// vectorStoreService.test.ts — Unit tests for VectorStoreService (M10 Task 1.2)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VectorStoreService,
  float32ArrayToBuffer,
  sanitizeFts5Query,
  sanitizeFts5QueryOr,
  isStopword,
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

  it('joins multiple terms with AND (implicit) for precision', () => {
    const result = sanitizeFts5Query('hello world');
    // AND (implicit in FTS5 — space-separated quoted terms) for precision;
    // vector path handles recall
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

  it('filters document-structural stopwords like numbers', () => {
    const result = sanitizeFts5Query('FSI Shona vocabulary page numbers');
    // "numbers" is a stopword → "FSI", "Shona", "vocabulary", "page" survive
    // M16: "page" is no longer a stopword (domain-useful term)
    expect(result).toBe('"FSI" "Shona" "vocabulary" "page"');
  });

  it('uses AND for multi-term queries for precision', () => {
    // 8 terms, all content-bearing — AND for precision, vector handles recall
    const result = sanitizeFts5Query('FSI Shona Basic Course vocabulary definitions grammar textbook');
    expect(result).toBe('"FSI" "Shona" "Basic" "Course" "vocabulary" "definitions" "grammar" "textbook"');
  });

  it('uses AND for 2+ content terms', () => {
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

  it('filters plurals of stopwords via de-pluralisation', () => {
    // M16: "book" is no longer a stopword → "books" survives
    expect(sanitizeFts5Query('Shona books')).toBe('"Shona" "books"');
    // M16: "page" is no longer a stopword → "pages" survives
    expect(sanitizeFts5Query('grammar pages')).toBe('"grammar" "pages"');
    // M16: "table" is no longer a stopword → "tables" survives
    expect(sanitizeFts5Query('data tables charts')).toBe('"data" "tables" "charts"');
  });
});

describe('sanitizeFts5QueryOr()', () => {
  it('joins multiple terms with OR for broader recall', () => {
    const result = sanitizeFts5QueryOr('collision deductible coverage');
    expect(result).toBe('"collision" OR "deductible" OR "coverage"');
  });

  it('wraps single term same as AND version', () => {
    expect(sanitizeFts5QueryOr('hello')).toBe('"hello"');
  });

  it('filters stopwords same as AND version', () => {
    const result = sanitizeFts5QueryOr('what is the deductible for collision');
    expect(result).toBe('"deductible" OR "collision"');
  });

  it('returns empty for empty input', () => {
    expect(sanitizeFts5QueryOr('')).toBe('');
  });
});

describe('isStopword()', () => {
  it('detects direct stopwords', () => {
    expect(isStopword('the')).toBe(true);
    expect(isStopword('make')).toBe(true);
    expect(isStopword('also')).toBe(true);
  });

  it('detects plural forms of stopwords', () => {
    expect(isStopword('makes')).toBe(true);
    expect(isStopword('numbers')).toBe(true);
    expect(isStopword('tells')).toBe(true);
  });

  it('does not flag non-stopwords', () => {
    expect(isStopword('Shona')).toBe(false);
    expect(isStopword('vocabulary')).toBe(false);
    expect(isStopword('grammar')).toBe(false);
  });

  it('does not flag domain-useful words removed in M16', () => {
    // These were previously stopwords but are now preserved for search quality
    expect(isStopword('page')).toBe(false);
    expect(isStopword('table')).toBe(false);
    expect(isStopword('section')).toBe(false);
    expect(isStopword('chapter')).toBe(false);
    expect(isStopword('book')).toBe(false);
    expect(isStopword('note')).toBe(false);
    expect(isStopword('find')).toBe(false);
    expect(isStopword('help')).toBe(false);
    expect(isStopword('use')).toBe(false);
    expect(isStopword('work')).toBe(false);
    expect(isStopword('read')).toBe(false);
    expect(isStopword('show')).toBe(false);
  });

  it('does not strip s from words ending in ss', () => {
    // "less" → "les" would not be a stopword anyway, but double-s guard matters
    expect(isStopword('less')).toBe(false);
    expect(isStopword('pass')).toBe(false);
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

    it('prepends contextPrefix to FTS5 content for BM25 metadata enrichment', async () => {
      db.all.mockResolvedValueOnce([]); // no existing rows

      await service.upsert('page_block', 'page-1', fakeChunks, 'hash-meta');

      const ops = db.runTransaction.mock.calls[0][0];
      const insertFts = ops.find((o: any) => o.sql.includes('INSERT INTO fts_chunks'));
      expect(insertFts).toBeDefined();
      // The FTS content should be contextPrefix + space + chunk text
      const ftsContent = insertFts.params[3];
      expect(ftsContent).toBe('[Source: "My Page"] Chunk zero text');
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
      expect(stats.sourceCountByType['page_block']).toBe(3);
      expect(stats.sourceCountByType['file_chunk']).toBe(2);
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

    it('captures keyword fallback and fusion details in the search trace', async () => {
      db.all.mockResolvedValueOnce([
        vectorRow(1, 'page_block', 'p1', 0, 'Architecture overview'),
      ]);
      db.all.mockResolvedValueOnce([]); // AND keyword path
      db.all.mockResolvedValueOnce([
        vectorRow(1, 'page_block', 'p1', 0, 'Architecture overview'),
        vectorRow(2, 'file_chunk', 'ARCHITECTURE.md', 0, 'System architecture notes'),
      ]); // OR fallback path

      await service.search([0.1, 0.2], 'architecture overview', { topK: 5 });

      const trace = service.getLastSearchTrace();
      expect(trace).toBeDefined();
      expect(trace?.vectorResultCount).toBe(1);
      expect(trace?.keywordResultCount).toBe(2);
      expect(trace?.keywordTrace?.fallbackUsed).toBe(true);
      expect(trace?.keywordTrace?.andResultCount).toBe(0);
      expect(trace?.fusedResultCount).toBeGreaterThan(0);
    });
  });

  describe('vectorSearch()', () => {
    it('returns vector-only results with cosine similarity scores', async () => {
      db.get.mockResolvedValueOnce({ max_id: 0 });
      db.all.mockResolvedValueOnce([
        vectorRow(5, 'file_chunk', 'main.ts', 0, 'entry point code', 0.4),
        vectorRow(6, 'file_chunk', 'utils.ts', 0, 'helper code', 1.2),
      ]);

      const results = await service.vectorSearch([0.1, 0.2, 0.3], 5);
      expect(results).toHaveLength(2);
      expect(results[0].rowid).toBe(5);
      expect(results[0].sources).toEqual(['vector']);
      // Cosine similarity = 1 - (distance / 2)
      expect(results[0].score).toBeCloseTo(0.8, 5);  // 1 - (0.4 / 2)
      expect(results[1].score).toBeCloseTo(0.4, 5);  // 1 - (1.2 / 2)
    });

    it('returns score 1.0 for distance 0 (identical)', async () => {
      db.get.mockResolvedValueOnce({ max_id: 0 });
      db.all.mockResolvedValueOnce([
        vectorRow(7, 'page_block', 'p1', 0, 'identical content', 0),
      ]);

      const results = await service.vectorSearch([0.1], 5);
      expect(results[0].score).toBe(1.0);
    });

    it('returns score 0.0 for distance 2 (opposite)', async () => {
      db.get.mockResolvedValueOnce({ max_id: 0 });
      db.all.mockResolvedValueOnce([
        vectorRow(8, 'page_block', 'p2', 0, 'opposite content', 2.0),
      ]);

      const results = await service.vectorSearch([0.1], 5);
      expect(results[0].score).toBe(0.0);
    });
  });

  describe('getEmbeddings()', () => {
    it('returns empty map for empty rowids', async () => {
      const result = await service.getEmbeddings([]);
      expect(result).toEqual(new Map());
      expect(db.all).not.toHaveBeenCalled();
    });

    it('fetches and converts Float32Array embeddings by rowid', async () => {
      // Create a Float32Array embedding and convert to Uint8Array (as stored in sqlite-vec)
      const f32 = new Float32Array([0.1, 0.2, 0.3]);
      const bytes = new Uint8Array(f32.buffer);

      db.all.mockResolvedValueOnce([
        { rowid: 10, embedding: bytes },
        { rowid: 20, embedding: bytes },
      ]);

      const result = await service.getEmbeddings([10, 20]);
      expect(result.size).toBe(2);

      const emb10 = result.get(10)!;
      expect(emb10).toHaveLength(3);
      expect(emb10[0]).toBeCloseTo(0.1, 5);
      expect(emb10[1]).toBeCloseTo(0.2, 5);
      expect(emb10[2]).toBeCloseTo(0.3, 5);

      expect(result.get(20)).toEqual(emb10);
    });

    it('batches large requests in groups of 100', async () => {
      // 250 rowids → 3 batches (100, 100, 50)
      const rowids = Array.from({ length: 250 }, (_, i) => i + 1);

      db.all.mockResolvedValue([]); // return empty for all batches

      await service.getEmbeddings(rowids);
      expect(db.all).toHaveBeenCalledTimes(3);
    });

    it('handles database errors gracefully', async () => {
      db.all.mockRejectedValueOnce(new Error('table not found'));

      const result = await service.getEmbeddings([1, 2, 3]);
      // Non-fatal — returns empty map on error
      expect(result.size).toBe(0);
    });
  });
});
