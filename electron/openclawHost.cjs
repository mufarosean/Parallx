/**
 * electron/openclawHost.cjs — M86-W8 sidecar AI runtime scaffold.
 *
 * Spawned by the main process as an Electron utility-process so that
 * openclaw turns, MCP clients, and cron jobs run off the renderer's
 * event loop. This file is the SCAFFOLD only — the actual openclaw
 * migration happens in a follow-up work item. Today the host:
 *
 *   1. Responds to `host:ping` for health checks.
 *   2. Responds to `host:version` so the main process can confirm
 *      compatibility with the renderer's `OpenclawProxy`.
 *   3. Echoes `host:echo` payloads so end-to-end channel tests can
 *      exercise the round-trip without depending on real openclaw.
 *
 * The protocol is request/response by `{ id, kind, payload }`. The
 * main process owns the MessagePort that the renderer holds the other
 * end of, so streaming responses (e.g. token streams) can later be
 * delivered with `{ id, kind: 'stream', chunk }` events terminated by
 * `{ id, kind: 'end' }`. The renderer side is `src/services/openclawProxy.ts`.
 *
 * Stays a CommonJS module on purpose: utilityProcess loads .cjs
 * directly without an ESM loader hook.
 */

'use strict';

const HOST_VERSION = '0.1.0-scaffold';

const _handlers = Object.create(null);

function registerHandler(kind, handler) {
  _handlers[kind] = handler;
}

registerHandler('host:ping', () => ({ ok: true, pong: Date.now() }));

registerHandler('host:version', () => ({ ok: true, version: HOST_VERSION }));

registerHandler('host:echo', (payload) => ({ ok: true, payload: payload ?? null }));

async function _dispatch(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string' || typeof msg.kind !== 'string') {
    return;
  }
  const handler = _handlers[msg.kind];
  if (typeof handler !== 'function') {
    process.parentPort?.postMessage({ id: msg.id, ok: false, error: 'EUNKNOWN_KIND', kind: msg.kind });
    return;
  }
  try {
    const result = await handler(msg.payload);
    process.parentPort?.postMessage({ id: msg.id, ...result });
  } catch (err) {
    process.parentPort?.postMessage({
      id: msg.id,
      ok: false,
      error: err && err.message ? String(err.message) : String(err),
    });
  }
}

if (process.parentPort && typeof process.parentPort.on === 'function') {
  process.parentPort.on('message', (event) => {
    // Electron wraps the payload in { data }; node:worker_threads uses raw.
    const msg = event && Object.prototype.hasOwnProperty.call(event, 'data') ? event.data : event;
    void _dispatch(msg);
  });
  // Announce readiness so the main process can resolve its fork promise.
  process.parentPort.postMessage({ id: 'host:ready', ok: true, version: HOST_VERSION });
}

module.exports = { HOST_VERSION, _dispatch, _handlers };
