import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Emitter } from '../../src/platform/events.js';
import {
  SemanticGraphService,
  canonicalizeSemanticEdgePair,
  semanticSourceToNodeId,
} from '../../src/services/semanticGraphService.js';

function createMockDb() {
  const onDidOpen = new Emitter<string>();
  const onDidClose = new Emitter<void>();
  return {
    isOpen: true,
    currentPath: ':memory:',
    onDidOpen: onDidOpen.event,
    onDidClose: onDidClose.event,
    openForWorkspace: vi.fn(),
    close: vi.fn(),
    migrate: vi.fn(),
    run: vi.fn().mockResolvedValue({ changes: 0, lastInsertRowid: 0 }),
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]),
    runTransaction: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };
}

function createMockVectorStore() {
  const onDidUpdateIndex = new Emitter<{ sourceId: string; chunkCount: number }>();
  return {
    onDidUpdateIndex: onDidUpdateIndex.event,
    upsert: vi.fn(),
    deleteSource: vi.fn(),
    search: vi.fn(),
    vectorSearch: vi.fn().mockResolvedValue([]),
    getContentHash: vi.fn().mockResolvedValue(null),
    getIndexedAtMap: vi.fn(),
    getIndexedSources: vi.fn().mockResolvedValue([]),
    getStats: vi.fn(),
    getDocumentSummaries: vi.fn(),
    getEmbeddings: vi.fn(),
    getSourceCentroid: vi.fn(),
    getStructuralCompanions: vi.fn(),
    purgeAll: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockPipeline() {
  const onDidIndexSource = new Emitter<any>();
  const onDidCompleteInitialIndex = new Emitter<any>();
  const onDidChangeProgress = new Emitter<any>();
  return {
    isIndexing: false,
    progress: { phase: 'idle', processed: 0, total: 0 },
    isInitialIndexComplete: true,
    start: vi.fn(),
    cancel: vi.fn(),
    reindexPage: vi.fn(),
    reindexFile: vi.fn(),
    schedulePageReindex: vi.fn(),
    scheduleFileReindex: vi.fn(),
    onDidIndexSource: onDidIndexSource.event,
    onDidCompleteInitialIndex: onDidCompleteInitialIndex.event,
    onDidChangeProgress: onDidChangeProgress.event,
    dispose: vi.fn(),
  };
}

function createMockWorkspace() {
  return {
    folders: [{ uri: { toString: () => 'file:///workspace' }, name: 'workspace', index: 0 }],
    dispose: vi.fn(),
  };
}

describe('semanticSourceToNodeId()', () => {
  it('maps Canvas pages and workspace-relative files to Workspace Graph node ids', () => {
    expect(semanticSourceToNodeId('page_block', 'page-1')).toBe('page:page-1');
    expect(semanticSourceToNodeId('file_chunk', 'notes/today.md', 'file:///workspace')).toBe(
      'file:file:///workspace/notes/today.md',
    );
  });

  it('returns undefined for file sources without a workspace root', () => {
    expect(semanticSourceToNodeId('file_chunk', 'notes/today.md')).toBeUndefined();
  });
});

describe('canonicalizeSemanticEdgePair()', () => {
  it('uses a stable node-id ordering for undirected semantic edges', () => {
    const a = { nodeId: 'page:z', sourceType: 'page_block' as const, sourceId: 'z' };
    const b = { nodeId: 'page:a', sourceType: 'page_block' as const, sourceId: 'a' };

    const pair = canonicalizeSemanticEdgePair(a, b);

    expect(pair.source.nodeId).toBe('page:a');
    expect(pair.target.nodeId).toBe('page:z');
  });
});

describe('SemanticGraphService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads cached edges without touching vector search or embedding paths', async () => {
    const db = createMockDb();
    const vectorStore = createMockVectorStore();
    const service = new SemanticGraphService(
      db as any,
      vectorStore as any,
      createMockPipeline() as any,
      createMockWorkspace() as any,
    );
    // M76 schema migration runs PRAGMA table_info on _ensureSchema(); return
    // a row indicating `direction` already exists so the ALTER TABLE migration
    // is a no-op. Subsequent mockResolvedValueOnce queues drive real queries.
    db.all
      .mockResolvedValueOnce([{ name: 'direction' }])
      .mockResolvedValueOnce([
        {
          sourceNodeId: 'page:a',
          targetNodeId: 'page:b',
          sourceType: 'page_block',
          sourceId: 'a',
          targetType: 'page_block',
          targetId: 'b',
          score: 0.88,
          kind: 'similar-to',
          direction: 'undirected',
          sourceContentHash: 'hash-a',
          targetContentHash: 'hash-b',
          updatedAt: '2026-05-15 00:00:00',
        },
      ]);

    const edges = await service.getCachedEdges();

    expect(edges).toHaveLength(1);
    expect(vectorStore.vectorSearch).not.toHaveBeenCalled();
    expect(vectorStore.getSourceCentroid).not.toHaveBeenCalled();
  });

  it('recomputes one source from stored centroids and vector search results', async () => {
    const db = createMockDb();
    const vectorStore = createMockVectorStore();
    const service = new SemanticGraphService(
      db as any,
      vectorStore as any,
      createMockPipeline() as any,
      createMockWorkspace() as any,
      { debounceMs: 0, processYieldMs: 0, minScore: 0.7, topLinksPerSource: 3, candidateK: 10 },
    );
    vectorStore.getIndexedSources.mockResolvedValueOnce([
      { sourceType: 'page_block', sourceId: 'a', contentHash: 'hash-a', chunkCount: 1, indexedAt: 'now' },
    ]);
    vectorStore.getContentHash.mockImplementation(async (sourceType: string, sourceId: string) => {
      if (sourceType === 'page_block' && sourceId === 'a') return 'hash-a';
      if (sourceType === 'page_block' && sourceId === 'b') return 'hash-b';
      return null;
    });
    vectorStore.getSourceCentroid.mockResolvedValueOnce({
      sourceType: 'page_block',
      sourceId: 'a',
      vector: [1, 0],
      chunkCount: 1,
    });
    vectorStore.vectorSearch.mockResolvedValueOnce([
      { sourceType: 'page_block', sourceId: 'a', score: 0.99 },
      { sourceType: 'page_block', sourceId: 'b', score: 0.9 },
    ]);
    db.get.mockResolvedValueOnce({ content_hash: 'old-hash' });

    await service.rebuildChangedSources();
    await vi.runOnlyPendingTimersAsync();

    expect(vectorStore.getSourceCentroid).toHaveBeenCalledWith('page_block', 'a');
    expect(vectorStore.vectorSearch).toHaveBeenCalledWith([1, 0], 10);
    expect(db.runTransaction).toHaveBeenCalledOnce();
    const ops = db.runTransaction.mock.calls[0][0];
    expect(ops.some((op: any) => String(op.sql).includes('INSERT OR REPLACE INTO semantic_graph_edges'))).toBe(true);
    expect(JSON.stringify(ops)).toContain('page:b');
  });
});

