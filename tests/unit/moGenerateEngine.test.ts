// moGenerateEngine.test.ts — Generate's engine (ext/media-organizer/
// generate-engine.js): its declaration passes the runtime bridge's own check,
// every package and every model file is pinned by hash, progress lines turn
// into words, and a run reports what the script said.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error — JS module with no types
import { moGenerateActivate, moGenerateDownloadBytes, moGenerateProgress, moGenerateRun, moGenerateSpec } from '../../ext/media-organizer/generate-engine.js';

const require = createRequire(import.meta.url);
const appRoot = resolve(__dirname, '..', '..');
const extDir = join(appRoot, 'ext', 'media-organizer');
const { checkSpec, ALLOWED_FILE_HOSTS } = require('../../electron/runtimeBridge.cjs')._internals;
const models: { name: string; path: string; url: string; bytes: number; sha256: string }[] =
  JSON.parse(readFileSync(join(extDir, 'engine', 'generate-models.json'), 'utf8')).files;

type Listener = (p: unknown) => void;
let listener: Listener | null = null;
let invoke: ReturnType<typeof vi.fn>;
let active: { dispose(): void } | null = null;

beforeEach(() => {
  listener = null;
  invoke = vi.fn();
  (globalThis as { window?: unknown }).window = {
    parallxElectron: { optionalBridges: { invoke, on: (_c: string, cb: Listener) => { listener = cb; return () => { listener = null; }; } } },
  };
  active = moGenerateActivate(extDir)[0];
});
afterEach(() => {
  active?.dispose();
  delete (globalThis as { window?: unknown }).window;
});

describe('Generate\'s runtime', () => {
  it('fetches exactly the files the script lays out', () => {
    expect(moGenerateSpec().files).toEqual(models.map((m) => ({ name: m.name, url: m.url, bytes: m.bytes, sha256: m.sha256 })));
  });

  it('declares an engine the runtime bridge accepts', () => {
    const spec = moGenerateSpec();
    expect(spec.files).toHaveLength(models.length);
    expect(spec.needs.gpu).toBe('nvidia');
    const here = { ...spec, locks: { [process.platform]: spec.locks.win32 } };
    if (['win32-x64', 'linux-x64'].includes(`${process.platform}-${process.arch}`)) {
      const checked = checkSpec(here, appRoot);
      expect(checked.error).toBeUndefined();
      expect(checked.spec.selftest.script.endsWith('selftest-generate.py')).toBe(true);
    }
    expect(moGenerateDownloadBytes()).toBeGreaterThan(30 * 1024 ** 3);
  });

  it('pins every model file: an allowed host, a fixed revision, a size and a SHA-256', () => {
    expect(models.length).toBe(24);
    const names = new Set<string>();
    for (const m of models) {
      const url = new URL(m.url);
      expect(ALLOWED_FILE_HOSTS.has(url.hostname)).toBe(true);
      expect(m.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.bytes).toBeGreaterThan(0);
      expect(m.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/);
      expect(m.path).not.toMatch(/\.\.|^[\\/]|:/);
      expect(names.has(m.name)).toBe(false);
      names.add(m.name);
    }
    const paths = models.map((m) => m.path);
    for (const needed of ['model_index.json', 'processor/chat_template.jinja', 'vae/diffusion_pytorch_model.safetensors']) expect(paths).toContain(needed);
    expect(paths.filter((p) => p.startsWith('text_encoder/model-')).length).toBe(4);
    expect(paths.filter((p) => p.startsWith('transformer/diffusion_pytorch_model-')).length).toBe(2);
  });

  it('pins every package by hash', () => {
    const lock = readFileSync(join(extDir, 'engine', 'requirements-generate-win.lock'), 'utf8');
    const blocks = lock.split(/\r?\n(?=[A-Za-z0-9_.\-[\]]+==)/).slice(1);
    expect(blocks.length).toBeGreaterThan(30);
    for (const block of blocks) expect(block).toMatch(/--hash=sha256:[0-9a-f]{64}/);
    expect(lock).toMatch(/^diffusers==0\.43\.0/m);
    expect(lock).toMatch(/^torch==[\d.]+\+cu128/m);
  });
});

describe('progress', () => {
  it('puts each stage into words', () => {
    expect(moGenerateProgress({ stage: 'load' }).label).toBe('Loading the model');
    expect(moGenerateProgress({ stage: 'prompt' }).label).toBe('Writing the instruction out');
    expect(moGenerateProgress({ stage: 'smaller' }).label).toBe('Trying a smaller size');
    expect(moGenerateProgress({ stage: 'try', try: 1, of: 3 }).label).toBe('Laying it back');
    expect(moGenerateProgress({ stage: 'tried', try: 1, of: 3 }).fraction).toBe(moGenerateProgress({ stage: 'try', try: 1, of: 3 }).fraction);
    expect(moGenerateProgress({ stage: 'generate', try: 1, of: 1, step: 20, steps: 40 })).toEqual({ label: 'Generating', fraction: 0.05 + 0.93 * 0.5 });
    expect(moGenerateProgress({ stage: 'generate', try: 2, of: 3, step: 40, steps: 40 }).label).toBe('Generating 2 of 3');
    expect(moGenerateProgress({ stage: 'done' })).toEqual({ label: 'Done', fraction: 1 });
    expect(moGenerateProgress(null).fraction).toBe(0);
  });

  it('only ever moves forward through a run of three tries', () => {
    let last = 0;
    const next = (d: unknown) => { const f = moGenerateProgress(d).fraction; expect(f).toBeGreaterThanOrEqual(last); last = f; };
    next({ stage: 'load' });
    next({ stage: 'prompt' });
    for (let t = 1; t <= 3; t++) {
      for (let s = 1; s <= 40; s++) next({ stage: 'generate', try: t, of: 3, step: s, steps: 40 });
      next({ stage: 'try', try: t, of: 3 });
      next({ stage: 'tried', try: t, of: 3 });
    }
    expect(last).toBeLessThanOrEqual(1);
  });
});

describe('a run', () => {
  it('runs the script on the job and returns what it wrote', async () => {
    invoke.mockImplementation(async (channel: string, _spec: unknown, script: string, args: string[], runId: string) => {
      expect(channel).toBe('runtimes:run');
      expect(script.endsWith('generate.py')).toBe(true);
      expect(args).toEqual(['--job', 'C:/w/job.json']);
      listener?.({ id: 'qwen-image-generate', kind: 'run', runId, data: { stage: 'generate', try: 1, of: 1, step: 1, steps: 40 } });
      listener?.({ id: 'some-other-engine', kind: 'run', runId, data: { stage: 'done' } });
      listener?.({ id: 'qwen-image-generate', kind: 'run', runId, data: { stage: 'done', prompt: 'Remove the hay bale on the left.', prompt_by: 'engine', note: '', tries: [{ file: 'try-1.png', small: 'try-1-small.png', box: [10, 20, 110, 220], seconds: 77, held_db: 38.5 }], peak_gb: 19.1, model_size: [1024, 1024] } });
      return { ok: true };
    });
    const seen: string[] = [];
    const r = await moGenerateRun('C:/w/job.json', (p: { label: string }) => seen.push(p.label));
    expect(r).toEqual({ tries: [{ file: 'try-1.png', small: 'try-1-small.png', box: [10, 20, 110, 220], seconds: 77, held_db: 38.5 }], prompt: 'Remove the hay bale on the left.', promptBy: 'engine', note: '', peakGb: 19.1, modelSize: [1024, 1024] });
    expect(seen).toEqual(['Generating', 'Done']);
  });

  it('says what the script said when it fails, in the script\'s own sentence', async () => {
    invoke.mockResolvedValue({ ok: false, code: 'FAILED', stderr: 'noise\nGENERATE-ERROR: Generate needs about 21 GB of free graphics memory; 9 GB is free. Set the chat model aside and try again.\n' });
    await expect(moGenerateRun('C:/w/job.json')).rejects.toThrow('Generate needs about 21 GB of free graphics memory; 9 GB is free. Set the chat model aside and try again.');
  });

  it('says it is not set up, or that it was stopped', async () => {
    invoke.mockResolvedValueOnce({ ok: false, code: 'NOT_READY', error: 'It is not set up yet.' });
    await expect(moGenerateRun('C:/w/job.json')).rejects.toThrow('Generate is not set up yet.');
    invoke.mockResolvedValueOnce({ ok: false, stopped: true, error: 'Stopped.' });
    await expect(moGenerateRun('C:/w/job.json')).rejects.toMatchObject({ stopped: true });
  });
});
