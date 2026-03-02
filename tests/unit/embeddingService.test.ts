// embeddingService.test.ts — Unit tests for EmbeddingService (M10 Task 1.1)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingService } from '../../src/services/embeddingService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock embedding of the expected dimension. */
function mockEmbedding(seed = 0): number[] {
  return Array.from({ length: 768 }, (_, i) => Math.sin(seed + i) * 0.1);
}

/** Create a mock /api/embed response. */
function mockEmbedResponse(count: number): { model: string; embeddings: number[][] } {
  return {
    model: 'nomic-embed-text',
    embeddings: Array.from({ length: count }, (_, i) => mockEmbedding(i)),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new EmbeddingService('http://localhost:11434', 'nomic-embed-text');

    // Mock global fetch
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    service.dispose();
    vi.restoreAllMocks();
  });

  // ── Model Verification ──

  describe('ensureModel()', () => {
    it('verifies model with a test embed call', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      await service.ensureModel();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/embed');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.model).toBe('nomic-embed-text');
      expect(body.input).toBe('test');
    });

    it('pulls model if embed returns 404', async () => {
      // First call: model not found
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'model not found' });
      // Second call: pull succeeds
      fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'success' }) });

      await service.ensureModel();
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const pullCall = fetchSpy.mock.calls[1];
      expect(pullCall[0]).toBe('http://localhost:11434/api/pull');
    });

    it('caches verified state and does not re-check', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      await service.ensureModel();
      await service.ensureModel(); // Second call should not fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Single Embedding ──

  describe('embedDocument()', () => {
    it('adds search_document prefix and returns embedding', async () => {
      // ensureModel call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      // Actual embed call
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      const result = await service.embedDocument('Hello world');
      expect(result).toHaveLength(768);

      // The second fetch call should have the prefixed text
      const embedCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(embedCall[1].body);
      expect(body.input).toBe('search_document: Hello world');
    });

    it('uses cache when contentHash matches', async () => {
      // ensureModel + first embed
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      const first = await service.embedDocument('Hello', 'hash-abc');
      const second = await service.embedDocument('Hello', 'hash-abc');

      // Only 2 fetch calls (ensureModel + first embed), not 3
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(second).toEqual(first);
    });
  });

  // ── Query Embedding ──

  describe('embedQuery()', () => {
    it('adds search_query prefix', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      await service.embedQuery('What is authentication?');

      const embedCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(embedCall[1].body);
      expect(body.input).toBe('search_query: What is authentication?');
    });
  });

  // ── Batch Embedding ──

  describe('embedDocumentBatch()', () => {
    it('returns empty array for empty input', async () => {
      const result = await service.embedDocumentBatch([]);
      expect(result).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('embeds multiple texts with search_document prefix', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(3),
      });

      const texts = ['First chunk', 'Second chunk', 'Third chunk'];
      const result = await service.embedDocumentBatch(texts);

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveLength(768);

      const embedCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(embedCall[1].body);
      expect(body.input).toHaveLength(3);
      expect(body.input[0]).toBe('search_document: First chunk');
      expect(body.input[2]).toBe('search_document: Third chunk');
    });

    it('skips cached entries and only embeds uncached', async () => {
      // ensureModel + first embed (for cache priming)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      // Prime cache for "First chunk"
      await service.embedDocument('First chunk', 'hash-1');

      // Now batch with hash-1 (cached) and hash-2 (uncached)
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      const result = await service.embedDocumentBatch(
        ['First chunk', 'Second chunk'],
        ['hash-1', 'hash-2'],
      );

      expect(result).toHaveLength(2);
      // The batch call should only embed 1 text (Second chunk)
      const lastCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(lastCall[1].body);
      expect(body.input).toBe('search_document: Second chunk');
    });
  });

  // ── Model Info ──

  describe('getModelInfo()', () => {
    it('returns default model info', () => {
      const info = service.getModelInfo();
      expect(info.name).toBe('nomic-embed-text');
      expect(info.dimensions).toBe(768);
      expect(info.installed).toBe(false);
    });

    it('returns installed=true after ensureModel', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      await service.ensureModel();
      expect(service.getModelInfo().installed).toBe(true);
    });
  });

  // ── Cache Management ──

  describe('cache management', () => {
    it('tracks cache size', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      expect(service.cacheSize).toBe(0);
      await service.embedDocument('test', 'hash-1');
      expect(service.cacheSize).toBe(1);
    });

    it('clearCache resets cache', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });

      await service.embedDocument('test', 'hash-1');
      expect(service.cacheSize).toBe(1);

      service.clearCache();
      expect(service.cacheSize).toBe(0);
    });
  });

  // ── Events ──

  describe('events', () => {
    it('fires onDidStartEmbedding and onDidFinishEmbedding', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(2),
      });

      const startEvents: { count: number }[] = [];
      const finishEvents: { count: number; durationMs: number }[] = [];

      service.onDidStartEmbedding((e) => startEvents.push(e));
      service.onDidFinishEmbedding((e) => finishEvents.push(e));

      await service.embedDocumentBatch(['a', 'b']);

      expect(startEvents).toHaveLength(1);
      expect(startEvents[0].count).toBe(2);
      expect(finishEvents).toHaveLength(1);
      expect(finishEvents[0].count).toBe(2);
      expect(finishEvents[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws on non-ok embed response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockEmbedResponse(1),
      });
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(service.embedDocument('test')).rejects.toThrow('/api/embed returned 500');
    });
  });
});
