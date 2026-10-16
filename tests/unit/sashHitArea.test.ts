/**
 * sashHitArea.test.ts — a divider's hit area is the divider's own.
 *
 * On 2026-10-13 the dividers took a 24px hit area under `any-pointer: coarse`,
 * which is true on any computer with a touchscreen or pen, so with a mouse too:
 * the wider area lay over the editor's scrollbar beside the chat divider and
 * took the scrollbar's drags. No stylesheet may grow a divider past its box.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

const SRC = resolve(__dirname, '../../src');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

describe('divider hit areas', () => {
  it('no stylesheet gives a divider a pseudo-element that reaches past it', () => {
    const found: string[] = [];
    for (const file of cssFiles(SRC)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]*sash[^{}]*::before[^{}]*)\{([^}]*)\}/g)) {
        if (/(left|right|top|bottom|inset)\s*:\s*-/.test(m[2])) found.push(`${relative(SRC, file)}: ${m[1].trim()}`);
      }
    }
    expect(found).toEqual([]);
  });
});
