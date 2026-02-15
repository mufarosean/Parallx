// Canvas Built-In Tool — main activation entry point
//
// Implements:
//   • CanvasDataService creation and migration (Task 3.2)
//   • Sidebar view provider registration for page tree (deferred to Cap 4)
//   • Editor provider registration for Canvas panes (deferred to Cap 5)
//   • Command handlers for page CRUD
//
// Follows the same pattern as src/built-in/explorer/main.ts.

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { CanvasDataService } from './canvasDataService.js';
import { CanvasSidebar } from './canvasSidebar.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: Record<string, unknown>): IDisposable;
    setBadge(containerId: string, badge: { count?: number; dot?: boolean } | undefined): void;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  workspace: {
    readonly workspaceFolders: readonly { uri: string; name: string; index: number }[] | undefined;
    getWorkspaceFolder(uri: string): { uri: string; name: string; index: number } | undefined;
    readonly name: string | undefined;
    getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined; has(key: string): boolean };
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInputBox(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
  };
  context: {
    createContextKey<T extends string | number | boolean | undefined>(name: string, defaultValue: T): { key: string; get(): T; set(value: T): void; reset(): void };
  };
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
    readonly openEditors: readonly { id: string; name: string; description: string; isDirty: boolean; isActive: boolean; groupId: string }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
}

// ─── Module State ────────────────────────────────────────────────────────────

let _api: ParallxApi;
let _context: ToolContext;
let _dataService: CanvasDataService | null = null;
let _sidebar: CanvasSidebar | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export async function activate(api: ParallxApi, context: ToolContext): Promise<void> {
  _api = api;
  _context = context;

  // 1. Run Canvas migrations on the open database
  await _runMigrations();

  // 2. Create CanvasDataService
  _dataService = new CanvasDataService();
  context.subscriptions.push(_dataService);

  // 3. Register sidebar view provider for page tree (Cap 4)
  _sidebar = new CanvasSidebar(_dataService, api);
  context.subscriptions.push(
    api.views.registerViewProvider('view.canvas', {
      createView(container: HTMLElement): IDisposable {
        return _sidebar!.createView(container);
      },
    }),
  );

  // 4. Register editor provider for Canvas panes (Cap 5)
  // Placeholder: registers a minimal editor that will be implemented in Cap 5
  context.subscriptions.push(
    api.editors.registerEditorProvider('canvas', {
      createEditorPane(container: HTMLElement): IDisposable {
        container.textContent = 'Canvas editor — coming in Capability 5';
        return { dispose() {} };
      },
    }),
  );

  // 5. Register command handlers
  _registerCommands(api, context);

  console.log('[Canvas] Tool activated');
}

export async function deactivate(): Promise<void> {
  // Flush any pending auto-saves before teardown
  if (_dataService) {
    await _dataService.flushPendingSaves();
  }

  // Clear module-level state
  _dataService = null;
  _sidebar = null;
  _api = undefined!;
  _context = undefined!;

  console.log('[Canvas] Tool deactivated');
}

// ─── Migrations ──────────────────────────────────────────────────────────────

async function _runMigrations(): Promise<void> {
  const electron = (window as any).parallxElectron;
  if (!electron?.database || !electron.appPath) {
    console.warn('[Canvas] Cannot run migrations — database or appPath not available');
    return;
  }

  // Check if database is open
  const status = await electron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[Canvas] Database not open — skipping migrations');
    return;
  }

  // Resolve migrations directory from the app root
  // In dev: <appPath>/src/built-in/canvas/migrations
  const sep = electron.platform === 'win32' ? '\\' : '/';
  const migrationsDir = [electron.appPath, 'src', 'built-in', 'canvas', 'migrations'].join(sep);
  const result = await electron.database.migrate(migrationsDir);
  if (result.error) {
    console.error('[Canvas] Migration failed:', result.error.message);
  } else {
    console.log('[Canvas] Migrations applied from:', migrationsDir);
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

function _registerCommands(api: ParallxApi, context: ToolContext): void {
  // canvas.newPage — Create a new page at root level
  context.subscriptions.push(
    api.commands.registerCommand('canvas.newPage', async () => {
      if (!_dataService) return;
      try {
        const page = await _dataService.createPage();
        // Open the new page in the editor
        await api.editors.openEditor({
          typeId: 'canvas',
          title: page.title,
          icon: page.icon ?? '📄',
          instanceId: page.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to create page:', err);
        await api.window.showErrorMessage('Failed to create page.');
      }
    }),
  );

  // canvas.deletePage — Delete the selected page (requires pageId argument)
  context.subscriptions.push(
    api.commands.registerCommand('canvas.deletePage', async (...args: unknown[]) => {
      if (!_dataService) return;
      const pageId = args[0] as string | undefined;
      if (!pageId) {
        console.warn('[Canvas] canvas.deletePage called without pageId');
        return;
      }

      const page = await _dataService.getPage(pageId);
      if (!page) return;

      const confirmation = await api.window.showWarningMessage(
        `Delete "${page.title}"? This cannot be undone.`,
        { title: 'Delete' },
        { title: 'Cancel' },
      );
      if (confirmation?.title !== 'Delete') return;

      try {
        await _dataService.deletePage(pageId);
      } catch (err) {
        console.error('[Canvas] Failed to delete page:', err);
        await api.window.showErrorMessage('Failed to delete page.');
      }
    }),
  );

  // canvas.renamePage — Rename a page (requires pageId argument)
  context.subscriptions.push(
    api.commands.registerCommand('canvas.renamePage', async (...args: unknown[]) => {
      if (!_dataService) return;
      const pageId = args[0] as string | undefined;
      if (!pageId) return;

      const page = await _dataService.getPage(pageId);
      if (!page) return;

      const newTitle = await api.window.showInputBox({
        prompt: 'Enter new page title',
        value: page.title,
      });
      if (newTitle === undefined || newTitle === page.title) return;

      try {
        await _dataService.updatePage(pageId, { title: newTitle || 'Untitled' });
      } catch (err) {
        console.error('[Canvas] Failed to rename page:', err);
        await api.window.showErrorMessage('Failed to rename page.');
      }
    }),
  );

  // canvas.duplicatePage — Duplicate a page (requires pageId argument)
  context.subscriptions.push(
    api.commands.registerCommand('canvas.duplicatePage', async (...args: unknown[]) => {
      if (!_dataService) return;
      const pageId = args[0] as string | undefined;
      if (!pageId) return;

      const original = await _dataService.getPage(pageId);
      if (!original) return;

      try {
        const copy = await _dataService.createPage(original.parentId, `${original.title} (copy)`);
        // Copy the content
        if (original.content) {
          await _dataService.updatePage(copy.id, { content: original.content, icon: original.icon });
        }
        // Open the duplicate in the editor
        await api.editors.openEditor({
          typeId: 'canvas',
          title: copy.title,
          icon: copy.icon ?? '📄',
          instanceId: copy.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to duplicate page:', err);
        await api.window.showErrorMessage('Failed to duplicate page.');
      }
    }),
  );
}

// ─── Exported for internal use by sidebar / editor ───────────────────────────

/** Access the Canvas data service from other Canvas modules. */
export function getDataService(): CanvasDataService | null {
  return _dataService;
}

/** Access the API from other Canvas modules. */
export function getApi(): ParallxApi {
  return _api;
}
