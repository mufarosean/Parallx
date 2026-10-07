// studyBundle.test.ts — ext/study/main.js is generated from ext/study/src/*.js.
//
// The bundle is the banner line, then every part in filename order with LF
// line endings (scripts/bundle-study.mjs). A stale main.js fails here: edit
// the parts, then run `node scripts/bundle-study.mjs`.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — JS module with no types
import { bundleStudy, listStudyParts, BANNER } from '../../scripts/bundle-study.mjs';

const ROOT = resolve(__dirname, '..', '..');
const MAIN = resolve(ROOT, 'ext', 'study', 'main.js');
const SRC = resolve(ROOT, 'ext', 'study', 'src');

describe('study bundle', () => {
  it('has the parts the spec lays out, in filename order', () => {
    const parts = listStudyParts(SRC);
    expect(parts[0]).toBe('00-header.js');
    expect(parts[1]).toBe('10-model.js');
    expect(parts[parts.length - 1]).toBe('90-activate.js');
    expect([...parts].sort()).toEqual(parts);
  });

  it('main.js equals the concatenation of src/*.js under the banner', () => {
    expect(existsSync(MAIN)).toBe(true);
    const actual = readFileSync(MAIN, 'utf8');
    const expected = bundleStudy(SRC);
    expect(actual.startsWith(BANNER + '\n')).toBe(true);
    expect(actual).toBe(expected);
  });

  it('uses LF line endings only', () => {
    expect(readFileSync(MAIN, 'utf8')).not.toContain('\r');
  });

  it('only 90-activate.js exports, and no part imports', () => {
    for (const part of listStudyParts(SRC)) {
      const text = readFileSync(resolve(SRC, part), 'utf8');
      expect(/^import\s/m.test(text), `${part} imports`).toBe(false);
      if (part !== '90-activate.js') expect(/^export\s/m.test(text), `${part} exports`).toBe(false);
    }
  });
});
