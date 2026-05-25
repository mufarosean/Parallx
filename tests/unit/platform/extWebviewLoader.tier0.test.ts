// extWebviewLoader.tier0.test.ts — M86-W9
//
// Tier-0 covers the pure resolver / partition / crash-handler logic.
// Loader is CJS so we require() it; the test runs under node env via
// vitest.tier0.config.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loader = require('../../../electron/extWebviewLoader.cjs');

function _mkExt(dir: string, manifest: unknown, opts?: { html?: boolean; preload?: boolean }) {
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) {
    fs.writeFileSync(path.join(dir, 'parallx-manifest.json'), JSON.stringify(manifest));
  }
  if (opts?.html) {
    fs.mkdirSync(path.join(dir, 'webview'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'webview', 'index.html'), '<html></html>');
  }
  if (opts?.preload) {
    fs.writeFileSync(path.join(dir, 'webview', 'preload.cjs'), '');
  }
}

describe('M86-W9 extWebviewLoader.partitionFor', () => {
  it('returns a persist:ext- prefixed partition', () => {
    expect(loader.partitionFor('parallx.example')).toBe('persist:ext-parallx.example');
  });
  it('sanitises non-identifier chars into hyphens', () => {
    expect(loader.partitionFor('foo/bar*baz')).toBe('persist:ext-foo-bar-baz');
  });
  it('throws on empty or non-string id', () => {
    expect(() => loader.partitionFor('')).toThrow();
    expect(() => loader.partitionFor(42 as unknown as string)).toThrow();
  });
});

describe('M86-W9 extWebviewLoader.resolveWebviewDescriptor', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm86-w9-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns null when the directory does not exist', () => {
    expect(loader.resolveWebviewDescriptor(path.join(tmp, 'nope'))).toBeNull();
  });

  it('returns null when no parallx-manifest.json is present', () => {
    fs.mkdirSync(path.join(tmp, 'ext-a'));
    expect(loader.resolveWebviewDescriptor(path.join(tmp, 'ext-a'))).toBeNull();
  });

  it('returns null when manifest is not valid JSON', () => {
    const d = path.join(tmp, 'ext-bad');
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'parallx-manifest.json'), '{not json');
    expect(loader.resolveWebviewDescriptor(d)).toBeNull();
  });

  it('returns null when manifest lacks an id', () => {
    const d = path.join(tmp, 'ext-noid');
    _mkExt(d, { name: 'No Id' }, { html: true });
    expect(loader.resolveWebviewDescriptor(d)).toBeNull();
  });

  it('returns null when the extension has no webview/index.html (in-process ext)', () => {
    const d = path.join(tmp, 'ext-inproc');
    _mkExt(d, { id: 'parallx.inproc', name: 'In Process' });
    expect(loader.resolveWebviewDescriptor(d)).toBeNull();
  });

  it('resolves a full descriptor when html is present, no preload', () => {
    const d = path.join(tmp, 'ext-min');
    _mkExt(d, { id: 'parallx.min', name: 'Min' }, { html: true });
    const desc = loader.resolveWebviewDescriptor(d);
    expect(desc).toEqual({
      schemaVersion: 1,
      id: 'parallx.min',
      name: 'Min',
      htmlPath: path.join(d, 'webview', 'index.html'),
      preloadPath: null,
      partition: 'persist:ext-parallx.min',
    });
  });

  it('attaches preloadPath when preload.cjs exists', () => {
    const d = path.join(tmp, 'ext-pre');
    _mkExt(d, { id: 'parallx.pre' }, { html: true, preload: true });
    const desc = loader.resolveWebviewDescriptor(d);
    expect(desc.preloadPath).toBe(path.join(d, 'webview', 'preload.cjs'));
    // Falls back to id when name is missing.
    expect(desc.name).toBe('parallx.pre');
  });
});

describe('M86-W9 extWebviewLoader.makeCrashHandler', () => {
  const desc = { id: 'x', name: 'X' };

  it('throws when descriptor or callback is missing', () => {
    expect(() => loader.makeCrashHandler(null, () => {})).toThrow();
    expect(() => loader.makeCrashHandler(desc, null)).toThrow();
  });

  it('invokes onCrash with extId + reason + normalised event', () => {
    const onCrash = vi.fn();
    const handler = loader.makeCrashHandler(desc, onCrash);
    handler({ type: 'crashed' }, 'segfault');
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash.mock.calls[0][0]).toEqual({
      extId: 'x',
      name: 'X',
      reason: 'segfault',
      event: { type: 'crashed' },
    });
  });

  it('is one-shot — second call is suppressed', () => {
    const onCrash = vi.fn();
    const handler = loader.makeCrashHandler(desc, onCrash);
    handler({ type: 'crashed' }, 'a');
    handler({ type: 'gpu-crashed' }, 'b');
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it('coerces non-string reasons to "unknown"', () => {
    const onCrash = vi.fn();
    const handler = loader.makeCrashHandler(desc, onCrash);
    handler({ type: 'crashed' }, undefined);
    expect(onCrash.mock.calls[0][0].reason).toBe('unknown');
  });

  it('swallows onCrash errors so the shell does not crash with the ext', () => {
    const onCrash = vi.fn(() => { throw new Error('boom'); });
    const handler = loader.makeCrashHandler(desc, onCrash);
    expect(() => handler({ type: 'crashed' }, 'segfault')).not.toThrow();
  });
});
