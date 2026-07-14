// Dashboard Built-In Tool — M71 activation entry point.
//
// What this tool does:
//   - Owns the editor type `dashboard` (one editor instance per dashboard page).
//   - Runs its own SQLite migrations on the shared workspace DB.
//   - Owns the workspace's widget contribution registry — other tools register
//     widget types here at activate-time.
//   - Owns the refresh scheduler — manual / interval / cron, headless when the
//     dashboard isn't open.
//   - Auto-creates a default dashboard page on first workspace open and opens
//     it for the user.
//
// Phase 1 ships the framework (grid, chrome, picker shell, persistence) plus
// no widgets yet. Phases 2-5 add widgets and richer interaction.

import { isDevMode } from '../../platform/devMode.js';
import './dashboard.css';

import type { IDisposable } from '../../platform/lifecycle.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { DashboardDataService } from './dashboardDataService.js';
import { DashboardWidgetRegistry } from './dashboardWidgetRegistry.js';
import { DashboardRefreshScheduler, validateRefreshPolicy } from './dashboardRefreshScheduler.js';
import { DashboardEditorProvider } from './dashboardEditorProvider.js';
import { DashboardSidebar } from './dashboardSidebar.js';
import type { DashboardRegistry, WidgetTypeRegistration } from './dashboardTypes.js';
import { registerBuiltInDashboardWidgets } from './widgets/builtInWidgets.js';
import { IEditorService } from '../../services/serviceTypes.js';

// ─── Minimal Parallx API surface (kept narrow on purpose) ────────────────────

interface ParallxApi {
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: Record<string, unknown>): IDisposable;
  };
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement, input?: unknown): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
    closeEditor(editorId: string): Promise<boolean>;
    openFileEditor?(uri: string, options?: { pinned?: boolean }): Promise<void>;
    focusEditor?(editorId: string): Promise<boolean>;
    readonly openEditors: readonly { id: string; name: string; description: string; isDirty: boolean; isActive: boolean; groupId: string }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
  workspace: {
    readonly workspaceFolders: readonly { uri: string; name: string; index: number }[] | undefined;
    readonly name: string | undefined;
    readonly fs?: unknown;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
    registerInstance<T>(id: { readonly id: string }, instance: T): void;
  };
  chat?: {
    registerTool(
      name: string,
      def: {
        description: string;
        parameters: Record<string, unknown>;
        handler: (args: Record<string, unknown>, token?: unknown) => Promise<{ content: string; isError?: boolean }>;
        requiresConfirmation: boolean;
      },
    ): IDisposable;
  };
}

// ─── Module state ───────────────────────────────────────────────────────────

let _dataService: DashboardDataService | null = null;
let _registry: DashboardWidgetRegistry | null = null;
let _scheduler: DashboardRefreshScheduler | null = null;

// Recency-ordered list of opened files + canvas pages (Recent Items widget).
interface RecentItem {
  /** Dedup key: `file:<uri>` or `page:<pageId>`. */
  readonly key: string;
  readonly kind: 'file' | 'page';
  readonly title: string;
  /** File URI (kind 'file') or page id (kind 'page') — used to reopen. */
  readonly target: string;
  readonly ts: number;
}
const RECENT_ITEMS_KEY = 'dashboard.recentItems';
const RECENT_ITEMS_CAP = 30;
let _recentItems: RecentItem[] = [];

// ─── Activate ───────────────────────────────────────────────────────────────

export async function activate(api: ParallxApi, context: ToolContext): Promise<void> {

  // 1. Run migrations on the shared workspace DB.
  await _runMigrations();

  // 2. Construct services.
  _dataService = new DashboardDataService();
  context.subscriptions.push(_dataService);

  _registry = new DashboardWidgetRegistry();
  context.subscriptions.push(_registry);

  _scheduler = new DashboardRefreshScheduler();
  context.subscriptions.push(_scheduler);

  // 3. Editor provider for `typeId: 'dashboard'`.
  const provider = new DashboardEditorProvider(
    _dataService,
    _registry,
    _scheduler,
    {
      editors: api.editors,
      commands: api.commands,
      window: api.window,
      services: api.services,
    },
  );
  context.subscriptions.push(
    api.editors.registerEditorProvider('dashboard', {
      createEditorPane(container: HTMLElement, input?: unknown): IDisposable {
        return provider.createEditorPane(container, input as { id: string; setName?(n: string): void; setIconHtml?(h: string | undefined): void } | undefined);
      },
    }),
  );

  // 3b. Sidebar view — the ribbon discovery surface. Lists dashboard pages,
  //     active highlight follows the editor, click opens.
  const sidebar = new DashboardSidebar(_dataService, {
    editors: api.editors,
    commands: api.commands,
    window: api.window,
  });
  context.subscriptions.push(sidebar);
  context.subscriptions.push(
    api.views.registerViewProvider('view.dashboard', {
      createView(container: HTMLElement): IDisposable {
        return sidebar.createView(container);
      },
    }),
  );

  // 4. Expose a public registry surface so widget-contributing tools can find it.
  const publicRegistry: DashboardRegistry = {
    registerWidgetType: <T = Record<string, unknown>>(registration: WidgetTypeRegistration<T>) => {
      // Validate refresh policy up front so bad widgets fail fast.
      if (registration.defaultRefreshPolicy) {
        validateRefreshPolicy(registration.defaultRefreshPolicy);
      }
      return _registry!.registerWidgetType(registration);
    },
    listWidgetTypes: () => _registry!.listWidgetTypes(),
  };
  // Surface via a command for tools that haven't yet been given DI access.
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.getRegistry', () => publicRegistry),
  );

  // 5. Register built-in widgets contributed by this tool itself.
  context.subscriptions.push(
    registerBuiltInDashboardWidgets(publicRegistry, api),
  );

  // 5b. Register the shared `dashboard_render_widget` AI tool. This is the single
  //     channel through which the AI delivers content to ANY widget surface:
  //     an AI-backed widget's refresh sends a prompt to the active chat
  //     session asking the model to research/compute, then call this tool with
  //     its own instanceId and the finished content. Writing the cache fires a
  //     `widget-cache` change event, which the open editor reconciles into a
  //     live repaint — no widget-specific plumbing required.
  if (api.chat?.registerTool) {
    context.subscriptions.push(
      api.chat.registerTool('dashboard_render_widget', {
        description:
          'Deliver finished content to a dashboard widget. Call this once you have gathered and formatted the result a widget asked for. Identify the target either by the instanceId the widget gave you, or by its title (the name shown on the widget) — supply at least one. Content replaces whatever the widget currently shows: send Markdown for a normal widget, or a self-contained HTML fragment for a Live (HTML) widget — follow the format the widget’s request asked for.',
        parameters: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'The widget instance id provided in the request. Deliver to exactly this id when you have it.' },
            title: { type: 'string', description: 'The widget\u2019s title, used to find it when no instanceId is given (e.g. the user said "update my Morning News widget"). Must match exactly one widget.' },
            content: { type: 'string', description: 'The finished Markdown to display in the widget.' },
          },
          required: ['content'],
        },
        handler: async (args: Record<string, unknown>) => {
          const instanceId = typeof args.instanceId === 'string' ? args.instanceId.trim() : '';
          const title = typeof args.title === 'string' ? args.title.trim() : '';
          const content = typeof args.content === 'string' ? args.content : '';
          if (!_dataService) return { isError: true, content: 'Error: dashboard is not ready.' };
          if (!content.trim()) return { isError: true, content: 'Error: content is empty.' };
          let widget = instanceId ? await _dataService.getWidget(instanceId) : null;
          if (!widget && title) widget = await _dataService.findWidgetByTitle(title);
          if (!widget) {
            if (instanceId) return { isError: true, content: `Error: no widget with instanceId "${instanceId}".` };
            if (title) return { isError: true, content: `Error: no single widget titled "${title}" (it may not exist or more than one shares that title).` };
            return { isError: true, content: 'Error: provide an instanceId or a title to identify the target widget.' };
          }
          await _dataService.setWidgetCachedOutput(widget.id, content);
          return { isError: false, content: `Delivered ${content.length} characters to widget ${widget.id}.` };
        },
        requiresConfirmation: false,
      }),
    );
  }

  // 6. Register commands the user / picker can invoke.
  _registerCommands(api, context);

  // 6b. Track recently-opened files + canvas pages for the Recent Items widget.
  _setupRecentItems(api, context);

  // 7. Auto-open the dashboard on first workspace open. After that the user
  //    drives. We track this in workspaceState so reopen behaviour is
  //    deterministic and the dashboard doesn't fight workspace-restore.
  await _maybeAutoOpen(api, context);

  if (isDevMode) console.log('[Dashboard] activated');
}

// ─── Deactivate ─────────────────────────────────────────────────────────────

export async function deactivate(): Promise<void> {
  _scheduler?.dispose();
  _registry?.dispose();
  _dataService?.dispose();
  _scheduler = null;
  _registry = null;
  _dataService = null;
}

// ─── Migrations ─────────────────────────────────────────────────────────────

async function _runMigrations(): Promise<void> {
  const electron = (window as { parallxElectron?: { database?: { isOpen(): Promise<{ isOpen: boolean }>; migrate(dir: string): Promise<{ error: { code: string; message: string } | null }> }; appPath?: string; platform?: string } }).parallxElectron;
  if (!electron?.database || !electron.appPath) {
    console.warn('[Dashboard] Cannot run migrations — database or appPath not available');
    return;
  }
  const status = await electron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[Dashboard] Database not open — skipping migrations');
    return;
  }
  const sep = electron.platform === 'win32' ? '\\' : '/';
  const migrationsDir = [electron.appPath, 'src', 'built-in', 'dashboard', 'migrations'].join(sep);
  const result = await electron.database.migrate(migrationsDir);
  if (result.error) {
    console.error('[Dashboard] Migration failed:', result.error.message);
  } else if (isDevMode) {
    console.log('[Dashboard] Migrations applied from:', migrationsDir);
  }
}

// ─── Auto-open ──────────────────────────────────────────────────────────────

const FIRST_OPEN_KEY = 'dashboard.firstOpenComplete';

async function _maybeAutoOpen(api: ParallxApi, context: ToolContext): Promise<void> {
  if (!_dataService) return;
  const alreadyOpened = context.workspaceState.get<boolean>(FIRST_OPEN_KEY, false);
  if (alreadyOpened) return;

  try {
    const page = await _dataService.ensureDefaultPage();
    await api.editors.openEditor({
      typeId: 'dashboard',
      title: page.name || 'Dashboard',
      iconHtml: _DASHBOARD_ICON_HTML,
      instanceId: page.id,
    });
    await context.workspaceState.update(FIRST_OPEN_KEY, true);
  } catch (err) {
    console.warn('[Dashboard] Auto-open failed:', err);
  }
}

// Inline SVG for tab icon. Kept in sync with the editor provider's header icon.
const _DASHBOARD_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

// ─── Commands ──────────────────────────────────────────────────────────────

function _registerCommands(api: ParallxApi, context: ToolContext): void {
  // dashboard.open — open (or focus) the first dashboard page.
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.open', async () => {
      if (!_dataService) return;
      try {
        const page = await _dataService.ensureDefaultPage();
        await api.editors.openEditor({
          typeId: 'dashboard',
          title: page.name || 'Dashboard',
          iconHtml: _DASHBOARD_ICON_HTML,
          instanceId: page.id,
        });
      } catch (err) {
        console.error('[Dashboard] open failed:', err);
        await api.window.showErrorMessage('Could not open dashboard.');
      }
    }),
  );

  // dashboard.newPage — create a fresh dashboard and open it.
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.newPage', async () => {
      if (!_dataService) return;
      try {
        const pages = await _dataService.listPages();
        const used = new Set(pages.map(p => p.name));
        let name = 'Dashboard';
        if (used.has(name)) {
          for (let i = 2; i < 99; i++) {
            const candidate = `Dashboard ${i}`;
            if (!used.has(candidate)) { name = candidate; break; }
          }
        }
        const page = await _dataService.createPage(name);
        await api.editors.openEditor({
          typeId: 'dashboard',
          title: page.name || 'Dashboard',
          iconHtml: _DASHBOARD_ICON_HTML,
          instanceId: page.id,
        });
      } catch (err) {
        console.error('[Dashboard] newPage failed:', err);
        await api.window.showErrorMessage('Could not create dashboard.');
      }
    }),
  );

  // dashboard.addWidget / dashboard.refreshAll — forward to whatever dashboard
  // editor pane is currently active. Phase 1
  // wires them as command-palette entries; the pane reacts via DOM events
  // (simpler than threading editor focus tracking now).
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.addWidget', () => {
      document.dispatchEvent(new CustomEvent('parallx.dashboard.addWidget'));
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.refreshAll', () => {
      document.dispatchEvent(new CustomEvent('parallx.dashboard.refreshAll'));
    }),
  );
}

// ─── Recent items ─────────────────────────────────────────────────────────────
//
// ONE recency-ordered list of everything the user opened — explorer files AND
// canvas pages — captured from the editor service's active-editor changes, the
// single signal both surfaces flow through (which is why the old Ctrl+P-only
// list never saw explorer/canvas opens). Persisted per-workspace so it survives
// reloads; the Recent Items widget reads it via `dashboard.getRecentItems`.

function _setupRecentItems(api: ParallxApi, context: ToolContext): void {
  try {
    const saved = context.workspaceState.get<RecentItem[]>(RECENT_ITEMS_KEY, []);
    if (Array.isArray(saved)) {
      _recentItems = saved.filter((x): x is RecentItem => !!x && typeof x.key === 'string' && typeof x.title === 'string');
    }
  } catch { /* fresh start */ }

  // Expose the read command regardless — if the editor service is unavailable
  // the widget still shows whatever was persisted.
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.getRecentItems', () => _recentItems),
  );

  let editorService: IEditorService | undefined;
  try {
    editorService = api.services.has(IEditorService) ? api.services.get<IEditorService>(IEditorService) : undefined;
  } catch { editorService = undefined; }
  if (!editorService) return;

  const record = (input: { readonly id: string; readonly name: string; readonly uri?: { toString(): string } } | undefined): void => {
    if (!input) return;
    let item: RecentItem | null = null;
    if (input.uri) {
      const uri = input.uri.toString();
      item = { key: 'file:' + uri, kind: 'file', title: input.name || _basename(uri), target: uri, ts: Date.now() };
    } else {
      // Canvas editor ids look like `parallx.canvas:canvas:<pageId>` /
      // `…:database:<pageId>`. Anything else (dashboard, welcome) is skipped.
      const parts = (input.id || '').split(':');
      if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
        const pageId = parts.slice(2).join(':');
        item = { key: 'page:' + pageId, kind: 'page', title: input.name || 'Untitled', target: pageId, ts: Date.now() };
      }
    }
    if (!item) return;
    const next = item;
    _recentItems = [next, ..._recentItems.filter((r) => r.key !== next.key)].slice(0, RECENT_ITEMS_CAP);
    void context.workspaceState.update(RECENT_ITEMS_KEY, _recentItems);
  };

  record(editorService.activeEditor);
  context.subscriptions.push(editorService.onDidActiveEditorChange(record));
}

function _basename(uri: string): string {
  const clean = uri.split('?')[0].replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = clean.lastIndexOf('/');
  const name = idx >= 0 ? clean.slice(idx + 1) : clean;
  try { return decodeURIComponent(name) || uri; } catch { return name || uri; }
}
