// vectorStoreUpsertMany.test.ts — M60 Phase θ B4
//
// Asserts the IPC-batching contract:
//   - `upsertMany([N records])` issues exactly ONE `runTransaction` call.
//   - Op order across sources preserves the per-source `$lastRowId` sentinel
//     contract (vec_embeddings INSERT immediately precedes its
//     chunk_metadata + fts_chunks INSERTs for that source).
//   - Empty-batch shortcut (no IPC).

import { describe, it, expect, vi } from 'vitest';
import { VectorStoreService } from '../../src/services/vectorStoreService.js';

function makeDb() {
  return {
    isOpen: true,
    currentPath: ':memory:',
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]), // no existing rowids
    run: vi.fn().mockResolvedValue({ changes: 0, lastInsertRowid: 0 }),
    runTransaction: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };
}

function makeChunks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    sourceType: 'page_block' as const,
    sourceId: 'src',
    chunkIndex: i,
    text: `chunk ${i}`,
    contextPrefix: '[Source: "src"]',
    contentHash: `hash-${i}`,
    embedding: new Array(768).fill(0.1),
  }));
}

describe('VectorStoreService.upsertMany — M60 B4 IPC batching', () => {
  it('issues exactly ONE runTransaction for N source records', async () => {
    const db = makeDb();
    const store = new VectorStoreService(db as any);

    const records = Array.from({ length: 50 }, (_, i) => ({
      sourceType: 'page_block',
      sourceId: `p${i}`,
      chunks: makeChunks(3),
      contentHash: `page-hash-${i}`,
    }));

    await store.upsertMany(records);

    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    const ops = (db.runTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as { sql: string }[];
    // 50 sources × (DELETE fts + DELETE chunk_metadata + 3×(vec INS + chunk_metadata INS + fts INS) + indexing_metadata) = 50×12 = 600 ops
    expect(ops.length).toBe(50 * (2 /* deletes */ + 3 * 3 /* per-chunk inserts */ + 1 /* indexing_metadata */));
  });

  it('preserves $lastRowId locality (no DELETE breaks the per-source insert chain)', async () => {
    const db = makeDb();
    const store = new VectorStoreService(db as any);

    await store.upsertMany([
      { sourceType: 'page_block', sourceId: 'p1', chunks: makeChunks(2), contentHash: 'h1' },
      { sourceType: 'page_block', sourceId: 'p2', chunks: makeChunks(1), contentHash: 'h2' },
    ]);

    const ops = (db.runTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as { sql: string; params?: unknown[] }[];
    // Every chunk_metadata + fts_chunks row using '$lastRowId' must be
    // immediately preceded by an INSERT (vec_embeddings or chunk_metadata) —
    // never by a DELETE / SELECT — so the sentinel resolves to a valid rowid
    // in the same per-chunk insert chain.
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const usesSentinel = Array.isArray(op.params) && op.params.includes('$lastRowId');
      if (!usesSentinel) continue;
      expect(i).toBeGreaterThan(0);
      const prev = ops[i - 1];
      expect(prev.sql.toLowerCase()).toMatch(/^\s*insert /);
    }
  });

  it('skips IPC entirely on empty batch', async () => {
    const db = makeDb();
    const store = new VectorStoreService(db as any);
    await store.upsertMany([]);
    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('upsert (single) and upsertMany (batched of 1) produce equivalent op shape', async () => {
    const dbA = makeDb();
    const dbB = makeDb();
    const storeA = new VectorStoreService(dbA as any);
    const storeB = new VectorStoreService(dbB as any);

    const chunks = makeChunks(2);
    await storeA.upsert('page_block', 'p1', chunks, 'h1');
    await storeB.upsertMany([{ sourceType: 'page_block', sourceId: 'p1', chunks, contentHash: 'h1' }]);

    const opsA = (dbA.runTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[];
    const opsB = (dbB.runTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[];
    expect(opsA.length).toBe(opsB.length);
  });
});
