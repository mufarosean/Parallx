// stop-check.mjs — before Claude may stop, the code it changed is checked.
//
// A Stop hook (.claude/settings.json). When files under the app's code have
// changed since the last time this passed, it runs the typecheck, the
// ratchet and compliance tests, and the unit tests that depend on the
// changed files. A failure is handed back to Claude (exit code 2) so the
// turn goes on until it is fixed; a pass is remembered, so an unchanged tree
// costs nothing. Runs on Linux (cloud) and Windows alike: everything is
// started through node itself, never a shell.
//
// It also names every check that was weakened in this session: an assertion
// removed or made unable to fail, a test skipped, deleted or renamed out of
// the runner's sight, a ratchet baseline raised, the rules or settings of a
// check changed, a type or lint error silenced, an acceptance probe edited.
// A model under pressure to pass a check tends to change the check. The
// owner does not read the code; this list is what he reads. Claude is sent
// back once for each new item; the owner is told at the next stop, whatever
// happens in between, unless the check was put back.
//
// Its own behaviour is tested: tests/unit/stopHook.test.ts.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(import.meta.dirname, '../..');
/** What counts as the app's code and its checks: a change elsewhere (docs, .claude) is not checked here. */
const PATHS = ['src', 'ext', 'electron', 'scripts', 'tests/unit', 'tests/probes', 'package.json', 'tsconfig.json', 'tsconfig.test.json', 'vitest.config.ts'];
const BUDGET_MS = 9 * 60_000;
/** A session's memory of what it has already named. After this long the next run starts a new one. */
const SESSION_MS = 16 * 3_600_000;
const started = Date.now();

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (...args) => { try { return git(...args); } catch { return ''; } };
const lines = (text) => text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
const sha = (text) => createHash('sha1').update(text).digest('hex');

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no input: carry on */ }

const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
// Dependencies not installed (a fresh cloud session): nothing can be checked, and that is not Claude's to fix here.
if (!fs.existsSync(tsc) || !fs.existsSync(vitest)) process.exit(0);

const head = tryGit('rev-parse', 'HEAD').trim();
if (!head) process.exit(0);
const gitDir = path.resolve(root, tryGit('rev-parse', '--git-dir').trim() || '.git');
const stateFile = path.join(gitDir, 'claude-stop-check.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) ?? {}; } catch { /* first run */ }
const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* read-only checkout */ } };
const isAncestor = (older, newer) => { try { git('merge-base', '--is-ancestor', older, newer); return true; } catch { return false; } };

/**
 * Let the turn end. Whatever is owed to the owner (weakened checks Claude was
 * already sent back for, and that are still weakened) is said now, once.
 */
function allow(extra = '') {
  const owed = Array.isArray(state.owed) ? state.owed : [];
  const parts = [];
  if (extra) parts.push(extra);
  if (owed.length) parts.push(`Checks weakened in this session (Claude was told to put each back or to name it to you):\n${owed.map((w) => `- ${w}`).join('\n')}`);
  state.owed = [];
  save();
  if (parts.length) process.stdout.write(JSON.stringify({ systemMessage: parts.join('\n\n') }));
  process.exit(0);
}

// ── Where this session began ────────────────────────────────────────────────
// Weakened checks are looked for between that point and the files as they
// are now. Kept while it is still behind HEAD and recent; otherwise found
// again from the reflog: the place HEAD stood just before the first commit
// made here lately. A clone, a checkout or a pull moves it forward, so what
// came from the other machine is not counted as this session's.
function sessionBase() {
  if (state.base && Date.now() - (state.baseAt ?? 0) < SESSION_MS && isAncestor(state.base, head)) return state.base;
  let base = head;
  const entries = lines(tryGit('reflog', '--date=unix', '--format=%H%x09%gd%x09%gs', '-n', '400')).map((l) => { const [hash, sel, subject] = l.split('\t'); return { hash, at: Number((sel.match(/@\{(\d+)\}/) ?? [])[1] ?? 0) * 1000, subject: subject ?? '' }; });
  const recent = entries.filter((e) => Date.now() - e.at < SESSION_MS).reverse();
  for (const e of recent) {
    if (/^commit( \((amend|merge)\))?:/.test(e.subject) || /^(cherry-pick|revert|rebase)/.test(e.subject)) {
      const parent = tryGit('rev-parse', '--verify', '--quiet', `${e.hash}^`).trim();
      base = recent.indexOf(e) === 0 ? (parent || e.hash) : base;
      break;
    }
    base = e.hash;
  }
  if (!isAncestor(base, head)) base = head;
  // A new session: what the last one named and tracked is forgotten; what is still owed to the owner is not.
  state = { owed: state.owed ?? [], base, baseAt: Date.now() };
  return base;
}
const base = sessionBase();

// ── What changed ────────────────────────────────────────────────────────────
const statusRows = tryGit('status', '--porcelain', '-uall', '--', ...PATHS).split('\n').filter((l) => l.length > 3);
const unquote = (p) => (p.startsWith('"') ? JSON.parse(p) : p);
const untracked = statusRows.filter((l) => l.startsWith('??')).map((l) => unquote(l.slice(3)));
const uncommitted = statusRows.map((l) => unquote(l.slice(3).split(' -> ').pop()));
// For the checks: everything since the last pass, or since the session began when there has been none.
const checkFrom = state.head && isAncestor(state.head, head) ? state.head : base;
const committed = checkFrom !== head ? lines(tryGit('diff', '--name-only', `${checkFrom}..${head}`, '--', ...PATHS)) : [];
const changed = [...new Set([...committed, ...uncommitted])];

const hash = createHash('sha1').update(head).update(tryGit('diff', 'HEAD', '--', ...PATHS));
for (const f of untracked.slice().sort()) { hash.update(f); try { hash.update(fs.readFileSync(path.join(root, f))); } catch { /* gone */ } }
const fingerprint = hash.digest('hex');

// Nothing changed since the last run: no checks to repeat. What is owed is said.
if (fingerprint === state.fingerprint) allow();

// ── Checks that were weakened ───────────────────────────────────────────────
const show = (ref, file) => { try { return git('show', `${ref}:${file}`); } catch { return null; } };
const readNow = (file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const isTest = (f) => /^tests\/unit\/.*\.test\.ts$/.test(f) || /^tests\/probes\/.*\.(mjs|cjs)$/.test(f) || /^ext\/.*\/test\/.*\.(js|mjs|ts)$/.test(f);
const isBaseline = (f) => /^tests\/.*-baseline\.json$/.test(f);
const isRules = (f) => /^tests\/unit\/(fixtures|setup)\//.test(f) || /^tsconfig.*\.json$/.test(f) || /^vitest\.config\./.test(f) || /^tests\/unit\/.*(Ratchet|Compliance)\.test\.ts$/.test(f);
const flat = (value, prefix = '', out = {}) => {
  if (typeof value === 'number') out[prefix] = value;
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flat(v, prefix ? `${prefix} > ${k}` : k, out);
  return out;
};
// Lines of code, comments taken out: a commented-out assertion is a removed one.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'));
const ASSERT = /\bexpect\(|\bcheck\(|\bassert[.(]/;
const VACUOUS = /\bexpect\(\s*(true|false|1|0|null|undefined)\s*\)\s*\.\s*(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)|\bexpect\(\s*true\s*\)\s*\.\s*toBeTruthy\(|\bassert\(\s*true\s*\)|\bcheck\(\s*(['"`]).*?\2\s*,\s*true\s*[,)]/;
const SKIP = /\b(it|test|describe)\.(skip|todo|only|skipIf|fails)\(|\bx(it|describe|test)\(/;
const SILENCE = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable/;
const count = (text, re) => code(text).filter((l) => re.test(l)).length;
const countRaw = (text, re) => text.split('\n').filter((l) => re.test(l)).length;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const weakened = [];
/** One file, as it was and as it is. `was` may be under another name. */
function compare(file, before, after, wasFile = file) {
  if (isBaseline(file)) {
    try {
      const was = flat(JSON.parse(before)); const now = flat(JSON.parse(after));
      const rises = Object.entries(now).filter(([k, v]) => was[k] === undefined || v > was[k]).map(([k, v]) => `${k} ${was[k] === undefined ? 'new at' : `${was[k]} ->`} ${v}`);
      if (rises.length) weakened.push(`${file}: the baseline was raised (${rises.slice(0, 4).join('; ')}${rises.length > 4 ? `; and ${rises.length - 4} more` : ''})`);
    } catch { weakened.push(`${file}: the baseline was changed and can no longer be read`); }
    return;
  }
  if (isTest(wasFile)) {
    if (!isTest(file)) { weakened.push(`${wasFile}: renamed to ${file}, where the tests no longer run`); return; }
    const lost = count(before, ASSERT) - count(after, ASSERT);
    if (lost > 0) weakened.push(`${file}: ${plural(lost, 'assertion')} removed`);
    const vacuous = count(after, VACUOUS) - count(before, VACUOUS);
    if (vacuous > 0) weakened.push(`${file}: ${plural(vacuous, 'assertion')} that cannot fail`);
    const skips = count(after, SKIP) - count(before, SKIP);
    if (skips > 0) weakened.push(`${file}: ${plural(skips, 'test')} skipped or narrowed`);
    if (/@acceptance/.test(before.slice(0, 2000)) && before !== after) weakened.push(`${file}: an acceptance probe was edited after it was written (the builder does not edit it)`);
  }
  if (isRules(file) && before !== after) weakened.push(`${file}: what a check counts, or how the code is compiled, was changed`);
  if (/^(src|ext|electron)\//.test(file)) {
    const silenced = countRaw(after, SILENCE) - countRaw(before, SILENCE);
    if (silenced > 0) weakened.push(`${file}: ${plural(silenced, 'type or lint error')} silenced`);
  }
}

// Files git has never seen (new this session) are remembered here between runs, so a
// later edit to one is seen too: their first sight is their "before".
state.seen = state.seen ?? {};
const watched = (f) => isTest(f) || isBaseline(f) || isRules(f);
const WATCH = ['tests', 'src', 'ext', 'electron', 'tsconfig.json', 'tsconfig.test.json', 'vitest.config.ts'];
const newHere = new Map(); // path -> text, for files not in the session's base
const gone = [];
for (const row of lines(tryGit('diff', '-M', '--name-status', base, '--', ...WATCH))) {
  const [kind, a, b] = row.split('\t');
  const file = b ?? a;
  if (kind.startsWith('D')) { if (isTest(a)) gone.push(a); continue; }
  const after = readNow(file);
  if (after === null) continue;
  if (kind.startsWith('A')) { if (watched(file)) newHere.set(file, after); continue; }
  const before = show(base, kind.startsWith('R') ? a : file);
  if (before !== null) compare(file, before, after, kind.startsWith('R') ? a : file);
}
for (const f of untracked) if (watched(f) && !newHere.has(f)) { const t = readNow(f); if (t !== null) newHere.set(f, t); }
// A test moved without git shows as one file gone and one new: the same text under a new name is a move.
for (const f of gone) {
  const before = show(base, f) ?? '';
  const moved = [...newHere.entries()].find(([, text]) => text === before);
  if (moved) compare(moved[0], before, moved[1], f);
  else weakened.push(`${f}: the test file was deleted`);
}
for (const [file, text] of newHere) {
  const first = state.seen[file];
  if (first === undefined) { state.seen[file] = text; continue; }
  if (first !== text) compare(file, first, text);
}
for (const f of Object.keys(state.seen)) if (!newHere.has(f)) delete state.seen[f];

// Named already, and still weakened. One that was put back is forgotten, so weakening it again is named again.
const reported = new Set((Array.isArray(state.reported) ? state.reported : []).filter((w) => weakened.includes(w)));
state.reported = [...reported];
const fresh = weakened.filter((w) => !reported.has(w));
// Owed to the owner: only what is still weakened. A check that was put back is no longer his concern.
state.owed = (state.owed ?? []).filter((w) => weakened.includes(w));
const nameThem = () => { for (const w of fresh) { reported.add(w); if (!state.owed.includes(w)) state.owed.push(w); } state.reported = [...reported]; };
const weakenedNote = (list) => `These checks were weakened in this session:\n${list.map((w) => `- ${w}`).join('\n')}\n\nA check is changed only when the check was wrong, never to get a pass. Put back each one that was changed to get a pass. For each that is right to change, name it and say why in your reply to the owner and in the commit message; he does not read the code, and this list is what he reads. (If one came with a pull from the other machine, say so.)`;

// ── The checks ──────────────────────────────────────────────────────────────
const failures = [];
const run = (name, args) => {
  const left = BUDGET_MS - (Date.now() - started);
  if (left < 20_000) { failures.push(`${name}: not run, the hook ran out of time. Run it yourself.`); return; }
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: left, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
  if (r.status === 0) return;
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const keep = out.split('\n').filter((l) => /error TS|FAIL|AssertionError|Error:|×|✗|expected|\+ |- |Unhandled|originated|stale|grew|gained|builds more|copied/.test(l)).slice(0, 40);
  failures.push(`${name} failed${r.error ? ` (${r.error.message})` : ''}:\n${(keep.length ? keep : out.trim().split('\n').slice(-25)).join('\n')}`);
};

const source = changed.filter((f) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(f));
if (source.length) {
  const appTs = source.some((f) => (f.startsWith('src/') && f.endsWith('.ts')) || f === 'tsconfig.json' || f === 'package.json');
  const testTs = source.some((f) => f.startsWith('tests/unit/') || f === 'tsconfig.test.json');
  if (appTs) run('Typecheck (the app)', [tsc, '--noEmit']);
  if (appTs || testTs) run('Typecheck (the tests)', [tsc, '-p', 'tsconfig.test.json']);
  // The house ratchets and compliance tests: sizes, hand-built DOM, handlers, tokens, copy, copied code, the reference docs.
  run('Ratchets and compliance', [vitest, 'run', 'Ratchet', 'Compliance', 'referenceDocs']);
  // The unit tests that import what changed (and the changed tests themselves).
  const related = source.filter((f) => /^(src|ext|tests\/unit)\//.test(f) && fs.existsSync(path.join(root, f)));
  if (related.length && related.length <= 40) run('Unit tests for the changed files', [vitest, 'related', '--run', '--passWithNoTests', ...related]);
  // Too many to pick from: the whole suite, so the tree can still pass and be remembered.
  else if (related.length > 40) run('The unit tests (all of them: more than 40 files changed)', [vitest, 'run']);
}

if (failures.length) {
  const report = `Checks failed on the code changed in this session (${plural(changed.length, 'file')}). Fix the cause, whoever caused it; do not skip or loosen a test.\n\n${failures.join('\n\n')}`;
  // What failed on which tree. Not the report's text: a runner prints each failing test's time, never the same twice.
  const failureHash = sha(`${fingerprint}\n${failures.map((f) => f.split('\n')[0]).join('\n')}`);
  // Already sent back once and nothing moved: let the turn end, and tell the person instead of looping.
  if (input.stop_hook_active && state.lastFailure === failureHash) {
    nameThem();
    allow(`Checks are still failing and Claude has stopped anyway:\n${failures.map((f) => `- ${f.split('\n')[0]}`).join('\n')}`);
  }
  state.lastFailure = failureHash;
  nameThem();
  save();
  process.stderr.write(fresh.length ? `${report}\n\n${weakenedNote(fresh)}` : report);
  process.exit(2);
}

// The checks pass. This tree is remembered, so it is not checked again.
state.head = head;
state.fingerprint = fingerprint;
state.lastFailure = undefined;
if (!fresh.length) allow();
// Some checks were weakened on the way: Claude is sent back once for them. They reach the owner at the next stop.
nameThem();
save();
process.stderr.write(`The checks pass. ${weakenedNote(fresh)}`);
process.exit(2);
