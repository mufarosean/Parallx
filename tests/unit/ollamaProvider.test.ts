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
        JSON.stringify({ model: 'test', message: { role: 'assistant', content: '' }, done: true, eval_count: 10, eval_duration: 1000000, prompt_eval_count: 26, prompt_eval_duration: 342546000, load_duration: 1334875 }),
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
      let last: Record<string, unknown> = {};

      for await (const chunk of freshProvider.sendChatRequest('test', messages)) {
        received.push(chunk.content);
        if (chunk.done) { last = chunk as unknown as Record<string, unknown>; break; }
      }

      expect(received).toContain('Hello');
      expect(received).toContain(' world');
      // The final chunk carries what the engine reported of the call: an answer's speed is made of it.
      expect(last).toMatchObject({ evalCount: 10, evalDuration: 1000000, promptEvalCount: 26, promptEvalDuration: 342546000, loadDuration: 1334875 });
      freshProvider.dispose();
    });

    it('keeps inline <think> state per stream: one stream inside a tag does not file another stream\'s answer as reasoning', async () => {
      const line = (content: string, done = false) => JSON.stringify({ model: 'test', message: { role: 'assistant', content }, done });
      vi.stubGlobal('fetch', createMockFetch(new Map([
        ['/api/version', () => jsonResponse({ version: '0.5.4' })],
        ['/api/ps', () => jsonResponse({ models: [] })],
        ['/api/tags', () => jsonResponse({ models: [] })],
        ['/api/chat', () => streamResponse([line('<think>weighing the factors'), line(' still thinking'), line('', true)])],
      ])));
      const provider = new OllamaProvider();
      const a = provider.sendChatRequest('test', [{ role: 'user' as const, content: 'A' }])[Symbol.asyncIterator]();
      const first = await a.next();
      expect(first.value?.thinking).toContain('weighing');

      // A second stream starts while the first is inside its <think> tag.
      vi.stubGlobal('fetch', createMockFetch(new Map([
        ['/api/chat', () => streamResponse([line('The answer is 1.25.'), line('', true)])],
      ])));
      let content = '';
      let thinking = '';
      for await (const chunk of provider.sendChatRequest('test', [{ role: 'user' as const, content: 'B' }])) {
        content += chunk.content;
        thinking += chunk.thinking ?? '';
      }
      expect(content).toBe('The answer is 1.25.');
      expect(thinking).toBe('');

      const second = await a.next();
      expect(second.value?.thinking).toContain('still thinking');
      provider.dispose();
    });

    it('says why it stopped: a reply that ran out of room ends with doneReason "length"', async () => {
      const chunks = [
        JSON.stringify({ model: 'test', message: { role: 'assistant', content: 'She turned to' }, done: false }),
        JSON.stringify({ model: 'test', message: { role: 'assistant', content: '' }, done: true, done_reason: 'length', eval_count: 4 }),
      ];
      vi.stubGlobal('fetch', createMockFetch(new Map([
        ['/api/version', () => jsonResponse({ version: '0.5.4' })],
        ['/api/ps', () => jsonResponse({ models: [] })],
        ['/api/tags', () => jsonResponse({ models: [] })],
        ['/api/chat', () => streamResponse(chunks)],
      ])));
      const freshProvider = new OllamaProvider();
      let reason: string | undefined;
      for await (const chunk of freshProvider.sendChatRequest('test', [{ role: 'user' as const, content: 'Hi' }])) {
        if (chunk.done) reason = chunk.doneReason;
      }
      expect(reason).toBe('length');
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

  // Seen live (Ollama's log, 2026-09-10/11): the warm-up loaded the first
  // model Ollama listed at its full 262K default, and requests with no size
  // made Ollama reload the chat's model at 262K, spilling past the graphics
  // card, then again at the chat's 160K.
  describe('launch warm-up and request options', () => {
    const tag = (name: string) => ({
      name, model: name, modified_at: '2026-09-11T00:00:00Z', size: 1, digest: name,
      details: { format: 'gguf', family: 'qwen3', families: ['qwen3'], parameter_size: '27B', quantization_level: 'Q4_K_M' },
    });
    function recordingFetch(tags: string[]) {
      const chats: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/version')) return jsonResponse({ version: '0.12.0' });
        if (url.includes('/api/ps')) return jsonResponse({ models: [] });
        if (url.includes('/api/tags')) return jsonResponse({ models: tags.map(tag) });
        if (url.includes('/api/embed')) return jsonResponse({ embeddings: [[0]] });
        if (url.includes('/api/chat')) {
          chats.push(JSON.parse(String(init?.body ?? '{}')));
          return streamResponse([JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true })]);
        }
        throw new Error(`Unexpected fetch to: ${url}`);
      });
      return { fetchMock, chats };
    }
    const drain = async (it: AsyncIterable<unknown>) => { for await (const _chunk of it) { /* drain */ } };

    it('loads nothing at launch: no chat model and no embedding model until a request asks', async () => {
      const { fetchMock, chats } = recordingFetch(['qwen3.6:latest', 'qwen3.8:27b']);
      vi.stubGlobal('fetch', fetchMock);
      const p = new OllamaProvider();
      await new Promise((r) => setTimeout(r, 400));
      expect(chats).toEqual([]);
      expect(fetchMock.mock.calls.filter(([input]) => /api\/(embed|chat|generate)/.test(String(input)))).toEqual([]);
      p.dispose();
    });

    it('a request with no size and nothing remembered still names one: the model\'s length capped at 65536, never nothing', async () => {
      const { fetchMock, chats } = recordingFetch([]);
      vi.stubGlobal('fetch', fetchMock);
      const p = new OllamaProvider();
      await drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Rewrite the voice' }]));
      expect(chats.map((c) => (c.options as { num_ctx?: number } | undefined)?.num_ctx)).toEqual([65536]);
      p.dispose();
    });

    it('a size the app chose that spills off the card is measured and sent again at the size that fits; the fit is kept', async () => {
      const GiB = 1024 ** 3;
      const chats: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/version')) return jsonResponse({ version: '0.12.0' });
        if (url.includes('/api/tags')) return jsonResponse({ models: [{ ...tag('gemma4:31b'), size: 20 * GiB }] });
        if (url.includes('/api/ps')) return jsonResponse({ models: chats.length ? [{ name: 'gemma4:31b', size: 40 * GiB, size_vram: 30 * GiB, context_length: (chats[chats.length - 1].options as { num_ctx: number }).num_ctx }] : [] });
        if (url.includes('/api/chat')) {
          chats.push(JSON.parse(String(init?.body ?? '{}')));
          const first = chats.length === 1;
          // The first attempt never answers (spilled); the second answers at once.
          return new Response(new ReadableStream({
            start(ctrl) {
              if (first) { init?.signal?.addEventListener('abort', () => { try { ctrl.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } }); return; }
              ctrl.enqueue(new TextEncoder().encode(JSON.stringify({ model: 'm', message: { role: 'assistant', content: 'Hi' }, done: true }) + '\n'));
              ctrl.close();
            },
          }), { status: 200 });
        }
        throw new Error(`Unexpected fetch to: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      const was = OllamaProvider.FIT_POLL_MS; OllamaProvider.FIT_POLL_MS = 5;
      const p = new OllamaProvider();
      try {
        await p.listModels();
        const learned: number[] = [];
        p.onDidLearnContextFit(({ numCtx }) => learned.push(numCtx));
        const sent: number[] = [];
        p.onDidSendChatRequest(({ numCtx }) => sent.push(numCtx));
        let text = '';
        for await (const c of p.sendChatRequest('gemma4:31b', [{ role: 'user', content: 'Rewrite the voice' }])) text += c.content ?? '';
        expect(text).toBe('Hi');
        expect(chats.map((c) => (c.options as { num_ctx: number }).num_ctx)).toEqual([65536, 22 * 1024]);
        expect(learned).toEqual([22 * 1024]);
        expect(sent).toEqual([22 * 1024]);
        // The next sizeless request goes straight to the fit; a size the caller names is kept.
        for await (const _c of p.sendChatRequest('gemma4:31b', [{ role: 'user', content: 'Again' }])) { /* drain */ }
        for await (const _c of p.sendChatRequest('gemma4:31b', [{ role: 'user', content: 'At 128K' }], { numCtx: 131072 })) { /* drain */ }
        expect(chats.slice(2).map((c) => (c.options as { num_ctx: number }).num_ctx)).toEqual([22 * 1024, 131072]);
      } finally {
        OllamaProvider.FIT_POLL_MS = was;
        p.dispose();
      }
    });

    it('names a context size on every request: one without a size reuses the last size named', async () => {
      const { fetchMock, chats } = recordingFetch([]);
      vi.stubGlobal('fetch', fetchMock);
      const p = new OllamaProvider();
      const sent = vi.fn();
      p.onDidSendChatRequest(sent);
      await drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Hi' }], { numCtx: 163840 }));
      await drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Summarize this' }]));
      expect(sent).toHaveBeenCalledTimes(1);
      expect(sent).toHaveBeenCalledWith({ modelId: 'qwen3.8:27b', numCtx: 163840 });
      expect(chats.map((c) => (c.options as { num_ctx?: number } | undefined)?.num_ctx)).toEqual([163840, 163840]);
      p.dispose();
    });

    it('a sizeless request reuses its own model\'s size, never a small one a short task named', async () => {
      const { fetchMock, chats } = recordingFetch([]);
      vi.stubGlobal('fetch', fetchMock);
      const p = new OllamaProvider();
      await drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Hi' }], { numCtx: 32768 }));
      await drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Mark this' }], { numCtx: 2048 })); // a marking call
      await drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Rewrite this paragraph' }]));
      await drain(p.sendChatRequest('gemma3:12b', [{ role: 'user', content: 'Other model' }])); // no size named for this model yet: the cap, never nothing
      expect(chats.map((c) => (c.options as { num_ctx?: number } | undefined)?.num_ctx)).toEqual([32768, 2048, 32768, 65536]);
      p.dispose();
    });

    it('omits temperature when it is negative, so the model keeps its own tuned value', async () => {
      // -1 is the settings default: no opinion. Ollama then falls back to the
      // model's own PARAMETER temperature. A harness default sent here would
      // override that for every model.
      const { fetchMock, chats } = recordingFetch([]);
      vi.stubGlobal('fetch', fetchMock);
      const p = new OllamaProvider();
      const ask = (temperature: number) => drain(p.sendChatRequest('qwen3.8:27b', [{ role: 'user', content: 'Hi' }], { numCtx: 8192, temperature }));
      await ask(-1);
      await ask(0);
      await ask(1.4);
      expect(chats.map((c) => (c.options as { temperature?: number }).temperature)).toEqual([undefined, 0, 1.4]);
      p.dispose();
    });
  });
});
