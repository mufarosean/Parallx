// Runs ONNX models off the main thread (electron/modelBridge.cjs owns this
// worker). One session per model file, kept until the bridge says release.
//
// The graphics card is reached through the runtime's WebGPU provider; its
// DirectML provider fails on models with Fourier layers (LaMa), measured
// 2026-09-28. A model that will not load or run there falls back to the
// processor, once, and stays there.
//
// in:  { id, op: 'run', model, data: [{ path, name }], inputs: { name: { data, dims: number[], type } } }
//      (data: the model's weights files, read once when it is opened; type float32, int64 or int32)
//      { id, op: 'release' }
// out: { id, ok: true, outputs: { name: { data: Float32Array, dims } }, provider, ms, loadMs }
//      { id, ok: false, error }
'use strict';
const { parentPort } = require('worker_threads');
const fs = require('node:fs');

let ort = null;
const sessions = new Map();   // model path -> { session, provider, loadMs }

async function open(model, providers, data) {
  if (!ort) ort = require('onnxruntime-node');
  // The weights go in as bytes under the name the model refers to them by: the runtime reads no path of ours.
  const externalData = (data || []).map((d) => { const b = fs.readFileSync(d.path); return { path: d.name, data: new Uint8Array(b.buffer, b.byteOffset, b.length) }; });
  let last = null;
  for (const provider of providers) {
    try {
      const t = Date.now();
      const session = await ort.InferenceSession.create(model, { executionProviders: [provider], logSeverityLevel: 3, ...(externalData.length ? { externalData } : {}) });
      return { session, provider, loadMs: Date.now() - t };
    } catch (err) { last = err; }
  }
  throw last || new Error('The model could not be loaded.');
}

async function release(entry) {
  try { if (entry && entry.session && typeof entry.session.release === 'function') await entry.session.release(); } catch { /* gone */ }
}

async function run(model, inputs, data) {
  let entry = sessions.get(model);
  let loadMs = 0;
  if (!entry) { entry = await open(model, ['webgpu', 'cpu'], data); sessions.set(model, entry); loadMs = entry.loadMs; }
  const feeds = () => {
    const f = {};
    for (const [name, v] of Object.entries(inputs)) f[name] = new ort.Tensor(v.type || 'float32', v.data, v.dims);
    return f;
  };
  const t = Date.now();
  let result;
  try {
    result = await entry.session.run(feeds());
  } catch (err) {
    if (entry.provider === 'cpu') throw err;
    await release(entry);
    entry = await open(model, ['cpu'], data);
    sessions.set(model, entry);
    loadMs += entry.loadMs;
    result = await entry.session.run(feeds());
  }
  const outputs = {};
  for (const [name, tensor] of Object.entries(result)) {
    const d = tensor.data;
    outputs[name] = { data: d instanceof Float32Array ? d : Float32Array.from(d, Number), dims: Array.from(tensor.dims) };
  }
  return { outputs, provider: entry.provider, ms: Date.now() - t, loadMs };
}

parentPort.on('message', async (msg) => {
  const id = msg && msg.id;
  try {
    if (msg.op === 'release') {
      for (const entry of sessions.values()) await release(entry);
      sessions.clear();
      parentPort.postMessage({ id, ok: true });
      return;
    }
    if (msg.op === 'run') {
      const r = await run(msg.model, msg.inputs, msg.data);
      parentPort.postMessage({ id, ok: true, ...r });
      return;
    }
    parentPort.postMessage({ id, ok: false, error: `unknown op ${msg.op}` });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
});
