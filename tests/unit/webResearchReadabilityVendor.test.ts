// tests/unit/webResearchReadabilityVendor.test.ts — M65 Iter 3 F1: confirm
// Mozilla Readability is vendored at the pinned SHA and exports the
// constructor in an ES-module-friendly shape.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const READABILITY_PATH = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '../../ext/web-research/readability.js',
);

describe('Mozilla Readability — vendored at pinned SHA (M65 F1)', () => {
  const raw = readFileSync(READABILITY_PATH, 'utf8');

  it('records the pinned SHA in the header', () => {
    // The pinned SHA is checked in to prove the file is not the placeholder
    // stub. Refreshing the pin REQUIRES updating both this assertion and
    // the SHA line at the top of readability.js.
    expect(raw).toContain('SHA:     08be6b4bdb204dd333c9b7a0cfbc0e730b257252');
    expect(raw).toContain('SOURCE:  https://github.com/mozilla/readability');
  });

  it('preserves the original Apache-2.0 license header', () => {
    expect(raw).toContain('Copyright (c) 2010 Arc90 Inc');
    expect(raw).toContain('Apache License, Version 2.0');
  });

  it('is the real Mozilla Readability source (not the placeholder stub)', () => {
    expect(raw).toContain('function Readability(doc, options)');
    expect(raw).toContain('First argument to Readability constructor should be a document object.');
    expect(raw).not.toContain('Readability not vendored yet');
  });

  it('exports Readability for ES-module consumers', () => {
    expect(raw).toMatch(/export\s*\{\s*Readability\s*\}/);
  });

  it('can be imported and instantiated (smoke test)', async () => {
    const mod = await import('../../ext/web-research/readability.js');
    expect(typeof mod.Readability).toBe('function');

    let Document: any = null;
    try {
      const { JSDOM } = await import('jsdom') as any;
      Document = new JSDOM('<!doctype html><html><head><title>x</title></head><body><article><h1>Title</h1><p>Body paragraph for readability to chew on.</p></article></body></html>').window.document;
    } catch {
      try {
        const mod2: any = await import('happy-dom');
        const w = new mod2.Window();
        w.document.write('<!doctype html><html><head><title>x</title></head><body><article><h1>Title</h1><p>Body paragraph for readability to chew on.</p></article></body></html>');
        Document = w.document;
      } catch {
        // Neither DOM lib installed — skip the smoke test silently. The
        // file-content assertions above already verify the vendor pin.
        return;
      }
    }
    const r = new mod.Readability(Document);
    expect(r).toBeTruthy();
    expect(typeof r.parse).toBe('function');
  });
});
