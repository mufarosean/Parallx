// lazyVendorBundles.test.ts — pdf.js, highlight.js and JSZip load on first use.
//
// The three together were a quarter of the main bundle and were parsed at
// every boot, for a PDF, a Markdown preview or an Excel import the session
// might never open. Each is now its own bundle under src/vendor/, and the
// main bundle reaches it through a dynamic import that the build leaves as
// a run-time request. This keeps it so: no file outside src/vendor/ may
// import one of these packages for its value, every vendor entry builds,
// and the plugin rewrites the import.

import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { globSync } from 'glob';
// @ts-expect-error — JS module with no types
import { VENDOR_BUNDLES, lazyVendorPlugin } from '../../scripts/vendorBundles.mjs';

const ROOT = path.resolve(__dirname, '..', '..');
const LAZY_PACKAGES = /^(pdfjs-dist(\/.*)?|highlight\.js(\/.*)?|jszip)$/;
/** A value import or re-export of a bare package (type-only ones are erased by the compiler). */
const VALUE_IMPORT = /^\s*(?:import\s+(?!type\b)[^'"]*?\s+from\s+|import\s+|export\s+(?!type\b)[^'"]*?\s+from\s+)['"]([^'".][^'"]*)['"]/gm;

describe('the lazy vendor bundles', () => {
  it('each entry exists under src/vendor/', () => {
    expect(VENDOR_BUNDLES.map((b: { name: string }) => b.name).sort()).toEqual(['hljs', 'jszip', 'pdfjs']);
    for (const { entry } of VENDOR_BUNDLES) {
      expect(entry.startsWith('src/vendor/')).toBe(true);
      expect(existsSync(path.join(ROOT, entry))).toBe(true);
    }
  });

  it('nothing outside src/vendor/ imports pdf.js, highlight.js or JSZip for its value', () => {
    const offenders: string[] = [];
    for (const file of globSync('src/**/*.ts', { cwd: ROOT, posix: true })) {
      if (file.startsWith('src/vendor/') || file.endsWith('.d.ts')) continue;
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const m of text.matchAll(VALUE_IMPORT)) {
        const spec = m[1];
        if (spec.endsWith('.css')) continue;
        if (LAZY_PACKAGES.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('build.mjs builds every vendor bundle and gives the main bundle the plugin', () => {
    const src = readFileSync(path.join(ROOT, 'scripts/build.mjs'), 'utf8');
    expect(src).toContain('plugins: [lazyVendorPlugin()]');
    expect(src).toContain('for (const { name, entry } of VENDOR_BUNDLES)');
    expect(src).toContain('outfile: `dist/renderer/vendor-${name}.js`');
  });

  it('the plugin leaves each loader\'s import as a request for its bundle', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plx-vendor-'));
    try {
      const entry = path.join(dir, 'entry.ts');
      const lazy = path.join(ROOT, 'src/vendor/lazy.js').replace(/\\/g, '/');
      writeFileSync(entry, `export { loadPdfjs, loadHljs, loadJsZip } from '${lazy}';\n`);
      const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', plugins: [lazyVendorPlugin()], logLevel: 'silent' });
      const text = out.outputFiles[0].text;
      for (const name of ['pdfjs', 'hljs', 'jszip']) expect(text).toContain(`import("./dist/renderer/vendor-${name}.js")`);
      expect(text).not.toContain('GlobalWorkerOptions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
