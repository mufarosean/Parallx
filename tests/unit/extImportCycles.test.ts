// extImportCycles.test.ts — every extension loads: no cycle among its files.
//
// The loader gives each file of an external tool a blob URL, so relative
// imports between its files must not form a cycle (toolModuleLoader.ts
// refuses the whole extension when they do, at launch). Splitting a big file
// into modules is how the file-size check is met, and a split that imports
// back from where it came out of made Creations fail to load. This walks
// each extension's imports from its manifest's main the way the loader does.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { collectRelativeImports, resolveRelativeModulePath } from '../../src/tools/toolModuleLoader';

const ROOT = resolve(__dirname, '..', '..');

function firstCycle(entry: string): string[] | null {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const visit = (file: string): string[] | null => {
    const key = file.toLowerCase();
    if (state.get(key) === 'done') return null;
    if (state.get(key) === 'open') return [...stack.slice(stack.indexOf(file)), file];
    state.set(key, 'open');
    stack.push(file);
    if (existsSync(file)) {
      for (const spec of collectRelativeImports(readFileSync(file, 'utf8'))) {
        const found = visit(resolveRelativeModulePath(file, spec));
        if (found) return found;
      }
    }
    stack.pop();
    state.set(key, 'done');
    return null;
  };
  return visit(entry);
}

describe('extension imports', () => {
  const manifests = globSync('ext/*/parallx-manifest.json', { cwd: ROOT });
  it('finds the extensions', () => { expect(manifests.length).toBeGreaterThan(3); });
  for (const m of manifests) {
    const dir = resolve(ROOT, m, '..');
    const main = (JSON.parse(readFileSync(resolve(ROOT, m), 'utf8')) as { main?: string }).main;
    if (!main) continue;
    it(`${m.split(/[\\/]/)[1]}: no file imports back into a file that imports it`, () => {
      const cycle = firstCycle(resolve(dir, main));
      expect(cycle ? cycle.map((f) => f.slice(dir.length + 1)) : null).toBeNull();
    });
  }
});
