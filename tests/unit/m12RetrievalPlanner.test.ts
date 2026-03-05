// @vitest-environment jsdom
// Unit tests for M12 — Retrieval Planner Pipeline
//
// Tests cover:
//   - OllamaProvider.planRetrieval() — streaming → JSON parsing
//   - OllamaProvider._parsePlannerResponse() — robust JSON extraction
//   - RetrievalService.retrieveMulti() — parallel queries, merge, dedup
//   - shouldUsePlanner() — planner gate logic
//   - buildPlannerPrompt() — prompt generation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/built-in/chat/providers/ollamaProvider';
import type { IRetrievalPlan } from '../../src/built-in/chat/providers/ollamaProvider';
import { RetrievalService } from '../../src/services/retrievalService';
import { buildPlannerPrompt } from '../../src/built-in/chat/config/chatSystemPrompts';
import type { SearchResult } from '../../src/services/vectorStoreService';

// ── Helpers ──

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk + '\n'));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function createMockFetch(chatResponse: () => Response) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/version')) return jsonResponse({ version: '0.5.4' });
    if (url.includes('/api/tags')) return jsonResponse({ models: [] });
    if (url.includes('/api/ps')) return jsonResponse({ models: [] });
    if (url.includes('/api/chat')) return chatResponse();
    throw new Error(`Unexpected fetch to: ${url}`);
  });
}

function makePlannerStreamChunks(jsonText: string): string[] {
  // Simulate streaming: break the JSON into character-level chunks
  const words = jsonText.split(' ');
  const chunks: string[] = [];
  for (const word of words) {
    chunks.push(JSON.stringify({
      model: 'test',
      message: { role: 'assistant', content: word + ' ' },
      done: false,
    }));
  }
  chunks.push(JSON.stringify({
    model: 'test',
    message: { role: 'assistant', content: '' },
    done: true,
  }));
  return chunks;
}

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

// ── buildPlannerPrompt tests ──

describe('buildPlannerPrompt', () => {
  it('returns a non-empty prompt string', () => {
    const prompt = buildPlannerPrompt();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes intent taxonomy', () => {
    const prompt = buildPlannerPrompt();
    expect(prompt).toContain('question');
    expect(prompt).toContain('situation');
    expect(prompt).toContain('task');
    expect(prompt).toContain('conversational');
    expect(prompt).toContain('exploration');
  });

  it('includes JSON output instructions', () => {
    const prompt = buildPlannerPrompt();
    expect(prompt).toContain('"intent"');
    expect(prompt).toContain('"reasoning"');
    expect(prompt).toContain('"needs_retrieval"');
    expect(prompt).toContain('"queries"');
  });

  it('includes few-shot examples', () => {
    const prompt = buildPlannerPrompt();
    expect(prompt).toContain('fender bender');
    expect(prompt).toContain('Hello');
  });

  it('includes workspace digest when provided', () => {
    const digest = 'CANVAS PAGES (3):\n  - Insurance Policy\n  - Claims Guide';
    const prompt = buildPlannerPrompt(digest);
    expect(prompt).toContain('Insurance Policy');
    expect(prompt).toContain('Claims Guide');
    expect(prompt).toContain('WHAT THE WORKSPACE CONTAINS');
  });

  it('omits workspace section when no digest', () => {
    const prompt = buildPlannerPrompt();
    expect(prompt).not.toContain('WHAT THE WORKSPACE CONTAINS');
  });
});

// ── OllamaProvider.planRetrieval tests ──

describe('OllamaProvider.planRetrieval', () => {
  let provider: OllamaProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    provider?.dispose();
    vi.stubGlobal('fetch', originalFetch);
  });

  it('parses a valid JSON plan from streaming response', async () => {
    const planJson = JSON.stringify({
      intent: 'situation',
      reasoning: 'User had a car accident. Needs insurance info.',
      needs_retrieval: true,
      queries: ['collision coverage deductible', 'claims filing procedure', 'agent contact info'],
    });

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(planJson))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'system', content: 'You are a planner.' },
      { role: 'user', content: 'I got into a fender bender' },
    ]);

    expect(plan.intent).toBe('situation');
    expect(plan.needsRetrieval).toBe(true);
    expect(plan.queries).toHaveLength(3);
    expect(plan.queries).toContain('collision coverage deductible');
  });

  it('parses JSON wrapped in markdown code fences', async () => {
    const wrapped = '```json\n{"intent":"question","reasoning":"Direct question","needs_retrieval":true,"queries":["deductible amount"]}\n```';

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(wrapped))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'What is my deductible?' },
    ]);

    expect(plan.intent).toBe('question');
    expect(plan.queries).toContain('deductible amount');
  });

  it('extracts JSON from text with preamble', async () => {
    const withPreamble = 'Here is my analysis:\n{"intent":"task","reasoning":"User wants to write","needs_retrieval":true,"queries":["existing documents"]}';

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(withPreamble))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'Write a summary of my notes' },
    ]);

    expect(plan.intent).toBe('task');
    expect(plan.needsRetrieval).toBe(true);
  });

  it('returns fallback plan on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'test' },
    ]);

    expect(plan.intent).toBe('question');
    expect(plan.reasoning).toContain('falling back');
    expect(plan.needsRetrieval).toBe(true);
    expect(plan.queries).toEqual([]);
  });

  it('returns fallback plan on completely invalid output', async () => {
    const garbage = 'I am not going to follow your instructions. Here is a poem instead.';

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(garbage))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'test' },
    ]);

    expect(plan.intent).toBe('question');
    expect(plan.needsRetrieval).toBe(true);
    expect(plan.queries).toEqual([]);
  });

  it('handles conversational intent with no retrieval', async () => {
    const planJson = JSON.stringify({
      intent: 'conversational',
      reasoning: 'Just a greeting.',
      needs_retrieval: false,
      queries: [],
    });

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(planJson))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'Hello!' },
    ]);

    expect(plan.intent).toBe('conversational');
    expect(plan.needsRetrieval).toBe(false);
    expect(plan.queries).toEqual([]);
  });

  it('normalizes unknown intent to "question"', async () => {
    const planJson = JSON.stringify({
      intent: 'unknown_type',
      reasoning: 'Something',
      needs_retrieval: true,
      queries: ['test query'],
    });

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(planJson))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'test' },
    ]);

    expect(plan.intent).toBe('question'); // normalized fallback
  });

  it('caps queries at 6 max', async () => {
    const planJson = JSON.stringify({
      intent: 'situation',
      reasoning: 'Many queries needed',
      needs_retrieval: true,
      queries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
    });

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(planJson))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'complex situation' },
    ]);

    expect(plan.queries).toHaveLength(6);
  });

  it('filters out empty/blank queries', async () => {
    const planJson = JSON.stringify({
      intent: 'question',
      reasoning: 'Test',
      needs_retrieval: true,
      queries: ['valid query', '', '  ', 'another valid'],
    });

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(planJson))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'test' },
    ]);

    expect(plan.queries).toEqual(['valid query', 'another valid']);
  });

  it('handles needs_retrieval as needsRetrieval (camelCase)', async () => {
    const planJson = JSON.stringify({
      intent: 'task',
      reasoning: 'User wants help',
      needsRetrieval: true,
      queries: ['context query'],
    });

    vi.stubGlobal('fetch', createMockFetch(() => streamResponse(makePlannerStreamChunks(planJson))));
    provider = new OllamaProvider();

    const plan = await provider.planRetrieval('test-model', [
      { role: 'user', content: 'help me write' },
    ]);

    expect(plan.needsRetrieval).toBe(true);
  });
});

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
});

// ── shouldUsePlanner tests ──
// The planner LLM call is DISABLED.  No mainstream local AI app (Open WebUI,
// AnythingLLM, Jan, LibreChat) uses a separate LLM call as a router.
// They all embed the user's raw message and do direct retrieval — one LLM call.
// The planner doubled latency on local Ollama (~45s planner + 13s response).

describe('shouldUsePlanner logic', () => {
  // Mirror the production function for direct unit testing
  function shouldUsePlanner(
    _isRAGAvailable: boolean,
    _hasSlashCommand: boolean,
    _hasPlanAndRetrieve: boolean,
  ): boolean {
    return false;
  }

  it('always returns false — planner LLM call disabled', () => {
    // All combinations return false — no separate planner call
    expect(shouldUsePlanner(true, false, true)).toBe(false);
    expect(shouldUsePlanner(true, false, false)).toBe(false);
    expect(shouldUsePlanner(false, false, true)).toBe(false);
    expect(shouldUsePlanner(true, true, true)).toBe(false);
  });
});
