// openaiCompatibleBridge.test.ts — the main-process side of the
// OpenAI-compatible provider, run against a fake fetch: model listing, error
// wording, the API key sent only to the server it was saved for, the two
// endpoints it may call, and the sealed-workspace rule.

import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const B = require('../../electron/openaiCompatibleBridge.cjs') as {
  createOpenAICompatibleClient(o: { fetchImpl: FakeFetch; readSecret: (k: string) => Promise<string | null>; isSealed?: () => boolean }): Client;
  parseBaseUrl(raw: string): { base: string; origin: string; hostname: string };
};

type FakeFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
interface Client {
  hasKey(baseUrl?: string): Promise<boolean>;
  keyRecord(key: string, baseUrl: string): string;
  listModels(baseUrl: string): Promise<{ ok: boolean; data?: unknown[]; error?: string }>;
  streamChat(baseUrl: string, body: unknown, signal: AbortSignal | undefined, onData: (t: string) => void): Promise<void>;
}

function recorder(respond: (url: string) => Response | Promise<Response>) {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetchImpl: FakeFetch = async (url, init) => { seen.push({ url, method: init.method, headers: init.headers, body: init.body }); return respond(url); };
  return { seen, fetchImpl };
}

const refused = (): never => {
  const err = new TypeError('fetch failed') as TypeError & { cause?: unknown };
  err.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), { code: 'ECONNREFUSED' });
  throw err;
};

const secretFor = (origin: string, key = 'sk-local') => async () => JSON.stringify({ origin, key });
const noSecret = async () => null;

describe('openaiCompatibleBridge client', () => {
  it('lists models from GET {base}/models', async () => {
    const { seen, fetchImpl } = recorder(() => new Response(JSON.stringify({ object: 'list', data: [{ id: 'a' }, { id: 'b' }] })));
    const c = B.createOpenAICompatibleClient({ fetchImpl, readSecret: noSecret });
    expect(await c.listModels('http://localhost:1234/v1/')).toEqual({ ok: true, data: [{ id: 'a' }, { id: 'b' }] });
    expect(seen[0]).toMatchObject({ url: 'http://localhost:1234/v1/models', method: 'GET' });
    expect(seen[0].headers).not.toHaveProperty('authorization');
  });

  it('says "No server at <url>" when nothing listens', async () => {
    const c = B.createOpenAICompatibleClient({ fetchImpl: async () => refused(), readSecret: noSecret });
    const r = await c.listModels('http://localhost:1234/v1');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^No server at http:\/\/localhost:1234\/v1\./);
    await expect(c.streamChat('http://localhost:1234/v1', {}, undefined, () => {})).rejects.toThrow(/^No server at http:\/\/localhost:1234\/v1/);
  });

  it('words HTTP errors with the server’s own message', async () => {
    const { fetchImpl } = recorder(() => new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }));
    const c = B.createOpenAICompatibleClient({ fetchImpl, readSecret: noSecret });
    const r = await c.listModels('https://example.test/v1');
    expect(r.error).toContain('refused the request (HTTP 401)');
    expect(r.error).toContain('Invalid API key');
    const { fetchImpl: f404 } = recorder(() => new Response('Not Found', { status: 404 }));
    await expect(B.createOpenAICompatibleClient({ fetchImpl: f404, readSecret: noSecret }).streamChat('http://localhost:1234', {}, undefined, () => {}))
      .rejects.toThrow(/HTTP 404: Not Found\. Check that the URL ends in \/v1/);
  });

  it('flags a /models answer that is not JSON', async () => {
    const { fetchImpl } = recorder(() => new Response('<html>LM Studio</html>'));
    const r = await B.createOpenAICompatibleClient({ fetchImpl, readSecret: noSecret }).listModels('http://localhost:1234');
    expect(r.error).toContain('ends in /v1');
  });

  it('sends the key only to the server it was saved for', async () => {
    const { seen, fetchImpl } = recorder(() => new Response(JSON.stringify({ data: [] })));
    const c = B.createOpenAICompatibleClient({ fetchImpl, readSecret: secretFor('http://localhost:1234') });
    await c.listModels('http://localhost:1234/v1');
    await c.listModels('http://evil.test/v1');
    expect(seen[0].headers.authorization).toBe('Bearer sk-local');
    expect(seen[1].headers).not.toHaveProperty('authorization');
    expect(await c.hasKey('http://localhost:1234/v1')).toBe(true);
    expect(await c.hasKey('http://localhost:8080/v1')).toBe(false);
    expect(JSON.parse(c.keyRecord(' sk-x ', 'http://localhost:8080/v1/'))).toEqual({ origin: 'http://localhost:8080', key: 'sk-x' });
  });

  it('streams POST {base}/chat/completions and relays the bytes', async () => {
    const enc = new TextEncoder();
    const { seen, fetchImpl } = recorder(() => new Response(new ReadableStream({
      start(ctrl) { ctrl.enqueue(enc.encode('data: {"choices":[]}\n\n')); ctrl.enqueue(enc.encode('data: [DONE]\n\n')); ctrl.close(); },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const c = B.createOpenAICompatibleClient({ fetchImpl, readSecret: noSecret });
    const got: string[] = [];
    await c.streamChat('http://127.0.0.1:8080/v1', { model: 'm', stream: true }, undefined, (t) => got.push(t));
    expect(seen[0]).toMatchObject({ url: 'http://127.0.0.1:8080/v1/chat/completions', method: 'POST', body: '{"model":"m","stream":true}' });
    expect(got.join('')).toBe('data: {"choices":[]}\n\ndata: [DONE]\n\n');
  });

  it('refuses URLs that are not plain http(s) server URLs', async () => {
    const c = B.createOpenAICompatibleClient({ fetchImpl: async () => new Response('{}'), readSecret: noSecret });
    for (const bad of ['file:///etc/passwd', 'not a url', 'http://user:pw@host/v1', 'http://host/v1?x=1']) {
      expect((await c.listModels(bad)).ok).toBe(false);
    }
  });

  it('a sealed workspace reaches only a server on this machine', async () => {
    const { seen, fetchImpl } = recorder(() => new Response(JSON.stringify({ data: [] })));
    const c = B.createOpenAICompatibleClient({ fetchImpl, readSecret: noSecret, isSealed: () => true });
    expect((await c.listModels('http://localhost:1234/v1')).ok).toBe(true);
    const remote = await c.listModels('https://openrouter.ai/api/v1');
    expect(remote.error).toContain('sealed');
    await expect(c.streamChat('https://openrouter.ai/api/v1', {}, undefined, () => {})).rejects.toThrow('sealed');
    expect(seen).toHaveLength(1);
  });
});
