// packageExtension.test.ts — a packaged extension holds every file it imports.
//
// `main.js` imports its sibling modules by relative path, so a .plx that
// ships only main.js cannot load. The package lists every top-level module,
// the migrations and the binaries, and leaves tests and sources out.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';
import { collectExtensionFiles } from '../../scripts/package-extension.mjs';

const EXT_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../ext');

function relativeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('collectExtensionFiles', () => {
  it('every module main.js imports from ext/creations-ai is in its package', () => {
    const dir = path.join(EXT_ROOT, 'creations-ai');
    const files = collectExtensionFiles(dir).map((f) => f.file);
    const imported = relativeImports(path.join(dir, 'main.js'));
    expect(imported.length).toBeGreaterThan(5);
    for (const name of imported) expect(files).toContain(name);
    expect(files).toContain('parallx-manifest.json');
    expect(files).toContain('main.js');
    expect(files.some((f) => f.startsWith('test'))).toBe(false);
  });

  it('every extension in ext/ packages all its top-level modules, migrations and binaries', () => {
    for (const folder of readdirSync(EXT_ROOT)) {
      const dir = path.join(EXT_ROOT, folder);
      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }
      if (!entries.includes('parallx-manifest.json')) continue;
      const files = collectExtensionFiles(dir).map((f) => f.file);
      for (const name of entries.filter((e) => e.endsWith('.js'))) expect(files).toContain(name);
    }
  });

  it('keeps migrations and binaries in their folders and skips tests and sources', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plx-'));
    try {
      writeFileSync(path.join(dir, 'parallx-manifest.json'), '{}');
      writeFileSync(path.join(dir, 'main.js'), "import './helper.js';");
      writeFileSync(path.join(dir, 'helper.js'), 'export const x = 1;');
      mkdirSync(path.join(dir, 'test')); writeFileSync(path.join(dir, 'test', 'run.mjs'), '');
      mkdirSync(path.join(dir, 'src')); writeFileSync(path.join(dir, 'src', 'part.js'), '');
      mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
      writeFileSync(path.join(dir, 'db', 'migrations', 'x_001.sql'), 'SELECT 1;');
      mkdirSync(path.join(dir, 'bin')); writeFileSync(path.join(dir, 'bin', 'tool.exe'), '');
      const files = collectExtensionFiles(dir);
      expect(files).toEqual([
        { file: 'parallx-manifest.json', zipDir: '' },
        { file: 'helper.js', zipDir: '' },
        { file: 'main.js', zipDir: '' },
        { file: path.join('db', 'migrations', 'x_001.sql'), zipDir: 'db/migrations' },
        { file: path.join('bin', 'tool.exe'), zipDir: 'bin' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a folder without a manifest or a main.js', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plx-'));
    try {
      expect(() => collectExtensionFiles(dir)).toThrow(/parallx-manifest.json/);
      writeFileSync(path.join(dir, 'parallx-manifest.json'), '{}');
      expect(() => collectExtensionFiles(dir)).toThrow(/main.js/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
