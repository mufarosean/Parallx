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
    getStructuralCompanions: vi.fn(async (): Promise<SearchResult[]> => []),
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
        expect.objectContaining({ topK: 60, includeKeyword: true }),
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
      expect(results[0].score).toBeGreaterThan(0.05);
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

    it('deduplicates sources — max 5 chunks per source by default', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', chunkIndex: 0, score: 0.10 }),
        makeResult({ rowid: 2, sourceId: 'p1', chunkIndex: 1, score: 0.09 }),
        makeResult({ rowid: 3, sourceId: 'p1', chunkIndex: 2, score: 0.08 }), // kept (3rd of 5 allowed)
        makeResult({ rowid: 4, sourceId: 'p2', chunkIndex: 0, score: 0.07 }),
        makeResult({ rowid: 5, sourceId: 'p2', chunkIndex: 1, score: 0.06 }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        [1, 2, 3, 4, 5].map(id => [id, emb] as [number, number[]]),
      ));

      const results = await service.retrieve('query');
      const p1Chunks = results.filter((r) => r.sourceId === 'p1');
      expect(p1Chunks).toHaveLength(3);
      expect(results).toHaveLength(5); // 3 from p1 + 2 from p2
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

    it('does not apply drop-off filter by default (ragDropoffRatio = 0)', async () => {
      const emb = new Array(768).fill(0.1);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.10 }),   // top score
        makeResult({ rowid: 2, sourceId: 'p2', score: 0.07 }),   // 70% of top
        makeResult({ rowid: 3, sourceId: 'p3', score: 0.05 }),   // 50% of top
        makeResult({ rowid: 4, sourceId: 'p4', score: 0.026 }),  // 26% of top — all kept (dropoff disabled)
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map(
        [1, 2, 3, 4].map(id => [id, emb] as [number, number[]]),
      ));

      const results = await service.retrieve('query');
      expect(results).toHaveLength(4); // dropoff disabled by default
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
    it('drops candidates with cosine similarity below 0.20 (default threshold)', async () => {
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

    it('decomposes hard multi-clause queries and merges candidates', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);

      vectorStore.search.mockImplementation(async (_queryEmbedding: number[], queryText: string) => {
        if (/who do i call/i.test(queryText)) {
          return [makeResult({ rowid: 2, sourceId: 'contacts', score: 0.08, chunkText: 'Call Sarah to start a claim.' })];
        }
        return [makeResult({ rowid: 1, sourceId: 'accident-guide', score: 0.09, chunkText: 'Take photos and document the scene.' })];
      });
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('What should I do after an accident and who do I call to start a claim?');

      expect(vectorStore.search.mock.calls.length).toBeGreaterThan(1);
      expect(results.map((result) => result.sourceId)).toEqual(expect.arrayContaining(['accident-guide', 'contacts']));

      const trace = service.getLastTrace();
      expect(trace?.queryPlan?.complexity).toBe('hard');
      expect(trace?.queryPlan?.strategy).toBe('decomposed');
      expect(trace?.queryPlan?.variants.length).toBeGreaterThan(1);
    });

    it('keeps identifier-heavy queries on the single-query fast path', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'vehicle-info', score: 0.08, chunkText: 'The total loss threshold is 75% of KBB value.' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      await service.retrieve('What is the 75% KBB total loss rule? Please find it.');

      expect(vectorStore.search).toHaveBeenCalledTimes(1);
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'What is the 75% KBB total loss rule? Please find it.',
        expect.objectContaining({ topK: 40 }),
      );

      const trace = service.getLastTrace();
      expect(trace?.queryPlan?.exactMatchBias).toBe(true);
      expect(trace?.queryPlan?.strategy).toBe('single');
      expect(trace?.queryPlan?.identifiers).toEqual(expect.arrayContaining(['75%', 'KBB']));
    });

    it('uses a keyword-focused lexical query for simple non-identifier prompts', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'contacts', score: 0.08, chunkText: 'AutoCraft Collision Center and Precision Auto Body are preferred repair shops.' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      await service.retrieve('Which repair shops are recommended under my policy? Please cite your sources.');

      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'repair shops recommended',
        expect.objectContaining({ topK: 60 }),
      );

      const trace = service.getLastTrace();
      expect(trace?.queryPlan?.strategy).toBe('single');
      expect(trace?.queryPlan?.reasons).toContain('keyword-focused-lexical');
      expect(trace?.queryPlan?.variants[0]?.keywordQuery).toBe('repair shops recommended');
    });

    it('boosts candidates whose headings match the lexical focus terms', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'claims-guide',
          score: 0.05,
          contextPrefix: 'Claims Guide > Repair Authorization',
          chunkText: 'You can choose any licensed repair shop.',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'agent-contacts',
          score: 0.05,
          contextPrefix: 'Agent Contacts > Preferred Repair Shops',
          headingPath: 'Preferred Repair Shops',
          chunkText: 'AutoCraft Collision Center is a preferred shop.',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('Which repair shops are recommended under my policy? Please cite your sources.');

      expect(results[0].sourceId).toBe('agent-contacts');
    });

    it('expands hard structured anchors with nearby parent-section companions', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/Architecture.pdf',
          score: 0.072,
          sourceType: 'file_chunk',
          contextPrefix: 'Architecture.pdf > Retrieval Pipeline > Candidate Fusion',
          headingPath: 'Retrieval Pipeline > Candidate Fusion',
          parentHeadingPath: 'Retrieval Pipeline',
          structuralRole: 'table',
          documentKind: 'pdf',
          extractionPipeline: 'docling',
          chunkText: 'Table: candidate fusion weights and fallback ordering.',
        }),
      ]);
      vectorStore.getStructuralCompanions.mockResolvedValue([
        makeResult({
          rowid: 2,
          sourceId: 'docs/Architecture.pdf',
          score: 0,
          sourceType: 'file_chunk',
          contextPrefix: 'Architecture.pdf > Retrieval Pipeline',
          headingPath: 'Retrieval Pipeline',
          structuralRole: 'section',
          documentKind: 'pdf',
          extractionPipeline: 'docling',
          chunkIndex: 6,
          chunkText: 'The retrieval pipeline first broadens candidates, then reranks and packs evidence.',
          sources: ['structure-expand'],
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb], [2, emb]]));

      const results = await service.retrieve('How does the retrieval pipeline in the PDF architecture doc rank and pack evidence, and which parent section explains the overall flow?');

      expect(vectorStore.getStructuralCompanions).toHaveBeenCalledTimes(1);
      expect(results.map((result) => result.sourceId)).toEqual(expect.arrayContaining(['docs/Architecture.pdf']));
      expect(results.some((result) => result.text.includes('first broadens candidates'))).toBe(true);
      expect(service.getLastTrace()?.rankingTrace?.structureExpansionApplied).toBe(true);
    });

    it('does not expand structured anchors when hard-document expansion is off', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragCandidateBreadth: 'balanced',
            ragStructureExpansionMode: 'off',
            ragRerankMode: 'standard',
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/Architecture.pdf',
          score: 0.072,
          sourceType: 'file_chunk',
          contextPrefix: 'Architecture.pdf > Retrieval Pipeline > Candidate Fusion',
          headingPath: 'Retrieval Pipeline > Candidate Fusion',
          parentHeadingPath: 'Retrieval Pipeline',
          structuralRole: 'table',
          documentKind: 'pdf',
          extractionPipeline: 'docling',
          chunkText: 'Table: candidate fusion weights and fallback ordering.',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      await service.retrieve('How does the retrieval pipeline in the PDF architecture doc rank and pack evidence, and which parent section explains the overall flow?');

      expect(vectorStore.getStructuralCompanions).not.toHaveBeenCalled();
      expect(service.getLastTrace()?.rankingTrace?.structureExpansionApplied).toBe(false);
    });

    it('keeps short what-about follow-ups on the simple keyword-focused path', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'policy', score: 0.08, chunkText: 'Comprehensive deductible is $250.' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      await service.retrieve('And what about comprehensive?');

      const [, queryText, searchOptions] = vectorStore.search.mock.calls[0];
      expect(queryText).toBe('And what about comprehensive?');
      expect(searchOptions).toEqual(expect.objectContaining({ topK: 60 }));

      const trace = service.getLastTrace();
      expect(trace?.queryPlan?.complexity).toBe('simple');
      expect(trace?.queryPlan?.strategy).toBe('single');
      expect(trace?.queryPlan?.reasons).not.toContain('multi-clause-question');
    });

    it('widens hard-query candidate breadth when broad mode is enabled', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragCandidateBreadth: 'broad',
            ragStructureExpansionMode: 'auto',
            ragRerankMode: 'standard',
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'Claims Guide.md', score: 0.06, chunkText: 'Call the police and document the scene.' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      await service.retrieve('I was rear-ended by an uninsured driver. What should I do and what does my policy cover?');

      const trace = service.getLastTrace();
      expect(trace?.queryPlan?.candidateMultiplier).toBe(6);
      expect(trace?.queryPlan?.reasons).toContain('broad-candidate-breadth');
    });

    it('keeps hard queries on a single-query plan when decomposition mode is off', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragDecompositionMode: 'off',
            ragCandidateBreadth: 'balanced',
            ragDiversityStrength: 'balanced',
            ragStructureExpansionMode: 'auto',
            ragRerankMode: 'standard',
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'Claims Guide.md', score: 0.06, chunkText: 'Call the police and document the scene.' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      await service.retrieve('I was rear-ended by an uninsured driver. What should I do and what does my policy cover?');

      const trace = service.getLastTrace();
      expect(trace?.queryPlan?.strategy).toBe('single');
      expect(trace?.queryPlan?.variants).toHaveLength(1);
      expect(trace?.queryPlan?.reasons).toContain('decomposition-disabled');
    });

    it('captures developer-facing retrieval diagnostics for queries, candidates, rerank scores, dropped evidence, and final packed context', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'Claims Guide.md', score: 0.090, headingPath: 'At the Scene', contextPrefix: 'Claims Guide > At the Scene', chunkText: 'Call the police and take photos of the scene.', sourceType: 'file_chunk' }),
        makeResult({ rowid: 2, sourceId: 'Claims Guide.md', score: 0.089, headingPath: 'At the Scene', contextPrefix: 'Claims Guide > At the Scene', chunkText: 'Exchange information with the other driver and gather witnesses.', sourceType: 'file_chunk' }),
        makeResult({ rowid: 3, sourceId: 'Auto Insurance Policy.md', score: 0.088, headingPath: 'Uninsured / Underinsured Motorist (UM/UIM)', contextPrefix: 'Auto Insurance Policy > Uninsured / Underinsured Motorist (UM/UIM)', chunkText: 'UM coverage applies when the at-fault driver has no insurance.', sourceType: 'file_chunk' }),
        makeResult({ rowid: 4, sourceId: 'Concept Coverage', score: 0.005, contextPrefix: 'Coverage Concepts', chunkText: 'Coverage concepts overview.', sourceType: 'concept' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
        [4, new Array(768).fill(0)],
      ]));

      await service.retrieve(
        'I was rear-ended by an uninsured driver. What should I do and what does my policy cover?',
        { topK: 2, maxPerSource: 1, tokenBudget: 80 },
      );

      const trace = service.getLastTrace();
      expect(trace?.diagnostics?.generatedQueries.length).toBeGreaterThan(0);
      expect(trace?.diagnostics?.firstStageCandidates.length).toBeGreaterThan(0);
      expect(trace?.diagnostics?.rerankScores.length).toBeGreaterThan(0);
      expect(trace?.diagnostics?.droppedEvidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ droppedAt: 'score-threshold', sourceId: 'Concept Coverage' }),
        expect.objectContaining({ droppedAt: 'dedup', sourceId: 'Claims Guide.md' }),
      ]));
      expect(trace?.diagnostics?.finalPackedContext).toHaveLength(2);
      expect(trace?.diagnostics?.finalPackedContextText).toContain('[Retrieved Context]');
      expect(trace?.diagnostics?.finalPackedContextText).toContain('Claims Guide.md');
    });

    it('boosts direct contact queries toward Agent Contacts over generic accident references', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Guide.md',
          score: 0.050,
          contextPrefix: 'Claims Guide > Within 24 Hours',
          chunkText: 'Call your insurance agent and the claims hotline.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Agent Contacts.md',
          score: 0.044,
          contextPrefix: 'Agent Contacts > Your Agent',
          headingPath: 'Your Agent',
          chunkText: 'Sarah Chen — (555) 234-5678',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'concept:coverage details',
          score: 0.046,
          contextPrefix: 'Coverage Details',
          chunkText: 'The user reviewed policy coverage details.',
          sourceType: 'concept',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
      ]));

      const results = await service.retrieve("What is my insurance agent's phone number?");

      expect(results[0].sourceId).toBe('Agent Contacts.md');
      expect(results.at(-1)?.sourceType).toBe('concept');
    });

    it('prefers table-style agent contact fields over generic claim-contact reminders', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Guide.md',
          score: 0.052,
          contextPrefix: 'Claims Guide > Within 24 Hours',
          headingPath: 'Within 24 Hours',
          chunkText: 'Call your insurance agent and the 24/7 claims hotline within 24 hours.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Agent Contacts.md',
          score: 0.048,
          contextPrefix: 'Agent Contacts > Your Agent',
          headingPath: 'Your Agent',
          chunkText: '| Field | Details |\n| **Name** | Sarah Chen |\n| **Phone** | (555) 234-5678 |\n| **Email** | sarah.chen@greatlakesmutual.example.com |',
          sourceType: 'file_chunk',
          structuralRole: 'table',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve("What is my insurance agent's phone number?");

      expect(results[0].sourceId).toBe('Agent Contacts.md');
      expect(results[0].text).toContain('Sarah Chen');
      expect(results[0].text).toContain('(555) 234-5678');
    });

    it('second-stage reranking prefers candidates with stronger heading and body overlap', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Auto Insurance Policy.md',
          score: 0.061,
          contextPrefix: 'Auto Insurance Policy > Exclusions',
          headingPath: 'Exclusions',
          chunkText: 'This section lists exclusions and coverage limits.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Guide.md',
          score: 0.058,
          contextPrefix: 'Claims Guide > Uninsured Motorist Claim Procedure',
          headingPath: 'Uninsured Motorist Claim Procedure',
          chunkText: 'If the other driver has no insurance, file a police report within 24 hours and use uninsured motorist coverage.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('What coverage do I have if the other driver has no insurance?');

      expect(results[0].sourceId).toBe('Claims Guide.md');
      expect(service.getLastTrace()?.rankingTrace?.secondStageApplied).toBe(true);
      expect(service.getLastTrace()?.rankingTrace?.secondStageMode).toBe('standard');
    });

    it('uses experimental late-interaction reranking only when explicitly configured', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragRerankMode: 'late-interaction',
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Guide.md',
          score: 0.061,
          contextPrefix: 'Claims Guide > Filing Basics',
          headingPath: 'Filing Basics',
          chunkText: 'Claim filing requires prompt reporting after an accident.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Auto Insurance Policy.md',
          score: 0.059,
          contextPrefix: 'Auto Insurance Policy > Claim Duties',
          headingPath: 'Claim Duties',
          chunkText: '1. File the claim within 72 hours. 2. Call roadside assistance immediately after any accident. 3. Keep receipts and photos for reimbursement.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('After an accident, who do I call and how soon do I file the claim?');

      expect(results[0].sourceId).toBe('Auto Insurance Policy.md');
      expect(service.getLastTrace()?.rankingTrace?.secondStageMode).toBe('late-interaction');
    });

    it('late-interaction keeps downstream hard-query table terms and promotes the matching matrix row', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragDecompositionMode: 'auto',
            ragRerankMode: 'late-interaction',
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Workflow Architecture.md',
          score: 0.064,
          contextPrefix: 'Claims Workflow Architecture > Severity Routing Overview',
          headingPath: 'Severity Routing Overview',
          chunkText: 'The claims workflow architecture coordinates potential total loss escalation across several desks and checkpoints.',
          sourceType: 'file_chunk',
          structuralRole: 'section',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Workflow Architecture.md',
          score: 0.060,
          contextPrefix: 'Claims Workflow Architecture > Severity Routing Matrix',
          headingPath: 'Severity Routing Matrix',
          chunkText: '| Trigger | Coordinator | Review Start | Target |\n| Potential total loss | Severity Desk Coordinator | Start valuation review immediately | Within 1 business day |',
          sourceType: 'file_chunk',
          structuralRole: 'table',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve(
        'In the claims workflow architecture doc, when a potential total loss is identified, which coordinator starts review and what target does the matrix set?',
      );

      expect(results[0].text).toContain('Within 1 business day');
      expect(results[0].text).toContain('Start valuation review immediately');
      expect(service.getLastTrace()?.rankingTrace?.secondStageMode).toBe('late-interaction');
      expect(service.getLastTrace()?.rankingTrace?.focusTerms).toEqual(expect.arrayContaining([
        'review',
        'starts',
        'target',
      ]));
    });

    it('late-interaction promotes code snippets when helper and stage-name details appear late in the query', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragDecompositionMode: 'auto',
            ragRerankMode: 'late-interaction',
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Workflow Architecture.md',
          score: 0.064,
          contextPrefix: 'Claims Workflow Architecture > Escalation Packet Ownership',
          headingPath: 'Escalation Packet Ownership',
          chunkText: 'The Severity Desk Coordinator helper assembles the escalation packet before downstream review.',
          sourceType: 'file_chunk',
          structuralRole: 'section',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Workflow Architecture.md',
          score: 0.059,
          contextPrefix: 'Claims Workflow Architecture > buildEscalationPacket',
          headingPath: 'buildEscalationPacket',
          chunkText: 'const buildEscalationPacket = () => ({ stages: [\'policy-summary\', \'valuation\', \'police-report\'] });',
          sourceType: 'file_chunk',
          structuralRole: 'code',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve(
        'In the claims workflow architecture doc for the severity flow, which helper assembles the escalation packet and which stage names are included?',
      );

      expect(results[0].text).toContain('buildEscalationPacket');
      expect(results[0].text).toContain('policy-summary');
      expect(service.getLastTrace()?.rankingTrace?.focusTerms).toEqual(expect.arrayContaining([
        'helper',
        'stage',
      ]));
    });

    it('diversity-aware ordering surfaces complementary hard-query evidence earlier', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Guide.md',
          score: 0.090,
          contextPrefix: 'Claims Guide > At the Scene',
          headingPath: 'At the Scene',
          chunkText: 'Call the police and take photos of the scene.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Guide.md',
          score: 0.089,
          contextPrefix: 'Claims Guide > At the Scene',
          headingPath: 'At the Scene',
          chunkText: 'Exchange information with the other driver and gather witnesses.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'Auto Insurance Policy.md',
          score: 0.088,
          contextPrefix: 'Auto Insurance Policy > Uninsured / Underinsured Motorist (UM/UIM)',
          headingPath: 'Uninsured / Underinsured Motorist (UM/UIM)',
          chunkText: 'UM coverage applies when the at-fault driver has no insurance.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
      ]));

      const results = await service.retrieve(
        "I was rear-ended by an uninsured driver. What should I do and what does my policy cover?",
        { topK: 3, maxPerSource: 3 },
      );

      expect(results.slice(0, 2).map((result) => result.sourceId)).toEqual(
        expect.arrayContaining(['Claims Guide.md', 'Auto Insurance Policy.md']),
      );
      expect(results[2].sourceId).toBe('Claims Guide.md');
      expect(service.getLastTrace()?.rankingTrace?.diversityApplied).toBe(true);
    });

    it('demotes concept noise for hard coverage questions', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'concept:coverage types',
          score: 0.062,
          contextPrefix: 'Coverage Types',
          chunkText: 'Coverage Types: Includes Collision, Comprehensive, Liability, Uninsured/Underinsured Motorist.',
          sourceType: 'concept',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Auto Insurance Policy.md',
          score: 0.058,
          contextPrefix: 'Auto Insurance Policy > Uninsured / Underinsured Motorist (UM/UIM)',
          headingPath: 'Uninsured / Underinsured Motorist (UM/UIM)',
          chunkText: 'UM coverage applies when the other driver has no insurance and collision coverage has a $500 deductible.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'Claims Guide.md',
          score: 0.057,
          contextPrefix: 'Claims Guide > Uninsured Motorist (UM) Claim Procedure',
          headingPath: 'Uninsured Motorist (UM) Claim Procedure',
          chunkText: 'If the other driver is uninsured, file a police report within 24 hours and use UM coverage as a backup.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 4,
          sourceId: 'Auto Insurance Policy.md',
          score: 0.059,
          contextPrefix: 'Auto Insurance Policy > Exclusions',
          headingPath: 'Exclusions',
          chunkText: 'This policy does not cover wear and tear or racing.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
        [4, emb],
      ]));

      const results = await service.retrieve('They said they have insurance but I am not sure. What coverage do I have for this?');

      expect(results[0].sourceId).toBe('Auto Insurance Policy.md');
      expect(results[1].sourceId).toBe('Claims Guide.md');
      expect(results.findIndex((result) => result.sourceType === 'concept')).toBeGreaterThan(1);
    });

    it('strong diversity can promote a complementary source ahead of a slightly higher same-source result', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragDecompositionMode: 'auto',
            ragCandidateBreadth: 'balanced',
            ragDiversityStrength: 'strong',
            ragStructureExpansionMode: 'auto',
            ragRerankMode: 'standard',
            ragTopK: 3,
            ragMaxPerSource: 3,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
            ragCosineThreshold: 0.2,
            ragDropoffRatio: 0,
          },
          model: { contextWindow: 8192 },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'Guide A.md', score: 0.100, contextPrefix: 'Guide A > Overview', headingPath: 'Overview', chunkText: 'Alpha note.', sourceType: 'file_chunk' }),
        makeResult({ rowid: 2, sourceId: 'Guide A.md', score: 0.099, contextPrefix: 'Guide A > Overview', headingPath: 'Overview', chunkText: 'Beta note.', sourceType: 'file_chunk' }),
        makeResult({ rowid: 3, sourceId: 'Guide B.md', score: 0.091, contextPrefix: 'Guide B > Summary', headingPath: 'Summary', chunkText: 'Gamma note.', sourceType: 'file_chunk' }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
      ]));

      const results = await service.retrieve(
        'coverage',
        { topK: 3, maxPerSource: 3 },
      );

      expect(results[1].sourceId).toBe('Guide B.md');
      expect(service.getLastTrace()?.rankingTrace?.diversityStrength).toBe('strong');
    });

    it('boosts claim filing questions toward claims steps and agent contact evidence', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Auto Insurance Policy.md',
          score: 0.064,
          contextPrefix: 'Auto Insurance Policy > Collision Coverage',
          headingPath: 'Collision Coverage',
          chunkText: 'Collision coverage applies after the deductible is paid.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Guide.md',
          score: 0.058,
          contextPrefix: 'Claims Guide > Within 72 Hours',
          headingPath: 'Within 72 Hours',
          chunkText: 'Report the claim within 72 hours and call the claims line to start the process.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'Agent Contacts.md',
          score: 0.057,
          contextPrefix: 'Agent Contacts > Your Agent',
          headingPath: 'Your Agent',
          chunkText: 'Sarah Chen can help you file the claim at (555) 234-5678.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
      ]));

      const results = await service.retrieve('OK I want to file a claim. How do I do that and who do I call?');

      expect(results.slice(0, 2).map((result) => result.sourceId)).toEqual(
        expect.arrayContaining(['Claims Guide.md', 'Agent Contacts.md']),
      );
    });

    it('prefers tabular evidence for numeric comparison questions', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Auto Insurance Policy.md',
          sourceType: 'file_chunk',
          score: 0.061,
          contextPrefix: 'Auto Insurance Policy > Coverage Types',
          chunkText: 'Collision coverage is one part of the policy summary.',
          structuralRole: 'section',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Auto Insurance Policy.md',
          sourceType: 'file_chunk',
          score: 0.058,
          contextPrefix: 'Auto Insurance Policy > Premium Summary',
          chunkText: '| Coverage | Annual Premium |\n| Collision ($500 ded) | $620 |\n| Comprehensive ($250 ded) | $280 |',
          structuralRole: 'table',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('Compare the collision and comprehensive deductible table values.');

      expect(results[0].text).toContain('Annual Premium');
    });

    it('prefers threshold-specific vehicle evidence over generic total-loss workflow summaries', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Claims Workflow Architecture.md',
          sourceType: 'file_chunk',
          score: 0.063,
          contextPrefix: 'Claims Workflow Architecture > Severity Routing Overview',
          headingPath: 'Severity Routing Overview',
          chunkText: 'Potential total loss cases are routed to the severity desk for review and settlement handling.',
          structuralRole: 'section',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Vehicle Info.md',
          sourceType: 'file_chunk',
          score: 0.058,
          contextPrefix: 'Vehicle Info > Estimated Current Value',
          headingPath: 'Estimated Current Value',
          chunkText: '| Measure | Value |\n| Current value (KBB) | $28,500-$30,200 |\n| Total loss threshold | 75% of KBB value |',
          structuralRole: 'table',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('What is the total loss threshold for my car based on KBB value?');

      expect(results[0].sourceId).toBe('Vehicle Info.md');
      expect(results[0].text).toContain('75%');
      expect(results[0].text).toContain('KBB');
    });

    it('prefers code chunks for identifier-heavy implementation queries', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/RETRIEVAL_GUIDE.md',
          sourceType: 'file_chunk',
          score: 0.060,
          contextPrefix: 'Retrieval Guide > Ranking',
          chunkText: 'The guide mentions applySecondStageRerank conceptually.',
          structuralRole: 'section',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'src/services/retrievalService.ts',
          sourceType: 'file_chunk',
          score: 0.055,
          contextPrefix: 'RetrievalService > _applySecondStageRerank',
          headingPath: '_applySecondStageRerank',
          chunkText: 'private _applySecondStageRerank(results: SearchResult[], queryPlan: RetrievalQueryPlan) {',
          structuralRole: 'code',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('Where is _applySecondStageRerank implemented?');

      expect(results[0].sourceId).toBe('src/services/retrievalService.ts');
    });

    it('excludes .parallx internal artifacts from generic grounded retrieval by default', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: '.parallx/ai-config.json',
          sourceType: 'file_chunk',
          score: 0.070,
          contextPrefix: '.parallx/ai-config.json',
          chunkText: '{"models": ["gpt-oss:20b"]}',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Guide.md',
          sourceType: 'file_chunk',
          score: 0.061,
          contextPrefix: 'Claims Guide > Filing Basics',
          chunkText: 'File the claim within 72 hours and call the claims hotline.',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('How do I file a claim after an accident?');

      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('Claims Guide.md');
      expect(service.getLastTrace()?.corpusHygieneDrops).toBe(1);
    });

    it('can include .parallx artifacts when a caller explicitly opts in', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: '.parallx/memory/MEMORY.md',
          sourceType: 'file_chunk',
          score: 0.072,
          contextPrefix: 'Durable memory',
          chunkText: 'Preferred answer style: structured brevity.',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([[1, emb]]));

      const results = await service.retrieve('answer style memory', {
        sourceFilter: 'file_chunk',
        internalArtifactPolicy: 'include',
      });

      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('.parallx/memory/MEMORY.md');
      expect(service.getLastTrace()?.corpusHygieneDrops).toBe(0);
    });

    it('does not apply insurance-agent boosts to unrelated agent architecture queries', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'Agent Contacts.md',
          sourceType: 'file_chunk',
          score: 0.065,
          contextPrefix: 'Agent Contacts > Your Agent',
          chunkText: 'Sarah Chen — (555) 234-5678',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'src/services/agentExecutionService.ts',
          sourceType: 'file_chunk',
          score: 0.060,
          contextPrefix: 'AgentExecutionService > queueApprovalForTask',
          headingPath: 'queueApprovalForTask',
          chunkText: 'const queued = await this._sessionService.queueApprovalForTask(taskId, request);',
          structuralRole: 'code',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('Where is the agent approval flow implemented?');

      expect(results[0].sourceId).toBe('src/services/agentExecutionService.ts');
    });

    it('prefers figure or caption callouts when the query asks for them', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/Architecture.pdf',
          sourceType: 'file_chunk',
          score: 0.060,
          contextPrefix: 'Architecture.pdf > Retrieval Pipeline',
          chunkText: 'The retrieval pipeline uses staged ranking and packing.',
          structuralRole: 'section',
          documentKind: 'pdf',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'docs/Architecture.pdf',
          sourceType: 'file_chunk',
          score: 0.057,
          contextPrefix: 'Architecture.pdf > Figure 3',
          chunkText: 'Figure 3 caption: Retrieval pipeline with candidate generation, reranking, and packing.',
          structuralRole: 'section',
          documentKind: 'pdf',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
      ]));

      const results = await service.retrieve('What does the retrieval pipeline figure caption say?');

      expect(results[0].text).toContain('Figure 3 caption');
    });

    it('balances evidence roles for hard multi-part questions before packing', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/ARCHITECTURE.md',
          score: 0.090,
          contextPrefix: 'ARCHITECTURE > Retrieval Pipeline',
          headingPath: 'Retrieval Pipeline',
          chunkText: 'The architecture routes hybrid retrieval into ranking and context assembly.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'docs/RETRIEVAL_NOTES.md',
          score: 0.089,
          contextPrefix: 'Retrieval Notes > Ranking Pipeline',
          headingPath: 'Ranking Pipeline',
          chunkText: 'The retrieval pipeline overview explains where reranking happens.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'src/services/retrievalService.ts',
          score: 0.084,
          contextPrefix: 'RetrievalService > _applySecondStageRerank',
          headingPath: '_applySecondStageRerank',
          chunkText: 'Current runtime behavior reranks candidates after cosine filtering and before token-budget packing.',
          sourceType: 'file_chunk',
          structuralRole: 'code',
        }),
        makeResult({
          rowid: 4,
          sourceId: 'docs/RISK_REGISTER.md',
          score: 0.082,
          contextPrefix: 'Risk Register > Failure Modes',
          headingPath: 'Failure Modes',
          chunkText: 'Worker teardown races and empty-response bugs can still cause flaky evaluation failures.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
        [4, emb],
      ]));

      const results = await service.retrieve(
        'Where is retrieval reranking implemented, what does it currently do, and what failures should I watch for?',
        { topK: 3, maxPerSource: 3 },
      );

      expect(results).toHaveLength(3);
      expect(results.map((result) => result.sourceId)).toEqual(expect.arrayContaining([
        'src/services/retrievalService.ts',
        'docs/RISK_REGISTER.md',
      ]));
      expect(results.at(-1)?.sourceId).toBe('docs/RISK_REGISTER.md');
      expect(results.some((result) => result.sourceId === 'docs/ARCHITECTURE.md' || result.sourceId === 'docs/RETRIEVAL_NOTES.md')).toBe(true);

      const trace = service.getLastTrace();
      expect(trace?.rankingTrace?.roleBalanceApplied).toBe(true);
      expect(trace?.rankingTrace?.targetRoles).toEqual(expect.arrayContaining([
        'architecture-location',
        'current-behavior',
        'failure-mode',
      ]));
      expect(trace?.rankingTrace?.coveredRoles).toEqual(expect.arrayContaining([
        'architecture-location',
        'implementation-detail',
        'failure-mode',
      ]));
    });

    it('packs smaller complementary chunks ahead of one oversized early chunk', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/ARCHITECTURE.md',
          score: 0.090,
          contextPrefix: 'ARCHITECTURE > Retrieval Pipeline',
          headingPath: 'Retrieval Pipeline',
          chunkText: 'A'.repeat(640),
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'src/services/retrievalService.ts',
          score: 0.084,
          contextPrefix: 'RetrievalService > _applySecondStageRerank',
          headingPath: '_applySecondStageRerank',
          chunkText: 'Current runtime behavior reranks candidates after cosine filtering and before token-budget packing.',
          sourceType: 'file_chunk',
          structuralRole: 'code',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'docs/RISK_REGISTER.md',
          score: 0.082,
          contextPrefix: 'Risk Register > Failure Modes',
          headingPath: 'Failure Modes',
          chunkText: 'Worker teardown races and empty-response bugs can still cause flaky evaluation failures.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 4,
          sourceId: 'docs/CURRENT_BEHAVIOR.md',
          score: 0.081,
          contextPrefix: 'Current Behavior > Retrieval Runtime',
          headingPath: 'Retrieval Runtime',
          chunkText: 'The current runtime behavior blends cosine reranking with evidence-role-aware packing.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
        [4, emb],
      ]));

      const results = await service.retrieve(
        'Where is retrieval reranking implemented, what does it currently do, and what failures should I watch for?',
        { topK: 4, maxPerSource: 4, tokenBudget: 80 },
      );

      expect(results.map((result) => result.sourceId)).toEqual([
        'src/services/retrievalService.ts',
        'docs/RISK_REGISTER.md',
        'docs/CURRENT_BEHAVIOR.md',
      ]);
      expect(results.some((result) => result.sourceId === 'docs/ARCHITECTURE.md')).toBe(false);
    });

    it('reduces redundant same-heading evidence when a hard query needs complementary sources', async () => {
      const emb = new Array(768).fill(0.1);
      embeddingService.embedQuery.mockResolvedValue(emb);
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: 'docs/ARCHITECTURE.md',
          score: 0.092,
          contextPrefix: 'ARCHITECTURE > Retrieval Pipeline',
          headingPath: 'Retrieval Pipeline',
          chunkText: 'The architecture routes hybrid retrieval into ranking and context assembly.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'docs/ARCHITECTURE.md',
          score: 0.091,
          contextPrefix: 'ARCHITECTURE > Retrieval Pipeline',
          headingPath: 'Retrieval Pipeline',
          chunkText: 'The retrieval pipeline also controls packing order and section-level evidence assembly.',
          sourceType: 'file_chunk',
        }),
        makeResult({
          rowid: 3,
          sourceId: 'src/services/retrievalService.ts',
          score: 0.084,
          contextPrefix: 'RetrievalService > _applySecondStageRerank',
          headingPath: '_applySecondStageRerank',
          chunkText: 'Current runtime behavior reranks candidates after cosine filtering and before token-budget packing.',
          sourceType: 'file_chunk',
          structuralRole: 'code',
        }),
        makeResult({
          rowid: 4,
          sourceId: 'docs/RISK_REGISTER.md',
          score: 0.083,
          contextPrefix: 'Risk Register > Failure Modes',
          headingPath: 'Failure Modes',
          chunkText: 'Worker teardown races and empty-response bugs can still cause flaky evaluation failures.',
          sourceType: 'file_chunk',
        }),
      ]);
      vectorStore.getEmbeddings.mockResolvedValue(new Map([
        [1, emb],
        [2, emb],
        [3, emb],
        [4, emb],
      ]));

      const results = await service.retrieve(
        'Where is retrieval reranking implemented, what does it currently do, and what failures should I watch for?',
        { topK: 3, maxPerSource: 3 },
      );

      expect(results).toHaveLength(3);
      const architectureEntries = results.filter((result) => result.sourceId === 'docs/ARCHITECTURE.md');
      expect(architectureEntries).toHaveLength(1);
      expect(results.map((result) => result.sourceId)).toEqual(expect.arrayContaining([
        'src/services/retrievalService.ts',
        'docs/RISK_REGISTER.md',
      ]));
    });
  });
});
