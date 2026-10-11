// vectorStoreDeletes.test.ts — a source's vectors are found through the indexed chunk table.
//
// vec0 deletes by rowid only, and its auxiliary columns have no index, so
// "SELECT rowid FROM vec_embeddings WHERE source_id = ?" read the whole
// vector table on every re-index of every source. chunk_metadata holds each
// chunk's rowid under an index; the scan remains only for a source indexed
// before chunk_metadata existed.

import { describe, it, expect, vi } from 'vitest';
import { VectorStoreService } from '../../src/services/vectorStoreService';

function dbWith(opts: { chunkIds?: number[]; indexed?: boolean; vecRowids?: number[] }) {
  const all = vi.fn(async (sql: string) => {
    if (sql.includes('FROM chunk_metadata')) return (opts.chunkIds ?? []).map((chunk_id) => ({ chunk_id }));
    if (sql.includes('FROM vec_embeddings')) return (opts.vecRowids ?? []).map((rowid) => ({ rowid }));
    return [];
  });
  const get = vi.fn(async (sql: string) => (sql.includes('FROM indexing_metadata') && opts.indexed ? { source_id: 'p1' } : null));
  const runTransaction = vi.fn(async () => []);
  return { isOpen: true, all, get, run: vi.fn(async () => ({ changes: 0, lastInsertRowid: 0 })), runTransaction };
}

function vectorDeletes(db: ReturnType<typeof dbWith>): number[] {
  const ops = (db.runTransaction.mock.calls[0] as unknown as [{ sql: string; params?: unknown[] }[]])[0];
  return ops.filter((o) => o.sql.startsWith('DELETE FROM vec_embeddings')).map((o) => (o.params as number[])[0]);
}

describe('VectorStoreService.deleteSource', () => {
  it('deletes the rowids chunk_metadata lists and never scans the vector table', async () => {
    const db = dbWith({ chunkIds: [7, 8, 9] });
    await new VectorStoreService(db as never).deleteSource('page_block', 'p1');
    expect(vectorDeletes(db)).toEqual([7, 8, 9]);
    expect(db.all.mock.calls.some(([sql]) => sql.includes('FROM vec_embeddings'))).toBe(false);
    expect(db.get).not.toHaveBeenCalled();
  });

  it('scans the vector table only for a source indexed before chunk_metadata existed', async () => {
    const db = dbWith({ chunkIds: [], indexed: true, vecRowids: [3, 4] });
    await new VectorStoreService(db as never).deleteSource('page_block', 'p1');
    expect(vectorDeletes(db)).toEqual([3, 4]);
    expect(db.all.mock.calls.some(([sql]) => sql.includes('FROM vec_embeddings'))).toBe(true);
  });

  it('reads nothing from the vector table for a source never indexed', async () => {
    const db = dbWith({ chunkIds: [], indexed: false, vecRowids: [99] });
    await new VectorStoreService(db as never).deleteSource('page_block', 'p1');
    expect(vectorDeletes(db)).toEqual([]);
    expect(db.all.mock.calls.some(([sql]) => sql.includes('FROM vec_embeddings'))).toBe(false);
  });
});
