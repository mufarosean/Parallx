// fileSizeRatchet.test.ts — files may only get smaller.
//
// A file a beginner can read fits in one sitting: 800 lines, 1,500 at the
// very most. Today 80-odd files are over the budget. This records each one's
// length in file-size-baseline.json and fails when any of them grows, or
// when a new file arrives over the budget. Counts may only fall; once a file
// is split under the budget it leaves the baseline and the budget holds.
//
// Generated files are not counted (ext/study/main.js is built from
// ext/study/src; the icon registry is built from lucide).
//
// After a split lowers a count, refresh the baseline so the gain is kept:
//   UPDATE_FILE_SIZE_BASELINE=1 npx vitest run tests/unit/fileSizeRatchet.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'file-size-baseline.json');

/** A file over this many lines is one the next change must shrink, not grow. */
export const FILE_LINE_BUDGET = 800;

const SOURCE_GLOBS = ['src/**/*.{ts,css}', 'ext/**/*.{js,css}', 'electron/**/*.{cjs,mjs,js}', 'scripts/**/*.{mjs,cjs,js}'];
const NOT_COUNTED = [
  '**/node_modules/**',
  '**/*.generated.ts',
  '**/*.d.ts',
  'ext/study/main.js',
  'ext/**/readability.js',
  'ext/**/test/**',
];

type Counts = Record<string, number>;

function measure(): Counts {
  const out: Counts = {};
  for (const f of globSync(SOURCE_GLOBS, { cwd: ROOT, ignore: NOT_COUNTED }).sort()) {
    const lines = readFileSync(resolve(ROOT, f), 'utf8').split('\n').length;
    if (lines > FILE_LINE_BUDGET) out[f.split(String.fromCharCode(92)).join('/')] = lines;
  }
  return out;
}

describe('file size (ratchet)', () => {
  const now = measure();

  if (process.env.UPDATE_FILE_SIZE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file over the budget grew, and no new file is over it', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, lines] of Object.entries(now)) {
      const was = base[file];
      if (was === undefined) rises.push(`${file}: new file with ${lines} lines (budget ${FILE_LINE_BUDGET})`);
      else if (lines > was) rises.push(`${file}: ${was} -> ${lines}`);
    }
    expect(rises, `A file over ${FILE_LINE_BUDGET} lines grew. Split what you are adding into its own module instead.`).toEqual([]);
  });
});
