// kitHandlerRatchet.test.ts — kit controls with a local handler can only
// become fewer.
//
// docs/SELF_DESCRIBING_UI_DESIGN.md section 6.3. A control that declares a
// command (`command: 'planner.addTask'`) is in the palette, the menus, the
// keybindings and the model's reach; one with an `onClick` is only on its
// surface. Handlers are allowed, so a row's local action can stay one, but
// their count per file may not rise.
//
// UPDATE_KIT_HANDLER_BASELINE=1 refreshes kit-handler-baseline.json; refresh
// only in a commit whose message names the counts that fell.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { withoutComments } from './fixtures/sourceText.js';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'kit-handler-baseline.json');

const SOURCE_GLOBS = ['src/**/*.ts', 'ext/**/*.js'];
const NOT_COUNTED = [
  '**/node_modules/**', '**/*.generated.ts', '**/*.d.ts',
  'ext/study/main.js', 'ext/**/readability.js', 'ext/**/test/**',
  'src/ui/kit.ts', 'src/ui/scene.ts',
];

type Counts = Record<string, number>;

function measure(): Counts {
  const out: Counts = {};
  for (const f of globSync(SOURCE_GLOBS, { cwd: ROOT, ignore: NOT_COUNTED }).sort()) {
    const text = withoutComments(readFileSync(resolve(ROOT, f), 'utf8'));
    const n = (text.match(/\bonClick:/g) ?? []).length;
    if (n > 0) out[f.split(String.fromCharCode(92)).join('/')] = n;
  }
  return out;
}

describe('kit handlers (ratchet)', () => {
  const now = measure();
  if (process.env.UPDATE_KIT_HANDLER_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file has more controls with a local handler than it did', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}`);
    }
    expect(rises, 'A file gained controls with a local handler. Declare the command the control runs instead.').toEqual([]);
  });
});
