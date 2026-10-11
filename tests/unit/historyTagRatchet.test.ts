// historyTagRatchet.test.ts — comments explain the code, not its history.
//
// A comment that says "M60 Phase θ B5" or "(Mufaro, 2026-09-21)" tells a new
// reader nothing about what the code does; the history lives in git. This
// counts, per file, the comments carrying milestone codes, Greek-letter
// phases, dates and names, and fails when any count rises above
// history-tag-baseline.json. Counts may only fall; a new file starts at zero.
//
// Only comments are scanned: a milestone in a migration file name or a
// persisted id is a value, not history, and stays.
//
// After a cleanup lowers a count, refresh the baseline so the gain is kept:
//   UPDATE_HISTORY_TAG_BASELINE=1 npx vitest run tests/unit/historyTagRatchet.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..', '..');
const BASELINE = resolve(__dirname, 'history-tag-baseline.json');

export const HISTORY_TAGS: Record<string, RegExp> = {
  /** Milestone codes: M58, M60, M105. */
  milestone: /\bM\d{2,3}\b/g,
  /** Phases named by Greek letter: "Phase θ", "Phase γ". */
  greekPhase: /\bPhase\s+[α-ωΑ-Ω]\b/g,
  /** A date: history by definition. */
  date: /\b20\d\d-\d\d-\d\d\b/g,
  /** A reviewer's name attached to a change. */
  name: /\bMufaro\b/g,
  /** Section tags from plan documents: "§3.8", "D2:", "W6", "Iter 3". */
  planTag: /§\s*\d|\bD\d{1,2}:|\bW\d\b|\bIter\s+\d/g,
};

const SOURCE_GLOBS = ['src/**/*.{ts,css}', 'ext/**/*.{js,css}', 'electron/**/*.{cjs,mjs,js}'];
const NOT_COUNTED = ['**/node_modules/**', '**/*.generated.ts', 'ext/study/main.js', 'ext/**/readability.js', 'ext/**/test/**'];

/** Every comment in a file, block and line, as one string. */
function commentsOf(text: string): string {
  const blocks = text.match(/\/\*[\s\S]*?\*\//g) ?? [];
  const lines = text.match(/(?:^|[^:'"`\w])\/\/[^\n]*/gm) ?? [];
  return [...blocks, ...lines].join('\n');
}

type Counts = Record<string, number>;

function measure(): Counts {
  const out: Counts = {};
  for (const f of globSync(SOURCE_GLOBS, { cwd: ROOT, ignore: NOT_COUNTED }).sort()) {
    const comments = commentsOf(readFileSync(resolve(ROOT, f), 'utf8'));
    let n = 0;
    for (const re of Object.values(HISTORY_TAGS)) n += (comments.match(re) ?? []).length;
    if (n > 0) out[f.split(String.fromCharCode(92)).join('/')] = n;
  }
  return out;
}

describe('history in comments (ratchet)', () => {
  const now = measure();

  if (process.env.UPDATE_HISTORY_TAG_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
  }

  it('has a committed baseline', () => {
    expect(existsSync(BASELINE)).toBe(true);
  });

  it('no file carries more history in its comments than it did', () => {
    const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const rises: string[] = [];
    for (const [file, n] of Object.entries(now)) {
      const was = base[file] ?? 0;
      if (n > was) rises.push(`${file}: ${was} -> ${n}`);
    }
    expect(rises, 'A comment records history (a milestone, a date, a name). Say what the code does now and why; the history is in git.').toEqual([]);
  });
});
