// hoverRevealCompliance.test.ts — what a pointer's hover reveals, the
// keyboard and a finger reveal too.
//
// docs/ACCESSIBILITY.md, section 8. A control shown only while the pointer
// is over its card (opacity 0 until :hover, or pointer-events none) is
// invisible to a keyboard user who Tabs onto it and unreachable to a finger,
// which never hovers. A rule that reveals on :hover lists, in the same
// selector list, the same reveal under :focus-within (or :focus-visible /
// :focus) for the keyboard and under [data-input-modality="touch"] for a
// finger (src/ui/inputModality.ts). Counted per file; counts may only fall.
//
// UPDATE_HOVER_REVEAL_BASELINE=1 refreshes hover-reveal-baseline.json; refresh
// only in a commit whose message names the counts that fell.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'hover-reveal-baseline.json');

/** A declaration that shows what was hidden. */
const REVEALS = /(?:^|[;{\s])(?:opacity\s*:\s*(?:1|0?\.[5-9]\d*)\b|pointer-events\s*:\s*auto|visibility\s*:\s*visible)/;

/** CSS rules in a stylesheet, or in the template strings a JS file carries its stylesheet in. */
export function hoverReveals(text: string): string[] {
  const out: string[] = [];
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(css))) {
    const selector = m[1].trim();
    if (!/:hover\b/.test(selector) || !REVEALS.test(` ${m[2]}`)) continue;
    // Only rules that reveal something inside the hovered thing, not the hovered thing's own colour.
    const parts = selector.split(',').map((p) => p.trim()).filter(Boolean);
    const revealsChild = parts.some((p) => /:hover\b\s*[>~+\s]\s*\S/.test(p));
    if (!revealsChild) continue;
    const keyboard = parts.some((p) => /:focus(-within|-visible)?\b/.test(p));
    const touch = parts.some((p) => /data-input-modality\s*=\s*["']?touch/.test(p));
    if (!keyboard || !touch) out.push(selector.replace(/\s+/g, ' ').slice(0, 160));
  }
  return out;
}

type Counts = Record<string, number>;

export function measureHoverReveals(): Counts {
  const out: Counts = {};
  const files = globSync(['src/**/*.css', 'src/**/*.ts', 'ext/**/*.css', 'ext/**/*.js'], { cwd: ROOT, ignore: ['**/node_modules/**', '**/*.d.ts', '**/*.generated.ts', 'ext/**/test/**'] }).sort();
  for (const f of files) {
    const text = readFileSync(resolve(ROOT, f), 'utf8');
    if (!f.endsWith('.css') && !/:hover/.test(text)) continue;
    const n = hoverReveals(f.endsWith('.css') ? text : (text.match(/`[^`]*`/g) ?? []).join('\n')).length;
    if (n > 0) out[f.split(String.fromCharCode(92)).join('/')] = n;
  }
  return out;
}

describe('hover reveals (ratchet)', () => {
  const now = measureHoverReveals();
  if (process.env.UPDATE_HOVER_REVEAL_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('finds a hover-only reveal and accepts a full one', () => {
    expect(hoverReveals('.card:hover .actions { opacity: 1; }')).toHaveLength(1);
    expect(hoverReveals('.card:hover .actions, .card:focus-within .actions, [data-input-modality="touch"] .actions { opacity: 1; }')).toHaveLength(0);
    expect(hoverReveals('.card:hover { background: red; }')).toHaveLength(0);
  });

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file has more hover-only reveals than it did, and no new file has any', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}`);
    }
    expect(rises, 'A rule reveals on :hover only. List the same reveal under :focus-within and [data-input-modality="touch"] in its selector.').toEqual([]);
  });
});
