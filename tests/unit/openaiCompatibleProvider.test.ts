/**
 * OpenAI-compatible provider: message and tool mapping, the request body,
 * model listing, the SSE decoder (content, reasoning, tool calls split across
 * chunks, finish reasons, usage, errors), the provider over a fake bridge, and
 * its registration (off by default, nothing constructed while off).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  openAIMessagesFromChat,
  buildOpenAIRequestBody,
  createOpenAIStreamDecoder,
  modelsFromListResponse,
  normalizeBaseUrl,
  isLoopbackUrl,
  toNamespacedModelId,
  toServerModelId,
  OpenAICompatibleProvider,
  OPENAI_COMPATIBLE_DEFAULT_CONTEXT,
  type IOpenAICompatibleBridge,
  type IOpenAICompatibleStreamEvent,
} from '../../src/built-in/chat/providers/openaiCompatibleProvider';
import {
  wireOpenAICompatibleProvider,
  OPENAI_COMPATIBLE_ENABLED_SETTING,
  OPENAI_COMPATIBLE_BASE_URL_SETTING,
} from '../../src/built-in/chat/providers/openaiCompatibleRegistration';
import { SEALED_WORKSPACE_SETTING } from '../../src/services/sealedWorkspace';
import { Emitter } from '../../src/platform/events';
import type { IChatMessage, IChatResponseChunk, ILanguageModelProvider } from '../../src/services/chatTypes';
import type { ISettingChange, ISettingSchema } from '../../src/services/settingsRegistryService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const msgs = (arr: any[]): readonly IChatMessage[] => arr as readonly IChatMessage[];
const sse = (...events: unknown[]): string => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

describe('openAIMessagesFromChat', () => {
  it('joins system messages into one leading system message', () => {
    const out = openAIMessagesFromChat(msgs([
      { role: 'user', content: 'Hi' },
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
    ]));
    expect(out).toEqual([
      { role: 'system', content: 'You are helpful.\n\nBe concise.' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('sends images as image_url data URLs next to the text', () => {
    const out = openAIMessagesFromChat(msgs([
      { role: 'user', content: 'what is this', images: [{ mimeType: 'image/png', data: 'BASE64' }] },
    ]));
    expect(out[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BASE64' } },
      ],
    });
  });

  it('gives tool calls ids and links each result to its call by name', () => {
    const out = openAIMessagesFromChat(msgs([
      { role: 'user', content: 'weather and time?' },
      { role: 'assistant', content: '', thinking: 'hmm', toolCalls: [
        { function: { name: 'get_weather', arguments: { city: 'Paris' } } },
        { function: { name: 'get_time', arguments: {} } },
      ] },
      { role: 'tool', toolName: 'get_time', content: '12:00' },
      { role: 'tool', toolName: 'get_weather', content: '72F' },
      { role: 'assistant', content: 'It is 72F at noon.' },
    ]));
    expect(out[1]).toEqual({
      role: 'assistant', content: null,
      tool_calls: [
        { id: 'call_0', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } },
        { id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{}' } },
      ],
    });
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '12:00' });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: '72F' });
    expect(out[4]).toEqual({ role: 'assistant', content: 'It is 72F at noon.' });
  });

  it('sends a result with no call to answer as a user turn', () => {
    const out = openAIMessagesFromChat(msgs([{ role: 'tool', toolName: 'read_file', content: 'text' }]));
    expect(out).toEqual([{ role: 'user', content: 'Result of read_file:\ntext' }]);
  });
});

describe('buildOpenAIRequestBody', () => {
  it('strips the namespace, streams with usage, maps tools and options', () => {
    const body = buildOpenAIRequestBody(toNamespacedModelId('qwen2.5-7b'), msgs([{ role: 'user', content: 'hi' }]), {
      temperature: 0.2, topP: 0.9, seed: 7, maxTokens: 256, format: 'json',
      tools: [{ name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    });
    expect(body).toEqual({
      model: 'qwen2.5-7b',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2, top_p: 0.9, seed: 7, max_tokens: 256,
      response_format: { type: 'json_object' },
      tools: [{ type: 'function', function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
    });
  });

  it('sends a JSON schema format as json_schema and leaves unset options out', () => {
    const body = buildOpenAIRequestBody('m', msgs([]), { format: { type: 'object' } });
    expect(body['response_format']).toEqual({ type: 'json_schema', json_schema: { name: 'response', schema: { type: 'object' } } });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('max_tokens');
  });
});

describe('model ids and listing', () => {
  it('namespaces ids so they never collide with an Ollama model', () => {
    expect(toNamespacedModelId('llama3:8b')).toBe('openai-compatible::llama3:8b');
    expect(toServerModelId('openai-compatible::llama3:8b')).toBe('llama3:8b');
    expect(toServerModelId('llama3:8b')).toBe('llama3:8b');
  });

  it('maps /models, keeps reported context lengths and leaves embedding models out', () => {
    const models = modelsFromListResponse([
      { id: 'qwen2.5-7b-instruct', object: 'model' },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', max_model_len: 32768 },
      { id: 'text-embedding-nomic-embed-text-v1.5' },
      { id: 'qwen2.5-7b-instruct' },
      { nope: true },
    ], 'http://localhost:1234/v1');
    expect(models.map((m) => m.id)).toEqual([
      'openai-compatible::qwen2.5-7b-instruct',
      'openai-compatible::meta-llama/Llama-3.1-8B-Instruct',
    ]);
    expect(models[0]).toMatchObject({ displayName: 'qwen2.5-7b-instruct (localhost:1234)', contextLength: OPENAI_COMPATIBLE_DEFAULT_CONTEXT, capabilities: ['completion', 'tools'] });
    expect(models[1].contextLength).toBe(32768);
  });

  it('normalizes base URLs and tells loopback from remote', () => {
    expect(normalizeBaseUrl(' http://localhost:8080/v1/ ')).toBe('http://localhost:8080/v1');
    expect(normalizeBaseUrl('')).toBe('http://localhost:1234/v1');
    expect(isLoopbackUrl('http://127.0.0.1:8000/v1')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8000/v1')).toBe(true);
    expect(isLoopbackUrl('https://openrouter.ai/api/v1')).toBe(false);
  });
});

describe('createOpenAIStreamDecoder', () => {
  const decodeAll = (text: string, splitEvery = 0): IChatResponseChunk[] => {
    const d = createOpenAIStreamDecoder();
    const out: IChatResponseChunk[] = [];
    if (splitEvery > 0) for (let i = 0; i < text.length; i += splitEvery) out.push(...d.push(text.slice(i, i + splitEvery)));
    else out.push(...d.push(text));
    out.push(...d.end());
    return out;
  };

  it('yields content deltas and a final chunk with usage', () => {
    const text = sse(
      { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
      { choices: [{ index: 0, delta: { content: 'Hel' } }] },
      { choices: [{ index: 0, delta: { content: 'lo' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 } },
      '[DONE]',
    );
    const chunks = decodeAll(text);
    expect(chunks.filter((c) => !c.done).map((c) => c.content).join('')).toBe('Hello');
    expect(chunks[chunks.length - 1]).toEqual({ content: '', done: true, promptEvalCount: 12, evalCount: 2, doneReason: 'stop' });
  });

  it('assembles tool calls whose arguments arrive in pieces, whatever the byte split', () => {
    const text = sse(
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'get_weather', arguments: '' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"ci' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'get_time', arguments: '{}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Paris"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      '[DONE]',
    );
    for (const split of [0, 1, 7, 33]) {
      const calls = decodeAll(text, split).flatMap((c) => c.toolCalls ?? []);
      expect(calls).toEqual([
        { function: { name: 'get_weather', arguments: { city: 'Paris' } } },
        { function: { name: 'get_time', arguments: {} } },
      ]);
    }
  });

  it('emits tool calls at the end when the server never sends a finish reason', () => {
    const text = sse({ choices: [{ delta: { tool_calls: [{ function: { name: 'list_files', arguments: { path: '.' } } }] } }] });
    const chunks = decodeAll(text);
    expect(chunks.flatMap((c) => c.toolCalls ?? [])).toEqual([{ function: { name: 'list_files', arguments: { path: '.' } } }]);
    expect(chunks[chunks.length - 1].done).toBe(true);
  });

  it("reports a truncated reply as doneReason 'length'", () => {
    const chunks = decodeAll(sse({ choices: [{ delta: { content: 'cut' }, finish_reason: 'length' }] }));
    expect(chunks[chunks.length - 1]).toMatchObject({ done: true, doneReason: 'length' });
  });

  it('passes reasoning deltas through as thinking', () => {
    const chunks = decodeAll(sse({ choices: [{ delta: { reasoning_content: 'Let me think' } }] }));
    expect(chunks[0]).toEqual({ content: '', thinking: 'Let me think', done: false });
  });

  it('decodes a last line that has no newline', () => {
    const d = createOpenAIStreamDecoder();
    expect(d.push('data: {"choices":[{"delta":{"content":"x"}}]}')).toEqual([]);
    expect(d.end()[0]).toEqual({ content: 'x', done: false });
  });

  it('records an error object in the stream', () => {
    const d = createOpenAIStreamDecoder();
    d.push(sse({ error: { message: 'model not loaded' } }));
    expect(d.error).toBe('model not loaded');
  });
});

// ── The provider over a fake bridge ──────────────────────────────────────────

function fakeBridge(script: (requestId: string, emit: (e: IOpenAICompatibleStreamEvent) => void) => void) {
  const calls = { bodies: [] as unknown[], urls: [] as string[], aborted: [] as string[], listed: 0 };
  let listener: (e: IOpenAICompatibleStreamEvent) => void = () => {};
  const bridge: IOpenAICompatibleBridge = {
    hasKey: async () => false, setKey: async () => ({ ok: true }), clearKey: async () => undefined,
    listModels: async (baseUrl) => { calls.listed++; calls.urls.push(baseUrl); return { ok: true, data: [{ id: 'local-model' }] }; },
    abortStream: async (id) => { calls.aborted.push(id); return undefined; },
    onStreamEvent: (cb) => { listener = cb; return () => { listener = () => {}; }; },
    startStream: async (requestId, baseUrl, body) => {
      calls.bodies.push(body); calls.urls.push(baseUrl);
      setTimeout(() => script(requestId, (e) => listener(e)), 0);
      return { ok: true };
    },
  };
  return { bridge, calls };
}

async function drain(it: AsyncIterable<IChatResponseChunk>): Promise<IChatResponseChunk[]> {
  const out: IChatResponseChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('OpenAICompatibleProvider', () => {
  it('lists namespaced models and streams a reply through the bridge', async () => {
    const { bridge, calls } = fakeBridge((requestId, emit) => {
      emit({ requestId, type: 'data', data: sse({ choices: [{ delta: { content: 'Hi' } }] }).slice(0, 20) });
      emit({ requestId, type: 'data', data: sse({ choices: [{ delta: { content: 'Hi' } }] }).slice(20) });
      emit({ requestId, type: 'end' });
    });
    const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1/');
    expect(p.local).toBe(true);
    expect((await p.listModels()).map((m) => m.id)).toEqual(['openai-compatible::local-model']);
    const chunks = await drain(p.sendChatRequest('openai-compatible::local-model', msgs([{ role: 'user', content: 'hello' }])));
    expect(chunks.map((c) => c.content).join('')).toBe('Hi');
    expect(chunks[chunks.length - 1].done).toBe(true);
    expect(calls.urls).toEqual(['http://localhost:1234/v1', 'http://localhost:1234/v1']);
    expect((calls.bodies[0] as { model: string }).model).toBe('local-model');
    p.dispose();
  });

  it('throws the bridge error, worded for the person', async () => {
    const { bridge } = fakeBridge((requestId, emit) => emit({ requestId, type: 'error', error: 'No server at http://localhost:1234/v1. Start the server, or check the URL in AI Settings › Model.' }));
    const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1');
    await expect(drain(p.sendChatRequest('m', msgs([{ role: 'user', content: 'x' }])))).rejects.toThrow(/No server at http:\/\/localhost:1234\/v1/);
  });

  it('throws an error the server put in the stream', async () => {
    const { bridge } = fakeBridge((requestId, emit) => {
      emit({ requestId, type: 'data', data: sse({ error: { message: 'context length exceeded' } }) });
      emit({ requestId, type: 'end' });
    });
    const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1');
    await expect(drain(p.sendChatRequest('m', msgs([])))).rejects.toThrow('context length exceeded');
  });

  it('aborts the request in main when the signal fires, and ends quietly', async () => {
    const controller = new AbortController();
    const { bridge, calls } = fakeBridge((requestId, emit) => {
      emit({ requestId, type: 'data', data: sse({ choices: [{ delta: { content: 'partial' } }] }) });
      controller.abort();
      setTimeout(() => emit({ requestId, type: 'aborted' }), 0);
    });
    const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1');
    const chunks = await drain(p.sendChatRequest('m', msgs([]), undefined, controller.signal));
    expect(chunks.map((c) => c.content)).toEqual(['partial']);
    expect(calls.aborted.length).toBeGreaterThan(0);
  });

  it('reports a server that is down as unavailable', async () => {
    const { bridge } = fakeBridge(() => {});
    bridge.listModels = async () => ({ ok: false, error: 'No server at http://localhost:1234/v1.' });
    const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1');
    expect(await p.checkAvailability()).toEqual({ available: false, error: 'No server at http://localhost:1234/v1.' });
    await expect(p.listModels()).rejects.toThrow('No server at');
    p.dispose();
  });

  it('asks a server that was down again until it answers, then says so once', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = fakeBridge(() => {});
      let up = false;
      let asked = 0;
      bridge.listModels = async () => { asked++; return up ? { ok: true, data: [{ id: 'm' }] } : { ok: false, error: 'No server' }; };
      const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1');
      const seen: boolean[] = [];
      p.onDidChangeStatus((s) => seen.push(s.available));
      await expect(p.listModels()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(OpenAICompatibleProvider.RETRY_FIRST_MS);
      expect(asked).toBe(2);
      up = true;
      await vi.advanceTimersByTimeAsync(OpenAICompatibleProvider.RETRY_FIRST_MS * 2);
      expect(asked).toBe(3);
      expect(seen).toEqual([true]);
      await vi.advanceTimersByTimeAsync(OpenAICompatibleProvider.RETRY_MAX_MS * 2);
      expect(asked).toBe(3);
      p.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops asking once disposed', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = fakeBridge(() => {});
      let asked = 0;
      bridge.listModels = async () => { asked++; return { ok: false, error: 'No server' }; };
      const p = new OpenAICompatibleProvider(bridge, 'http://localhost:1234/v1');
      await expect(p.listModels()).rejects.toThrow();
      p.dispose();
      await vi.advanceTimersByTimeAsync(OpenAICompatibleProvider.RETRY_MAX_MS * 4);
      expect(asked).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

function fakeRegistry(values: Record<string, unknown> = {}) {
  const schemas = new Map<string, ISettingSchema>();
  const changes = new Emitter<ISettingChange>();
  const store: Record<string, unknown> = { ...values };
  return {
    register: (s: ISettingSchema) => { schemas.set(s.key, s); },
    getSchema: (k: string) => schemas.get(k),
    getValue: <T>(k: string): T => {
      const s = schemas.get(k);
      if (!s) throw new Error(`unregistered ${k}`);
      return (k in store ? store[k] : s.default) as T;
    },
    onDidChange: changes.event,
    set(k: string, v: unknown) { store[k] = v; changes.fire({ key: k, value: v, scope: 'workspace', origin: 'user' }); },
  };
}

function fakeModels() {
  const live: ILanguageModelProvider[] = [];
  return {
    live,
    registerProvider: (p: ILanguageModelProvider) => { live.push(p); return { dispose: () => { live.splice(live.indexOf(p), 1); } }; },
  };
}

describe('wireOpenAICompatibleProvider', () => {
  it('is off by default: registers its settings and nothing else', () => {
    const reg = fakeRegistry();
    const lms = fakeModels();
    const { bridge, calls } = fakeBridge(() => {});
    const d = wireOpenAICompatibleProvider(reg, lms, bridge);
    expect(reg.getValue(OPENAI_COMPATIBLE_ENABLED_SETTING)).toBe(false);
    expect(reg.getValue(OPENAI_COMPATIBLE_BASE_URL_SETTING)).toBe('http://localhost:1234/v1');
    expect(lms.live).toHaveLength(0);
    expect(calls.listed).toBe(0);
    d.dispose();
  });

  it('registers when turned on, follows a new URL, and unregisters when turned off', () => {
    const reg = fakeRegistry();
    const lms = fakeModels();
    const { bridge } = fakeBridge(() => {});
    const d = wireOpenAICompatibleProvider(reg, lms, bridge);
    reg.set(OPENAI_COMPATIBLE_ENABLED_SETTING, true);
    expect(lms.live).toHaveLength(1);
    expect((lms.live[0] as OpenAICompatibleProvider).baseUrl).toBe('http://localhost:1234/v1');
    reg.set(OPENAI_COMPATIBLE_BASE_URL_SETTING, 'http://localhost:8080/v1/');
    expect(lms.live).toHaveLength(1);
    expect((lms.live[0] as OpenAICompatibleProvider).baseUrl).toBe('http://localhost:8080/v1');
    reg.set(OPENAI_COMPATIBLE_ENABLED_SETTING, false);
    expect(lms.live).toHaveLength(0);
    d.dispose();
  });

  it('a sealed workspace keeps a local server and drops a remote one', () => {
    const reg = fakeRegistry({ [OPENAI_COMPATIBLE_ENABLED_SETTING]: true, [SEALED_WORKSPACE_SETTING]: true });
    const lms = fakeModels();
    const { bridge } = fakeBridge(() => {});
    const d = wireOpenAICompatibleProvider(reg, lms, bridge);
    expect(lms.live).toHaveLength(1);
    reg.set(OPENAI_COMPATIBLE_BASE_URL_SETTING, 'https://openrouter.ai/api/v1');
    expect(lms.live).toHaveLength(0);
    d.dispose();
  });

  it('disposing unregisters the provider', () => {
    const reg = fakeRegistry({ [OPENAI_COMPATIBLE_ENABLED_SETTING]: true });
    const lms = fakeModels();
    const { bridge } = fakeBridge(() => {});
    wireOpenAICompatibleProvider(reg, lms, bridge).dispose();
    expect(lms.live).toHaveLength(0);
  });
});
