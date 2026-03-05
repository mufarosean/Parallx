// Unit tests for RetrievalService — M10 Phase 3 Task 3.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetrievalService, dotProduct, cosineSimilarity } from '../../src/services/retrievalService';
import type { RetrievalOptions } from '../../src/services/retrievalService';
import type { SearchResult } from '../../src/services/vectorStoreService';

// ── Mock factories ──

function createMockEmbeddingService() {
  return {
    embedQuery: vi.fn(async () => new Array(768).fill(0.1)),
    embedDocument: vi.fn(async () => new Array(768).fill(0.1)),
    embedDocumentBatch: vi.fn(async () => []),
    getModelInfo: vi.fn(() => ({ name: 'nomic-embed-text', dimensions: 768, installed: true })),
    ensureModel: vi.fn(async () => {}),
    clearCache: vi.fn(),
    cacheSize: 0,
    onDidStartEmbedding: vi.fn(() => ({ dispose: vi.fn() })) as any,
    onDidFinishEmbedding: vi.fn(() => ({ dispose: vi.fn() })) as any,
    dispose: vi.fn(),
  };
}

function createMockVectorStore() {
  return {
    initialize: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    deleteSource: vi.fn(async () => {}),
    search: vi.fn(async (): Promise<SearchResult[]> => []),
    vectorSearch: vi.fn(async () => []),
    getContentHash: vi.fn(async () => null),
    getIndexedSources: vi.fn(async () => []),
    getStats: vi.fn(async () => ({ totalChunks: 0, totalSources: 0, bySourceType: {}, sourceCountByType: {} })),
    getEmbeddings: vi.fn(async () => new Map<number, number[]>()),
    onDidUpdateIndex: vi.fn(() => ({ dispose: vi.fn() })) as any,
    dispose: vi.fn(),
  };
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    rowid: 1,
    sourceType: 'page_block',
    sourceId: 'page-1',
    chunkIndex: 0,
    chunkText: 'Test chunk content',
    contextPrefix: 'Page Title > Section',
    score: 0.03,
    sources: ['vector'],
    ...overrides,
  };
}

// ── Tests ──

describe('dotProduct()', () => {
  it('computes dot product of two vectors', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 1*4 + 2*5 + 3*6
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });

  it('handles empty vectors', () => {
    expect(dotProduct([], [])).toBe(0);
  });
});

describe('cosineSimilarity()', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns 0 for zero-magnitude vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('is independent of vector magnitude', () => {
    const a = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    const b = cosineSimilarity([2, 4, 6], [4, 5, 6]);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('RetrievalService', () => {
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let service: RetrievalService;

  beforeEach(() => {
    embeddingService = createMockEmbeddingService();
    vectorStore = createMockVectorStore();
    service = new RetrievalService(embeddingService as any, vectorStore as any);
  });

  describe('retrieve()', () => {
    it('returns empty array for blank query', async () => {
      const results = await service.retrieve('');
      expect(results).toEqual([]);
      expect(embeddingService.embedQuery).not.toHaveBeenCalled();
    });

    it('embeds query and calls hybrid search', async () => {
      const queryEmb = new Array(768).fill(0.1);
      const storedEmb = new Array(768).fill(0.1); // identical → cosine ~1.0
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05, chunkText: 'JWT tokens' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, storedEmb]]));

      const results = await service.retrieve('authentication approach');

      expect(embeddingService.embedQuery).toHaveBeenCalledWith('authentication approach');
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'authentication approach',
        expect.objectContaining({ topK: 30, includeKeyword: true }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('JWT tokens');
      expect(results[0].sourceType).toBe('page_block');
    });

    it('filters out results below minScore', async () => {
      const highEmb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05 }),
        makeResult({ rowid: 2, score: 0.001, chunkText: 'low score' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, highEmb]]));

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.05);
    });

    it('respects custom minScore option', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05 }),
        makeResult({ rowid: 2, score: 0.02 }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      const results = await service.retrieve('query', { minScore: 0.04 });
      expect(results).toHaveLength(1);
    });

    it('deduplicates sources — max 3 chunks per source by default', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', chunkIndex: 0, score: 0.10 }),
        makeResult({ rowid: 2, sourceId: 'p1', chunkIndex: 1, score: 0.09 }),
        makeResult({ rowid: 3, sourceId: 'p1', chunkIndex: 2, score: 0.08 }),
        makeResult({ rowid: 4, sourceId: 'p1', chunkIndex: 3, score: 0.07 }), // should be dropped
        makeResult({ rowid: 5, sourceId: 'p2', chunkIndex: 0, score: 0.06 }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        [1, 2, 3, 4, 5].map(id => [id, emb] as [number, number[]]),
      ));

      const results = await service.retrieve('query');
      const p1Chunks = results.filter((r) => r.sourceId === 'p1');
      expect(p1Chunks).toHaveLength(3);
      expect(results).toHaveLength(4); // 3 from p1 + 1 from p2
    });

    it('respects custom maxPerSource option', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', chunkIndex: 0, score: 0.10 }),
        makeResult({ rowid: 2, sourceId: 'p1', chunkIndex: 1, score: 0.09 }),
        makeResult({ rowid: 3, sourceId: 'p2', chunkIndex: 0, score: 0.08 }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        [1, 2, 3].map(id => [id, emb] as [number, number[]]),
      ));

      const results = await service.retrieve('query', { maxPerSource: 1 });
      expect(results).toHaveLength(2); // 1 from each source
    });

    it('enforces token budget', async () => {
      const emb = new Array(768).fill(0.1);
      // Each chunk ~5 tokens (20 chars / 4)
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.10, chunkText: 'A'.repeat(400) }), // 100 tokens
        makeResult({ rowid: 2, sourceId: 'p2', score: 0.09, chunkText: 'B'.repeat(400) }), // 100 tokens
        makeResult({ rowid: 3, sourceId: 'p3', score: 0.08, chunkText: 'C'.repeat(400) }), // 100 tokens
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        [1, 2, 3].map(id => [id, emb] as [number, number[]]),
      ));

      const results = await service.retrieve('query', { tokenBudget: 200 });
      expect(results).toHaveLength(2); // 100 + 100 = 200, third would exceed
    });

    it('always includes at least one chunk even if it exceeds budget', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.10, chunkText: 'A'.repeat(2000) }), // 500 tokens
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      const results = await service.retrieve('query', { tokenBudget: 100 });
      expect(results).toHaveLength(1); // Included despite exceeding budget
    });

    it('passes sourceFilter to VectorStoreService', async () => {
      vectorStore.search.mockResolvedValue([]);

      await service.retrieve('query', { sourceFilter: 'file_chunk' });

      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'query',
        expect.objectContaining({ sourceFilter: 'file_chunk' }),
      );
    });

    it('respects topK option', async () => {
      const emb = new Array(768).fill(0.1);
      const results = Array.from({ length: 15 }, (_, i) =>
        makeResult({ rowid: i + 1, sourceId: `p${i}`, score: 0.10 - i * 0.001 }),
      );
      vectorStore.search.mockResolvedValue(results);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        Array.from({ length: 15 }, (_, i) => [i + 1, emb] as [number, number[]]),
      ));

      const retrieved = await service.retrieve('query', { topK: 5 });
      expect(retrieved.length).toBeLessThanOrEqual(5);
    });

    it('includes tokenCount in results', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.10, chunkText: 'Hello world' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      const results = await service.retrieve('query');
      expect(results[0].tokenCount).toBe(Math.ceil('Hello world'.length / 4));
    });

    it('applies relative score drop-off filter — drops results < 60% of top score', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.10 }),   // top score
        makeResult({ rowid: 2, sourceId: 'p2', score: 0.07 }),   // 70% of top → keeps
        makeResult({ rowid: 3, sourceId: 'p3', score: 0.05 }),   // 50% of top → dropped
        makeResult({ rowid: 4, sourceId: 'p4', score: 0.026 }),  // 26% of top → dropped
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        [1, 2].map(id => [id, emb] as [number, number[]]),
      ));

      const results = await service.retrieve('query');
      expect(results).toHaveLength(2);
      expect(results[0].sourceId).toBe('p1');
      expect(results[1].sourceId).toBe('p2');
    });

    it('does not apply drop-off filter when only one result', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.03 }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1);
    });
  });

  describe('formatContext()', () => {
    it('returns empty string for no chunks', () => {
      expect(service.formatContext([])).toBe('');
    });

    it('formats chunks with source attribution and citation numbers', () => {
      const chunks = [
        {
          sourceType: 'page_block',
          sourceId: 'p1',
          contextPrefix: 'Backend Architecture > Auth',
          text: 'We chose JWT with refresh tokens.',
          score: 0.9,
          sources: ['vector'],
          tokenCount: 8,
        },
        {
          sourceType: 'file_chunk',
          sourceId: 'src/auth/middleware.ts',
          contextPrefix: 'src/auth/middleware.ts',
          text: 'function verifyToken() { ... }',
          score: 0.8,
          sources: ['vector', 'keyword'],
          tokenCount: 8,
        },
      ];

      const formatted = service.formatContext(chunks);

      expect(formatted).toContain('[Retrieved Context]');
      expect(formatted).toContain('[1] Source: Backend Architecture > Auth');
      expect(formatted).toContain('We chose JWT with refresh tokens.');
      expect(formatted).toContain('[2] Source: src/auth/middleware.ts');
      expect(formatted).toContain('function verifyToken() { ... }');
      expect(formatted).toContain('---');
    });

    it('uses sourceId as fallback when contextPrefix is empty', () => {
      const chunks = [
        {
          sourceType: 'page_block',
          sourceId: 'page-uuid-123',
          contextPrefix: '',
          text: 'Some content',
          score: 0.7,
          sources: ['vector'],
          tokenCount: 3,
        },
      ];

      const formatted = service.formatContext(chunks);
      expect(formatted).toContain('[1] Source: page-uuid-123');
    });

    it('assigns the same citation number to chunks from the same source', () => {
      const chunks = [
        {
          sourceType: 'file_chunk',
          sourceId: 'src/auth.ts',
          contextPrefix: 'src/auth.ts',
          text: 'First chunk',
          score: 0.9,
          sources: ['vector'],
          tokenCount: 3,
        },
        {
          sourceType: 'file_chunk',
          sourceId: 'src/auth.ts',
          contextPrefix: 'src/auth.ts',
          text: 'Second chunk',
          score: 0.8,
          sources: ['vector'],
          tokenCount: 3,
        },
        {
          sourceType: 'page_block',
          sourceId: 'p2',
          contextPrefix: 'Notes',
          text: 'Third chunk',
          score: 0.7,
          sources: ['vector'],
          tokenCount: 3,
        },
      ];

      const formatted = service.formatContext(chunks);
      // Both auth.ts chunks get [1], the page gets [2]
      const lines = formatted.split('\n');
      const sourceLines = lines.filter(l => l.includes('Source:'));
      expect(sourceLines[0]).toBe('[1] Source: src/auth.ts');
      expect(sourceLines[1]).toBe('[1] Source: src/auth.ts');
      expect(sourceLines[2]).toBe('[2] Source: Notes');
    });
  });

  describe('cosine re-ranking (M16)', () => {
    it('drops candidates with cosine similarity below 0.30', async () => {
      // Create two different embeddings: one similar to query, one orthogonal
      const queryEmb = new Array(768).fill(0);
      queryEmb[0] = 1.0; // unit vector along dim 0
      embeddingService.embedQuery.mockResolvedValue(queryEmb);

      const similarEmb = new Array(768).fill(0);
      similarEmb[0] = 0.9; similarEmb[1] = 0.3; // cosine ~0.95 with query

      const orthogonalEmb = new Array(768).fill(0);
      orthogonalEmb[1] = 1.0; // cosine ~0 with query (orthogonal)

      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.08, chunkText: 'Relevant chunk' }),
        makeResult({ rowid: 2, sourceId: 'p2', score: 0.06, chunkText: 'Irrelevant chunk' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, similarEmb],
        [2, orthogonalEmb],
      ]));

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('p1');
    });

    it('re-sorts results by cosine similarity (descending)', async () => {
      const queryEmb = new Array(768).fill(0);
      queryEmb[0] = 1.0;
      embeddingService.embedQuery.mockResolvedValue(queryEmb);

      // emb1: cosine ~0.6 with query
      const emb1 = new Array(768).fill(0);
      emb1[0] = 0.6; emb1[1] = 0.8;

      // emb2: cosine ~0.95 with query (higher similarity despite lower RRF score)
      const emb2 = new Array(768).fill(0);
      emb2[0] = 0.95; emb2[1] = 0.1;

      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.09, chunkText: 'Lower cosine' }),
        makeResult({ rowid: 2, sourceId: 'p2', score: 0.07, chunkText: 'Higher cosine' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb1],
        [2, emb2],
      ]));

      const results = await service.retrieve('query');
      // Rowid 2 has higher cosine similarity → should be first
      expect(results[0].sourceId).toBe('p2');
      expect(results[1].sourceId).toBe('p1');
    });

    it('keeps candidates when getEmbeddings returns empty (no stored embedding)', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);

      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.08 }),
      ]);
      // No embeddings returned — candidate should still be kept with neutral score
      vectorStore.getEmbeddings.mockResolvedValue(new Map());

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1);
    });

    it('uses 3× overfetch factor for cosine re-ranking', async () => {
      vectorStore.search.mockResolvedValue([]);

      await service.retrieve('query', { topK: 10 });

      // topK=10, overfetchFactor=3 → searchOptions.topK = 30
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'query',
        expect.objectContaining({ topK: 30 }),
      );
    });
  });
});
