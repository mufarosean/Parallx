// Unit tests for RetrievalService

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
      expect(results[0].score).toBeGreaterThanOrEqual(0.01);
    });

    it('respects custom minScore option', async () => {
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.05 }),
        makeResult({ rowid: 2, score: 0.02 }),
      ]);

      const results = await service.retrieve('query', { minScore: 0.04 });
      expect(results).toHaveLength(1);
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

    it('reads topK and minScore from config provider', async () => {
      service.setConfigProvider({
        getEffectiveConfig: () => ({
          retrieval: {
            ragTopK: 5,
            ragScoreThreshold: 0.05,
          },
        }),
      });
      vectorStore.search.mockResolvedValue([
        makeResult({ rowid: 1, score: 0.06 }),
        makeResult({ rowid: 2, score: 0.03 }),
      ]);

      const results = await service.retrieve('query');
      expect(results).toHaveLength(1); // 0.03 < minScore 0.05
      expect(vectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        'query',
        expect.objectContaining({ topK: 5 }),
      );
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
        makeResult({ rowid: 3, sourceId: 'noise', score: 0.005, chunkText: 'Irrelevant noise.' }),
      ]);

      await service.retrieve('collision deductible', { topK: 5 });
      const trace = service.getLastTrace();

      expect(trace).toBeDefined();
      expect(trace?.query).toBe('collision deductible');
      expect(trace?.topK).toBe(5);
      expect(trace?.minScore).toBe(0.01);
      expect(trace?.rawCandidateCount).toBe(3);
      expect(trace?.afterScoreFilterCount).toBe(2); // 0.005 filtered
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
      expect(sourceLines[0]).toBe('[1] Source: src/auth.ts');
      expect(sourceLines[1]).toBe('[1] Source: src/auth.ts');
      expect(sourceLines[2]).toBe('[2] Source: Notes');
    });
  });
});