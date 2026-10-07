#!/usr/bin/env node
/**
 * bundle-study.mjs
 *
 * ext/study/main.js is generated: the concatenation, in filename order, of
 * ext/study/src/*.js under a banner line, with LF line endings. Edit the
 * parts, then run this; tests/unit/studyBundle.test.ts fails when main.js is
 * stale (it builds the same string through bundleStudy()).
 *
 * Run: node scripts/bundle-study.mjs
 *
 * While the parts are written in parallel, a part that does not exist yet is
 * created as a one-line placeholder so the bundle is complete today; a file
 * that exists is never touched. The 90-activate.js placeholder exports the
 * no-op activate/deactivate and a __testables listing every function and
 * constant of 00-header.js and 10-model.js, so the model tests run before
 * the real activate lands; the real one replaces it.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STUDY_SRC = join(ROOT, 'ext', 'study', 'src');
export const STUDY_MAIN = join(ROOT, 'ext', 'study', 'main.js');
export const BANNER = '// GENERATED from ext/study/src/*.js by scripts/bundle-study.mjs; edit the parts, then run it.';

/** The parts every build has, in order. */
const PARTS = ['00-header.js', '10-model.js', '20-data.js', '30-ai.js', '40-css.js', '50-sidebar.js', '60-pane.js', '70-integration.js', '90-activate.js'];

/** The part files in filename order. */
export function listStudyParts(srcDir = STUDY_SRC) {
  if (!existsSync(srcDir)) return [];
  return readdirSync(srcDir).filter((f) => /\.js$/.test(f)).sort();
}

/** The bundle: the banner, then each part (LF, one trailing newline), a blank line between. */
export function bundleStudy(srcDir = STUDY_SRC) {
  const parts = listStudyParts(srcDir).map((f) => readFileSync(join(srcDir, f), 'utf8').replace(/\r\n?/g, '\n').replace(/\s*$/, '') + '\n');
  return BANNER + '\n\n' + parts.join('\n');
}

/** Names declared at the top level of a part: functions and consts. */
function declaredNames(text) {
  const names = [];
  for (const m of text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.push(m[1]);
  for (const m of text.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.push(m[1]);
  for (const m of text.matchAll(/^const\s+([A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?(?:\s*,\s*[A-Za-z_$][\w$]*\s*=\s*[^,;]+)+);/gm)) {
    for (const piece of m[1].split(',')) {
      const n = /^\s*([A-Za-z_$][\w$]*)/.exec(piece);
      if (n && !names.includes(n[1])) names.push(n[1]);
    }
  }
  return [...new Set(names)];
}

function activatePlaceholder(srcDir) {
  const exported = [];
  for (const part of ['00-header.js', '10-model.js']) {
    const file = join(srcDir, part);
    if (!existsSync(file)) continue;
    for (const n of declaredNames(readFileSync(file, 'utf8'))) {
      if (n === 'db' || n === 'bus' || n.startsWith('_')) continue;
      exported.push(n);
    }
  }
  return [
    '// 90-activate.js: written by another part of the build',
    '// PLACEHOLDER written by scripts/bundle-study.mjs so the model tests run before the',
    '// real activate lands. The real 90-activate.js replaces this file and must export',
    '// every name below through __testables.',
    'export async function activate() {}',
    'export async function deactivate() {}',
    'export const __testables = {',
    ...exported.map((n) => `  ${n},`),
    '};',
    '',
  ].join('\n');
}

/** Create the parts that do not exist yet. Never overwrites. Returns the names created. */
export function ensureStudyParts(srcDir = STUDY_SRC) {
  mkdirSync(srcDir, { recursive: true });
  const created = [];
  for (const part of PARTS) {
    const file = join(srcDir, part);
    if (existsSync(file)) continue;
    const body = part === '90-activate.js'
      ? activatePlaceholder(srcDir)
      : `// ${part}: written by another part of the build\n`;
    writeFileSync(file, body);
    created.push(part);
  }
  return created;
}

function main() {
  const created = ensureStudyParts();
  for (const c of created) console.log(`placeholder created: ext/study/src/${c}`);
  const out = bundleStudy();
  writeFileSync(STUDY_MAIN, out);
  console.log(`wrote ext/study/main.js (${out.length} chars, ${listStudyParts().length} parts)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
