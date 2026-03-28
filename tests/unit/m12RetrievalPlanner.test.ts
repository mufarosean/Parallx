// @vitest-environment jsdom
// Unit tests for retrieval trace and pipeline behavior.
//
// Tests cover:
//   - RetrievalService trace capture
//   - Config provider integration

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetrievalService } from '../../src/services/retrievalService';
import type { SearchResult } from '../../src/services/vectorStoreService';

// ── Helpers ──

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
    getLastSearchTrace: vi.fn(() => ({
      queryText: 'test query',
      topK: 6,
      candidateK: 40,
      includeKeyword: true,
      vectorResultCount: 3,
      keywordResultCount: 2,
      fusedResultCount: 3,
      finalResultCount: 3,
    })),
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

describe('RetrievalService trace and pipeline', () => {
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let service: RetrievalService;

  beforeEach(() => {
    embeddingService = createMockEmbeddingService();
    vectorStore = createMockVectorStore();
    service = new RetrievalService(embeddingService as any, vectorStore as any);
  });

  it('captures retrieval trace counts and final chunk identities', async () => {
    vectorStore.search.mockResolvedValue([
      makeResult({ rowid: 1, sourceId: 'policy', score: 0.12, chunkText: 'Collision deductible is $500.' }),
      makeResult({ rowid: 2, sourceId: 'policy', score: 0.11, chunkIndex: 1, chunkText: 'Comprehensive deductible is $250.' }),
      makeResult({ rowid: 3, sourceId: 'contacts', score: 0.05, chunkText: 'Agent contact details.' }),
    ]);

    const results = await service.retrieve('collision deductible', { topK: 2 });
    const trace = service.getLastTrace();

    expect(results).toHaveLength(2);
    expect(trace).toBeDefined();
    expect(trace?.rawCandidateCount).toBe(3);
    expect(trace?.afterScoreFilterCount).toBe(3);
    expect(trace?.finalCount).toBe(2);
    expect(trace?.finalChunks).toHaveLength(2);
    expect(trace?.finalChunks[0]?.sourceId).toBe('policy');
    expect(trace?.vectorStoreTrace?.fusedResultCount).toBe(3);
  });

  it('makes exactly one search call per retrieve', async () => {
    vectorStore.search.mockResolvedValue([
      makeResult({ rowid: 1, score: 0.08, chunkText: 'Result' }),
    ]);

    await service.retrieve('What should I do after an accident and who do I call?');
    expect(vectorStore.search).toHaveBeenCalledTimes(1);
  });

  it('passes query directly to vectorStore search without rewriting', async () => {
    vectorStore.search.mockResolvedValue([]);
    const query = 'Which repair shops are recommended under my policy? Please cite your sources.';

    await service.retrieve(query);

    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.any(Array),
      query,
      expect.any(Object),
    );
  });
});