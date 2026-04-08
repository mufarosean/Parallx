// Canvas Built-In Tool â€” main activation entry point
//
// Implements:
//   â€¢ CanvasDataService creation and migration (Task 3.2)
//   â€¢ Sidebar view provider registration for page tree (deferred to Cap 4)
//   â€¢ Editor provider registration for Canvas panes (deferred to Cap 5)
//   â€¢ Command handlers for page CRUD
//
// Follows the same pattern as src/built-in/explorer/main.ts.

import { isDevMode } from '../../platform/devMode.js';

import './canvas.css';
import 'katex/dist/katex.min.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { IIndexingPipelineService, IVectorStoreService } from '../../services/serviceTypes.js';
import { CanvasDataService } from './canvasDataService.js';
import type { ICanvasDataService } from './canvasTypes.js';
import { PageChangeKind } from './canvasTypes.js';
import type { PageChangeEvent, PageUpdateField } from './canvasTypes.js';
import { CanvasSidebar } from './canvasSidebar.js';
import { CanvasEditorProvider } from './canvasEditorProvider.js';
import { setOnLinkedPageBlockDeleted } from './config/blockRegistry.js';
import { PropertyDataService } from './properties/propertyDataService.js';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    readonly onDidChangeWorkspaceFolders: (listener: (e: { added: readonly { uri: string; name: string; index: number }[]; removed: readonly { uri: string; name: string; index: number }[] }) => void) => IDisposable;
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
    closeEditor(editorId: string): Promise<boolean>;
    readonly openEditors: readonly { id: string; name: string; description: string; isDirty: boolean; isActive: boolean; groupId: string }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
  };
}

const CANVAS_PAGE_REINDEX_DEBOUNCE_MS = 3_000;

function buildIndexedPagePayloadKey(page: { title: string; content: string }): string {
  return JSON.stringify({ title: page.title, content: page.content });
}

const INDEX_METADATA_PAGE_FIELDS: ReadonlySet<PageUpdateField> = new Set([
  'title',
]);

function doesPageChangeAffectIndexMetadata(event: PageChangeEvent): boolean {
  if (event.kind === PageChangeKind.Created || event.kind === PageChangeKind.Deleted) {
    return true;
  }

  if (event.kind !== PageChangeKind.Updated) {
    return false;
  }

  if (!event.changedFields || event.changedFields.length === 0) {
    return true;
  }

  return event.changedFields.some((field) => INDEX_METADATA_PAGE_FIELDS.has(field));
}

// â”€â”€â”€ Module State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _api: ParallxApi;
let _dataService: CanvasDataService | null = null;
let _sidebar: CanvasSidebar | null = null;
let _propertyService: PropertyDataService | null = null;

// â”€â”€â”€ Activation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function activate(api: ParallxApi, context: ToolContext): Promise<void> {
  _api = api;

  const getIndexingPipeline = () => api.services.has(IIndexingPipelineService)
    ? api.services.get<import('../../services/serviceTypes.js').IIndexingPipelineService>(IIndexingPipelineService)
    : undefined;
  const getVectorStore = () => api.services.has(IVectorStoreService)
    ? api.services.get<import('../../services/serviceTypes.js').IVectorStoreService>(IVectorStoreService)
    : undefined;
  const pendingPageReindexes = new Map<string, ReturnType<typeof setTimeout>>();
  const queuedPagePayloads = new Map<string, string>();
  const runningPagePayloads = new Map<string, string>();

  const cancelPendingPageReindex = (pageId: string): void => {
    const timer = pendingPageReindexes.get(pageId);
    if (timer) {
      clearTimeout(timer);
      pendingPageReindexes.delete(pageId);
    }
  };

  const schedulePageReindexForPayload = (page: { id: string; title: string; content: string } | null | undefined): void => {
    if (!page) {
      return;
    }

    const nextPayloadKey = buildIndexedPagePayloadKey(page);
    const currentPayloadKey = queuedPagePayloads.get(page.id);
    const runningPayloadKey = runningPagePayloads.get(page.id);
    if (currentPayloadKey === nextPayloadKey || runningPayloadKey === nextPayloadKey) {
      return;
    }

    queuedPagePayloads.set(page.id, nextPayloadKey);
    if (pendingPageReindexes.has(page.id)) {
      return;
    }

    const timer = setTimeout(() => {
      pendingPageReindexes.delete(page.id);

      const latestPayloadKey = queuedPagePayloads.get(page.id);
      if (!latestPayloadKey) {
        return;
      }

      runningPagePayloads.set(page.id, latestPayloadKey);

      const indexingPipeline = getIndexingPipeline();
      if (!indexingPipeline) {
        return;
      }

      void indexingPipeline.reindexPage(page.id).catch((err) => {
        console.warn('[Canvas] Failed to re-index saved page:', page.id, err);
      }).finally(() => {
        const finishedPayloadKey = runningPagePayloads.get(page.id);
        if (finishedPayloadKey === latestPayloadKey) {
          runningPagePayloads.delete(page.id);
        }

        if (queuedPagePayloads.get(page.id) !== latestPayloadKey) {
          const latestPage = _dataService?.getPage(page.id);
          void latestPage?.then((resolvedPage) => {
            schedulePageReindexForPayload(resolvedPage ?? undefined);
          }).catch((err) => {
            console.warn('[Canvas] Failed to reload page after re-index scheduling drift:', page.id, err);
          });
        }
      });
    }, CANVAS_PAGE_REINDEX_DEBOUNCE_MS);

    pendingPageReindexes.set(page.id, timer);
  };

  context.subscriptions.push({
    dispose() {
      for (const timer of pendingPageReindexes.values()) {
        clearTimeout(timer);
      }
      pendingPageReindexes.clear();
      queuedPagePayloads.clear();
      runningPagePayloads.clear();
    },
  });

  // 1. Run Canvas migrations on the open database
  await _runMigrations();

  // 2. Create CanvasDataService
  _dataService = new CanvasDataService();
  context.subscriptions.push(_dataService);

  // 2b. Create PropertyDataService and seed defaults
  _propertyService = new PropertyDataService();
  context.subscriptions.push(_propertyService);
  await _propertyService.ensureDefaultProperties();

  // 2a. parentId is the source of truth for hierarchy — no content reconciliation needed.

  // 3. Register sidebar view provider for page tree (Cap 4)
  _sidebar = new CanvasSidebar(_dataService, api);
  context.subscriptions.push(
    api.views.registerViewProvider('view.canvas', {
      createView(container: HTMLElement): IDisposable {
        return _sidebar!.createView(container);
      },
    }),
  );

  // 3a. Restore expanded state from workspace memento (Task 6.2)
  const savedExpandedIds = context.workspaceState.get<string[]>('canvas.expandedPages', []);
  if (savedExpandedIds.length > 0) {
    _sidebar.setExpandedIds(savedExpandedIds);
  }

  // 3b. Persist expanded state on change (Task 6.2)
  _sidebar.onExpandStateChanged = (expandedIds) => {
    context.workspaceState.update('canvas.expandedPages', [...expandedIds]);
  };

  // 4. Register editor provider for Canvas panes (Cap 5)
  const editorProvider = new CanvasEditorProvider(_dataService);
  editorProvider.setOpenEditor((opts) => api.editors.openEditor(opts));
  if (_propertyService) {
    editorProvider.setPropertyService(_propertyService);
  }
  context.subscriptions.push(
    api.editors.registerEditorProvider('canvas', {
      createEditorPane(container: HTMLElement, input?: any): IDisposable {
        return editorProvider.createEditorPane(container, input);
      },
    }),
  );

  // 4b. Wire inline AI provider from chat tool (M10 Phase 7 — Task 7.3)
  //     The chat tool may activate before or after the canvas tool.
  //     Try immediately, and if the command doesn't exist yet, it's okay —
  //     new editor panes created after the chat tool activates will get the provider.
  api.commands.executeCommand<{
    sendChatRequest: (...args: any[]) => AsyncIterable<any>;
    retrieveContext?: (query: string) => Promise<string | undefined>;
  }>('chat.getInlineAIProvider').then((provider) => {
    if (provider?.sendChatRequest) {
      editorProvider.setInlineAIProvider(provider.sendChatRequest, provider.retrieveContext);
    }
  }).catch(() => { /* chat tool not activated yet — that's fine */ });

  // 5. Register command handlers
  _registerCommands(api, context);

  // 5a. When a page-linked block (pageBlock, databaseInline) is deleted from
  //     editor content, run the normal page deletion process (same as sidebar).
  setOnLinkedPageBlockDeleted((pageId) => {
    if (!_dataService) return;
    _dataService.archivePage(pageId).catch(err => {
      console.error(`[Canvas] Failed to archive child page ${pageId} after block deletion:`, err);
    });
  });

  // 5b. Auto-close editor tabs when their page is deleted or archived
  context.subscriptions.push(
    _dataService.onDidChangePage(async (e) => {
      if (e.kind !== PageChangeKind.Deleted) return;
      // Editor IDs follow the pattern "parallx.canvas:<typeId>:<pageId>"
      // Check both canvas and database editors
      const editors = api.editors.openEditors;
      for (const ed of editors) {
        const parts = ed.id.split(':');
        if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
          const edPageId = parts.slice(2).join(':');
          if (edPageId === e.pageId) {
            await api.editors.closeEditor(ed.id);
          }
        }
      }
    }),
  );

  // 5c. Keep the knowledge index in sync with page lifecycle changes.
  context.subscriptions.push(
    _dataService.onDidSavePage((pageId) => {
      void _dataService?.getPage(pageId).then((page) => {
        schedulePageReindexForPayload(page ?? undefined);
      }).catch((err) => {
        console.warn('[Canvas] Failed to load saved page for re-index scheduling:', pageId, err);
      });
    }),
  );

  context.subscriptions.push(
    _dataService.onDidChangePage((event) => {
      if (!doesPageChangeAffectIndexMetadata(event)) {
        return;
      }

      if (event.kind === PageChangeKind.Deleted) {
        cancelPendingPageReindex(event.pageId);
        queuedPagePayloads.delete(event.pageId);
        runningPagePayloads.delete(event.pageId);
        const vectorStore = getVectorStore();
        if (!vectorStore) {
          return;
        }
        void vectorStore.deleteSource('page_block', event.pageId).catch((err) => {
          console.warn('[Canvas] Failed to remove deleted page from knowledge index:', event.pageId, err);
        });
        return;
      }

      const indexingPipeline = getIndexingPipeline();
      if (!indexingPipeline) {
        return;
      }

      schedulePageReindexForPayload(event.page);
    }),
  );

  // 5d. Re-index when page properties change (tags, dates, etc.)
  context.subscriptions.push(
    _propertyService.onDidChangePageProperty((event) => {
      // Invalidate dedup keys so the pipeline picks up the property change
      // (buildIndexedPagePayloadKey only hashes title+content, not properties)
      queuedPagePayloads.delete(event.pageId);
      runningPagePayloads.delete(event.pageId);

      void _dataService?.getPage(event.pageId).then((page) => {
        schedulePageReindexForPayload(page ?? undefined);
      }).catch((err) => {
        console.warn('[Canvas] Failed to load page for property re-index:', event.pageId, err);
      });
    }),
  );

  // 6. Track last-opened page for persistence (Task 6.3)
  context.subscriptions.push(
    api.editors.onDidChangeOpenEditors(() => {
      const editors = api.editors.openEditors;
      const active = editors.find((e: any) => e.isActive);
      if (!active) return;
      // Extract page ID from editor ID (format: "parallx.canvas:<typeId>:<pageId>")
      const parts = active.id.split(':');
      if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
        const pageId = parts.slice(2).join(':');
        context.workspaceState.update('canvas.lastOpenedPage', pageId);
      }
    }),
  );

  // 7. Restore last-opened page (Task 6.3)
  await _restoreLastOpenedPage(api, context, _dataService);

  // 8. Listen for workspace folder changes â€” run migrations when a folder is opened
  //    This handles the case where Canvas activates before any workspace is open.
  context.subscriptions.push(
    api.workspace.onDidChangeWorkspaceFolders(async (e) => {
      if (e.added.length > 0) {
        // A folder was added â€” database should now be open. Run migrations.
        // Small delay to let the database service open the DB file.
        await new Promise(r => setTimeout(r, 500));
        await _runMigrations();
        // Refresh the sidebar to show data from the new workspace
        _sidebar?.refresh();
      }
    }),
  );

  if (isDevMode) console.log('[Canvas] Tool activated');
}

export async function deactivate(): Promise<void> {
  // Flush any pending auto-saves before teardown
  if (_dataService) {
    await _dataService.flushPendingSaves();
  }

  // Clear module-level state
  _dataService = null;
  _sidebar = null;
  _propertyService = null;
  _api = undefined!;

  if (isDevMode) console.log('[Canvas] Tool deactivated');
}

// â”€â”€â”€ Migrations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _runMigrations(): Promise<void> {
  const electron = (window as any).parallxElectron;
  if (!electron?.database || !electron.appPath) {
    console.warn('[Canvas] Cannot run migrations â€” database or appPath not available');
    return;
  }

  // Check if database is open
  const status = await electron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[Canvas] Database not open â€” skipping migrations');
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
    if (isDevMode) console.log('[Canvas] Migrations applied from:', migrationsDir);
  }
}

// â”€â”€â”€ Restore Last-Opened Page (Task 6.3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _restoreLastOpenedPage(api: ParallxApi, context: ToolContext, dataService: ICanvasDataService): Promise<void> {
  const lastPageId = context.workspaceState.get<string>('canvas.lastOpenedPage');
  if (!lastPageId) return;

  try {
    const page = await dataService.getPage(lastPageId);
    if (!page) {
      // Page was deleted â€” clear stored value
      await context.workspaceState.update('canvas.lastOpenedPage', undefined);
      return;
    }
    await api.editors.openEditor({
      typeId: 'canvas',
      title: page.title,
      icon: page.icon ?? undefined,
      instanceId: page.id,
    });
  } catch (err) {
    console.warn('[Canvas] Failed to restore last-opened page:', err);
    await context.workspaceState.update('canvas.lastOpenedPage', undefined);
  }
}

// â”€â”€â”€ Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _registerCommands(api: ParallxApi, context: ToolContext): void {
  // canvas.newPage â€” Create a new page at root level
  context.subscriptions.push(
    api.commands.registerCommand('canvas.newPage', async () => {
      if (!_dataService) return;
      try {
        const page = await _dataService.createPage();
        // Open the new page in the editor
        await api.editors.openEditor({
          typeId: 'canvas',
          title: page.title,
          icon: page.icon ?? undefined,
          instanceId: page.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to create page:', err);
        await api.window.showErrorMessage('Failed to create page.');
      }
    }),
  );

  // canvas.deletePage â€” Delete the selected page (requires pageId argument)
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

  // canvas.renamePage â€” Rename a page (requires pageId argument)
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

  // canvas.duplicatePage â€” Duplicate a page (requires pageId argument)
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
          icon: copy.icon ?? undefined,
          instanceId: copy.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to duplicate page:', err);
        await api.window.showErrorMessage('Failed to duplicate page.');
      }
    }),
  );
}

// â”€â”€â”€ Exported for internal use by sidebar / editor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Access the Canvas data service from other Canvas modules. */
export function getDataService(): ICanvasDataService | null {
  return _dataService;
}

/** Access the API from other Canvas modules. */
export function getApi(): ParallxApi {
  return _api;
}
