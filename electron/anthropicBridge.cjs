// electron/anthropicBridge.cjs — main-process proxy for the Claude (Anthropic)
// Messages API.
//
// Why this lives in the main process (not the renderer):
//   • The API key must never enter the renderer — it stays in main + safeStorage
//     (same contract as googleSyncBridge.cjs / the Brave key in webFetchBridge).
//   • api.anthropic.com doesn't emit CORS headers a renderer `fetch` would need.
//
// Surface (all under `anthropic:*`):
//   anthropic:hasKey / setKey / clearKey  — key management (safeStorage)
//   anthropic:start  { requestId, body }  — begin a streaming /v1/messages call;
//                                            raw SSE text is relayed to the
//                                            renderer as `anthropic:event` pushes
//                                            ({ requestId, type:'data'|'end'|
//                                              'error'|'aborted', ... }).
//   anthropic:abort  requestId            — cancel an in-flight request.
//
// The renderer builds the request body and decodes the SSE — this file is a thin
// authenticated pipe, host-locked to api.anthropic.com.

const ANTHROPIC_KEY_SECRET = 'anthropic.api_key';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** requestId → AbortController for in-flight streams. */
const _active = new Map();

function setupAnthropicBridge(ipcMain, secrets) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('[AnthropicBridge] ipcMain.handle is required');
  }
  if (!secrets
    || typeof secrets.readSecret !== 'function'
    || typeof secrets.writeSecret !== 'function'
    || typeof secrets.deleteSecret !== 'function') {
    throw new Error('[AnthropicBridge] secrets {readSecret,writeSecret,deleteSecret} are required');
  }

  ipcMain.handle('anthropic:hasKey', async () => {
    try { return !!(await secrets.readSecret(ANTHROPIC_KEY_SECRET)); }
    catch { return false; }
  });

  ipcMain.handle('anthropic:setKey', async (_event, key) => {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'empty-key' };
    try { await secrets.writeSecret(ANTHROPIC_KEY_SECRET, key.trim()); return { ok: true }; }
    catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });

  ipcMain.handle('anthropic:clearKey', async () => {
    try { await secrets.deleteSecret(ANTHROPIC_KEY_SECRET); } catch { /* idempotent */ }
    return { ok: true };
  });

  ipcMain.handle('anthropic:abort', async (_event, requestId) => {
    const controller = _active.get(requestId);
    if (controller) { try { controller.abort(); } catch { /* already done */ } }
    return { ok: true };
  });

  ipcMain.handle('anthropic:start', async (event, args) => {
    const requestId = args && typeof args.requestId === 'string' ? args.requestId : null;
    const body = args && args.body && typeof args.body === 'object' ? args.body : null;
    if (!requestId || !body) return { ok: false, error: 'bad-args' };

    const key = await secrets.readSecret(ANTHROPIC_KEY_SECRET).catch(() => null);
    if (!key) return { ok: false, error: 'no-api-key' };

    const controller = new AbortController();
    _active.set(requestId, controller);

    const sender = event.sender;
    const send = (payload) => {
      try { if (sender && !sender.isDestroyed()) sender.send('anthropic:event', payload); }
      catch { /* renderer gone */ }
    };

    // Fire-and-forget: stream the response back over IPC. The handle() call
    // returns { ok: true } immediately so the renderer can start listening.
    (async () => {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          send({ requestId, type: 'error', error: `Anthropic API HTTP ${res.status}${text ? ': ' + text.slice(0, 800) : ''}` });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          send({ requestId, type: 'data', data: decoder.decode(value, { stream: true }) });
        }
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

module.exports = { setupAnthropicBridge };
