// indexingPipelineMtimeFastSkip.test.ts — M60 Phase θ B5
//
// Asserts:
//   - When `indexing.lazyMtime.enabled` is on, pages whose `updated_at`
//     predates the persisted `indexed_at` are skipped without hydrating
//     content + properties (no extra DB read for `pages.content`,
//     no chunkPage call).
//   - Acceptance contract from M60 §6 B5: ≥95% of pages skipped on a
//     warm reopen of an unchanged workspace.
//   - When the flag is off, legacy behavior is preserved (every page
//     hydrated + hash-checked).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IndexingPipelineService } from '../../src/services/indexingPipeline.js';
import { FileType } from '../../src/platform/fileTypes.js';
import { URI } from '../../src/platform/uri.js';

// Minimal mocks (tighter than the full unit-test factories — we only need
// the seams the page-indexing path touches under fast-skip).

function makeDb(pages: { id: string; title: string; content: string; updated_at: string }[]) {
  // First all() with 'updated_at' → mtime pass.
  // Second all() with 'IN (...)' → hydrate candidates.
  return {
    isOpen: true,
    currentPath: ':memory:',
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('SELECT id, updated_at FROM pages')) {
        return pages.map((p) => ({ id: p.id, updated_at: p.updated_at }));
      }
      if (typeof sql === 'string' && sql.includes('SELECT id, title, content FROM pages WHERE id IN')) {
        const ids = new Set((params ?? []) as string[]);
        return pages.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, title: p.title, content: p.content }));
      }
      if (typeof sql === 'string' && sql.includes('SELECT id, title, content FROM pages WHERE is_archived')) {
        return pages.map((p) => ({ id: p.id, title: p.title, content: p.content }));
      }
      if (typeof sql === 'string' && sql.includes('FROM page_properties')) {
        return [];
      }
      return [];
    }),
    run: vi.fn().mockResolvedValue({ changes: 0, lastInsertRowid: 0 }),
    runTransaction: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };
}

function makeFileService() {
  return {
    readFile: vi.fn().mockResolvedValue({ content: '', encoding: 'utf-8', size: 0, mtime: 0 }),
    readdir: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({ type: FileType.File, size: 0, mtime: 0, ctime: 0 }),
    onDidFileChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    watch: vi.fn().mockResolvedValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
    writeFile: vi.fn(), rename: vi.fn(), delete: vi.fn(), mkdir: vi.fn(), copy: vi.fn(),
    setBoundaryChecker: vi.fn(),
    openFileDialog: vi.fn(), openFolderDialog: vi.fn(), saveFileDialog: vi.fn(), showMessageBox: vi.fn(),
    readDocumentText: vi.fn().mockResolvedValue({ text: '', format: 'unknown', metadata: {} }),
    isRichDocument: vi.fn().mockReturnValue(false),
    richDocumentExtensions: new Set(['.pdf']),
  };
}

function makeEmbedding() {
  return {
    ensureModel: vi.fn().mockResolvedValue(undefined),
    embedDocument: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
    embedQuery: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
    embedDocumentBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => new Array(768).fill(0.1)))),
    getModelInfo: vi.fn().mockReturnValue({ name: 'nomic-embed-text', dimensions: 768, installed: true }),
    clearCache: vi.fn(), cacheSize: 0,
    onDidStartEmbedding: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidFinishEmbedding: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  };
}

function makeChunking() {
  return {
    chunkPage: vi.fn().mockImplementation((pageId: string, title: string) =>
      Promise.resolve([{
        sourceType: 'page_block' as const, sourceId: pageId, chunkIndex: 0,
        text: `Content of ${title}`, contextPrefix: `[Source: "${title}"]`,
        contentHash: `hash-${pageId}`,
      }])),
    chunkFile: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };
}

function makeVectorStore(indexedAtMap: Map<string, number>) {
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
    getIndexedAtMap: vi.fn().mockImplementation(async (sourceType: string) =>
      sourceType === 'page_block' ? indexedAtMap : new Map()),
    getIndexedSources: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalChunks: 0, totalSources: 0, bySourceType: {}, sourceCountByType: {} }),
    getDocumentSummaries: vi.fn().mockResolvedValue(new Map()),
    getEmbeddings: vi.fn().mockResolvedValue(new Map()),
    onDidUpdateIndex: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispose: vi.fn(),
  };
}

function makeWorkspace() {
  return {
    activeWorkspace: undefined, isRestored: true,
    folders: [{ uri: URI.file('/workspace'), name: 'workspace', index: 0 }],
    workbenchState: 'FOLDER', workspaceName: 'workspace',
    onDidChangeWorkspace: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidRestoreState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeFolders: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidChangeWorkbenchState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    save: vi.fn(), requestSave: vi.fn(), createWorkspace: vi.fn(), switchWorkspace: vi.fn(),
    getRecentWorkspaces: vi.fn(), removeRecentWorkspace: vi.fn(),
    addFolder: vi.fn(), removeFolder: vi.fn(), updateFolders: vi.fn(),
    getWorkspaceFolder: vi.fn(), dispose: vi.fn(),
  };
}

describe('IndexingPipelineService — page mtime fast-skip (M60 B5)', () => {
  let pipeline: IndexingPipelineService;

  beforeEach(() => {
    // Force-disable the rIC startup defer for tests via VITEST env (already true).
  });

  it('skips ≥95% of pages whose updated_at predates indexed_at when flag is on', async () => {
    // 100 pages all "old" (updated_at = 2026-01-01); indexed at 2026-04-01.
    const pages = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      title: `Page ${i}`,
      content: '{"type":"doc","content":[]}',
      updated_at: '2026-01-01 00:00:00',
    }));
    const indexedAtMap = new Map<string, number>(
      pages.map((p) => [p.id, new Date('2026-04-01T00:00:00Z').getTime()]),
    );
    const db = makeDb(pages);
    const vectorStore = makeVectorStore(indexedAtMap);
    const chunking = makeChunking();

    pipeline = new IndexingPipelineService(
      db as any, makeFileService() as any, makeEmbedding() as any,
      chunking as any, vectorStore as any, makeWorkspace() as any,
    );
    pipeline.setFlagAccessor((id) => id === 'indexing.lazyMtime.enabled');

    await pipeline.start();

    // No content hydration: only the lightweight `(id, updated_at)` query
    // hit the pages table — no IN-list hydrate, no chunkPage call.
    const allCalls = (db.all as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const hydrateCalls = allCalls.filter((s) => s.includes('SELECT id, title, content FROM pages WHERE id IN'));
    expect(hydrateCalls.length).toBe(0);
    expect(chunking.chunkPage).not.toHaveBeenCalled();
    expect(vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('does NOT skip pages whose updated_at is newer than indexed_at', async () => {
    // 1 stale page + 1 fresh page.
    const pages = [
      { id: 'p_old', title: 'Old', content: '{"type":"doc","content":[]}', updated_at: '2026-01-01 00:00:00' },
      { id: 'p_new', title: 'New', content: '{"type":"doc","content":[]}', updated_at: '2026-05-01 00:00:00' },
    ];
    const indexedAtMap = new Map<string, number>([
      ['p_old', new Date('2026-04-01T00:00:00Z').getTime()],
      ['p_new', new Date('2026-04-01T00:00:00Z').getTime()],
    ]);
    const db = makeDb(pages);
    const vectorStore = makeVectorStore(indexedAtMap);
    const chunking = makeChunking();

    pipeline = new IndexingPipelineService(
      db as any, makeFileService() as any, makeEmbedding() as any,
      chunking as any, vectorStore as any, makeWorkspace() as any,
    );
    pipeline.setFlagAccessor(() => true);

    await pipeline.start();

    // The fresh page hydrated + chunked + upserted; the old one didn't.
    expect(chunking.chunkPage).toHaveBeenCalledTimes(1);
    const chunkCall = (chunking.chunkPage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(chunkCall[0]).toBe('p_new');
  });

  it('falls back to legacy hash-check path when flag is off', async () => {
    const pages = [
      { id: 'p1', title: 'P1', content: '{"type":"doc","content":[]}', updated_at: '2026-01-01 00:00:00' },
    ];
    const indexedAtMap = new Map<string, number>([['p1', Date.now()]]);
    const db = makeDb(pages);
    const vectorStore = makeVectorStore(indexedAtMap);
    const chunking = makeChunking();

    pipeline = new IndexingPipelineService(
      db as any, makeFileService() as any, makeEmbedding() as any,
      chunking as any, vectorStore as any, makeWorkspace() as any,
    );
    // No setFlagAccessor — defaults to legacy.

    await pipeline.start();

    // Legacy path queries the full row up-front, then runs the hash check
    // inside _indexSinglePage. With the mocked content hash mismatch
    // (getContentHash returns null for non-_system) chunkPage IS called.
    expect(chunking.chunkPage).toHaveBeenCalledTimes(1);
  });

  it('falls back to legacy when accessor returns false', async () => {
    const pages = [
      { id: 'p1', title: 'P1', content: '{"type":"doc","content":[]}', updated_at: '2026-01-01 00:00:00' },
    ];
    const indexedAtMap = new Map<string, number>([['p1', Date.now()]]);
    const db = makeDb(pages);
    const vectorStore = makeVectorStore(indexedAtMap);
    const chunking = makeChunking();

    pipeline = new IndexingPipelineService(
      db as any, makeFileService() as any, makeEmbedding() as any,
      chunking as any, vectorStore as any, makeWorkspace() as any,
    );
    pipeline.setFlagAccessor(() => false);

    await pipeline.start();

    expect(chunking.chunkPage).toHaveBeenCalledTimes(1);
  });
});
