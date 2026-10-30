// rawDomRatchet.test.ts — hand-built DOM per file can only fall.
//
// docs/SELF_DESCRIBING_UI_DESIGN.md section 6.1. A control made by hand
// (an element and a click listener) is invisible to the scene, the probes
// and a screen reader. Every conversion moves such code into a kit call;
// this ratchet keeps it from coming back. The kit and the components it
// wraps are the one place raw DOM belongs, so they are not counted.
//
// UPDATE_RAW_DOM_BASELINE=1 refreshes raw-dom-baseline.json; refresh only in
// a commit whose message names the counts that fell.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { withoutComments } from './fixtures/sourceText.js';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'raw-dom-baseline.json');

export const RAW_DOM_PATTERNS: readonly RegExp[] = [
  /document\.createElement\(/g,
  /\bel\('/g,
  /\bh\('/g,
  /\$\('/g,
  /\.innerHTML\s*=/g,
  /addEventListener\('click'/g,
];

const SOURCE_GLOBS = ['src/**/*.ts', 'ext/**/*.js'];
const NOT_COUNTED = [
  '**/node_modules/**', '**/*.generated.ts', '**/*.d.ts',
  'ext/study/main.js', 'ext/**/readability.js', 'ext/**/test/**',
  'src/ui/kit.ts', 'src/ui/scene.ts', 'src/ui/toggle.ts', 'src/ui/inputBox.ts', 'src/ui/dropdown.ts',
  'src/ui/slider.ts', 'src/ui/tabBar.ts', 'src/ui/segmentedControl.ts', 'src/ui/contextMenu.ts',
  'src/ui/dateTimeField.ts', 'src/ui/undoToast.ts',
  'src/ui/externalLinks.ts', // the window's link guard, not a control
];

type Counts = Record<string, number>;

export function measureRawDom(): Counts {
  const out: Counts = {};
  for (const f of globSync(SOURCE_GLOBS, { cwd: ROOT, ignore: NOT_COUNTED }).sort()) {
    const text = withoutComments(readFileSync(resolve(ROOT, f), 'utf8'));
    let n = 0;
    for (const re of RAW_DOM_PATTERNS) n += (text.match(re) ?? []).length;
    if (n > 0) out[f.split(String.fromCharCode(92)).join('/')] = n;
  }
  return out;
}

describe('raw DOM (ratchet)', () => {
  const now = measureRawDom();
  if (process.env.UPDATE_RAW_DOM_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file builds more DOM by hand than it did, and no new file builds any', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}`);
    }
    expect(rises, 'A file builds more DOM by hand. Make the control through the kit (src/ui/kit.ts) instead.').toEqual([]);
  });
});
