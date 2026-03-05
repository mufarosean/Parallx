// Unit tests for RetrievalService — M10 Phase 3 Task 3.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetrievalService } from '../../src/services/retrievalService';
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
    getStats: vi.fn(async () => ({ totalChunks: 0, totalSources: 0, bySourceType: {} })),
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

// ── Mock LLM service for re-ranking tests ──

function createMockLanguageModelsService(scoreMap: Record<string, number> = {}) {
  const defaultScore = 7;
  return {
    getActiveModel: vi.fn(() => 'qwen2.5:32b'),
    getModels: vi.fn(async () => []),
    getProviders: vi.fn(() => []),
    setActiveModel: vi.fn(),
    registerProvider: vi.fn(() => ({ dispose: vi.fn() })),
    checkStatus: vi.fn(async () => ({ available: true })),
    onDidChangeProviders: vi.fn(() => ({ dispose: vi.fn() })) as any,
    onDidChangeModels: vi.fn(() => ({ dispose: vi.fn() })) as any,
    sendChatRequest: vi.fn(function (messages: any[]) {
      // Extract query and passage from the user message to look up score
      const userContent = messages[1]?.content ?? '';
      const passageMatch = userContent.match(/Passage: (.{0,30})/);
      const key = passageMatch?.[1]?.trim() ?? '';
      const score = scoreMap[key] ?? defaultScore;
      // Return an async iterable
      return {
        [Symbol.asyncIterator]: async function* () {
          yield { content: JSON.stringify({ score }), done: true };
        },
      };
    }),
    dispose: vi.fn(),
  };
}

// ── Tests ──

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
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05, chunkText: 'JWT tokens' }),
      ]);

      const results = await service.retrieve('authentication approach');

      expect(embeddingService.embedQuery).toHaveBeenCalledWith('authentication approach');
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'authentication approach',
        expect.objectContaining({ topK: 20, includeKeyword: true }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('JWT tokens');
      expect(results[0].sourceType).toBe('page_block');
    });

    it('filters out results below minScore', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05 }),
        makeResult({ rowid: 2, score: 0.001, chunkText: 'low score' }),
      ]);

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.05);
    });

    it('respects custom minScore option', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05 }),
        makeResult({ rowid: 2, score: 0.02 }),
      ]);

      const results = await service.retrieve('query', { minScore: 0.04 });
      expect(results).toHaveLength(1);
    });

    it('deduplicates sources — max 3 chunks per source by default', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', chunkIndex: 0, score: 0.10 }),
        makeResult({ rowid: 2, sourceId: 'p1', chunkIndex: 1, score: 0.09 }),
        makeResult({ rowid: 3, sourceId: 'p1', chunkIndex: 2, score: 0.08 }),
        makeResult({ rowid: 4, sourceId: 'p1', chunkIndex: 3, score: 0.07 }), // should be dropped
        makeResult({ rowid: 5, sourceId: 'p2', chunkIndex: 0, score: 0.06 }),
      ]);

      const results = await service.retrieve('query');
      const p1Chunks = results.filter((r) => r.sourceId === 'p1');
      expect(p1Chunks).toHaveLength(3);
      expect(results).toHaveLength(4); // 3 from p1 + 1 from p2
    });

    it('respects custom maxPerSource option', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', chunkIndex: 0, score: 0.10 }),
        makeResult({ rowid: 2, sourceId: 'p1', chunkIndex: 1, score: 0.09 }),
        makeResult({ rowid: 3, sourceId: 'p2', chunkIndex: 0, score: 0.08 }),
      ]);

      const results = await service.retrieve('query', { maxPerSource: 1 });
      expect(results).toHaveLength(2); // 1 from each source
    });

    it('enforces token budget', async () => {
      // Each chunk ~5 tokens (20 chars / 4)
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.10, chunkText: 'A'.repeat(400) }), // 100 tokens
        makeResult({ rowid: 2, sourceId: 'p2', score: 0.09, chunkText: 'B'.repeat(400) }), // 100 tokens
        makeResult({ rowid: 3, sourceId: 'p3', score: 0.08, chunkText: 'C'.repeat(400) }), // 100 tokens
      ]);

      const results = await service.retrieve('query', { tokenBudget: 200 });
      expect(results).toHaveLength(2); // 100 + 100 = 200, third would exceed
    });

    it('always includes at least one chunk even if it exceeds budget', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.10, chunkText: 'A'.repeat(2000) }), // 500 tokens
      ]);

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
      const results = Array.from({ length: 15 }, (_, i) =>
        makeResult({ rowid: i + 1, sourceId: `p${i}`, score: 0.10 - i * 0.001 }),
      );
      vectorStore.search.mockResolvedValue(results);

      const retrieved = await service.retrieve('query', { topK: 5 });
      expect(retrieved.length).toBeLessThanOrEqual(5);
    });

    it('includes tokenCount in results', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.10, chunkText: 'Hello world' }),
      ]);

      const results = await service.retrieve('query');
      expect(results[0].tokenCount).toBe(Math.ceil('Hello world'.length / 4));
    });
  });

  describe('formatContext()', () => {
    it('returns empty string for no chunks', () => {
      expect(service.formatContext([])).toBe('');
    });

    it('formats chunks with source attribution', () => {
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
      expect(formatted).toContain('Source: Backend Architecture > Auth');
      expect(formatted).toContain('We chose JWT with refresh tokens.');
      expect(formatted).toContain('Source: src/auth/middleware.ts');
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
      expect(formatted).toContain('Source: page-uuid-123');
    });
  });

  describe('LLM re-ranking', () => {
    it('filters out low-relevance chunks when LM service is available', async () => {
      const lmService = createMockLanguageModelsService({
        'Auth JWT tokens refresh': 8,  // high relevance → keep
        'Insurance premium calc': 1,    // low relevance → drop
      });
      const rerankService = new RetrievalService(
        embeddingService as any,
        vectorStore as any,
        lmService as any,
      );

      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05, chunkText: 'Auth JWT tokens refresh' }),
        makeResult({ rowid: 2, score: 0.04, chunkText: 'Insurance premium calc' }),
      ]);

      const results = await rerankService.retrieve('authentication approach');
      // Only the relevant chunk should survive (score 8 ≥ 4 threshold)
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('Auth JWT tokens refresh');
    });

    it('skips re-ranking when rerank=false is explicitly set', async () => {
      const lmService = createMockLanguageModelsService({});
      const rerankService = new RetrievalService(
        embeddingService as any,
        vectorStore as any,
        lmService as any,
      );

      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05, chunkText: 'Chunk A' }),
        makeResult({ rowid: 2, score: 0.04, chunkText: 'Chunk B' }),
      ]);

      const results = await rerankService.retrieve('query', { rerank: false });
      // Both chunks should survive (no re-ranking applied)
      expect(results).toHaveLength(2);
      expect(lmService.sendChatRequest).not.toHaveBeenCalled();
    });

    it('falls back gracefully when no LM model is active', async () => {
      const lmService = createMockLanguageModelsService({});
      lmService.getActiveModel.mockReturnValue(undefined);
      const rerankService = new RetrievalService(
        embeddingService as any,
        vectorStore as any,
        lmService as any,
      );

      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05, chunkText: 'Chunk A' }),
      ]);

      const results = await rerankService.retrieve('query');
      expect(results).toHaveLength(1);
      expect(lmService.sendChatRequest).not.toHaveBeenCalled();
    });

    it('over-fetches 3× when re-ranking is active', async () => {
      const lmService = createMockLanguageModelsService({});
      const rerankService = new RetrievalService(
        embeddingService as any,
        vectorStore as any,
        lmService as any,
      );

      vectorStore.search.mockResolvedValue([]);

      await rerankService.retrieve('query', { topK: 10 });

      // topK=10, overfetchFactor=3 → searchOptions.topK = 30
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'query',
        expect.objectContaining({ topK: 30 }),
      );
    });
  });
});
