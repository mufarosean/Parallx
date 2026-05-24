/**
 * Extension ESM export guard (§22 regression — caught by user 2026-05-23).
 *
 * The renderer loads every external extension entry point via dynamic
 * `import()` (see `src/tools/toolModuleLoader.ts`), which treats the file
 * as ESM. CommonJS `module.exports = { activate }` therefore throws
 * `ReferenceError: module is not defined` at activation time, and the
 * `activate` function never reaches the host.
 *
 * Bug history: M82 Slices A & B (`e9320875`, `3cd80b07`) shipped two
 * reference extensions (`ext/example-chat-participant/`,
 * `ext/example-canvas-block/`) using `module.exports = ...`. Both failed
 * to activate at runtime. tsc + the existing unit suite did not catch
 * this because nothing imported the example extensions directly.
 *
 * This guard scans every `ext/<name>/main.js` and asserts the entry
 * module exposes its activation hooks via ESM `export` syntax. It runs
 * in the standard `npm run test:unit` suite, so the pre-commit slice
 * gate will fail before a CommonJS extension entry can land again.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXT_DIR = join(__dirname, '..', '..', 'ext');

interface ExtensionEntry {
  readonly toolId: string;
  readonly entryPath: string;
  readonly source: string;
}

function collectExtensionEntries(): ExtensionEntry[] {
  const entries: ExtensionEntry[] = [];
  if (!existsSync(EXT_DIR)) return entries;
  for (const name of readdirSync(EXT_DIR)) {
    const toolDir = join(EXT_DIR, name);
    if (!statSync(toolDir).isDirectory()) continue;
    const manifestPath = join(toolDir, 'parallx-manifest.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: { main?: string };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      continue;
    }
    const main = manifest.main;
    if (!main) continue;
    const entryPath = join(toolDir, main);
    if (!existsSync(entryPath)) continue;
    entries.push({
      toolId: name,
      entryPath,
      source: readFileSync(entryPath, 'utf-8'),
    });
  }
  return entries;
}

const ENTRIES = collectExtensionEntries();

describe('extension entry modules use ESM exports', () => {
  it('discovers at least one external extension entry', () => {
    // Sanity: the scan is wired correctly. If this ever fails we've moved
    // the ext/ directory or broken the manifest contract — the guards
    // below would silently pass with an empty input otherwise.
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  for (const entry of ENTRIES) {
    describe(entry.toolId, () => {
      it('declares an `activate` export via ESM syntax', () => {
        // Accepts any of:
        //   export function activate(...) { ... }
        //   export async function activate(...) { ... }
        //   export const activate = ...
        //   export { activate, ... }
        const patterns = [
          /\bexport\s+(?:async\s+)?function\s+activate\b/,
          /\bexport\s+(?:const|let|var)\s+activate\b/,
          /\bexport\s*\{[^}]*\bactivate\b[^}]*\}/,
        ];
        const matched = patterns.some((re) => re.test(entry.source));
        expect(
          matched,
          `${entry.entryPath} does not appear to export an \`activate\` ` +
          'function via ESM syntax. The tool module loader awaits ' +
          '`rawModule.activate` after `import(blobUrl)` — without an ESM ' +
          'export the function is invisible to the host.',
        ).toBe(true);
      });
    });
  }
});
