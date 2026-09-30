// Local models that take pictures in and give pictures back (ONNX).
//
// Chat models answer in text and the upscaler is a sealed program with one
// job, so nothing in Parallx could run a model like LaMa (the image editor's
// Remove, docs/IMAGE_EDITOR.md). This bridge can, for any extension:
//
//   models:status    is the runtime here, and is this model on disk?
//   models:download  fetch a model once, from an allowed host, and keep it
//                    only if its SHA-256 is the one that was asked for
//   models:run       run it in a worker thread (electron/modelWorker.cjs)
//
// What keeps it safe:
//   - A model is named by the SHA-256 of its file. The file on disk is
//     <models>/<sha256>.onnx, so a caller cannot point the runner at any
//     other path, and cannot replace one model with another.
//   - Downloads are https, from ALLOWED_HOSTS only, refused while the
//     workspace is sealed, written to a .part file and renamed only after the
//     size and the hash both match.
//   - The download goes through Chromium's network stack (net.fetch), which
//     trusts what Windows trusts. Node's own TLS does not, and fails behind
//     antivirus that inspects connections.
//   - The model leaves memory after IDLE_MS without a run, so it does not sit
//     on graphics memory a chat model needs.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');

const ALLOWED_HOSTS = new Set(['huggingface.co']);
const MAX_MODEL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const IDLE_MS = 120_000;
const SHA_RE = /^[0-9a-f]{64}$/;

function runtimePresent() {
  try { require.resolve('onnxruntime-node'); return true; } catch { return false; }
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ appRoot: string, getMainWindow: () => any, isSealed: () => boolean, fetch?: Function }} opts
 */
function setupModelBridge(ipcMain, opts) {
  const modelsDir = process.env.PARALLX_MODELS_DIR || path.join(opts.appRoot, 'data', 'models');
  const fileFor = (sha) => path.join(modelsDir, `${sha}.onnx`);
  const send = (payload) => { try { const w = opts.getMainWindow(); if (w && !w.isDestroyed()) w.webContents.send('models:progress', payload); } catch { /* window gone */ } };
  const checkDesc = (desc) => {
    const d = desc && typeof desc === 'object' ? desc : {};
    const sha = String(d.sha256 || '').toLowerCase();
    if (!SHA_RE.test(sha)) return { error: 'A model is named by the SHA-256 of its file.' };
    const bytes = Number(d.bytes);
    if (!(bytes > 0 && bytes <= MAX_MODEL_BYTES)) return { error: 'The model needs a size in bytes.' };
    return { sha, bytes, url: typeof d.url === 'string' ? d.url : '' };
  };
  const present = async (sha, bytes) => {
    try { const st = await fsp.stat(fileFor(sha)); return st.isFile() && st.size === bytes; } catch { return false; }
  };

  ipcMain.handle('models:status', async (_event, desc) => {
    const d = checkDesc(desc);
    if (d.error) return { ok: false, error: d.error };
    return { ok: true, runtime: runtimePresent(), present: await present(d.sha, d.bytes), downloading: downloads.has(d.sha) };
  });

  // ── download ──
  const downloads = new Map();   // sha -> AbortController
  ipcMain.handle('models:download', async (_event, desc) => {
    const d = checkDesc(desc);
    if (d.error) return { ok: false, error: d.error };
    if (await present(d.sha, d.bytes)) return { ok: true, already: true };
    if (downloads.has(d.sha)) return { ok: false, error: 'This model is already being fetched.' };
    if (opts.isSealed && opts.isSealed()) return { ok: false, code: 'SEALED', error: 'This workspace is sealed: nothing is fetched.' };
    let url;
    try { url = new URL(d.url); } catch { return { ok: false, error: 'The model has no usable address.' }; }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return { ok: false, error: `Models are fetched from ${[...ALLOWED_HOSTS].join(', ')} only.` };

    const controller = new AbortController();
    downloads.set(d.sha, controller);
    const part = `${fileFor(d.sha)}.part`;
    let handle = null;
    try {
      await fsp.mkdir(modelsDir, { recursive: true });
      const doFetch = opts.fetch || require('electron').net.fetch;
      const res = await doFetch(url.toString(), { signal: controller.signal, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`The server answered ${res.status}.`);
      handle = await fsp.open(part, 'w');
      const hash = crypto.createHash('sha256');
      let received = 0; let lastSent = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > d.bytes) throw new Error('The file is larger than the model that was asked for.');
        hash.update(value);
        await handle.write(value);
        const now = Date.now();
        if (now - lastSent > 200) { lastSent = now; send({ sha256: d.sha, received, total: d.bytes }); }
      }
      await handle.close(); handle = null;
      if (received !== d.bytes) throw new Error(`The file is ${received} bytes; the model is ${d.bytes}.`);
      if (hash.digest('hex') !== d.sha) throw new Error('The file is not the model that was asked for (its SHA-256 differs). It was not kept.');
      await fsp.rename(part, fileFor(d.sha));
      send({ sha256: d.sha, received, total: d.bytes, done: true });
      return { ok: true };
    } catch (err) {
      if (handle) { try { await handle.close(); } catch { /* closed */ } }
      try { await fsp.rm(part, { force: true }); } catch { /* nothing to remove */ }
      const stopped = controller.signal.aborted;
      send({ sha256: d.sha, received: 0, total: d.bytes, done: true, error: stopped ? 'Stopped.' : (err && err.message) || String(err) });
      return { ok: false, stopped, error: stopped ? 'Stopped.' : (err && err.message) || String(err) };
    } finally {
      downloads.delete(d.sha);
    }
  });
  ipcMain.handle('models:cancelDownload', (_event, sha) => {
    const c = downloads.get(String(sha || '').toLowerCase());
    if (c) c.abort();
    return { ok: !!c };
  });

  // ── run ──
  let worker = null; let nextId = 1; let idle = null;
  const pending = new Map();
  const failAll = (message) => { for (const job of pending.values()) job.resolve({ ok: false, error: message }); pending.clear(); };
  const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(path.join(__dirname, 'modelWorker.cjs'));
    worker.on('message', (msg) => { const job = pending.get(msg.id); if (job) { pending.delete(msg.id); job.resolve(msg); } });
    worker.on('error', (err) => { worker = null; failAll((err && err.message) || 'The model runner stopped.'); });
    worker.on('exit', () => { worker = null; failAll('The model runner stopped.'); });
    worker.unref();
    return worker;
  };
  const call = (msg, transfer) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    ensureWorker().postMessage({ id, ...msg }, transfer || []);
  });
  const rest = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { idle = null; if (worker && pending.size === 0) void call({ op: 'release' }); }, IDLE_MS);
    if (typeof idle.unref === 'function') idle.unref();
  };

  ipcMain.handle('models:run', async (_event, sha256, inputs) => {
    const sha = String(sha256 || '').toLowerCase();
    if (!SHA_RE.test(sha)) return { ok: false, error: 'A model is named by the SHA-256 of its file.' };
    if (!runtimePresent()) return { ok: false, code: 'NO_RUNTIME', error: 'The model runtime is not installed.' };
    if (!fs.existsSync(fileFor(sha))) return { ok: false, code: 'NO_MODEL', error: 'The model has not been fetched yet.' };
    const clean = {}; let total = 0;
    for (const [name, v] of Object.entries(inputs && typeof inputs === 'object' ? inputs : {})) {
      if (!v || !(v.data instanceof Float32Array) || !Array.isArray(v.dims)) return { ok: false, error: `Input "${name}" needs Float32Array data and dims.` };
      const dims = v.dims.map((n) => Math.round(Number(n)));
      if (dims.some((n) => !(n > 0)) || dims.reduce((a, b) => a * b, 1) !== v.data.length) return { ok: false, error: `Input "${name}" does not have the size its dims say.` };
      total += v.data.byteLength;
      clean[name] = { data: v.data, dims };
    }
    if (!Object.keys(clean).length) return { ok: false, error: 'There is nothing to run the model on.' };
    if (total > MAX_INPUT_BYTES) return { ok: false, error: 'The input is too large.' };
    const r = await call({ op: 'run', model: fileFor(sha), inputs: clean });
    rest();
    return r;
  });

  return {
    modelsDir,
    /** Let go of the worker (app quit). */
    dispose() { if (idle) clearTimeout(idle); for (const c of downloads.values()) c.abort(); if (worker) { void worker.terminate(); worker = null; } },
  };
}

module.exports = { setupModelBridge, _internals: { ALLOWED_HOSTS, SHA_RE, runtimePresent } };
