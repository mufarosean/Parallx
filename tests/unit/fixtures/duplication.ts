// duplication.ts — the same code in two files, measured.
//
// Used by duplicationRatchet.test.ts. Every source file is reduced to its
// lines of substance (comments, blank lines, imports and lines of only
// brackets dropped; whitespace collapsed). A run of WINDOW such lines that
// appears in two different files is a copy. Repeats inside one file are not
// counted: this is about code that should exist once and exists twice.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { withoutComments } from './sourceText.js';

/** Lines of substance in a row that make a copy. */
export const WINDOW = 10;
/** A window shorter than this many characters is boilerplate, not a copy. */
export const MIN_CHARS = 320;

const SOURCE_GLOBS = ['src/**/*.ts', 'ext/**/*.js', 'electron/**/*.{cjs,mjs,js}'];
const NOT_COUNTED = [
  '**/node_modules/**', 'ext/**/vendor/**', '**/*.generated.ts', '**/*.d.ts',
  'ext/study/main.js', 'ext/**/readability.js', 'ext/**/test/**',
  // Generated lists and tables: the same shape by design.
  'src/built-in/worksheet/athenaFunctions.ts',
];

export interface DuplicationMeasure {
  /** Per file: how many of its lines of substance also stand in another file. */
  readonly files: Record<string, number>;
  /** Per pair of files ("a | b", sorted): the lines they share. */
  readonly pairs: Record<string, number>;
}

/** FNV-1a, 32 bits: enough to tell lines apart when two of them are combined. */
function hash(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** The lines of a file that carry meaning, in order. */
export function substance(text: string): string[] {
  const out: string[] = [];
  /** Inside an import or re-export list that runs over several lines. */
  let inList = false;
  for (const raw of withoutComments(text).split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (inList) { if (/\}\s*(from\b|;|$)/.test(line)) inList = false; continue; }
    if (line.length < 3) continue;
    if (/^[\])}>;,(){[]+$/.test(line)) continue;
    if (/^(import|export)\s+(type\s+)?\{[^}]*$/.test(line)) { inList = true; continue; }
    if (/^(import |export \* from |export (type )?\{[^}]*\} from )/.test(line)) continue;
    out.push(line);
  }
  return out;
}

export function measureDuplication(root: string): DuplicationMeasure {
  const names = globSync(SOURCE_GLOBS, { cwd: root, ignore: NOT_COUNTED }).map((f) => f.split(String.fromCharCode(92)).join('/')).sort();
  const lines = names.map((f) => substance(readFileSync(resolve(root, f), 'utf8')));
  // Every window, keyed by two hashes of its text; where it was seen.
  const seen = new Map<string, { file: number; at: number }[]>();
  lines.forEach((ls, file) => {
    for (let at = 0; at + WINDOW <= ls.length; at++) {
      const text = ls.slice(at, at + WINDOW).join('\n');
      if (text.length < MIN_CHARS) continue;
      const key = `${hash(text, 2166136261)}:${hash(text, 84696351)}`;
      const list = seen.get(key);
      if (list) list.push({ file, at }); else seen.set(key, [{ file, at }]);
    }
  });
  const covered = names.map(() => new Set<number>());
  const shared = new Map<string, Set<string>>();
  for (const list of seen.values()) {
    const files = new Set(list.map((x) => x.file));
    if (files.size < 2) continue;
    for (const { file, at } of list) for (let i = 0; i < WINDOW; i++) covered[file].add(at + i);
    const sorted = [...files].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const pair = `${names[sorted[i]]} | ${names[sorted[j]]}`;
      let set = shared.get(pair);
      if (!set) { set = new Set(); shared.set(pair, set); }
      for (const x of list) if (x.file === sorted[i]) for (let k = 0; k < WINDOW; k++) set.add(`${x.at + k}`);
    }
  }
  const files: Record<string, number> = {};
  covered.forEach((set, i) => { if (set.size) files[names[i]] = set.size; });
  const pairs: Record<string, number> = {};
  for (const [pair, set] of shared) pairs[pair] = set.size;
  return { files, pairs };
}
