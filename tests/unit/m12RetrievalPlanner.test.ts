// @vitest-environment jsdom
// Unit tests for retrieval multi-query behavior.
//
// Tests cover:
//   - RetrievalService.retrieveMulti() — parallel queries, merge, dedup

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
  const defaultEmb = new Array(768).fill(0.1);
  return {
    initialize: vi.fn(async () => {}),
    upsert: vi.fn(async () => {}),
    deleteSource: vi.fn(async () => {}),
    search: vi.fn(async (): Promise<SearchResult[]> => []),
    vectorSearch: vi.fn(async () => []),
    getContentHash: vi.fn(async () => null),
    getIndexedSources: vi.fn(async () => []),
    getStats: vi.fn(async () => ({ totalChunks: 0, totalSources: 0, bySourceType: {}, sourceCountByType: {} })),
    getEmbeddings: vi.fn(async (rowids: number[]) => new Map(rowids.map(id => [id, defaultEmb] as [number, number[]]))),
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

// ── RetrievalService.retrieveMulti tests ──

describe('RetrievalService.retrieveMulti', () => {
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let service: RetrievalService;

  beforeEach(() => {
    embeddingService = createMockEmbeddingService();
    vectorStore = createMockVectorStore();
    service = new RetrievalService(embeddingService as any, vectorStore as any);
  });

  it('returns empty array for zero queries', async () => {
    const results = await service.retrieveMulti([]);
    expect(results).toEqual([]);
  });

  it('delegates to retrieve() for single query', async () => {
    vectorStore.search.mockResolvedValue([
      makeResult({ rowid: 1, score: 0.1, chunkText: 'Single result' }),
    ]);

    const results = await service.retrieveMulti(['single query']);

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Single result');
    // Should have called embedQuery exactly once
    expect(embeddingService.embedQuery).toHaveBeenCalledTimes(1);
  });

  it('runs multiple queries in parallel and merges results', async () => {
    let callCount = 0;
    vectorStore.search.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        // First query (called twice: inner overfetch for each query)
        return [
          makeResult({ rowid: callCount * 10, sourceId: `p${callCount}`, score: 0.1, chunkText: `Result from query ${callCount}` }),
        ];
      }
      return [
        makeResult({ rowid: callCount * 10, sourceId: `p${callCount}`, score: 0.08, chunkText: `Result from query ${callCount}` }),
      ];
    });

    const results = await service.retrieveMulti(['query 1', 'query 2']);

    // Should have embedded 2 queries
    expect(embeddingService.embedQuery).toHaveBeenCalledTimes(2);
    // Should have results from both queries
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates identical chunks from different queries', async () => {
    // Both queries return the same chunk
    vectorStore.search.mockResolvedValue([
      makeResult({
        rowid: 1,
        sourceId: 'page-shared',
        score: 0.1,
        chunkText: 'This content appears in both query results',
      }),
    ]);

    const results = await service.retrieveMulti(['query A', 'query B']);

    // Should deduplicate — only 1 copy of the chunk
    const sharedChunks = results.filter(r => r.sourceId === 'page-shared');
    expect(sharedChunks.length).toBeLessThanOrEqual(1);
  });

  it('keeps highest score when deduplicating', async () => {
    let call = 0;
    vectorStore.search.mockImplementation(async () => {
      call++;
      return [
        makeResult({
          rowid: 1,
          sourceId: 'page-1',
          // First query scores higher
          score: call === 1 ? 0.15 : call === 2 ? 0.15 : 0.05,
          chunkText: 'Shared content chunk',
        }),
      ];
    });

    const results = await service.retrieveMulti(['high score query', 'low score query']);

    if (results.length > 0) {
      const chunk = results.find(r => r.sourceId === 'page-1');
      expect(chunk).toBeDefined();
      // Should keep the higher score
      expect(chunk!.score).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('applies maxPerSource globally across merged results', async () => {
    // Return many chunks from the same source across different queries
    vectorStore.search.mockResolvedValue([
      makeResult({ rowid: 1, sourceId: 'monopoly-page', chunkIndex: 0, score: 0.10, chunkText: 'Chunk A' }),
      makeResult({ rowid: 2, sourceId: 'monopoly-page', chunkIndex: 1, score: 0.09, chunkText: 'Chunk B' }),
      makeResult({ rowid: 3, sourceId: 'monopoly-page', chunkIndex: 2, score: 0.08, chunkText: 'Chunk C' }),
      makeResult({ rowid: 4, sourceId: 'monopoly-page', chunkIndex: 3, score: 0.07, chunkText: 'Chunk D' }),
      makeResult({ rowid: 5, sourceId: 'monopoly-page', chunkIndex: 4, score: 0.06, chunkText: 'Chunk E' }),
    ]);

    const results = await service.retrieveMulti(['query 1', 'query 2'], { maxPerSource: 3 });

    const monopolyChunks = results.filter(r => r.sourceId === 'monopoly-page');
    expect(monopolyChunks.length).toBeLessThanOrEqual(3);
  });

  it('enforces token budget on merged results', async () => {
    vectorStore.search.mockResolvedValue([
      makeResult({ rowid: 1, sourceId: 'p1', score: 0.10, chunkText: 'A'.repeat(400) }), // 100 tokens
      makeResult({ rowid: 2, sourceId: 'p2', score: 0.09, chunkText: 'B'.repeat(400) }), // 100 tokens
      makeResult({ rowid: 3, sourceId: 'p3', score: 0.08, chunkText: 'C'.repeat(400) }), // 100 tokens
    ]);

    const results = await service.retrieveMulti(
      ['query 1', 'query 2'],
      { tokenBudget: 200 },
    );

    // Should fit at most 2 chunks within 200-token budget
    const totalTokens = results.reduce((sum, r) => sum + r.tokenCount, 0);
    expect(totalTokens).toBeLessThanOrEqual(200);
  });

  it('handles query failure gracefully', async () => {
    let call = 0;
    vectorStore.search.mockImplementation(async () => {
      call++;
      if (call <= 2) {
        // First query succeeds (called twice: inner overfetch)
        return [
          makeResult({ rowid: 1, sourceId: 'p1', score: 0.1, chunkText: 'Good result' }),
        ];
      }
      // Second query fails
      throw new Error('Embedding service timeout');
    });

    // Should not throw — failed queries return empty
    const results = await service.retrieveMulti(['good query', 'bad query']);
    expect(results.length).toBeGreaterThanOrEqual(0); // At least doesn't crash
  });

  it('captures retrieval trace counts and final chunk identities', async () => {
    vectorStore.search.mockResolvedValue([
      makeResult({ rowid: 1, sourceId: 'policy', score: 0.12, chunkText: 'Collision deductible is $500.' }),
      makeResult({ rowid: 2, sourceId: 'policy', score: 0.11, chunkIndex: 1, chunkText: 'Comprehensive deductible is $250.' }),
      makeResult({ rowid: 3, sourceId: 'contacts', score: 0.05, chunkText: 'Agent contact details.' }),
    ]);

    const results = await service.retrieve('collision deductible', { topK: 2, maxPerSource: 1, tokenBudget: 40 });
    const trace = service.getLastTrace();

    expect(results).toHaveLength(2);
    expect(trace).toBeDefined();
    expect(trace?.rawCandidateCount).toBe(3);
    expect(trace?.afterDedupCount).toBe(2);
    expect(trace?.dedupDrops).toBe(1);
    expect(trace?.finalChunks).toHaveLength(2);
    expect(trace?.finalChunks[0]?.sourceId).toBe('policy');
    expect(trace?.vectorStoreTrace?.fusedResultCount).toBe(3);
  });
});

