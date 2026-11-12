// doclingRuntime.test.ts — the document reader's engine as a tool runtime:
// its declaration passes the runtime bridge's own check, every package and
// every model file is pinned by hash, and no address is a moving branch.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const appRoot = resolve(__dirname, '..', '..');
const { doclingRuntimeSpec, RUNTIME_ID, PACKAGE_BYTES } = require('../../electron/doclingRuntime.cjs');
const { checkSpec, ALLOWED_FILE_HOSTS } = require('../../electron/runtimeBridge.cjs')._internals;

const spec = doclingRuntimeSpec(appRoot);
const dir = join(appRoot, 'tools', 'docling-bridge');
const models: { name: string; path: string; url: string; bytes: number; sha256: string }[] =
  JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8')).files;

describe('the document reader\'s runtime', () => {
  it('declares an engine the runtime bridge accepts', () => {
    expect(spec.id).toBe(RUNTIME_ID);
    expect(spec.python).toMatch(/^3\.\d+\.\d+$/);
    expect(PACKAGE_BYTES).toBeGreaterThan(1024 ** 3);
    // The bridge checks the lock for the platform it runs on; Windows is the one declared.
    const forWindows = { ...spec, locks: { [process.platform]: spec.locks.win32 } };
    const checked = checkSpec(forWindows, appRoot);
    if (['win32-x64', 'linux-x64'].includes(`${process.platform}-${process.arch}`)) {
      expect(checked.error).toBeUndefined();
      expect(checked.spec.files).toHaveLength(models.length);
    }
  });

  it('pins every package by hash, from PyPI and the PyTorch index only', () => {
    const lock = readFileSync(spec.locks.win32, 'utf8');
    const pins = lock.split(/\r?\n/).filter((l) => /^[A-Za-z0-9_.\-[\]]+==/.test(l));
    expect(pins.length).toBeGreaterThan(50);
    // Each pinned package is followed by at least one hash before the next one.
    const blocks = lock.split(/\r?\n(?=[A-Za-z0-9_.\-[\]]+==)/).slice(1);
    for (const block of blocks) expect(block).toMatch(/--hash=sha256:[0-9a-f]{64}/);
    const indexes = lock.split(/\r?\n/).filter((l) => /^--(extra-)?index-url /.test(l)).map((l) => l.split(' ')[1]);
    expect(indexes.sort()).toEqual(['https://download.pytorch.org/whl/cu128', 'https://pypi.org/simple']);
    expect(lock).toMatch(/^docling==\d/m);
  });

  it('pins every model file: an allowed host, a fixed revision, a size and a SHA-256', () => {
    expect(models.length).toBeGreaterThan(10);
    const names = new Set<string>();
    for (const m of models) {
      const url = new URL(m.url);
      expect(url.protocol).toBe('https:');
      expect(ALLOWED_FILE_HOSTS.has(url.hostname)).toBe(true);
      // Never a branch that can move under us.
      expect(m.url).not.toMatch(/\/resolve\/(main|master)\//);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.bytes).toBeGreaterThan(0);
      expect(m.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/);
      expect(m.path).not.toMatch(/\.\.|^[\\/]|:/);
      expect(names.has(m.name)).toBe(false);
      names.add(m.name);
    }
  });

  it('has the files the reader loads: layout, tables, formulas, and the scan reader', () => {
    const paths = models.map((m) => m.path);
    expect(paths).toContain('docling-project--docling-layout-heron/model.safetensors');
    expect(paths).toContain('docling-project--docling-models/model_artifacts/tableformer/accurate/tableformer_accurate.safetensors');
    expect(paths).toContain('docling-project--CodeFormulaV2/model.safetensors');
    expect(paths.filter((p) => p.startsWith('RapidOcr/') && p.endsWith('.onnx'))).toHaveLength(3);
  });
});
