// copyCompliance.test.ts — standardization canary (STANDARDIZATION.md P5).
//
// The copy rules in docs/Parallx_UI_System.md had ZERO enforcement, which
// is why the app drifted to 24 three-dot ellipses (four commands were
// registered under BOTH spellings, so the palette showed duplicates),
// ~19 emoji in system UI, and em dashes in palette-visible strings.
// Same canary pattern as motionTokenCompliance / fontCompliance: a new
// violation fails here until fixed or consciously exempted.
//
// Scope is UI-SHAPED STRING PROPERTIES (title:/label:/placeholder:/
// aiDescription:/description: in command + manifest declarations), not
// comments and not prose content — the house style deliberately uses em
// dashes in comments.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '../..');

/** Property names whose string values render in chrome (palette, menus,
 *  settings rows, inputs). */
const UI_PROPS = ['title', 'label', 'placeholder', 'aiDescription', 'actionLabel'];

/** UI-shaped `prop: '...'` matches on one line, with the quoted value. */
function uiStrings(line: string): string[] {
  const out: string[] = [];
  for (const prop of UI_PROPS) {
    const re = new RegExp(`\\b${prop}\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) out.push(m[1]);
  }
  return out;
}

const FILES = globSync('src/**/*.ts', { cwd: ROOT, ignore: ['**/*.test.ts'] }).sort();

function sweep(check: (value: string) => boolean): string[] {
  const violations: string[] = [];
  for (const file of FILES) {
    const rel = relative(ROOT, resolve(ROOT, file)).replace(/\\/g, '/');
    const lines = readFileSync(resolve(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const value of uiStrings(line)) {
        if (check(value)) violations.push(`${rel}:${i + 1} → '${value}'`);
      }
    });
  }
  return violations;
}

describe('copy compliance — UI-shaped strings', () => {
  it('uses the ellipsis character, never three dots', () => {
    const violations = sweep((v) => v.includes('...'));
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('carries no em dashes in labels and titles', () => {
    const violations = sweep((v) => v.includes('—'));
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('carries no emoji in system UI strings', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const violations = sweep((v) => emoji.test(v));
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('keeps built-in manifest descriptions free of em dashes and emoji', () => {
    // Manifest descriptions render in the Tool Gallery and the palette.
    const src = readFileSync(resolve(ROOT, 'src/tools/builtinManifests.ts'), 'utf8');
    const bad = src.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\bdescription\s*:\s*'[^']*(?:—|\p{Extended_Pictographic})/u.test(line))
      .map(({ n, line }) => `builtinManifests.ts:${n} → ${line.trim()}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
