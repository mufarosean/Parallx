// Planner Built-In Tool — M82 activation entry point.
//
// Registers parallx.planner: own SQLite tables (planner_tasks +
// planner_events), sidebar view, editor pane (Tasks + Calendar tabs),
// three chat tools (captureTask / captureEvent / read), three dashboard
// widgets (tasks summary, calendar agenda, calendar view), and an
// in-process reminder scheduler.
//
// Sync provider registration hook (registerSyncProvider) ships in M82 so
// a future Google Calendar provider can plug in without a migration.

import { isDevMode } from '../../platform/devMode.js';
import './planner.css';

import { toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import { PlannerDataService } from './plannerDataService.js';
import type { ICalendarSyncProvider } from './plannerTypes.js';
import { PlannerSidebar } from './plannerSidebar.js';
import { PlannerEditorProvider } from './plannerEditorProvider.js';
import { PlannerReminderScheduler } from './plannerReminderScheduler.js';
import { registerPlannerChatTools } from './plannerChatTools.js';
import { registerPlannerDashboardWidgets } from './widgets/registerPlannerWidgets.js';
import { createPlannerSettingsPanel } from './plannerSettingsPanel.js';
import { settingsPanelRegistry } from '../../services/settingsPanelRegistry.js';

// ─── API surface ────────────────────────────────────────────────────────────

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
    openFileEditor?(uri: string, options?: { pinned?: boolean }): Promise<void>;
    focusEditor?(editorId: string): Promise<boolean>;
    readonly openEditors: readonly { id: string; name: string; description: string; isDirty: boolean; isActive: boolean; groupId: string }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
  window: {
    showInputBox?(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  chat?: {
    registerTool(toolId: string, def: {
      description: string;
      parameters: object;
      requiresConfirmation: boolean;
      handler: (args: unknown) => Promise<{ content: string; isError?: boolean }>;
    }): IDisposable;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
    registerInstance<T>(id: { readonly id: string }, instance: T): void;
  };
}

// ─── Module state ───────────────────────────────────────────────────────────

let _data: PlannerDataService | null = null;
let _scheduler: PlannerReminderScheduler | null = null;
const _syncProviders = new Map<string, ICalendarSyncProvider>();

// ─── Public registry surface (planner.getRegistry command) ──────────────────

export interface PlannerRegistry {
  /** Register a sync provider. Returns disposable. */
  registerSyncProvider(provider: ICalendarSyncProvider): IDisposable;
  /** Snapshot of currently registered providers. */
  listSyncProviders(): readonly ICalendarSyncProvider[];
  /** Direct access to the data service for in-process consumers. */
  readonly data: PlannerDataService;
}

// ─── Activate ───────────────────────────────────────────────────────────────

export async function activate(api: ParallxApi, context: ToolContext): Promise<void> {
  // 1. Migrations.
  await _runMigrations();

  // 2. Data service.
  _data = new PlannerDataService();
  context.subscriptions.push(_data);

  // 2b. Settings panel in the unified Settings hub. The sidebar's Settings row
  //     deep-links straight here via settings.open('planner').
  context.subscriptions.push(settingsPanelRegistry.register(createPlannerSettingsPanel(_data)));

  // 3. Sidebar view (lists tasks with filter chips).
  const sidebar = new PlannerSidebar(_data, {
    editors: api.editors,
    commands: api.commands,
    window: api.window,
  });
  context.subscriptions.push(sidebar);
  context.subscriptions.push(
    api.views.registerViewProvider('view.planner', {
      createView(container: HTMLElement): IDisposable {
        return sidebar.createView(container);
      },
    }),
  );

  // 4. Editor pane (Tasks + Calendar tabs).
  const editorProvider = new PlannerEditorProvider(_data, {
    editors: api.editors,
    commands: api.commands,
    window: api.window,
  });
  context.subscriptions.push(
    api.editors.registerEditorProvider('planner', {
      createEditorPane(container: HTMLElement, input?: unknown): IDisposable {
        return editorProvider.createEditorPane(container, input as { id: string; setName?(n: string): void; setIconHtml?(h: string | undefined): void } | undefined);
      },
    }),
  );

  // 5. Reminder scheduler.
  _scheduler = new PlannerReminderScheduler(_data, api);
  context.subscriptions.push(_scheduler);
  _scheduler.start();

  // 6. Chat tools (captureTask / captureEvent / read).
  if (api.chat?.registerTool) {
    context.subscriptions.push(registerPlannerChatTools(api.chat, _data));
  } else if (isDevMode) {
    console.warn('[Planner] api.chat.registerTool not available — chat tools skipped.');
  }

  // 7. Public registry surface (sync providers + data service handle).
  const publicRegistry: PlannerRegistry = {
    registerSyncProvider: (provider: ICalendarSyncProvider) => {
      _syncProviders.set(provider.id, provider);
      return toDisposable(() => { _syncProviders.delete(provider.id); });
    },
    listSyncProviders: () => [..._syncProviders.values()],
    get data() { return _data!; },
  };
  context.subscriptions.push(
    api.commands.registerCommand('planner.getRegistry', () => publicRegistry),
  );

  // 8. Dashboard widgets — only if the dashboard tool is up.
  //
  // Built-in tools all activate in parallel via Promise.allSettled in the
  // workbench (workbench.ts), so the dashboard tool may not have its
  // `dashboard.getRegistry` command in place yet when we land here.
  // Awaiting it once and silently swallowing the "Unknown command" throw
  // was the bug that made the planner widgets invisible in the picker
  // even though both tools were active.
  //
  // Fix: poll with a short backoff. If the dashboard is enabled at all it
  // activates within a handful of microtasks; if it's actually disabled
  // we give up cleanly after ~1.5s and move on.
  void (async () => {
    if (!_data) return;
    const attempts = [0, 30, 60, 120, 250, 500, 750];
    for (const delay of attempts) {
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      try {
        const dashboardRegistry = await api.commands.executeCommand<unknown>('dashboard.getRegistry');
        if (dashboardRegistry) {
          context.subscriptions.push(
            registerPlannerDashboardWidgets(dashboardRegistry as never, _data),
          );
          if (isDevMode) console.log('[Planner] dashboard widgets registered');
          return;
        }
      } catch {
        // command not registered yet — back off and try again
      }
    }
    if (isDevMode) console.log('[Planner] dashboard tool not available; widgets not registered');
  })();

  // 9. Commands.
  _registerCommands(api, context);

  if (isDevMode) console.log('[Planner] activated');
}

// ─── Deactivate ─────────────────────────────────────────────────────────────

export async function deactivate(): Promise<void> {
  _scheduler?.dispose();
  _data?.dispose();
  _scheduler = null;
  _data = null;
  _syncProviders.clear();
}

// ─── Migrations ─────────────────────────────────────────────────────────────

async function _runMigrations(): Promise<void> {
  const electron = (window as { parallxElectron?: { database?: { isOpen(): Promise<{ isOpen: boolean }>; migrate(dir: string): Promise<{ error: { code: string; message: string } | null }> }; appPath?: string; platform?: string } }).parallxElectron;
  if (!electron?.database || !electron.appPath) {
    console.warn('[Planner] Cannot run migrations — database or appPath not available');
    return;
  }
  const status = await electron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[Planner] Database not open — skipping migrations');
    return;
  }
  const sep = electron.platform === 'win32' ? '\\' : '/';
  const migrationsDir = [electron.appPath, 'src', 'built-in', 'planner', 'migrations'].join(sep);
  const result = await electron.database.migrate(migrationsDir);
  if (result.error) console.error('[Planner] Migration failed:', result.error.message);
  else if (isDevMode) console.log('[Planner] Migrations applied from:', migrationsDir);
}

// ─── Commands ───────────────────────────────────────────────────────────────

const PLANNER_ICON_HTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg>';

function _registerCommands(api: ParallxApi, context: ToolContext): void {
  context.subscriptions.push(
    api.commands.registerCommand('planner.open', async () => {
      await api.editors.openEditor({
        typeId: 'planner',
        title: 'Planner',
        iconHtml: PLANNER_ICON_HTML,
        instanceId: 'main',
      });
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('planner.newTask', async () => {
      try {
        // Open the planner editor first (so the popover has a host pane to
        // render against), then dispatch — the active pane catches it and
        // opens the full task popover with all fields wired up.
        await api.editors.openEditor({
          typeId: 'planner',
          title: 'Planner',
          iconHtml: PLANNER_ICON_HTML,
          instanceId: 'main',
        });
        document.dispatchEvent(new CustomEvent('parallx.planner.newTask'));
      } catch (err) {
        console.error('[Planner] newTask failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        await api.window.showErrorMessage(`Could not open new-task form: ${msg}`);
      }
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('planner.newEvent', async () => {
      if (!_data || !api.window.showInputBox) return;
      const title = await api.window.showInputBox({
        prompt: 'New event',
        placeholder: 'Title',
      });
      if (!title?.trim()) return;
      const now = new Date();
      now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
      try {
        await _data.createEvent({
          title: title.trim(),
          startAt: now.getTime(),
        });
      } catch (err) {
        console.error('[Planner] newEvent failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        await api.window.showErrorMessage(`Could not create event: ${msg}`);
      }
    }),
  );
}
