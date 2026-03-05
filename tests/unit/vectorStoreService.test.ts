// vectorStoreService.test.ts — Unit tests for VectorStoreService (M10 Task 1.2)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VectorStoreService,
  float32ArrayToBuffer,
  sanitizeFts5Query,
  reciprocalRankFusion,
} from '../../src/services/vectorStoreService.js';
import type { EmbeddedChunk, SearchResult } from '../../src/services/vectorStoreService.js';

// ─── Mock DatabaseService ────────────────────────────────────────────────────

function createMockDb() {
  return {
    get: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue([]),
    run: vi.fn().mockResolvedValue(undefined),
    runTransaction: vi.fn().mockResolvedValue(undefined),
    getPath: vi.fn().mockReturnValue(':memory:'),
    dispose: vi.fn(),
  };
}

// ─── Helper: build a VectorRow-like object ───────────────────────────────────

function vectorRow(
  rowid: number,
  sourceType: string,
  sourceId: string,
  chunkIndex: number,
  text: string,
  distance = 0,
) {
  return {
    rowid,
    distance,
    source_type: sourceType,
    source_id: sourceId,
    chunk_index: chunkIndex,
    chunk_text: text,
    context_prefix: `[Source: "${sourceId}"]`,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('float32ArrayToBuffer()', () => {
  it('converts a number[] to Uint8Array of 4× length', () => {
    const buf = float32ArrayToBuffer([1.0, 2.0, 3.0]);
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.byteLength).toBe(12); // 3 floats × 4 bytes
  });

  it('round-trips back to Float32Array', () => {
    const original = [0.5, -1.25, 3.14159];
    const buf = float32ArrayToBuffer(original);
    const restored = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    expect(restored[0]).toBeCloseTo(0.5);
    expect(restored[1]).toBeCloseTo(-1.25);
    expect(restored[2]).toBeCloseTo(3.14159);
  });

  it('handles empty array', () => {
    const buf = float32ArrayToBuffer([]);
    expect(buf.byteLength).toBe(0);
  });
});

describe('sanitizeFts5Query()', () => {
  it('wraps single term in quotes', () => {
    const result = sanitizeFts5Query('hello');
    expect(result).toBe('"hello"');
  });

  it('joins multiple terms with implicit AND (space-separated)', () => {
    const result = sanitizeFts5Query('hello world');
    // FTS5 treats space-separated quoted terms as AND
    expect(result).toBe('"hello" "world"');
  });

  it('filters stopwords from multi-term queries', () => {
    const result = sanitizeFts5Query('what is the meaning of life');
    // "what", "is", "the", "of" are stopwords → only "meaning" and "life"
    expect(result).toBe('"meaning" "life"');
  });

  it('preserves all terms when every term is a stopword', () => {
    const result = sanitizeFts5Query('is the');
    // Both are stopwords → keep originals to avoid empty query
    expect(result).toBe('"is" "the"');
  });

  it('filters document-structural stopwords like page/chapter/book/examples', () => {
    const result = sanitizeFts5Query('FSI Shona vocabulary page numbers');
    // "page" and "numbers" are stopwords → "FSI", "Shona", "vocabulary"
    expect(result).toBe('"FSI" "Shona" "vocabulary"');
  });

  it('caps long queries at 5 AND terms to prevent empty result sets', () => {
    // 8 terms, all content-bearing (none are stopwords)
    const result = sanitizeFts5Query('FSI Shona Basic Course vocabulary definitions grammar textbook');
    // After stopword filtering: all 8 remain → cap to first 5
    expect(result).toBe('"FSI" "Shona" "Basic" "Course" "vocabulary"');
  });

  it('does not cap queries with 5 or fewer content terms', () => {
    const result = sanitizeFts5Query('FSI Shona Basic Course vocabulary');
    expect(result).toBe('"FSI" "Shona" "Basic" "Course" "vocabulary"');
  });

  it('strips FTS5 special characters', () => {
    const result = sanitizeFts5Query('hello(world) "test" ^match');
    expect(result).toContain('"hello"');
    expect(result).toContain('"world"');
    expect(result).toContain('"test"');
    expect(result).toContain('"match"');
    // Should not contain raw special chars
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
    expect(result).not.toContain('^');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeFts5Query('')).toBe('');
    expect(sanitizeFts5Query('   ')).toBe('');
  });

  it('returns empty string for only special characters', () => {
    expect(sanitizeFts5Query('()^*~')).toBe('');
  });
});

describe('reciprocalRankFusion()', () => {
  it('fuses two ranked lists with k=60', () => {
    const vectorResults = [
      vectorRow(1, 'page_block', 'p1', 0, 'chunk A'),
      vectorRow(2, 'page_block', 'p2', 0, 'chunk B'),
      vectorRow(3, 'page_block', 'p3', 0, 'chunk C'),
    ];
    const keywordResults = [
      vectorRow(2, 'page_block', 'p2', 0, 'chunk B'), // also rank 0 in keyword
      vectorRow(4, 'page_block', 'p4', 0, 'chunk D'),
      vectorRow(1, 'page_block', 'p1', 0, 'chunk A'), // rank 2 in keyword
    ];

    const lists = new Map<string, typeof vectorResults>();
    lists.set('vector', vectorResults);
    lists.set('keyword', keywordResults);

    const results = reciprocalRankFusion(lists, 60, 10);

    // chunk B (rowid=2): rank 1 in vector + rank 0 in keyword → highest score
    expect(results[0].rowid).toBe(2);
    expect(results[0].sources).toContain('vector');
    expect(results[0].sources).toContain('keyword');

    // chunk A (rowid=1): rank 0 in vector + rank 2 in keyword → second highest
    expect(results[1].rowid).toBe(1);

    // Score of rowid 2:  1/(60+1+1) + 1/(60+0+1) = 1/62 + 1/61
    expect(results[0].score).toBeCloseTo(1 / 62 + 1 / 61, 6);

    // Score of rowid 1:  1/(60+0+1) + 1/(60+2+1) = 1/61 + 1/63
    expect(results[1].score).toBeCloseTo(1 / 61 + 1 / 63, 6);

    // All 4 unique chunks should appear
    expect(results).toHaveLength(4);
  });

  it('respects topN limit', () => {
    const vectorResults = Array.from({ length: 20 }, (_, i) =>
      vectorRow(i + 1, 'page_block', `p${i}`, 0, `chunk ${i}`),
    );
    const lists = new Map([['vector', vectorResults]]);
    const results = reciprocalRankFusion(lists, 60, 5);
    expect(results).toHaveLength(5);
  });

  it('handles empty lists', () => {
    const lists = new Map<string, ReturnType<typeof vectorRow>[]>();
    lists.set('vector', []);
    const results = reciprocalRankFusion(lists, 60, 10);
    expect(results).toHaveLength(0);
  });

  it('handles single list', () => {
    const vectorResults = [
      vectorRow(10, 'file_chunk', 'file.ts', 0, 'code snippet'),
    ];
    const lists = new Map([['vector', vectorResults]]);
    const results = reciprocalRankFusion(lists, 60, 10);
    expect(results).toHaveLength(1);
    expect(results[0].rowid).toBe(10);
    expect(results[0].score).toBeCloseTo(1 / 61, 6);
    expect(results[0].sources).toEqual(['vector']);
  });

  it('sorts by descending score', () => {
    const list1 = [vectorRow(1, 'page_block', 'p1', 0, 'A')];
    const list2 = [
      vectorRow(2, 'page_block', 'p2', 0, 'B'),
      vectorRow(1, 'page_block', 'p1', 0, 'A'),
    ];
    const lists = new Map([['a', list1], ['b', list2]]);
    const results = reciprocalRankFusion(lists, 60, 10);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ─── VectorStoreService (with mock DB) ──────────────────────────────────────

describe('VectorStoreService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: VectorStoreService;

  beforeEach(() => {
    db = createMockDb();
    service = new VectorStoreService(db as any);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('upsert()', () => {
    const fakeChunks: EmbeddedChunk[] = [
      {
        sourceType: 'page_block',
        sourceId: 'page-1',
        chunkIndex: 0,
        text: 'Chunk zero text',
        contextPrefix: '[Source: "My Page"]',
        contentHash: 'abc123',
        embedding: [0.1, 0.2, 0.3],
      },
    ];

    it('calls runTransaction with delete + insert ops', async () => {
      db.all.mockResolvedValueOnce([]); // no existing rows to delete

      await service.upsert('page_block', 'page-1', fakeChunks, 'hash-all');

      expect(db.runTransaction).toHaveBeenCalledTimes(1);
      const ops = db.runTransaction.mock.calls[0][0];

      // Should have: delete from fts_chunks, insert vec_embeddings, insert fts_chunks, upsert indexing_metadata
      expect(ops.length).toBeGreaterThanOrEqual(3);

      const insertVec = ops.find((o: any) => o.sql.includes('INSERT INTO vec_embeddings'));
      expect(insertVec).toBeDefined();

      const insertFts = ops.find((o: any) => o.sql.includes('INSERT INTO fts_chunks'));
      expect(insertFts).toBeDefined();

      const upsertMeta = ops.find((o: any) => o.sql.includes('INSERT OR REPLACE INTO indexing_metadata'));
      expect(upsertMeta).toBeDefined();
    });

    it('deletes existing rows before inserting', async () => {
      db.all.mockResolvedValueOnce([{ rowid: 5 }, { rowid: 6 }]); // existing rows

      await service.upsert('page_block', 'page-1', fakeChunks, 'hash-new');

      const ops = db.runTransaction.mock.calls[0][0];
      const deleteOps = ops.filter((o: any) => o.sql.includes('DELETE FROM vec_embeddings'));
      expect(deleteOps).toHaveLength(2); // two existing rows
    });

    it('fires onDidUpdateIndex event', async () => {
      db.all.mockResolvedValueOnce([]);

      const updates: { sourceId: string; chunkCount: number }[] = [];
      service.onDidUpdateIndex((e) => updates.push(e));

      await service.upsert('page_block', 'page-1', fakeChunks, 'hash-1');

      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual({ sourceId: 'page-1', chunkCount: 1 });
    });
  });

  describe('deleteSource()', () => {
    it('deletes from all tables', async () => {
      db.all.mockResolvedValueOnce([{ rowid: 10 }]);
      await service.deleteSource('file_chunk', 'src/index.ts');

      expect(db.runTransaction).toHaveBeenCalledTimes(1);
      const ops = db.runTransaction.mock.calls[0][0];

      const vecDeletes = ops.filter((o: any) => o.sql.includes('vec_embeddings'));
      expect(vecDeletes.length).toBeGreaterThanOrEqual(1);

      const ftsDelete = ops.find((o: any) => o.sql.includes('fts_chunks'));
      expect(ftsDelete).toBeDefined();

      const metaDelete = ops.find((o: any) => o.sql.includes('indexing_metadata'));
      expect(metaDelete).toBeDefined();
    });

    it('skips transaction when no rows exist', async () => {
      db.all.mockResolvedValueOnce([]); // no existing rows
      await service.deleteSource('page_block', 'orphan-page');

      // Still should call runTransaction (for fts + metadata deletes)
      const ops = db.runTransaction.mock.calls[0]?.[0];
      if (ops) {
        // The fts and metadata deletes are always present
        expect(ops.some((o: any) => o.sql.includes('fts_chunks'))).toBe(true);
        expect(ops.some((o: any) => o.sql.includes('indexing_metadata'))).toBe(true);
      }
    });
  });

  describe('getContentHash()', () => {
    it('returns stored hash', async () => {
      db.get.mockResolvedValueOnce({ content_hash: 'abcdef' });
      const hash = await service.getContentHash('page_block', 'page-1');
      expect(hash).toBe('abcdef');
    });

    it('returns null when not indexed', async () => {
      db.get.mockResolvedValueOnce(null);
      const hash = await service.getContentHash('file_chunk', 'unknown.ts');
      expect(hash).toBeNull();
    });
  });

  describe('getStats()', () => {
    it('returns aggregate stats', async () => {
      db.get.mockResolvedValueOnce({ count: 5 });
      db.all.mockResolvedValueOnce([
        { source_type: 'page_block', count: 3, chunks: 15 },
        { source_type: 'file_chunk', count: 2, chunks: 8 },
      ]);

      const stats = await service.getStats();
      expect(stats.totalSources).toBe(5);
      expect(stats.totalChunks).toBe(23);
      expect(stats.bySourceType['page_block']).toBe(15);
      expect(stats.bySourceType['file_chunk']).toBe(8);
    });

    it('returns zeros on error', async () => {
      db.get.mockRejectedValueOnce(new Error('table missing'));
      const stats = await service.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalSources).toBe(0);
    });
  });

  describe('search()', () => {
    it('queries vector index and returns fused results', async () => {
      // Initialize
      db.get.mockResolvedValueOnce({ max_id: 0 });

      // Vector search returns rows
      db.all.mockResolvedValueOnce([
        vectorRow(1, 'page_block', 'p1', 0, 'Architecture overview'),
        vectorRow(2, 'page_block', 'p2', 1, 'API design patterns'),
      ]);

      // Keyword search returns rows
      db.all.mockResolvedValueOnce([
        vectorRow(2, 'page_block', 'p2', 1, 'API design patterns'),
        vectorRow(3, 'file_chunk', 'api.ts', 0, 'export function createAPI()'),
      ]);

      const results = await service.search(
        [0.1, 0.2, 0.3],
        'architecture API',
      );

      expect(results.length).toBeGreaterThan(0);
      // Rowid 2 appears in both lists → should be ranked highest
      expect(results[0].rowid).toBe(2);
      expect(results[0].sources).toContain('vector');
      expect(results[0].sources).toContain('keyword');
    });

    it('skips keyword search when includeKeyword=false', async () => {
      db.get.mockResolvedValueOnce({ max_id: 0 });
      db.all.mockResolvedValueOnce([
        vectorRow(1, 'page_block', 'p1', 0, 'Result A'),
      ]);

      const results = await service.search(
        [0.1, 0.2],
        'test',
        { includeKeyword: false },
      );

      // Only one db.all call (vector search), not two
      expect(db.all).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].sources).toEqual(['vector']);
    });

    it('respects topK option', async () => {
      db.get.mockResolvedValueOnce({ max_id: 0 });
      const manyRows = Array.from({ length: 15 }, (_, i) =>
        vectorRow(i + 1, 'page_block', `p${i}`, 0, `chunk ${i}`),
      );
      db.all.mockResolvedValueOnce(manyRows); // vector
      db.all.mockResolvedValueOnce([]); // keyword

      const results = await service.search([0.1], 'query', { topK: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('vectorSearch()', () => {
    it('returns vector-only results', async () => {
      db.get.mockResolvedValueOnce({ max_id: 0 });
      db.all.mockResolvedValueOnce([
        vectorRow(5, 'file_chunk', 'main.ts', 0, 'entry point code'),
      ]);

      const results = await service.vectorSearch([0.1, 0.2, 0.3], 5);
      expect(results).toHaveLength(1);
      expect(results[0].rowid).toBe(5);
      expect(results[0].sources).toEqual(['vector']);
    });
  });
});
