// stop-check.mjs — before Claude may stop, the code it changed is checked.
//
// A Stop hook (.claude/settings.json). When files under the app's code have
// changed since the last time this passed, it runs the typecheck, the
// ratchet and compliance tests, and the unit tests that depend on the
// changed files. A failure is handed back to Claude (exit code 2) so the
// turn goes on until it is fixed; a pass is remembered, so an unchanged tree
// costs nothing. Runs on Linux (cloud) and Windows alike: everything is
// started through node itself, never a shell.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(import.meta.dirname, '../..');
/** What counts as the app's code: a change elsewhere (docs, probes, .claude) is not checked here. */
const PATHS = ['src', 'ext', 'electron', 'scripts', 'tests/unit', 'package.json', 'tsconfig.json', 'tsconfig.test.json'];
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

if (fingerprint === state.fingerprint) allow();
if (!changed.length && !untracked.length) { save({ head, fingerprint }); allow(); }

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

if (!failures.length) { save({ head, fingerprint }); allow(); }

const report = `Checks failed on the code changed in this session (${changed.length} files). Fix the cause, whoever caused it; do not skip or loosen a test.\n\n${failures.join('\n\n')}`;
const failureHash = createHash('sha1').update(report).digest('hex');
// Already sent back once and nothing moved: let the turn end, and tell the person instead of looping.
if (input.stop_hook_active && state.lastFailure === failureHash) {
  allow(`Checks are still failing and Claude has stopped anyway:\n${failures.map((f) => f.split('\n')[0]).join('\n')}`);
}
save({ ...state, lastFailure: failureHash });
process.stderr.write(report);
process.exit(2);
