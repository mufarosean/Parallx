// importDirectionRatchet.test.ts — imports point down the layers, never up.
//
// ARCHITECTURE.md draws the dependency matrix; nothing enforced it, and 120-odd
// imports cross it. This counts, per file, the value imports that point the
// wrong way and fails when any count rises above import-direction-baseline.json.
// Counts may only fall; a new file starts at zero.
//
// The rules, top of the app at the bottom of the list:
//   platform       imports nothing else in src.
//   ui, theme      import platform (theme may use ui).
//   layout         imports platform and ui.
//   services, the runtime folders (openclaw, agent, aiSettings, links) and the
//                  host folders (api, tools, contributions, configuration,
//                  commands, context, editor, parts, views, dnd, workspace)
//                  never import a built-in tool or the workbench.
//   built-in/<a>   never imports built-in/<b>: what one tool needs from another
//                  goes through a contribution point (CLAUDE.md, the first
//                  principle). Nor the workbench.
//   workbench      is the composition root and may import anything.
// Type-only imports (`import type`, `import('x').T`) are not counted: they
// create no runtime coupling, and the matrix allows them in several cells.
//
// After a cleanup lowers a count, refresh the baseline so the gain is kept:
//   UPDATE_IMPORT_DIRECTION_BASELINE=1 npx vitest run tests/unit/importDirectionRatchet.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, posix } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'import-direction-baseline.json');

/** The folder a src path belongs to: 'platform', 'built-in/canvas', ... */
function layerOf(srcPath: string): string {
  const parts = srcPath.split('/');
  if (parts[0] === 'built-in') return parts.length > 2 ? `built-in/${parts[1]}` : 'built-in';
  return parts.length > 1 ? parts[0] : '(root)';
}

const LOWER = new Set(['platform', 'ui', 'theme', 'layout']);
const NEVER_UPWARD = new Set([
  'services', 'openclaw', 'agent', 'aiSettings', 'links',
  'api', 'tools', 'contributions', 'configuration', 'commands', 'context', 'editor', 'parts', 'views', 'dnd', 'workspace',
]);

/** True when a file in `from` may import a file in `to`. */
export function mayImport(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === 'platform') return false;
  if (from === 'ui') return to === 'platform';
  if (from === 'theme') return to === 'platform' || to === 'ui';
  if (from === 'layout') return to === 'platform' || to === 'ui';
  if (to === 'workbench') return from === '(root)';
  const toBuiltIn = to.startsWith('built-in');
  if (from.startsWith('built-in')) return !toBuiltIn;
  if (NEVER_UPWARD.has(from)) return !toBuiltIn;
  return true;
}

const VALUE_IMPORT = /^\s*(?:import\s+(?!type\b)[^'"]*?\s+from\s+|import\s+|export\s+(?!type\b)[^'"]*?\s+from\s+)['"](\.[^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /(?<!\btype\s)(?<![\w.])import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

type Counts = Record<string, number>;

function measure(): { counts: Counts; edges: string[] } {
  const counts: Counts = {};
  const edges: string[] = [];
  for (const f of globSync('src/**/*.ts', { cwd: ROOT, ignore: ['**/*.d.ts'] }).sort()) {
    const rel = f.split(String.fromCharCode(92)).join('/').slice('src/'.length);
    const from = layerOf(rel);
    const text = stripComments(readFileSync(resolve(ROOT, f), 'utf8'));
    const targets = [...text.matchAll(VALUE_IMPORT), ...text.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]);
    for (const t of targets) {
      const target = posix.normalize(posix.join(dirname(rel), t)).replace(/\.js$/, '');
      if (target.startsWith('..')) continue;
      const to = layerOf(target);
      if (mayImport(from, to)) continue;
      counts[`src/${rel}`] = (counts[`src/${rel}`] ?? 0) + 1;
      edges.push(`src/${rel} -> ${target} (${from} -> ${to})`);
    }
  }
  return { counts, edges };
}

describe('import direction (ratchet)', () => {
  const now = measure();

  if (process.env.UPDATE_IMPORT_DIRECTION_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now.counts, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file imports upward more than it did', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now.counts)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}\n    ${now.edges.filter((e) => e.startsWith(file + ' ')).join('\n    ')}`);
    }
    expect(rises, 'An import points up the layers. Move the shared piece down, or add a contribution point.').toEqual([]);
  });

  it('the rules read as intended', () => {
    expect(mayImport('ui', 'platform')).toBe(true);
    expect(mayImport('ui', 'services')).toBe(false);
    expect(mayImport('services', 'built-in/chat')).toBe(false);
    expect(mayImport('built-in/canvas', 'built-in/chat')).toBe(false);
    expect(mayImport('built-in/canvas', 'services')).toBe(true);
    expect(mayImport('built-in/canvas', 'workbench')).toBe(false);
    expect(mayImport('workbench', 'built-in/chat')).toBe(true);
    expect(mayImport('(root)', 'workbench')).toBe(true);
  });
});
