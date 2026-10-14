// mousePressRatchet.test.ts — listeners on the mouse alone can only fall.
//
// docs/ACCESSIBILITY.md, section 8. A drag started from 'mousedown' never
// starts for a finger or a pen: a touchscreen gives the browser no mouse
// press for a drag, only for a tap. A drag starts with onDragPress
// (src/ui/touchDrag.ts; api.ui.onDragPress for extensions), which answers
// every pointer; a press that only keeps focus where it is can stay a
// mousedown, which a tap still sends. New code adds no mousedown listener,
// so every new drag is reachable by touch by construction, and the
// existing ones fall as they are converted. onDragPress itself is the one
// place a mousedown listener belongs, so it is not counted.
//
// UPDATE_MOUSE_PRESS_BASELINE=1 refreshes mouse-press-baseline.json; refresh
// only in a commit whose message names the counts that fell.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { withoutComments } from './fixtures/sourceText.js';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'mouse-press-baseline.json');

export const MOUSE_PRESS_PATTERNS: readonly RegExp[] = [
  /addEventListener\(\s*['"]mousedown['"]/g,
  /addDisposableListener\([^,]+,\s*['"]mousedown['"]/g,
  /\.onmousedown\s*=/g,
];

const SOURCE_GLOBS = ['src/**/*.ts', 'ext/**/*.js'];
const NOT_COUNTED = ['**/node_modules/**', '**/*.generated.ts', '**/*.d.ts', 'ext/**/readability.js', 'ext/**/test/**', 'src/ui/touchDrag.ts'];

type Counts = Record<string, number>;

export function measureMousePresses(): Counts {
  const out: Counts = {};
  for (const f of globSync(SOURCE_GLOBS, { cwd: ROOT, ignore: NOT_COUNTED }).sort()) {
    const text = withoutComments(readFileSync(resolve(ROOT, f), 'utf8'));
    let n = 0;
    for (const re of MOUSE_PRESS_PATTERNS) n += (text.match(re) ?? []).length;
    if (n > 0) out[f.split(String.fromCharCode(92)).join('/')] = n;
  }
  return out;
}

describe('mouse presses (ratchet)', () => {
  const now = measureMousePresses();
  if (process.env.UPDATE_MOUSE_PRESS_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file listens for the mouse press more than it did, and no new file does', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}`);
    }
    expect(rises, 'A file gained a mousedown listener. Start a drag with onDragPress (api.ui.onDragPress), which answers a mouse, a pen and a finger; a press that only keeps focus can use pointerdown.').toEqual([]);
  });
});
