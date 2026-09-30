/**
 * The local model bridge (electron/modelBridge.cjs): what it agrees to fetch,
 * what it keeps, and what it refuses to run. Running a model itself is covered
 * in the real app by tests/probes/image-editor-probe.mjs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { setupModelBridge } = require('../../electron/modelBridge.cjs');

const BYTES = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
const SHA = createHash('sha256').update(BYTES).digest('hex');
const URL_OK = 'https://huggingface.co/some/model/resolve/main/model.onnx';

interface Harness {
  call: (name: string, ...args: unknown[]) => Promise<any>;
  models: string;
  progress: any[];
  fetched: string[];
  sealed: { value: boolean };
  serve: { bytes: Uint8Array; status: number };
}

let root = '';
let savedEnv: string | undefined;

function harness(): Harness {
  const handlers: Record<string, (...a: any[]) => any> = {};
  const progress: any[] = [];
  const fetched: string[] = [];
  const sealed = { value: false };
  const serve = { bytes: BYTES, status: 200 };
  const bridge = setupModelBridge({ handle: (n: string, fn: any) => { handlers[n] = fn; } }, {
    appRoot: root,
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (_c: string, p: any) => progress.push(p) } }),
    isSealed: () => sealed.value,
    fetch: async (url: string) => { fetched.push(url); return new Response(serve.bytes, { status: serve.status }); },
  });
  return { call: (name, ...args) => Promise.resolve(handlers[name]({}, ...args)), models: bridge.modelsDir, progress, fetched, sealed, serve };
}

beforeEach(() => {
  savedEnv = process.env.PARALLX_MODELS_DIR;
  delete process.env.PARALLX_MODELS_DIR;
  root = mkdtempSync(join(tmpdir(), 'parallx-models-'));
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.PARALLX_MODELS_DIR; else process.env.PARALLX_MODELS_DIR = savedEnv;
  rmSync(root, { recursive: true, force: true });
});

describe('naming a model', () => {
  it('keeps models under the app folder, named by their hash', async () => {
    const h = harness();
    expect(h.models).toBe(join(root, 'data', 'models'));
    const st = await h.call('models:status', { sha256: SHA, bytes: BYTES.length });
    expect(st).toMatchObject({ ok: true, present: false, downloading: false });
    expect(typeof st.runtime).toBe('boolean');
  });
  it('refuses a model that is not named by a SHA-256 and a size', async () => {
    const h = harness();
    for (const desc of [null, {}, { sha256: 'abc', bytes: 10 }, { sha256: '../../evil', bytes: 10 }, { sha256: SHA, bytes: 0 }, { sha256: SHA }, { sha256: SHA, bytes: 5e12 }]) {
      expect((await h.call('models:status', desc)).ok).toBe(false);
      expect((await h.call('models:download', desc)).ok).toBe(false);
    }
    expect(h.fetched).toEqual([]);
  });
  it('a file of another size is not the model', async () => {
    const h = harness();
    mkdirSync(h.models, { recursive: true });
    writeFileSync(join(h.models, `${SHA}.onnx`), BYTES.subarray(0, 100));
    expect((await h.call('models:status', { sha256: SHA, bytes: BYTES.length })).present).toBe(false);
  });
});

describe('fetching a model', () => {
  it('keeps the file when its size and hash are the ones asked for', async () => {
    const h = harness();
    const res = await h.call('models:download', { url: URL_OK, sha256: SHA.toUpperCase(), bytes: BYTES.length });
    expect(res).toEqual({ ok: true });
    expect(h.fetched).toEqual([URL_OK]);
    expect(readdirSync(h.models)).toEqual([`${SHA}.onnx`]);
    expect(Buffer.compare(readFileSync(join(h.models, `${SHA}.onnx`)), Buffer.from(BYTES))).toBe(0);
    expect(h.progress[h.progress.length - 1]).toMatchObject({ sha256: SHA, received: BYTES.length, total: BYTES.length, done: true });
    expect((await h.call('models:status', { sha256: SHA, bytes: BYTES.length })).present).toBe(true);
    // asked again, it is not fetched again
    expect(await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length })).toEqual({ ok: true, already: true });
    expect(h.fetched.length).toBe(1);
  });
  it('throws away a file whose hash differs', async () => {
    const h = harness();
    h.serve.bytes = BYTES.map((b) => b ^ 1);
    const res = await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/SHA-256/);
    expect(readdirSync(h.models)).toEqual([]);
    expect(h.progress[h.progress.length - 1]).toMatchObject({ done: true });
    expect(h.progress[h.progress.length - 1].error).toBeTruthy();
  });
  it('throws away a file that is shorter or longer than the model', async () => {
    const h = harness();
    h.serve.bytes = BYTES.subarray(0, 4000);
    expect((await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length })).ok).toBe(false);
    h.serve.bytes = new Uint8Array(6000);
    const long = await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length });
    expect(long.ok).toBe(false);
    expect(long.error).toMatch(/larger/);
    expect(readdirSync(h.models)).toEqual([]);
  });
  it('gives up when the server refuses', async () => {
    const h = harness();
    h.serve.status = 404;
    const res = await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/404/);
    expect(readdirSync(h.models)).toEqual([]);
  });
  it('fetches over https from an allowed host only', async () => {
    const h = harness();
    for (const url of ['http://huggingface.co/x.onnx', 'https://example.com/x.onnx', 'https://huggingface.co.evil.test/x.onnx', 'file:///c:/x.onnx', 'not a url', '']) {
      const res = await h.call('models:download', { url, sha256: SHA, bytes: BYTES.length });
      expect(res.ok).toBe(false);
    }
    expect(h.fetched).toEqual([]);
    expect(existsSync(join(h.models, `${SHA}.onnx`))).toBe(false);
  });
  it('fetches nothing while the workspace is sealed', async () => {
    const h = harness();
    h.sealed.value = true;
    const res = await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length });
    expect(res).toMatchObject({ ok: false, code: 'SEALED' });
    expect(h.fetched).toEqual([]);
    h.sealed.value = false;
    expect((await h.call('models:download', { url: URL_OK, sha256: SHA, bytes: BYTES.length })).ok).toBe(true);
  });
});

describe('running a model', () => {
  it('runs only a model that is on disk under its own hash', async () => {
    const h = harness();
    const input = { image: { data: new Float32Array(12), dims: [1, 3, 2, 2] } };
    expect((await h.call('models:run', '../../windows/system32/evil', input)).ok).toBe(false);
    expect((await h.call('models:run', 'C:\\some\\file.onnx', input)).ok).toBe(false);
    const missing = await h.call('models:run', SHA, input);
    expect(missing.ok).toBe(false);
    expect(['NO_MODEL', 'NO_RUNTIME']).toContain(missing.code);
  });
  it('checks the input against the size its dims say', async () => {
    const h = harness();
    mkdirSync(h.models, { recursive: true });
    writeFileSync(join(h.models, `${SHA}.onnx`), BYTES);
    const st = await h.call('models:status', { sha256: SHA, bytes: BYTES.length });
    if (!st.runtime) return;   // the runtime is not installed here: the run is refused before the input is looked at
    expect((await h.call('models:run', SHA, {})).ok).toBe(false);
    expect((await h.call('models:run', SHA, { image: { data: [1, 2, 3], dims: [3] } })).ok).toBe(false);
    expect((await h.call('models:run', SHA, { image: { data: new Float32Array(12), dims: [1, 3, 4, 4] } })).ok).toBe(false);
    expect((await h.call('models:run', SHA, { image: { data: new Float32Array(12), dims: [1, 3, 2, -2] } })).ok).toBe(false);
  });
});
