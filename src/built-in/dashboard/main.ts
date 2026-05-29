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

  // 5b. Register the shared `renderToWidget` AI tool. This is the single
  //     channel through which the AI delivers content to ANY widget surface:
  //     an AI-backed widget's refresh sends a prompt to the active chat
  //     session asking the model to research/compute, then call this tool with
  //     its own instanceId and the finished content. Writing the cache fires a
  //     `widget-cache` change event, which the open editor reconciles into a
  //     live repaint — no widget-specific plumbing required.
  if (api.chat?.registerTool) {
    context.subscriptions.push(
      api.chat.registerTool('renderToWidget', {
        description:
          'Deliver finished content to a dashboard widget. Call this once you have gathered and formatted the result a widget asked for. The widget instructed you which instanceId to target. Content is Markdown and replaces whatever the widget currently shows.',
        parameters: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'The widget instance id provided in the request. Deliver to exactly this id.' },
            content: { type: 'string', description: 'The finished Markdown to display in the widget.' },
          },
          required: ['instanceId', 'content'],
        },
        handler: async (args: Record<string, unknown>) => {
          const instanceId = typeof args.instanceId === 'string' ? args.instanceId.trim() : '';
          const content = typeof args.content === 'string' ? args.content : '';
          if (!instanceId) return { isError: true, content: 'Error: instanceId is required.' };
          if (!_dataService) return { isError: true, content: 'Error: dashboard is not ready.' };
          const widget = await _dataService.getWidget(instanceId);
          if (!widget) return { isError: true, content: `Error: no widget with instanceId "${instanceId}".` };
          if (!content.trim()) return { isError: true, content: 'Error: content is empty.' };
          await _dataService.setWidgetCachedOutput(instanceId, content);
          return { isError: false, content: `Delivered ${content.length} characters to widget ${instanceId}.` };
        },
        requiresConfirmation: false,
      }),
    );
  }

  // 6. Register commands the user / picker can invoke.
  _registerCommands(api, context);

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

  // dashboard.addWidget / dashboard.toggleEditMode / dashboard.refreshAll —
  // forward to whatever dashboard editor pane is currently active. Phase 1
  // wires them as command-palette entries; the pane reacts via DOM events
  // (simpler than threading editor focus tracking now).
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.addWidget', () => {
      document.dispatchEvent(new CustomEvent('parallx.dashboard.addWidget'));
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.toggleEditMode', () => {
      document.dispatchEvent(new CustomEvent('parallx.dashboard.toggleEditMode'));
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.refreshAll', () => {
      document.dispatchEvent(new CustomEvent('parallx.dashboard.refreshAll'));
    }),
  );
}
