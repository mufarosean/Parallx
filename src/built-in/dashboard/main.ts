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

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import {
  getContributedDashboardWidgetTypes,
  onDashboardWidgetContributionsDidChange,
  type ContributedWidgetType,
} from '../../api/bridges/dashboardBridge.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { DashboardDataService } from './dashboardDataService.js';
import { DashboardWidgetRegistry } from './dashboardWidgetRegistry.js';
import { DashboardRefreshScheduler, validateRefreshPolicy } from './dashboardRefreshScheduler.js';
import { DashboardEditorProvider } from './dashboardEditorProvider.js';
import { DashboardSidebar } from './dashboardSidebar.js';
import type { DashboardRegistry, WidgetTypeRegistration, WorkbenchWidgetHost } from './dashboardTypes.js';
import { applyWidgetAppearance } from './widgetAppearance.js';
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
    getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined };
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

  // AI concurrency comes from the settings registry (M86 C4) — read live at
  // each admission decision so changes apply without restart.
  _scheduler = new DashboardRefreshScheduler(() => {
    try {
      const v = api.workspace.getConfiguration('dashboard').get<number>('aiRefreshConcurrency', 2);
      return typeof v === 'number' ? v : 2;
    } catch {
      return 2;
    }
  });
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
  //    (Legacy path — new code should use `api.dashboard.registerWidgetType`,
  //    which works regardless of activation order.)
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

  // 4a. The WORKBENCH widget host (one widget system, many hosts): the
  //     workbench seats widget instances as grid citizens; their rows live
  //     on the reserved workbench page so AI delivery, scheduling, and
  //     appearance work identically in both hosts. Same in-process command
  //     pattern as getRegistry.
  const workbenchHost: WorkbenchWidgetHost = {
    listWidgetTypes: () => _registry!.listWidgetTypes(),
    getWidgetType: (typeId) => _registry!.getWidgetType(typeId),
    onDidChangeTypes: (listener) => _registry!.onDidChange(listener),
    onDidChangeData: (listener) => _dataService!.onDidChange(listener),
    createInstance: async (widgetTypeId) => {
      const pageId = await _dataService!.ensureWorkbenchPage();
      const reg = _registry!.getWidgetType(widgetTypeId);
      const size = reg?.defaultSize ?? { rowSpan: 2, colSpan: 3 };
      return _dataService!.createWidget({
        pageId,
        widgetTypeId,
        placement: { row: 0, col: 0, rowSpan: size.rowSpan, colSpan: size.colSpan },
        config: { ...(reg?.defaultConfig ?? {}) },
        refreshPolicy: reg?.defaultRefreshPolicy ?? { kind: 'manual' },
        providerToolId: _registry!.getWidgetTypeOwner(widgetTypeId),
      });
    },
    getInstance: (id) => _dataService!.getWidget(id),
    removeInstance: async (id) => {
      _scheduler?.cancel(id);
      await _dataService!.removeWidget(id);
    },
    adoptInstance: async (id) => {
      const pageId = await _dataService!.ensureWorkbenchPage();
      return _dataService!.moveWidgetToPage(id, pageId);
    },
    setCachedOutput: (id, output) => _dataService!.setWidgetCachedOutput(id, output),
    setError: (id, message) => _dataService!.setWidgetError(id, message),
    clearError: (id) => _dataService!.clearWidgetError(id),
    updateAppearance: (id, appearance) => _dataService!.updateWidgetAppearance(id, appearance),
    refreshWidget: async (id) => {
      const row = await _dataService!.getWidget(id);
      if (!row) return;
      const typeReg = _registry!.getWidgetType(row.widgetTypeId);
      if (!typeReg?.refresh) return;
      await _scheduler!.runOnce(id, () => _headlessWidgetRefresh(api, id), typeReg);
    },
    scheduleWidget: async (id) => {
      const row = await _dataService!.getWidget(id);
      if (!row) return;
      const typeReg = _registry!.getWidgetType(row.widgetTypeId);
      if (!typeReg) return;
      _scheduler!.schedule(id, typeReg, row.refreshPolicy, () => _headlessWidgetRefresh(api, id));
    },
    cancelSchedule: (id) => _scheduler?.cancel(id),
    api: {
      editors: api.editors,
      commands: api.commands,
      window: api.window,
      services: api.services,
    },
    applyAppearance: applyWidgetAppearance,
  };
  context.subscriptions.push(
    api.commands.registerCommand('dashboard.getWorkbenchWidgetHost', () => workbenchHost),
  );

  // 4b. Mirror the `parallx.dashboard` contribution hub into the registry
  //     (M86). Tools register widget types through their own api bridge at
  //     any point — before or after this activate — and the mirror keeps
  //     the registry in sync, including live placeholder⇄widget swaps when
  //     an extension is disabled or (re-)enabled mid-session.
  const mirrored = new Map<string, { entry: ContributedWidgetType; disposable: IDisposable }>();
  const syncHub = (): void => {
    if (!_registry) return;
    const hub = new Map(getContributedDashboardWidgetTypes().map((e) => [e.registration.typeId, e]));
    // Drop mirrors whose hub entry vanished or was replaced.
    for (const [typeId, m] of [...mirrored]) {
      if (hub.get(typeId) !== m.entry) {
        m.disposable.dispose();
        mirrored.delete(typeId);
      }
    }
    // Register new / replaced contributions.
    for (const [typeId, entry] of hub) {
      if (mirrored.has(typeId)) continue;
      try {
        if (entry.registration.defaultRefreshPolicy) {
          validateRefreshPolicy(entry.registration.defaultRefreshPolicy);
        }
        const disposable = _registry.registerWidgetType(entry.registration, entry.ownerToolId);
        mirrored.set(typeId, { entry, disposable });
      } catch (err) {
        console.error(`[Dashboard] Rejected widget contribution "${typeId}" from "${entry.ownerToolId}":`, err);
      }
    }
  };
  syncHub();
  context.subscriptions.push(onDashboardWidgetContributionsDidChange(syncHub));
  context.subscriptions.push(toDisposable(() => {
    for (const m of mirrored.values()) m.disposable.dispose();
    mirrored.clear();
  }));

  // 5. Register built-in widgets contributed by this tool itself. These go
  //    straight into the registry (the dashboard owns them) with an explicit
  //    owner id so provider metadata is uniform across core and contributed.
  const coreRegistrar: DashboardRegistry = {
    registerWidgetType: <T = Record<string, unknown>>(registration: WidgetTypeRegistration<T>) => {
      if (registration.defaultRefreshPolicy) {
        validateRefreshPolicy(registration.defaultRefreshPolicy);
      }
      return _registry!.registerWidgetType(registration, 'parallx.dashboard');
    },
    listWidgetTypes: () => _registry!.listWidgetTypes(),
  };
  context.subscriptions.push(
    registerBuiltInDashboardWidgets(coreRegistrar, api),
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

  // 6c. Page-level refresh schedules (M86 C4) — headless. A page with a
  //     refresh policy fires whether or not it is open: every widget on it
  //     refreshes through the scheduler's admission queue (AI cap applies),
  //     writing results to the DB; any open editor repaints via the normal
  //     widget-cache change events.
  _setupPageSchedules(api, context);

  // (Recent-items tracking moved to the explorer tool in M86 — the explorer
  // owns file/page recency and contributes the "Recent items" widget.)

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

// ─── Page-level refresh schedules (M86 C4) ─────────────────────────────────
//
// Pages are few, so on any page change we simply cancel and rebuild every
// page schedule. Each fire enumerates the page's widgets and kicks their
// refreshes through the scheduler's runOnce — single-flight and the AI
// concurrency cap apply exactly as they do for per-widget schedules; the
// page job itself does not await AI turns (they run for minutes and report
// their own status/errors per widget).

function _setupPageSchedules(api: ParallxApi, context: ToolContext): void {
  const pageDisposables = new Map<string, IDisposable>();

  const refreshWholePage = async (pageId: string): Promise<void> => {
    if (!_dataService || !_registry || !_scheduler) return;
    let rows;
    try {
      rows = await _dataService.listWidgets(pageId);
    } catch (err) {
      console.warn('[Dashboard] page-schedule fire failed to list widgets:', err);
      return;
    }
    for (const row of rows) {
      const typeReg = _registry.getWidgetType(row.widgetTypeId);
      if (!typeReg?.refresh) continue;
      void _scheduler.runOnce(row.id, () => _headlessWidgetRefresh(api, row.id), typeReg)
        .catch((err) => console.warn(`[Dashboard] page-schedule refresh failed for ${row.id}:`, err));
    }
  };

  const sync = async (): Promise<void> => {
    if (!_dataService || !_scheduler) return;
    let pages;
    try {
      pages = await _dataService.listPages();
    } catch { return; }

    const seen = new Set<string>();
    for (const page of pages) {
      const key = `page:${page.id}`;
      seen.add(key);
      // Rebuild unconditionally — schedule() is idempotent per instanceId
      // and pages are few; diffing policies isn't worth the state.
      pageDisposables.get(key)?.dispose();
      pageDisposables.delete(key);
      if (!page.refreshPolicy || page.refreshPolicy.kind === 'manual') continue;
      try {
        validateRefreshPolicy(page.refreshPolicy);
      } catch (err) {
        console.warn(`[Dashboard] invalid page schedule for "${page.name}":`, err);
        continue;
      }
      // The page job itself is instant fan-out — treat it as 'query' so it
      // never occupies an AI slot; individual AI widgets are admitted (and
      // capped) by their own runOnce calls.
      const pseudoType: WidgetTypeRegistration<Record<string, unknown>> = {
        typeId: 'parallx.dashboard.__page-schedule__',
        displayName: 'Page schedule',
        category: 'query',
        defaultSize: { colSpan: 1, rowSpan: 1 },
        defaultConfig: {},
        createWidget: () => ({ dispose() { /* never mounted */ } }),
      };
      const d = _scheduler.schedule(key, pseudoType, page.refreshPolicy, () => refreshWholePage(page.id));
      pageDisposables.set(key, d);
    }
    for (const [key, d] of [...pageDisposables]) {
      if (!seen.has(key)) {
        d.dispose();
        pageDisposables.delete(key);
      }
    }
  };

  void sync();
  if (_dataService) {
    context.subscriptions.push(_dataService.onDidChange((e) => {
      if (e.kind.startsWith('page-')) void sync();
    }));
  }
  context.subscriptions.push({
    dispose() {
      for (const d of pageDisposables.values()) d.dispose();
      pageDisposables.clear();
    },
  });
}

/**
 * Refresh one widget with no editor mounted: run its refresh handler and
 * persist the outcome. Open editors repaint through the widget-cache /
 * widget-status change events this write fires.
 */
async function _headlessWidgetRefresh(api: ParallxApi, widgetId: string): Promise<void> {
  if (!_dataService || !_registry) return;
  const row = await _dataService.getWidget(widgetId);
  if (!row) return;
  const typeReg = _registry.getWidgetType(row.widgetTypeId);
  if (!typeReg?.refresh) return;
  const prevCachedAt = row.cachedAt;
  try {
    const output = await typeReg.refresh({
      instanceId: row.id,
      pageId: row.pageId,
      config: row.config,
      api,
      cachedOutput: row.cachedOutput,
      mode: 'background',
      // A page-schedule fire is automation, not a user gesture — say so
      // explicitly instead of relying on downstream defaults (M90).
      initiator: 'autonomous',
    });
    if (typeof output === 'string') {
      await _dataService.setWidgetCachedOutput(row.id, output);
      return;
    }
    // Honesty check (mirrors the editor path): a "successful" AI turn that
    // never called dashboard_render_widget delivered nothing — record a real
    // error instead of clearing one over stale content.
    const fresh = await _dataService.getWidget(row.id);
    if (typeReg.category === 'ai' && fresh && fresh.cachedAt === prevCachedAt) {
      await _dataService.setWidgetError(row.id,
        'The refresh turn completed but never delivered content to this widget '
        + '(dashboard_render_widget was not called). Check the Autonomy Log for the full run.');
      return;
    }
    await _dataService.clearWidgetError(row.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await _dataService.setWidgetError(row.id, msg);
  }
}

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

