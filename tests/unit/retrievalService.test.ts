// Unit tests for RetrievalService

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetrievalService } from '../../src/services/retrievalService';
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

    it('a chunk\'s score is its similarity to the query, in the store\'s order', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.032, similarity: 0.71 }),
        makeResult({ rowid: 2, score: 0.016, similarity: 0.78, chunkText: 'ranked lower by fusion' }),
      ]);

      const results = await service.retrieve('query');
      expect(results.map((r) => r.score)).toEqual([0.71, 0.78]);
    });

    it('passes a custom relevance floor to the store', async () => {
      await service.retrieve('query', { minRelevance: 0.6 });
      expect(vectorStore.search).toHaveBeenCalledWith(expect.any(Array), 'query', expect.objectContaining({ minRelevance: 0.6 }));
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

    it('returns single result without dropping it', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'p1', score: 0.03 }),
      ]);

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1);
    });

    it('reads topK and the relevance floor from config, and gives the floor to the store for every search', async () => {
      let floor = 0.55;
      const setMinRelevance = vi.fn();
      (vectorStore as unknown as { setMinRelevance: typeof setMinRelevance }).setMinRelevance = setMinRelevance;
      service.setConfigProvider({
        getEffectiveConfig: () => ({ retrieval: { ragTopK: 5, ragMinRelevance: floor } }),
      });

      await service.retrieve('query');
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'query',
        expect.objectContaining({ topK: 5, minRelevance: 0.55 }),
      );
      // Memory recall searches the store directly; it reads the same setting, live.
      const get = setMinRelevance.mock.calls[0][0] as () => number;
      floor = 0.7;
      expect(get()).toBe(0.7);
    });

    it('excludes .parallx internal artifacts from generic retrieval by default', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: '.parallx/ai-config.json',
          sourceType: 'file_chunk',
          score: 0.070,
          chunkText: '{"models": ["gpt-oss:20b"]}',
        }),
        makeResult({
          rowid: 2,
          sourceId: 'Claims Guide.md',
          sourceType: 'file_chunk',
          score: 0.061,
          chunkText: 'File the claim within 72 hours.',
        }),
      ]);

      const results = await service.retrieve('How do I file a claim after an accident?');

      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('Claims Guide.md');
    });

    it('includes .parallx artifacts when query explicitly targets them', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({
          rowid: 1,
          sourceId: '.parallx/memory/MEMORY.md',
          sourceType: 'file_chunk',
          score: 0.072,
          chunkText: 'Preferred answer style: structured brevity.',
        }),
      ]);

      const results = await service.retrieve('show me my parallx memory file');

      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('.parallx/memory/MEMORY.md');
    });

    it('builds a trace with simplified fields', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, sourceId: 'policy', score: 0.12, chunkText: 'Collision deductible is $500.' }),
        makeResult({ rowid: 2, sourceId: 'contacts', score: 0.05, chunkText: 'Agent contact details.' }),
      ]);
      (vectorStore as unknown as { getLastSearchTrace(): unknown }).getLastSearchTrace = () => ({ minRelevance: 0.5, bestSimilarity: 0.82 });

      await service.retrieve('collision deductible', { topK: 5 });
      const trace = service.getLastTrace();

      expect(trace).toBeDefined();
      expect(trace?.query).toBe('collision deductible');
      expect(trace?.topK).toBe(5);
      expect(trace?.minRelevance).toBe(0.5);
      expect(trace?.bestSimilarity).toBe(0.82);
      expect(trace?.rawCandidateCount).toBe(2);
      expect(trace?.finalCount).toBe(2);
      expect(trace?.finalChunks).toHaveLength(2);
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

    it('labels a PDF chunk with the page its text is on', () => {
      const formatted = service.formatContext([
        {
          sourceType: 'file_chunk',
          sourceId: 'Rising Fellow Guides/Clark.pdf',
          contextPrefix: 'Rising Fellow Guides/Clark.pdf',
          text: 'The ultimate loss is NOT the same as the expected loss!',
          score: 0.9,
          sources: ['vector'],
          tokenCount: 12,
          page: 'page 13 of 30',
        },
      ]);
      expect(formatted).toContain('Path: Rising Fellow Guides/Clark.pdf\nPDF page: page 13 of 30\nThe ultimate loss');
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
      const lines = formatted.split('\n');
      const sourceLines = lines.filter(l => l.includes('Source:'));
      expect(sourceLines[0]).toBe('[1] Source: src/auth.ts (relevance 0.90)');
      expect(sourceLines[1]).toBe('[1] Source: src/auth.ts (relevance 0.80)');
      expect(sourceLines[2]).toMatch(/^\[2\] Source: Notes \(relevance /);
    });
  });
});