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
// It also names every check that was weakened since the last pass: an
// assertion removed, a test skipped or deleted, a ratchet baseline raised, a
// ratchet's own rules changed, a type or lint error silenced, an acceptance
// probe edited. A model under pressure to pass a check tends to change the
// check. The owner does not read the code; this list is what he reads.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(import.meta.dirname, '../..');
/** What counts as the app's code: a change elsewhere (docs, probes, .claude) is not checked here. */
const PATHS = ['src', 'ext', 'electron', 'scripts', 'tests/unit', 'tests/probes', 'package.json', 'tsconfig.json', 'tsconfig.test.json', 'vitest.config.ts'];
const BUDGET_MS = 9 * 60_000;
const started = Date.now();

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (...args) => { try { return git(...args); } catch { return ''; } };
const allow = (message) => { if (message) process.stdout.write(JSON.stringify({ systemMessage: message })); process.exit(0); };

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no input: carry on */ }

const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const vitest = path.join(root, 'node_modules/vitest/vitest.mjs');
// Dependencies not installed (a fresh cloud session): nothing can be checked, and that is not Claude's to fix here.
if (!fs.existsSync(tsc) || !fs.existsSync(vitest)) allow();

const head = tryGit('rev-parse', 'HEAD').trim();
if (!head) allow();
const gitDir = path.resolve(root, tryGit('rev-parse', '--git-dir').trim() || '.git');
const stateFile = path.join(gitDir, 'claude-stop-check.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first run */ }
const save = (next) => { try { fs.writeFileSync(stateFile, JSON.stringify(next)); } catch { /* read-only checkout */ } };

// What changed: commits made since the last pass, and work not yet committed.
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const isAncestor = (older, newer) => { try { git('merge-base', '--is-ancestor', older, newer); return true; } catch { return false; } };
const sinceLastPass = state.head && state.head !== head && isAncestor(state.head, head)
  ? lines(tryGit('diff', '--name-only', `${state.head}..${head}`, '--', ...PATHS)) : [];
const status = tryGit('status', '--porcelain', '--', ...PATHS).split('\n').filter((l) => l.length > 3);
const uncommitted = status.map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop());
const untracked = status.filter((l) => l.startsWith('??')).map((l) => l.slice(3).replace(/^"|"$/g, ''));
const changed = [...new Set([...sinceLastPass, ...uncommitted])].filter((f) => !f.endsWith('/'));

const hash = createHash('sha1').update(head).update(tryGit('diff', 'HEAD', '--', ...PATHS));
for (const f of untracked.sort()) { try { const p = path.join(root, f); if (fs.statSync(p).isFile()) hash.update(f).update(fs.readFileSync(p)); else hash.update(f); } catch { hash.update(f); } }
const fingerprint = hash.digest('hex');

// Nothing changed since the last pass. If that pass found weakened checks, the person is told now, once.
if (fingerprint === state.fingerprint) {
  if (state.notice) { save({ ...state, notice: undefined }); allow(`Checks weakened in this session (Claude was told to restore them or name each one to you):\n${state.notice}`); }
  allow();
}
if (!changed.length && !untracked.length) { save({ head, fingerprint }); allow(); }

// ── Checks that were weakened ───────────────────────────────────────────────
// Compared with the last pass (or the last commit, the first time).
const baseRef = state.head && state.head !== head && isAncestor(state.head, head) ? state.head : head;
const show = (ref, file) => { try { return git('show', `${ref}:${file}`); } catch { return null; } };
const flat = (value, prefix = '', out = {}) => {
  if (typeof value === 'number') out[prefix] = value;
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flat(v, prefix ? `${prefix} > ${k}` : k, out);
  return out;
};
const weakened = [];
const nameStatus = lines(tryGit('diff', '--name-status', baseRef, '--', 'tests', 'src', 'ext', 'vitest.config.ts'));
for (const line of nameStatus) {
  const [kind, ...rest] = line.split('\t');
  const file = rest[rest.length - 1];
  if (!file) continue;
  const isTest = /^tests\/unit\/.*\.test\.ts$/.test(file) || /^tests\/probes\/.*\.(mjs|cjs)$/.test(file) || /^ext\/.*\/test\//.test(file);
  if (kind.startsWith('D') && isTest) { weakened.push(`${file}: the test file was deleted`); continue; }
  if (kind.startsWith('D') || kind.startsWith('A')) continue;
  const before = show(baseRef, kind.startsWith('R') ? rest[0] : file);
  let after = null; try { after = fs.readFileSync(path.join(root, file), 'utf8'); } catch { /* gone */ }
  if (before === null || after === null) continue;
  // A ratchet baseline may only fall.
  if (/^tests\/unit\/.*-baseline\.json$/.test(file)) {
    try {
      const was = flat(JSON.parse(before)); const now = flat(JSON.parse(after));
      const rises = Object.entries(now).filter(([k, v]) => was[k] === undefined || v > was[k]).map(([k, v]) => `${k} ${was[k] === undefined ? 'new at' : `${was[k]} ->`} ${v}`);
      if (rises.length) weakened.push(`${file}: the baseline was raised (${rises.slice(0, 4).join('; ')}${rises.length > 4 ? `; and ${rises.length - 4} more` : ''})`);
    } catch { weakened.push(`${file}: the baseline was changed and can no longer be read`); }
    continue;
  }
  const diff = tryGit('diff', '-U0', baseRef, '--', file).split('\n');
  const added = diff.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  const removed = diff.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
  const count = (list, re) => list.filter((l) => re.test(l)).length;
  if (isTest) {
    const ASSERT = /\bexpect\(|\bcheck\(|\bassert[.(]/;
    const lost = count(removed, ASSERT) - count(added, ASSERT);
    if (lost > 0) weakened.push(`${file}: ${lost} assertion${lost === 1 ? '' : 's'} removed`);
    const SKIP = /\b(it|test|describe)\.(skip|todo|only|skipIf|fails)\(|\bx(it|describe|test)\(/;
    const skips = count(added, SKIP) - count(removed, SKIP);
    if (skips > 0) weakened.push(`${file}: ${skips} test${skips === 1 ? '' : 's'} skipped or narrowed`);
    if (/@acceptance/.test(before.slice(0, 2000))) weakened.push(`${file}: an acceptance probe was edited after it was written (the builder does not edit it)`);
    if (/(Ratchet|Compliance)\.test\.ts$/.test(file)) weakened.push(`${file}: a ratchet's own rules were changed (what it counts, or what it leaves out)`);
  } else if (/^(src|ext)\//.test(file)) {
    const SILENCE = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable/;
    const silenced = count(added, SILENCE) - count(removed, SILENCE);
    if (silenced > 0) weakened.push(`${file}: ${silenced} type or lint error${silenced === 1 ? '' : 's'} silenced`);
  } else if (file === 'vitest.config.ts') {
    weakened.push(`${file}: the test runner's configuration was changed`);
  }
}

// The checks.
const failures = [];
const run = (name, args) => {
  const left = BUDGET_MS - (Date.now() - started);
  if (left < 20_000) { failures.push(`${name}: not run, the hook ran out of time. Run it yourself.`); return; }
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: left, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
  if (r.status === 0) return;
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const keep = out.split('\n').filter((l) => /error TS|FAIL|AssertionError|Error:|×|✗|expected|\+ |- |Unhandled|originated|stale|grew|gained|builds more/.test(l)).slice(0, 40);
  failures.push(`${name} failed${r.error ? ` (${r.error.message})` : ''}:\n${(keep.length ? keep : out.trim().split('\n').slice(-25)).join('\n')}`);
};

const code = changed.filter((f) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(f));
const appTs = code.some((f) => (f.startsWith('src/') && f.endsWith('.ts')) || f === 'tsconfig.json' || f === 'package.json');
const testTs = code.some((f) => f.startsWith('tests/unit/') || f === 'tsconfig.test.json');
if (appTs) run('Typecheck (the app)', [tsc, '--noEmit']);
if (appTs || testTs) run('Typecheck (the tests)', [tsc, '-p', 'tsconfig.test.json']);
// The house ratchets and compliance tests: sizes, hand-built DOM, handlers, tokens, copy, the reference docs.
run('Ratchets and compliance', [vitest, 'run', 'Ratchet', 'Compliance', 'referenceDocs']);
// The unit tests that import what changed (and the changed tests themselves).
const related = code.filter((f) => /^(src|ext|tests\/unit)\//.test(f) && fs.existsSync(path.join(root, f)));
if (related.length && related.length <= 40) run('Unit tests for the changed files', [vitest, 'related', '--run', '--passWithNoTests', ...related]);
else if (related.length > 40) failures.push('More than 40 files changed: the hook did not pick tests. Run `npx vitest run` yourself before stopping.');

if (!failures.length) {
  if (!weakened.length) { save({ head, fingerprint }); allow(); }
  // The checks pass, and some of them were weakened on the way. Claude is sent back once to restore
  // them or to name each one to the owner; the list reaches him at the next stop whatever Claude does.
  const notice = weakened.map((w) => `- ${w}`).join('\n');
  save({ head, fingerprint, notice });
  process.stderr.write(`The checks pass, but these were weakened in this session:\n${notice}\n\nA check is changed only when the check was wrong, never to get a pass. Restore each one that was changed to get a pass. For each that is right to change, name it and say why in your reply to the owner and in the commit message; he does not read the code, and this list is what he reads.`);
  process.exit(2);
}

const report = `Checks failed on the code changed in this session (${changed.length} files). Fix the cause, whoever caused it; do not skip or loosen a test.\n\n${failures.join('\n\n')}`;
const failureHash = createHash('sha1').update(report).digest('hex');
// Already sent back once and nothing moved: let the turn end, and tell the person instead of looping.
if (input.stop_hook_active && state.lastFailure === failureHash) {
  allow(`Checks are still failing and Claude has stopped anyway:\n${failures.map((f) => f.split('\n')[0]).join('\n')}`);
}
save({ ...state, lastFailure: failureHash });
process.stderr.write(report);
process.exit(2);
