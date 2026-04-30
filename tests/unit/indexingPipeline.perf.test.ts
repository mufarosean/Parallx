// indexingPipeline.perf.test.ts — M60 Phase β (B1 + B2)
//
// Verifies the responsiveness floor:
//   • B1 — `_indexAllPages` yields between iterations and `_embedChunks`
//          yields between batches (cooperative yielding via setTimeout(_, 0)).
//   • B2 — `start()` defers the first run via `requestIdleCallback` (or the
//          fallback `setTimeout`) so the workbench can paint before
//          embedding CPU spikes.
//
// References:
//   - docs/Parallx_Milestone_60.md §5 (Tier 2 Responsiveness)
//   - docs/Future_Improvements.md §1 Options 1 + 2
//   - docs/STARTUP_PERFORMANCE.md

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IndexingPipelineService } from '../../src/services/indexingPipeline.js';
import { FileType } from '../../src/platform/fileTypes.js';
import { URI } from '../../src/platform/uri.js';

// ─── Minimal mocks (mirrors indexingPipeline.test.ts) ────────────────────────

function createMockDb() {
  return {
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue({ changes: 0, lastInsertRowid: 0 }),
    runTransaction: vi.fn().mockResolvedValue([]),
    isOpen: true,
    currentPath: ':memory:',
    dispose: vi.fn(),
  };
}

function createMockFileService() {
  return {
    readFile: vi.fn().mockResolvedValue({ content: '', encoding: 'utf-8', size: 0, mtime: 0 }),
    readdir: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({ type: FileType.File, size: 0, mtime: 0, ctime: 0 }),
    onDidFileChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    watch: vi.fn().mockResolvedValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    mkdir: vi.fn(),
    copy: vi.fn(),
    setBoundaryChecker: vi.fn(),
    openFileDialog: vi.fn(),
    openFolderDialog: vi.fn(),
    saveFileDialog: vi.fn(),
    showMessageBox: vi.fn(),
    readDocumentText: vi.fn().mockResolvedValue({ text: '', format: 'unknown', metadata: {} }),
    isRichDocument: vi.fn().mockReturnValue(false),
    richDocumentExtensions: new Set<string>(),
  };
}

function createMockEmbeddingService() {
  return {
    ensureModel: vi.fn().mockResolvedValue(undefined),
    embedDocument: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
    embedQuery: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
    embedDocumentBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => new Array(768).fill(0.1))),
    ),
    getModelInfo: vi.fn().mockReturnValue({ name: 'nomic-embed-text', dimensions: 768, installed: true }),
    clearCache: vi.fn(),
    cacheSize: 0,
    onDidStartEmbedding: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidFinishEmbedding: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  };
}

function createMockChunkingService() {
  return {
    chunkPage: vi.fn().mockImplementation((pageId: string, title: string) =>
      Promise.resolve([{
        sourceType: 'page_block' as const,
        sourceId: pageId,
        chunkIndex: 0,
        text: `Content of ${title}`,
        contextPrefix: `[Source: "${title}"]`,
        contentHash: `hash-${pageId}`,
      }]),
    ),
    chunkFile: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };
}

function createMockVectorStore() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteSource: vi.fn().mockResolvedValue(undefined),
    purgeAll: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    vectorSearch: vi.fn().mockResolvedValue([]),
    getContentHash: vi.fn().mockImplementation(
      async (sourceType: string, sourceId: string) =>
        sourceType === '_system' && sourceId === 'pipeline_version' ? '3' : null,
    ),
    getIndexedAtMap: vi.fn().mockResolvedValue(new Map()),
    getIndexedSources: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalChunks: 0, totalSources: 0, bySourceType: {}, sourceCountByType: {} }),
    getDocumentSummaries: vi.fn().mockResolvedValue(new Map()),
    getEmbeddings: vi.fn().mockResolvedValue(new Map()),
    onDidUpdateIndex: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  };
}

function createMockWorkspaceService() {
  return {
    activeWorkspace: undefined,
    isRestored: true,
    folders: [{ uri: URI.file('/workspace'), name: 'workspace', index: 0 }],
    workbenchState: 'FOLDER',
    workspaceName: 'workspace',
    onDidChangeWorkspace: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidRestoreState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeFolders: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeWorkbenchState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    save: vi.fn(),
    requestSave: vi.fn(),
    createWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    getRecentWorkspaces: vi.fn(),
    removeRecentWorkspace: vi.fn(),
    addFolder: vi.fn(),
    removeFolder: vi.fn(),
    updateFolders: vi.fn(),
    getWorkspaceFolder: vi.fn(),
    dispose: vi.fn(),
  };
}

function buildPipeline(): {
  pipeline: IndexingPipelineService;
  db: ReturnType<typeof createMockDb>;
  fileService: ReturnType<typeof createMockFileService>;
  embeddingService: ReturnType<typeof createMockEmbeddingService>;
  chunkingService: ReturnType<typeof createMockChunkingService>;
  vectorStore: ReturnType<typeof createMockVectorStore>;
} {
  const db = createMockDb();
  const fileService = createMockFileService();
  const embeddingService = createMockEmbeddingService();
  const chunkingService = createMockChunkingService();
  const vectorStore = createMockVectorStore();
  const workspaceService = createMockWorkspaceService();
  const pipeline = new IndexingPipelineService(
    db as never,
    fileService as never,
    embeddingService as never,
    chunkingService as never,
    vectorStore as never,
    workspaceService as never,
  );
  return { pipeline, db, fileService, embeddingService, chunkingService, vectorStore };
}

// ─── B1: Cooperative yielding ────────────────────────────────────────────────

describe('IndexingPipelineService — M60 B1 cooperative yielding', () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on the global timer so we can count yield calls (delay === 0).
    // We do NOT use fake timers — the real timer must fire so async work
    // can complete; we just want to observe the call shape.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  function countZeroDelayYields(): number {
    let count = 0;
    for (const call of setTimeoutSpy.mock.calls) {
      // setTimeout(fn, 0) signature — second arg may be undefined or 0.
      const delay = call[1];
      if (delay === 0) { count++; }
    }
    return count;
  }

  it('yields between page iterations in _indexAllPages', async () => {
    const { pipeline, db, fileService } = buildPipeline();
    const PAGE_COUNT = 5;
    db.all.mockResolvedValueOnce(
      Array.from({ length: PAGE_COUNT }, (_, i) => ({
        id: `p${i}`,
        title: `Page ${i}`,
        content: '{"type":"doc","content":[]}',
      })),
    );
    fileService.readdir.mockResolvedValueOnce([]);

    const yieldsBefore = countZeroDelayYields();
    await pipeline.start();
    const yieldsAfter = countZeroDelayYields();

    // At minimum one yield per page iteration.
    expect(yieldsAfter - yieldsBefore).toBeGreaterThanOrEqual(PAGE_COUNT);

    pipeline.dispose();
  });

  it('yields between embedding batches in _embedChunks', async () => {
    const { pipeline, db, fileService, chunkingService } = buildPipeline();

    // One page that produces enough chunks to span several BATCH_SIZE (=32)
    // batches — so the cross-batch yield path actually fires.
    const CHUNK_COUNT = 100; // → ceil(100/32) = 4 batches → 3 inter-batch yields
    chunkingService.chunkPage.mockImplementationOnce((pageId: string) =>
      Promise.resolve(
        Array.from({ length: CHUNK_COUNT }, (_, i) => ({
          sourceType: 'page_block' as const,
          sourceId: pageId,
          chunkIndex: i,
          text: `chunk ${i}`,
          contextPrefix: '[ctx]',
          contentHash: `h-${pageId}-${i}`,
        })),
      ),
    );
    db.all.mockResolvedValueOnce([
      { id: 'p1', title: 'Page 1', content: '{"type":"doc","content":[]}' },
    ]);
    fileService.readdir.mockResolvedValueOnce([]);

    const yieldsBefore = countZeroDelayYields();
    await pipeline.start();
    const yieldsAfter = countZeroDelayYields();

    // Page-loop yield (1) + at least 3 inter-batch yields = 4. Allow ≥4.
    expect(yieldsAfter - yieldsBefore).toBeGreaterThanOrEqual(4);

    pipeline.dispose();
  });
});

// ─── B2: Deferred start ──────────────────────────────────────────────────────

describe('IndexingPipelineService — M60 B2 deferred start', () => {
  type IdleCb = (cb: () => void, opts?: { timeout?: number }) => unknown;
  let originalRic: IdleCb | undefined;

  beforeEach(() => {
    const g = globalThis as unknown as { requestIdleCallback?: IdleCb };
    originalRic = g.requestIdleCallback;
  });

  afterEach(() => {
    const g = globalThis as unknown as { requestIdleCallback?: IdleCb };
    if (originalRic === undefined) {
      delete g.requestIdleCallback;
    } else {
      g.requestIdleCallback = originalRic;
    }
  });

  it('waits for requestIdleCallback before doing any indexing work', async () => {
    let idleResolver: (() => void) | null = null;
    const ric: IdleCb = (cb) => {
      idleResolver = cb as () => void;
      return 1;
    };
    (globalThis as unknown as { requestIdleCallback: IdleCb }).requestIdleCallback = ric;

    const { pipeline, db, embeddingService, fileService } = buildPipeline();
    db.all.mockResolvedValue([]);
    fileService.readdir.mockResolvedValue([]);

    const startPromise = pipeline.start();

    // Allow microtasks to drain — without rIC firing, no indexing work
    // should have begun. `ensureModel` is the first awaited side-effect
    // after the deferral, so its mock must remain uncalled.
    await Promise.resolve();
    await Promise.resolve();
    expect(embeddingService.ensureModel).not.toHaveBeenCalled();
    expect(idleResolver).not.toBeNull();

    // Fire idle — pipeline should now run to completion.
    idleResolver?.();
    await startPromise;

    expect(embeddingService.ensureModel).toHaveBeenCalled();
    pipeline.dispose();
  });

  it('proceeds immediately when cancel() fires during idle wait', async () => {
    let idleResolver: (() => void) | null = null;
    const ric: IdleCb = (cb) => {
      idleResolver = cb as () => void;
      return 1;
    };
    (globalThis as unknown as { requestIdleCallback: IdleCb }).requestIdleCallback = ric;

    const { pipeline, embeddingService } = buildPipeline();
    const startPromise = pipeline.start();

    // Cancel before idle fires — start() should unwind without indexing.
    pipeline.cancel();
    await startPromise;

    expect(embeddingService.ensureModel).not.toHaveBeenCalled();
    // Ensure idle never had to fire for the test to complete.
    expect(idleResolver).not.toBeNull();
    pipeline.dispose();
  });
});
