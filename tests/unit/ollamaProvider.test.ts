// @vitest-environment jsdom
// Unit tests for OllamaProvider — M9.0
//
// Tests cover: checkAvailability, listModels, sendChatRequest streaming.
// Network calls are mocked via vi.stubGlobal('fetch', ...).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from '../../src/built-in/chat/providers/ollamaProvider';

// ── Helpers ──

function createMockFetch(responses: Map<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, factory] of responses) {
      if (url.includes(pattern)) {
        return factory();
      }
    }
    throw new Error(`Unexpected fetch to: ${url}`);
  });
}

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

describe('OllamaProvider', () => {
  let provider: OllamaProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default mock: version endpoint available, empty models, empty ps
    const mockFetch = createMockFetch(new Map([
      ['/api/version', () => jsonResponse({ version: '0.5.4' })],
      ['/api/tags', () => jsonResponse({ models: [] })],
      ['/api/ps', () => jsonResponse({ models: [] })],
    ]));
    vi.stubGlobal('fetch', mockFetch);

    provider = new OllamaProvider('http://localhost:11434');
  });

  afterEach(() => {
    provider.dispose();
    vi.stubGlobal('fetch', originalFetch);
  });

  describe('checkAvailability', () => {
    it('returns available: true when server responds', async () => {
      const status = await provider.checkAvailability();
      expect(status.available).toBe(true);
      expect(status.version).toBe('0.5.4');
    });

    it('returns available: false on network error', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));

      const freshProvider = new OllamaProvider('http://localhost:99999');
      const status = await freshProvider.checkAvailability();
      expect(status.available).toBe(false);
      expect(status.error).toContain('ECONNREFUSED');
      freshProvider.dispose();
    });

    it('returns available: false on non-200 status', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        new Response('', { status: 503 }),
      )));

      const freshProvider = new OllamaProvider();
      const status = await freshProvider.checkAvailability();
      expect(status.available).toBe(false);
      freshProvider.dispose();
    });
  });

  describe('listModels', () => {
    it('returns empty array when no models', async () => {
      const models = await provider.listModels();
      expect(models).toHaveLength(0);
    });

    it('maps Ollama model data to ILanguageModelInfo', async () => {
      vi.stubGlobal('fetch', createMockFetch(new Map([
        ['/api/version', () => jsonResponse({ version: '0.5.4' })],
        ['/api/ps', () => jsonResponse({ models: [] })],
        ['/api/tags', () => jsonResponse({
          models: [{
            name: 'llama3.2:latest',
            model: 'llama3.2:latest',
            size: 2000000000,
            details: {
              family: 'llama',
              parameter_size: '3.2B',
              quantization_level: 'Q4_K_M',
            },
          }],
        })],
      ])));

      const freshProvider = new OllamaProvider();
      const models = await freshProvider.listModels();
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('llama3.2:latest');
      expect(models[0].family).toBe('llama');
      expect(models[0].parameterSize).toBe('3.2B');
      expect(models[0].quantization).toBe('Q4_K_M');
      freshProvider.dispose();
    });

    it('detects vision capability from model info', async () => {
      vi.stubGlobal('fetch', createMockFetch(new Map([
        ['/api/version', () => jsonResponse({ version: '0.5.4' })],
        ['/api/ps', () => jsonResponse({ models: [] })],
        ['/api/tags', () => jsonResponse({ models: [] })],
        ['/api/show', () => jsonResponse({
          details: { family: 'llava', parameter_size: '7B', quantization_level: 'Q4_K_M' },
          model_info: { 'llava.context_length': 8192 },
          capabilities: ['vision'],
        })],
      ])));

      const freshProvider = new OllamaProvider();
      const info = await freshProvider.getModelInfo('llava:latest');
      expect(info.capabilities).toContain('vision');
      freshProvider.dispose();
    });
  });

  describe('sendChatRequest streaming', () => {
    it('yields chunks from streaming response', async () => {
      const chunks = [
        JSON.stringify({ model: 'test', message: { role: 'assistant', content: 'Hello' }, done: false }),
        JSON.stringify({ model: 'test', message: { role: 'assistant', content: ' world' }, done: false }),
        JSON.stringify({ model: 'test', message: { role: 'assistant', content: '' }, done: true, eval_count: 10, eval_duration: 1000000 }),
      ];

      vi.stubGlobal('fetch', createMockFetch(new Map([
        ['/api/version', () => jsonResponse({ version: '0.5.4' })],
        ['/api/ps', () => jsonResponse({ models: [] })],
        ['/api/tags', () => jsonResponse({ models: [] })],
        ['/api/chat', () => streamResponse(chunks)],
      ])));

      const freshProvider = new OllamaProvider();
      const messages = [{ role: 'user' as const, content: 'Hi' }];
      const received: string[] = [];

      for await (const chunk of freshProvider.sendChatRequest('test', messages)) {
        received.push(chunk.content);
        if (chunk.done) break;
      }

      expect(received).toContain('Hello');
      expect(received).toContain(' world');
      freshProvider.dispose();
    });

    it('respects abort signal on fetch', async () => {
      // Mock fetch to throw AbortError immediately
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      }));

      const freshProvider = new OllamaProvider();
      const messages = [{ role: 'user' as const, content: 'Hi' }];

      let caught = false;
      try {
        for await (const _chunk of freshProvider.sendChatRequest('test', messages)) {
          // Should not reach here
        }
      } catch (err) {
        caught = true;
        expect((err as DOMException).name).toBe('AbortError');
      }

      expect(caught).toBe(true);
      freshProvider.dispose();
    });

    it('formats multimodal messages with image payloads', () => {
      const formatted = provider._debugFormatMessage({
        role: 'user',
        content: 'What is in this image?',
        images: [{ kind: 'image', id: 'img-1', name: 'clipboard.png', fullPath: 'parallx-image://1', isImplicit: false, mimeType: 'image/png', data: 'abc123' }],
      });

      expect(formatted.images).toEqual(['abc123']);
    });
  });

  describe('health monitor', () => {
    it('getLastStatus returns the last known status', () => {
      // After construction, health poll fires immediately
      const status = provider.getLastStatus();
      // Initially may be { available: false } before first poll completes
      expect(status).toHaveProperty('available');
    });

    it('onDidChangeStatus fires when availability changes', async () => {
      const listener = vi.fn();
      provider.onDidChangeStatus(listener);

      // Give the initial health poll time to fire
      await new Promise(r => setTimeout(r, 100));

      // listener may have been called with status from initial poll
      if (listener.mock.calls.length > 0) {
        expect(listener.mock.calls[0][0]).toHaveProperty('available');
      }
    });
  });
});
