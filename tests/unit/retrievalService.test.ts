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
      expect(results[0].score).toBeGreaterThanOrEqual(0.05);
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

  describe('query planning & retrieval pipeline', () => {
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
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
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
            ragTopK: 20,
            ragMaxPerSource: 5,
            ragTokenBudget: 0,
            ragScoreThreshold: 0.01,
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
      expect(trace?.diagnostics?.droppedEvidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ droppedAt: 'score-threshold', sourceId: 'Concept Coverage' }),
        expect.objectContaining({ droppedAt: 'dedup', sourceId: 'Claims Guide.md' }),
      ]));
      expect(trace?.diagnostics?.finalPackedContext).toHaveLength(2);
      expect(trace?.diagnostics?.finalPackedContextText).toContain('[Retrieved Context]');
      expect(trace?.diagnostics?.finalPackedContextText).toContain('Claims Guide.md');
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
  });
});
