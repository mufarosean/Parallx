// electron/openaiCompatibleBridge.cjs — main-process pipe for OpenAI-compatible
// model servers: LM Studio, llama.cpp server, vLLM, LocalAI, or any service
// that answers /v1/chat/completions.
//
// Why the main process:
//   • The renderer's CSP connect-src names only Ollama, and remote servers send
//     no CORS headers, so a renderer fetch could reach neither.
//   • The optional API key stays here (safeStorage), bound to the origin it was
//     saved for. It is sent to that server and no other, so changing the URL in
//     settings never carries the key somewhere else.
//
// The renderer builds the request body and decodes the SSE. This file talks to
// two endpoints under the base URL the renderer names, nothing else:
//   GET  {base}/models
//   POST {base}/chat/completions
// Nothing runs until the provider (AI Settings › Model › Providers) calls it.
// In a sealed workspace only a server on this machine may be used.
//
// Surface (all under `openaiCompat:*`):
//   hasKey(baseUrl) / setKey({ key, baseUrl }) / clearKey()
//   models(baseUrl)                     → { ok, data } | { ok: false, error }
//   start({ requestId, baseUrl, body }) → raw SSE text relayed as
//                                         `openaiCompat:event` pushes
//                                         ({ requestId, type: 'data'|'end'|
//                                            'error'|'aborted', ... })
//   abort(requestId)

const KEY_SECRET = 'openaiCompatible.api_key';
const EVENT_CHANNEL = 'openaiCompat:event';
const MODELS_TIMEOUT_MS = 8000;

/** Parse and normalize a base URL (no trailing slash). Throws a readable Error. */
function parseBaseUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  let url;
  try { url = new URL(text); } catch { throw new Error(`Not a server URL: "${text}". Use one like http://localhost:1234/v1.`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Not a server URL: "${text}". It must start with http:// or https://.`);
  if (url.username || url.password) throw new Error('Put the API key in its own field, not in the server URL.');
  if (url.search || url.hash) throw new Error(`Not a server URL: "${text}". Leave out ? and # parts.`);
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  return { base, origin: url.origin, hostname: url.hostname };
}

/** True for a host on this machine. */
function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Turn a fetch failure into a sentence the person can act on. */
function describeFetchError(err, base) {
  const code = (err && err.cause && err.cause.code) || (err && err.code) || '';
  if (code === 'ECONNREFUSED') return `No server at ${base}. Start the server, or check the URL in AI Settings › Model.`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `No server at ${base}: the host name was not found.`;
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return `The server at ${base} did not answer in time.`;
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return `The server at ${base} closed the connection.`;
  if (err && err.name === 'TimeoutError') return `The server at ${base} did not answer in time.`;
  return `Could not reach ${base}: ${err && err.message ? err.message : String(err)}`;
}

/** The server's own message from an error body, when it sent one. */
function errorDetail(text) {
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const m = (j && j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''))) || (j && j.message) || (j && j.detail) || '';
    if (m) return String(m).slice(0, 400);
  } catch { /* not JSON */ }
  return String(text).slice(0, 400);
}

/** Turn an HTTP error status into a sentence. */
function describeHttpError(status, text, base) {
  const detail = errorDetail(text);
  const tail = detail ? `: ${detail}` : '';
  if (status === 401 || status === 403) return `The server at ${base} refused the request (HTTP ${status}). Check the API key in AI Settings › Model${tail ? '. Server said' + tail : ''}.`;
  if (status === 404) return `The server at ${base} answered HTTP 404${tail}. Check that the URL ends in /v1 and the model is loaded.`;
  return `The server at ${base} answered HTTP ${status}${tail}`;
}

/**
 * The HTTP side, with fetch and the secret store passed in so tests can run it
 * against a fake server.
 */
function createOpenAICompatibleClient({ fetchImpl, readSecret, isSealed }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  async function storedKey() {
    try {
      const raw = await readSecret(KEY_SECRET);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.key === 'string' && typeof parsed.origin === 'string' ? parsed : null;
    } catch { return null; }
  }

  async function headersFor(origin, extra) {
    const headers = { accept: 'application/json', ...extra };
    const stored = await storedKey();
    if (stored && stored.origin === origin) headers.authorization = `Bearer ${stored.key}`;
    return headers;
  }

  function target(baseUrl) {
    const t = parseBaseUrl(baseUrl);
    if (isSealed && isSealed() && !isLoopbackHost(t.hostname)) {
      throw new Error('This workspace is sealed: only a server on this machine can be used.');
    }
    return t;
  }

  return {
    async hasKey(baseUrl) {
      const stored = await storedKey();
      if (!stored) return false;
      if (baseUrl === undefined || baseUrl === null || baseUrl === '') return true;
      try { return parseBaseUrl(baseUrl).origin === stored.origin; } catch { return false; }
    },

    keyRecord(key, baseUrl) {
      if (typeof key !== 'string' || !key.trim()) throw new Error('empty-key');
      return JSON.stringify({ origin: parseBaseUrl(baseUrl).origin, key: key.trim() });
    },

    async listModels(baseUrl) {
      let t;
      try { t = target(baseUrl); } catch (err) { return { ok: false, error: err.message }; }
      let res;
      try {
        res = await doFetch(`${t.base}/models`, {
          method: 'GET',
          headers: await headersFor(t.origin, {}),
          signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
        });
      } catch (err) {
        return { ok: false, error: describeFetchError(err, t.base) };
      }
      const text = await res.text().catch(() => '');
      if (!res.ok) return { ok: false, error: describeHttpError(res.status, text, t.base) };
      try {
        const json = JSON.parse(text);
        const data = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : (json && Array.isArray(json.models) ? json.models : null));
        if (!data) return { ok: false, error: `The server at ${t.base} answered /models without a model list.` };
        return { ok: true, data };
      } catch {
        return { ok: false, error: `The server at ${t.base} answered /models with something other than JSON. Check that the URL ends in /v1.` };
      }
    },

    /** Stream one completion; onData gets raw SSE text. Resolves at the end, throws a readable Error. */
    async streamChat(baseUrl, body, signal, onData) {
      const t = target(baseUrl);
      let res;
      try {
        res = await doFetch(`${t.base}/chat/completions`, {
          method: 'POST',
          headers: await headersFor(t.origin, { 'content-type': 'application/json', accept: 'text/event-stream' }),
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (signal && signal.aborted) throw err;
        throw new Error(describeFetchError(err, t.base));
      }
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(describeHttpError(res.status, text, t.base));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          onData(decoder.decode(value, { stream: true }));
        }
      } catch (err) {
        if (signal && signal.aborted) throw err;
        throw new Error(describeFetchError(err, t.base));
      }
    },
  };
}

/** requestId → AbortController for in-flight streams. */
const _active = new Map();

function setupOpenAICompatibleBridge(ipcMain, secrets, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('[OpenAICompatibleBridge] ipcMain.handle is required');
  }
  if (!secrets || typeof secrets.readSecret !== 'function'
    || typeof secrets.writeSecret !== 'function' || typeof secrets.deleteSecret !== 'function') {
    throw new Error('[OpenAICompatibleBridge] secrets {readSecret,writeSecret,deleteSecret} are required');
  }
  const client = createOpenAICompatibleClient({ readSecret: secrets.readSecret, isSealed: options.isSealed });

  ipcMain.handle('openaiCompat:hasKey', async (_e, baseUrl) => client.hasKey(baseUrl).catch(() => false));

  ipcMain.handle('openaiCompat:setKey', async (_e, args) => {
    try {
      await secrets.writeSecret(KEY_SECRET, client.keyRecord(args && args.key, args && args.baseUrl));
      return { ok: true };
    } catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });

  ipcMain.handle('openaiCompat:clearKey', async () => {
    try { await secrets.deleteSecret(KEY_SECRET); } catch { /* idempotent */ }
    return { ok: true };
  });

  ipcMain.handle('openaiCompat:models', async (_e, baseUrl) => client.listModels(baseUrl));

  ipcMain.handle('openaiCompat:abort', async (_e, requestId) => {
    const controller = _active.get(requestId);
    if (controller) { try { controller.abort(); } catch { /* already done */ } }
    return { ok: true };
  });

  ipcMain.handle('openaiCompat:start', async (event, args) => {
    const requestId = args && typeof args.requestId === 'string' ? args.requestId : null;
    const body = args && args.body && typeof args.body === 'object' ? args.body : null;
    if (!requestId || !body) return { ok: false, error: 'bad-args' };
    try { parseBaseUrl(args.baseUrl); } catch (err) { return { ok: false, error: err.message }; }

    const controller = new AbortController();
    _active.set(requestId, controller);
    const sender = event.sender;
    const send = (payload) => {
      try { if (sender && !sender.isDestroyed()) sender.send(EVENT_CHANNEL, payload); }
      catch { /* renderer gone */ }
    };

    // Fire and forget: handle() answers at once so the renderer starts listening.
    (async () => {
      try {
        await client.streamChat(args.baseUrl, body, controller.signal, (data) => send({ requestId, type: 'data', data }));
        send({ requestId, type: 'end' });
      } catch (err) {
        if (controller.signal.aborted) send({ requestId, type: 'aborted' });
        else send({ requestId, type: 'error', error: err && err.message ? err.message : String(err) });
      } finally {
        _active.delete(requestId);
      }
    })();
    return { ok: true };
  });
}

/** The renderer's facade, exposed by the preload as parallxElectron.openaiCompatible. */
function openaiCompatiblePreloadApi(ipcRenderer) {
  return {
    hasKey: (baseUrl) => ipcRenderer.invoke('openaiCompat:hasKey', baseUrl),
    setKey: (key, baseUrl) => ipcRenderer.invoke('openaiCompat:setKey', { key, baseUrl }),
    clearKey: () => ipcRenderer.invoke('openaiCompat:clearKey'),
    listModels: (baseUrl) => ipcRenderer.invoke('openaiCompat:models', baseUrl),
    startStream: (requestId, baseUrl, body) => ipcRenderer.invoke('openaiCompat:start', { requestId, baseUrl, body }),
    abortStream: (requestId) => ipcRenderer.invoke('openaiCompat:abort', requestId),
    onStreamEvent: (cb) => {
      const listener = (_e, payload) => { try { cb(payload); } catch { /* consumer error */ } };
      ipcRenderer.on(EVENT_CHANNEL, listener);
      return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener);
    },
  };
}

module.exports = {
  setupOpenAICompatibleBridge,
  openaiCompatiblePreloadApi,
  createOpenAICompatibleClient,
  parseBaseUrl,
  isLoopbackHost,
  describeFetchError,
  describeHttpError,
};
