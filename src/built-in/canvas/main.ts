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
import './database/database.css';
import 'katex/dist/katex.min.css';
import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { LinksApi } from '../../links/linksApi.js';
import { ICanvasPageQueryService, IIndexingPipelineService, IVectorStoreService, IDatabaseService, IEditorService } from '../../services/serviceTypes.js';
import { ILanguageModelToolsService, ILanguageModelsService } from '../../services/chatTypes.js';
import { registerCanvasAITools, canvasPageIdFromEditorId } from './ai/canvasAITools.js';
import { createComposePageRuntime } from './ai/composePageRuntime.js';
import { tiptapJsonToMarkdown } from './markdownExport.js';
import { markdownToTiptapJson } from './markdownImport.js';
import { decodeCanvasContent, encodeCanvasContentFromDoc } from './contentSchema.js';
import { CanvasDataService } from './canvasDataService.js';
import type { ICanvasDataService } from './canvasTypes.js';
import { PageChangeKind } from './canvasTypes.js';
import type { IPage, IPageTreeNode, PageChangeEvent, PageMutationField } from './canvasTypes.js';
import { CanvasSidebar } from './canvasSidebar.js';
import { CanvasEditorProvider } from './canvasEditorProvider.js';
import { DatabaseDataService } from './database/databaseDataService.js';
import { DatabaseEditorPane } from './database/databaseEditorPane.js';
import { setOnLinkedPageBlockDeleted, renderPageIconHtml } from './config/blockRegistry.js';
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
    readonly fs?: {
      readFile(uri: string): Promise<{ content: string; encoding: string }>;
      writeFile(uri: string, content: string): Promise<void>;
      readdir(uri: string): Promise<{ name: string; type: number }[]>;
      exists(uri: string): Promise<boolean>;
      mkdir(uri: string): Promise<void>;
      delete(uri: string, options?: { useTrash?: boolean; recursive?: boolean }): Promise<void>;
    };
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showErrorMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInputBox(options?: { prompt?: string; value?: string; placeholder?: string }): Promise<string | undefined>;
    showQuickPick(items: readonly { label: string; description?: string; detail?: string }[], options?: { placeholder?: string; canPickMany?: boolean }): Promise<{ label: string; description?: string; detail?: string } | undefined>;
  };
  context: {
    createContextKey<T extends string | number | boolean | undefined>(name: string, defaultValue: T): { key: string; get(): T; set(value: T): void; reset(): void };
  };
  editors: {
    registerEditorProvider(typeId: string, provider: { createEditorPane(container: HTMLElement): IDisposable }): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; iconHtml?: string; instanceId?: string }): Promise<void>;
    closeEditor(editorId: string): Promise<boolean>;
    readonly openEditors: readonly { id: string; name: string; description: string; isDirty: boolean; isActive: boolean; groupId: string }[];
    onDidChangeOpenEditors(listener: () => void): IDisposable;
  };
  links: LinksApi;
  services: {
    get<T>(id: { readonly id: string }): T;
    has(id: { readonly id: string }): boolean;
    registerInstance<T>(id: { readonly id: string }, instance: T): void;
  };
}

const CANVAS_PAGE_REINDEX_DEBOUNCE_MS = 3_000;

function buildIndexedPagePayloadKey(page: { title: string; content: string }): string {
  return JSON.stringify({ title: page.title, content: page.content });
}

const INDEX_METADATA_PAGE_FIELDS: ReadonlySet<PageMutationField> = new Set<PageMutationField>([
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

/** Payload for capturing a PDF/other-surface selection into a canvas page. */
interface CaptureDetail {
  text?: string;
  imageDataUrl?: string;
  fileName?: string;
  page?: number;
  sourceUri?: string;
}

let _api: ParallxApi;
let _dataService: CanvasDataService | null = null;
let _sidebar: CanvasSidebar | null = null;
let _propertyService: PropertyDataService | null = null;
let _editorProvider: CanvasEditorProvider | null = null;
let _databaseService: DatabaseDataService | null = null;

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

  // 2z. Database engine (Notion-style databases over migrations 006/007).
  // Created before the AI tools registration so the database tools get a live
  // service reference.
  _databaseService = new DatabaseDataService(_dataService);
  context.subscriptions.push(_databaseService);
  void _databaseService.ensureIdsLoaded();

  // 2a. Publish read-only page query service to DI for cross-tool access (M56)
  api.services.registerInstance(ICanvasPageQueryService, _dataService);

  // 2a2. M84 — register canvas's AI tools. Canvas owns the page/block tools it
  // exposes to the chat agent (they were previously created inside the chat
  // module). The tools service is a core boot service, so it is always present.
  if (api.services.has(ILanguageModelToolsService)) {
    const toolsService = api.services.get<import('../../services/chatTypes.js').ILanguageModelToolsService>(ILanguageModelToolsService);
    const db = api.services.has(IDatabaseService)
      ? api.services.get<import('../../services/serviceTypes.js').IDatabaseService>(IDatabaseService)
      : undefined;
    const editorService = api.services.has(IEditorService)
      ? api.services.get<import('../../services/serviceTypes.js').IEditorService>(IEditorService)
      : undefined;
    const canvasToolDisposables = registerCanvasAITools({
      toolsService,
      db,
      getCurrentPageId: () => canvasPageIdFromEditorId(editorService?.activeEditor?.id),
      workspaceRoot: api.workspace.workspaceFolders?.[0]?.uri,
      templateApi: api,
      pageMutationNotifier: async (pageId, kind) => {
        // Cancel any pending auto-save before the reload fires. The debounced
        // save holds pre-AI content; if it fires after notifyExternalPageMutation
        // updates _knownRevisions to the AI's new revision it silently succeeds
        // and overwrites the AI's write. Cancelling it here eliminates the race.
        if (kind === 'updated') _dataService?.cancelPendingSave(pageId);
        // Deterministic ordering: AWAIT the mutation notification (which drives
        // the open editor's surgical reload) before any focus side-effect. The
        // old fire-and-forget raced openPageInEditor on the same tick — the
        // open-editor path could re-read + focus mid-reload and the update never
        // visibly landed.
        try { await _dataService?.notifyExternalPageMutation(pageId, kind); }
        catch (err) { console.warn('[Canvas] notifyExternalPageMutation failed for', pageId, err); }
        // Surface what the AI did: open the page — but DON'T re-open/steal focus
        // when it's already open; the surgical reload above has updated it live.
        if (kind !== 'deleted' && !_editorProvider?.isPageOpen(pageId)) {
          void openPageInEditor(pageId);
        }
      },
      // canvas_relate_pages — nest related pages (by title) under a hub page via
      // the integrity-preserving movePageWithBlocks. Makes the agent's most common
      // useful review intent ("link these related pages") an actual, reversible op.
      relatePages: async (hubTitle, relatedTitles) => {
        const ds = _dataService;
        if (!ds) return { linked: [], missing: [...relatedTitles] };
        const flat: { id: string; title: string }[] = [];
        const walk = (nodes: readonly IPageTreeNode[]) => {
          for (const n of nodes) {
            flat.push({ id: n.id, title: n.title });
            if (n.children?.length) walk(n.children);
          }
        };
        try { walk(await ds.getPageTree()); } catch { return { linked: [], missing: [...relatedTitles] }; }
        const norm = (s: string) => s.trim().toLowerCase();
        const find = (t: string) => flat.find((p) => norm(p.title) === norm(t));
        const hub = find(hubTitle);
        if (!hub) return { linked: [], missing: [...relatedTitles] };
        const linked: string[] = [];
        const missing: string[] = [];
        for (const rt of relatedTitles) {
          const r = find(rt);
          if (!r) { missing.push(rt); continue; }
          if (r.id === hub.id) continue; // never nest the hub under itself
          try { await ds.movePageWithBlocks({ pageId: r.id, newParentId: hub.id }); linked.push(r.title); }
          catch { missing.push(rt); }
        }
        return { hub: hub.title, linked, missing };
      },
      // Database AI tools (create / add row / query).
      databaseService: _databaseService ?? undefined,
      // canvas_create_page parentId support — atomic sub-page creation (page
      // row + the parent's sub-page card in one transaction).
      createChildPage: async (parentId, title) => {
        if (!_dataService) throw new Error('Canvas data service unavailable.');
        const page = await _dataService.createChildPageWithBlock({ parentId, title });
        return page.id;
      },
      // canvas_compose_page — stream a model-composed body into the open editor
      // (live typing); falls back to a direct write when the page isn't open.
      composePage: createComposePageRuntime({
        getPage: async (pageId) => {
          const page = await _dataService?.getPage(pageId);
          if (!page) return null;
          let bodyMarkdown = '';
          try { bodyMarkdown = tiptapJsonToMarkdown(decodeCanvasContent(page.content).doc); }
          catch { bodyMarkdown = ''; }
          return { title: page.title, bodyMarkdown };
        },
        getSink: (pageId) => _editorProvider?.getStreamSink(pageId),
        sendChatRequest: (messages, signal) => {
          if (!api.services.has(ILanguageModelsService)) {
            throw new Error('No language model service available.');
          }
          const lm = api.services.get<import('../../services/chatTypes.js').ILanguageModelsService>(ILanguageModelsService);
          return lm.sendChatRequest(messages, undefined, signal);
        },
        writeBody: async (pageId, markdown) => {
          const ds = _dataService;
          if (!ds) throw new Error('Canvas data service unavailable.');
          const doc = markdownToTiptapJson(markdown);
          const encoded = encodeCanvasContentFromDoc(doc as Parameters<typeof encodeCanvasContentFromDoc>[0]);
          await ds.updatePage(pageId, { content: encoded.storedContent, contentSchemaVersion: encoded.schemaVersion });
          // Ensure any (re)opened editor reloads the committed body.
          await ds.notifyExternalPageMutation(pageId, 'updated');
        },
      }),
    });
    for (const d of canvasToolDisposables) context.subscriptions.push(d);
  }

  // 2b. Create PropertyDataService and seed defaults
  _propertyService = new PropertyDataService();
  context.subscriptions.push(_propertyService);
  await _propertyService.ensureDefaultProperties();
  // Backfill auto-managed `created`/`modified` values for any page that
  // pre-dates this feature so they appear in the property bar immediately
  // instead of only after the next save.
  await _propertyService.backfillTimestampProperties();

  // 2c. Auto-populate `created` / `modified` datetime properties so every
  //     page surfaces creation + last-modified timestamps in its property bar
  //     by default. We mirror the same data the `pages` table already tracks
  //     via its `created_at` / `updated_at` columns, exposed through the
  //     property system so it appears in the UI and is queryable by dataview.
  const propertyService = _propertyService;
  const dataServiceRef = _dataService;
  context.subscriptions.push(
    dataServiceRef.onDidChangePage((event) => {
      if (event.kind !== PageChangeKind.Created) return;
      const nowIso = new Date().toISOString();
      void propertyService.setProperty(event.pageId, 'created', nowIso).catch((err) => {
        console.warn('[Canvas] Failed to seed `created` property for', event.pageId, err);
      });
      void propertyService.setProperty(event.pageId, 'modified', nowIso).catch((err) => {
        console.warn('[Canvas] Failed to seed `modified` property for', event.pageId, err);
      });
      // Feed canvas activity into the agent's perception, so autonomy can actually
      // SEE you create pages (the core surface) instead of being blind to it.
      // Routed via the autonomy-signal command (the API the news widget uses too).
      const pageTitle = event.page?.title?.trim() || 'Untitled';
      void api.commands?.executeCommand?.('parallx.autonomy.signal', {
        source: 'canvas', title: `created page "${pageTitle}"`, severity: 'info',
      }).catch(() => { /* perception is best-effort; never block page creation */ });
    }),
  );
  // M78 Phase 4 — the on-save write to the `modified` property was a
  // denormalised copy of `pages.updated_at`, costing 2 extra IPC per
  // autosave (INSERT/REPLACE + readback) on top of the page UPDATE
  // itself. PropertyDataService.getPropertiesForPage now synthesises
  // the value from `pages.updated_at` at read time, so this write is
  // pure overhead and is removed. The on-Create `created` seed below
  // is also redundant for the same reason (handled via read-time
  // override) but is retained for compatibility with any consumer
  // that queries `page_properties` directly via raw SQL.

  // 2a. parentId is the source of truth for hierarchy — no content reconciliation needed.

  // 3. Register sidebar view provider for page tree (Cap 4)
  _sidebar = new CanvasSidebar(_dataService, api, (id) => _databaseService?.isDatabase(id) ?? false);
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
  const editorProvider = new CanvasEditorProvider(_dataService, api.window);
  _editorProvider = editorProvider;
  editorProvider.setDatabaseService(_databaseService);
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

  // 4a. Database editor — full-page Notion-style database views. The editor-id
  // scaffolding for `*:database:<pageId>` has existed since M84; this registers
  // the actual pane behind it.
  context.subscriptions.push(
    api.editors.registerEditorProvider('database', {
      createEditorPane(container: HTMLElement, input?: any): IDisposable {
        const pageId = (input?.id as string) ?? '';
        return new DatabaseEditorPane(container, pageId, {
          db: _databaseService!,
          openPage: (id) => void openPageInEditor(id),
          renamePage: async (id, title) => { await _dataService?.updatePage(id, { title }); },
        });
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

  // 5z. Capture-to-canvas. Other surfaces (e.g. the PDF viewer's selection
  //     actions) send a passage of text or a cropped image; we append it to a
  //     chosen/new page. Two entry points share one implementation:
  //       • window event `parallx:capture-to-canvas` — fire-and-forget, and
  //       • command `canvas.captureSelection` — awaitable, returns the target
  //         page so the caller can record a bidirectional link (M84).
  const onCaptureToCanvas = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as CaptureDetail | undefined;
    if (!detail?.text && !detail?.imageDataUrl) return;
    void captureNoteToCanvas(api, detail);
  };
  window.addEventListener('parallx:capture-to-canvas', onCaptureToCanvas);
  context.subscriptions.push({
    dispose: () => window.removeEventListener('parallx:capture-to-canvas', onCaptureToCanvas),
  });
  context.subscriptions.push(
    api.commands.registerCommand('canvas.captureSelection', (...args: unknown[]) =>
      captureNoteToCanvas(api, (args[0] ?? {}) as CaptureDetail),
    ),
  );
  context.subscriptions.push(
    api.commands.registerCommand('canvas.openPage', async (...args: unknown[]) => {
      const pageId = typeof args[0] === 'string' ? args[0] : '';
      if (!pageId) return false;
      await openPageInEditor(pageId);
      return true;
    }),
  );

  // 5a. When a page-linked block (pageBlock, databaseInline) is deleted from
  //     editor content, run the normal page deletion process (same as sidebar).
  setOnLinkedPageBlockDeleted((pageId) => {
    if (!_dataService) return;
    // The block was removed from the parent's editor content; the child
    // page must be archived to keep the two layers consistent. If the
    // archive fails (DB error, fk conflict, etc.) we surface a visible
    // error instead of swallowing it — silent failure here is what
    // produced "subpage still in sidebar but no parent block" reports.
    _dataService.archivePage(pageId).catch(err => {
      console.error(`[Canvas] Failed to archive child page ${pageId} after block deletion:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      void api.window.showErrorMessage(
        `Failed to archive removed subpage (${msg}). The subpage may now be visible in the sidebar without a parent reference — please refresh or restore manually.`,
      );
    });
  });

  // 5b. M77 Phase 2 + Phase 11.5 — surface auto-save failures. Without
  // this listener the SaveStateKind.Failed event fired by the data service
  // went nowhere; users lost work silently if the DB write failed (full
  // disk, schema drift, etc.). Throttle to one notification per page per
  // second so a stuck save loop doesn't spam notifications.
  //
  // Phase 11.5 — replace the raw error message with a user-friendly
  // translation and an actionable Reload button for the common "Revision
  // conflict" case (someone else / another writer modified the page
  // while we were typing). Other failures get a generic message plus
  // the raw error in parens for debugability.
  {
    const lastNotifiedAt = new Map<string, number>();
    context.subscriptions.push(
      _dataService.onDidChangeSaveState((e) => {
        if (e.kind !== 'Failed') return;
        const now = Date.now();
        const last = lastNotifiedAt.get(e.pageId) ?? 0;
        if (now - last < 1000) return;
        lastNotifiedAt.set(e.pageId, now);

        const isConflict = !!e.error && /revision conflict/i.test(e.error);
        if (isConflict) {
          void api.window.showWarningMessage(
            'This page was changed elsewhere. Reload to see the latest version (your unsaved local edits will be replaced).',
            { title: 'Reload page' },
            { title: 'Ignore' },
          ).then((choice) => {
            if (choice?.title === 'Reload page') {
              _dataService?.fireContentReload(e.pageId);
            }
          });
        } else {
          const detail = e.error ? ` (${e.error})` : '';
          void api.window.showErrorMessage(
            `Couldn't save this page${detail}. Check your disk space and try editing again.`,
          );
        }
      }),
    );
  }

  // 5c. Auto-close editor tabs when their page is deleted or archived.
  // Canvas opens page editors with `instanceId: pageId`, and EditorsBridge
  // uses the supplied instanceId verbatim as the editor input id — so the
  // descriptor id is the pageId itself (NOT "parallx.canvas:canvas:<pageId>"
  // as an older comment claimed). Match descriptor.id directly against the
  // deleted pageId, scoped to tool editors of typeId "canvas" or "database"
  // so unrelated tools that happen to use the same id are not affected.
  context.subscriptions.push(
    _dataService.onDidChangePage(async (e) => {
      if (e.kind !== PageChangeKind.Deleted) return;
      const editors = api.editors.openEditors;
      for (const ed of editors) {
        if (ed.id !== e.pageId) continue;
        if (ed.description === 'Tool editor: canvas' || ed.description === 'Tool editor: database') {
          await api.editors.closeEditor(ed.id);
        }
      }
    }),
  );

  // 5d. M66 — register the canvas link contract. Makes
  // `parallx://canvas/page/<pageId>` clickable from anywhere in the app
  // (chat markdown, canvas link chips, future link_create AI tool).
  context.subscriptions.push(
    api.links.register({
      segment: 'canvas',
      displayName: 'Canvas',
      kinds: {
        page: {
          uriTemplate: 'parallx://canvas/page/<pageId>',
          description: 'Open a canvas page by id. Optional ?block=<blockId> param to scroll to a specific block.',
          examples: ['parallx://canvas/page/01HZX7...'],
          async open(parsed) {
            const pageId = parsed.pathSegments[1];
            if (!pageId) return false;
            // Verify the page exists before opening so missing targets
            // return false (renderers can show a "(missing)" state).
            try {
              const page = await _dataService?.getPage(pageId);
              if (!page) return false;
            } catch {
              return false;
            }
            await openPageInEditor(pageId);
            // M66 Iter B — Optional `?block=<blockId>` deep-link anchor.
            // The editor pane is already initialized after openPageInEditor
            // resolves, but the DOM may still be laying out — yield once
            // before dispatching so the wrapper has its blocks mounted.
            const blockId = parsed.params['block'];
            if (blockId) {
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent('parallx:canvas-reveal-block', {
                  detail: { pageId, blockId },
                }));
              }, 50);
            }
            return true;
          },
          async resolveMetadata(parsed) {
            const pageId = parsed.pathSegments[1];
            if (!pageId || !_dataService) return null;
            try {
              const page = await _dataService.getPage(pageId);
              if (!page) return null;
              return { title: page.title || 'Untitled', icon: page.icon ?? '📄' };
            } catch {
              return null;
            }
          },
        },
      },
    }),
  );

  // 5c. Keep the knowledge index in sync with page lifecycle changes.
  context.subscriptions.push(
    _dataService.onDidSavePage((event) => {
      // M78 Phase 8 — onDidSavePage now carries the saved page object,
      // so we skip the redundant getPage IPC that previously fired on
      // every autosave. The reindex scheduler reads only id/title/
      // content from the page, which the carried IPage already provides.
      schedulePageReindexForPayload(event.page);
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
      iconHtml: renderPageIconHtml(page.icon),
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
    api.commands.registerCommand('canvas.newDatabase', async () => {
      if (!_databaseService) return;
      try {
        const db = await _databaseService.createDatabase({ title: 'Untitled database' });
        await openPageInEditor(db.id);
      } catch (err) {
        console.error('[Canvas] Failed to create database:', err);
        await api.window.showErrorMessage('Failed to create database.');
      }
    }),
    api.commands.registerCommand('canvas.newPage', async () => {
      if (!_dataService) return;
      try {
        const page = await _dataService.createPage();
        // Open the new page in the editor
        await api.editors.openEditor({
          typeId: 'canvas',
          title: page.title,
          icon: page.icon ?? undefined,
          iconHtml: renderPageIconHtml(page.icon),
          instanceId: page.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to create page:', err);
        await api.window.showErrorMessage('Failed to create page.');
      }
    }),
  );

  // canvas.showKeyboardShortcuts — Open the keyboard shortcut cheatsheet
  // (M77 Phase 11.6). Bound from the editor via Mod+/ and from the empty
  // state hint.
  context.subscriptions.push(
    api.commands.registerCommand('canvas.showKeyboardShortcuts', async () => {
      try {
        const mod = await import('./canvasShortcutsOverlay.js');
        await mod.showCanvasShortcutsOverlay();
      } catch (err) {
        console.error('[Canvas] Failed to open shortcuts overlay:', err);
      }
    }),
  );

  // canvas.showTemplatePicker — Open the template picker modal.
  // Creates a new root-level page seeded with the chosen template,
  // a blank page if the user picks the escape hatch, or opens the
  // template manager if the user clicks "Manage templates…". Cancel /
  // Esc / backdrop click → no-op.
  context.subscriptions.push(
    api.commands.registerCommand('canvas.showTemplatePicker', async () => {
      if (!_dataService) return;
      try {
        const mod = await import('./canvasTemplatePicker.js');
        const result = await mod.showCanvasTemplatePicker(api);

        if (result.openedManager) {
          await api.commands.executeCommand('canvas.manageTemplates');
          return;
        }

        // The "blank page" branch and the "no choice" branch are
        // distinguishable only by the explicit blank action: opening
        // the picker is a user-initiated request to create something,
        // so the blank button creates a page; cancel does NOT.
        // Distinguish via: template = null but openedManager not set.
        // For backward compat with the empty-workspace flow, we still
        // create-blank on null when the user clicked "Start with a
        // blank page" — that path returns null with no manager flag.
        // We can't tell apart from a cancel without an explicit flag,
        // so the picker resolves with template = null in BOTH cases;
        // only the explicit blank button created a page in M77.4.
        // Post-rev: cancel and blank are distinguishable because cancel
        // returns from a different button. We keep current semantics:
        // the empty-workspace flow goes through canvas.newPage now,
        // and this command is reached only when the user actively
        // wants a templated page — so a null template means cancel.
        if (!result.template) return;

        const page = await _dataService.createPage(null, result.template.defaultTitle);
        await _dataService.flushContentSave(page.id, result.template.buildDoc());
        await api.editors.openEditor({
          typeId: 'canvas',
          title: page.title,
          icon: page.icon ?? undefined,
          iconHtml: renderPageIconHtml(page.icon),
          instanceId: page.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to open template picker:', err);
        await api.window.showErrorMessage('Failed to open the template picker.');
      }
    }),
  );

  // canvas.saveAsTemplate — Snapshot an existing page as a user template.
  // Prompts for a template name + icon, writes the result to
  // `.parallx/canvas-templates/<id>.json`. The source page is unchanged.
  context.subscriptions.push(
    api.commands.registerCommand('canvas.saveAsTemplate', async (...args: unknown[]) => {
      if (!_dataService) return;
      const pageId = args[0] as string | undefined;
      if (!pageId) {
        await api.window.showWarningMessage('No page selected to save as a template.');
        return;
      }
      try {
        const page = await _dataService.getPage(pageId);
        if (!page) {
          await api.window.showErrorMessage('That page no longer exists.');
          return;
        }
        const name = await api.window.showInputBox({
          prompt: 'Template name',
          value: page.title,
          placeholder: 'Daily standup, Bug report, etc.',
        });
        if (!name) return;
        // Parse the page's stored content into a doc the template can
        // rebuild. createPage seeds via flushContentSave so the same
        // JSON shape round-trips.
        let doc: unknown = null;
        try {
          doc = page.content ? JSON.parse(page.content) : null;
        } catch {
          doc = null;
        }
        if (!doc) {
          await api.window.showWarningMessage('This page has no content to template yet.');
          return;
        }
        const mod = await import('./canvasTemplates.js');
        const saved = await mod.saveUserCanvasTemplate(api, {
          name,
          description: `Created from "${page.title}"`,
          icon: page.icon || 'file-text',
          defaultTitle: page.title,
          doc,
        });
        await api.window.showInformationMessage(`Saved as template "${name}".`);
        void saved; // path is logged for debug; nothing needs it here
      } catch (err) {
        console.error('[Canvas] Failed to save page as template:', err);
        await api.window.showErrorMessage(
          `Failed to save template: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // canvas.manageTemplates — List user templates with delete affordance.
  // Quick-pick implementation keeps the surface lightweight; rename /
  // edit-doc happens by hand-editing the JSON for now, which is fine
  // because the file lives in workspace and survives version control.
  context.subscriptions.push(
    api.commands.registerCommand('canvas.manageTemplates', async () => {
      if (!_dataService) return;
      try {
        const mod = await import('./canvasTemplates.js');
        const templates = await mod.loadUserCanvasTemplates(api);
        if (templates.length === 0) {
          const choice = await api.window.showInformationMessage(
            'You have no custom templates yet. Right-click a page and choose "Save as template" to create one.',
            { title: 'OK' },
          );
          void choice;
          return;
        }
        const items = templates.map((t) => ({
          label: t.name,
          description: t.description || '',
          detail: t.filePath ?? '',
        }));
        const picked = await api.window.showQuickPick(items, {
          placeholder: 'Pick a template to delete (Esc to cancel)',
        });
        if (!picked) return;
        const target = templates.find((t) => t.name === picked.label);
        if (!target || !target.filePath) return;
        const confirm = await api.window.showWarningMessage(
          `Delete the "${target.name}" template? This cannot be undone.`,
          { title: 'Delete' },
          { title: 'Cancel' },
        );
        if (confirm?.title !== 'Delete') return;
        await mod.deleteUserCanvasTemplate(api, target.filePath);
        await api.window.showInformationMessage(`Deleted template "${target.name}".`);
      } catch (err) {
        console.error('[Canvas] Manage templates failed:', err);
        await api.window.showErrorMessage(
          `Failed to manage templates: ${err instanceof Error ? err.message : String(err)}`,
        );
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

  // canvas.duplicatePage â€” Duplicate a page (requires pageId argument).
  // Delegates to the data service's deep-recursive duplicate so the new
  // page (a) gets a pageBlock on its parent and (b) recursively copies
  // descendants with pageBlock pageIds remapped. The earlier shallow
  // path called `createPage` directly and left both contracts broken:
  // the duplicate was orphaned visually (no parent block) and any
  // embedded pageBlocks still referenced the original's children.
  context.subscriptions.push(
    api.commands.registerCommand('canvas.duplicatePage', async (...args: unknown[]) => {
      if (!_dataService) return;
      const pageId = args[0] as string | undefined;
      if (!pageId) return;

      try {
        const copy = await _dataService.duplicatePage(pageId);
        await api.editors.openEditor({
          typeId: 'canvas',
          title: copy.title,
          icon: copy.icon ?? undefined,
          iconHtml: renderPageIconHtml(copy.icon),
          instanceId: copy.id,
        });
      } catch (err) {
        console.error('[Canvas] Failed to duplicate page:', err);
        await api.window.showErrorMessage('Failed to duplicate page.');
      }
    }),
  );

  // canvas.pickPageLink — open a quick pick of all pages and return a
  // `parallx://canvas/page/<id>` link for the chosen one. Used by other
  // surfaces (the Planner notes field) to attach a canvas page without
  // coupling them to the canvas schema. Returns null if cancelled/empty.
  context.subscriptions.push(
    api.commands.registerCommand('canvas.pickPageLink', async (): Promise<{ uri: string; title: string; icon: string | null } | null> => {
      if (!_dataService) return null;
      let tree: IPageTreeNode[];
      try {
        tree = await _dataService.getPageTree();
      } catch (err) {
        console.error('[Canvas] pickPageLink: getPageTree failed:', err);
        return null;
      }

      // Flatten the tree depth-first, indenting nested pages so the
      // hierarchy reads naturally in the flat quick-pick list.
      const flat: { page: IPage; depth: number }[] = [];
      const walk = (nodes: readonly IPageTreeNode[], depth: number): void => {
        for (const node of nodes) {
          flat.push({ page: node, depth });
          if (node.children.length) walk(node.children, depth + 1);
        }
      };
      walk(tree, 0);

      if (flat.length === 0) {
        await api.window.showInformationMessage('No canvas pages yet. Create one first.');
        return null;
      }

      const items = flat.map(({ page, depth }) => ({
        label: `${'\u2003'.repeat(depth)}${page.icon ? page.icon + ' ' : ''}${page.title || 'Untitled'}`,
        _pageId: page.id,
        _title: page.title || 'Untitled',
        _icon: page.icon,
      }));

      const picked = await api.window.showQuickPick(items, { placeholder: 'Link a canvas page\u2026' }) as (typeof items)[number] | undefined;
      if (!picked) return null;

      return {
        uri: api.links.mint('canvas', ['page', picked._pageId]),
        title: picked._title,
        icon: picked._icon,
      };
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

/**
 * Append a captured selection (from the PDF viewer or other surfaces) to a
 * canvas page as text or an image block, then open the page. Lets the user
 * pick an existing page or create a fresh "Study Notes" page.
 *
 * M84: returns the target page `{ pageId, title }` so callers (the PDF reader)
 * can record a bidirectional link back to the highlight. Returns null if the
 * user cancelled or the capture was empty.
 */
async function captureNoteToCanvas(
  api: ParallxApi,
  detail: CaptureDetail,
): Promise<{ pageId: string; title: string } | null> {
  if (!_dataService) return null;
  const text = (detail.text ?? '').trim();
  const imageDataUrl = detail.imageDataUrl ?? '';
  if (!text && !imageDataUrl) return null;

  // Build the target picker: a "new page" option plus every existing page.
  let tree: IPageTreeNode[] = [];
  try {
    tree = await _dataService.getPageTree();
  } catch (err) {
    console.error('[Canvas] captureNote: getPageTree failed:', err);
  }
  const flat: { page: IPage; depth: number }[] = [];
  const walk = (nodes: readonly IPageTreeNode[], depth: number): void => {
    for (const node of nodes) {
      flat.push({ page: node, depth });
      if (node.children.length) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);

  const NEW_PAGE = '\u0000new-page';
  const items = [
    { label: '\u2795  New study-notes page', _pageId: NEW_PAGE },
    ...flat.map(({ page, depth }) => ({
      label: `${'\u2003'.repeat(depth)}${page.icon ? page.icon + ' ' : ''}${page.title || 'Untitled'}`,
      _pageId: page.id,
    })),
  ];

  const picked = await api.window.showQuickPick(items, {
    placeholder: 'Add selection to a canvas page\u2026',
  }) as (typeof items)[number] | undefined;
  if (!picked) return null;

  let targetId: string;
  let targetTitle: string;
  if (picked._pageId === NEW_PAGE) {
    const page = await _dataService.createPage(null, 'Study Notes');
    targetId = page.id;
    targetTitle = page.title || 'Study Notes';
  } else {
    targetId = picked._pageId;
    targetTitle = flat.find((f) => f.page.id === targetId)?.page.title || 'Untitled';
  }

  const attribution = `\u2014 ${detail.fileName ?? 'Source'}${detail.page ? `, page ${detail.page}` : ''}`;
  const appendedNodes = [
    imageDataUrl
      ? { type: 'image', attrs: { src: imageDataUrl } }
      : { type: 'paragraph', content: [{ type: 'text', text }] },
    { type: 'paragraph', content: [{ type: 'text', text: attribution, marks: [{ type: 'italic' }] }] },
  ];

  try {
    await _dataService.appendBlocksToPage(targetId, appendedNodes);
    _dataService.fireContentReload(targetId);
  } catch (err) {
    console.error('[Canvas] captureNote: append failed:', err);
    await api.window.showErrorMessage('Could not add the note to the canvas page.');
    return null;
  }

  await openPageInEditor(targetId);
  return { pageId: targetId, title: targetTitle };
}

/**
 * Open (or focus, if already open) a page in the canvas editor by id.
 * Used by external writers — primarily the chat extension's page tools —
 * to surface the page they just created or edited into the user's view.
 *
 * Same `instanceId` semantics as `api.editors.openEditor`: if a canvas
 * editor tab with this pageId is already open, it gets focused (no
 * duplicate tab). If not, a new tab opens.
 *
 * Silently no-ops if the canvas extension hasn't activated yet, the API
 * isn't bound, or the page doesn't exist.
 */
export async function openPageInEditor(pageId: string): Promise<void> {
  if (!_api || !_dataService) return;
  let page;
  try {
    page = await _dataService.getPage(pageId);
  } catch (err) {
    console.warn('[Canvas] openPageInEditor: getPage failed for', pageId, err);
    return;
  }
  if (!page) return;
  try {
    await _api.editors.openEditor({
      // Database pages open in the database editor (table/board views);
      // regular pages open in the canvas editor.
      typeId: _databaseService?.isDatabase(pageId) ? 'database' : 'canvas',
      title: page.title,
      icon: page.icon ?? undefined,
      iconHtml: renderPageIconHtml(page.icon),
      instanceId: pageId,
    });
  } catch (err) {
    console.warn('[Canvas] openPageInEditor: openEditor failed for', pageId, err);
  }
}
