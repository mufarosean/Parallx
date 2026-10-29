// appVersion.test.ts — the version the app shows is package.json's, and every
// built-in and extension manifest still accepts it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { PARALLX_VERSION, validateManifest } from '../../src/tools/toolValidator';

const ROOT = resolve(__dirname, '..', '..');

describe('the app version', () => {
  it('is package.json\'s', () => {
    expect(PARALLX_VERSION).toBe(JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version);
  });

  it('every extension manifest accepts it', () => {
    for (const f of globSync('ext/*/parallx-manifest.json', { cwd: ROOT })) {
      const manifest = JSON.parse(readFileSync(resolve(ROOT, f), 'utf8'));
      const errors = validateManifest(manifest).errors.filter((e) => /version|engine/i.test(`${e.path ?? ''} ${e.message}`));
      expect(errors, f).toEqual([]);
    }
  });
});
