// stopHook.test.ts — the stop hook (.claude/hooks/stop-check.mjs) in throwaway repositories.
//
// The owner does not read the code; the hook's list of weakened checks is
// what he reads. So the hook itself is tested: each case below is a way a
// weakened check once slipped through or its notice was lost (found by an
// independent review, 2026-11-15, each reproduced by running).
//
// Every case builds a small git repository with stand-ins for the
// typecheck and the test runner, makes a change, and runs the real hook.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HOOK = resolve(__dirname, '..', '..', '.claude', 'hooks', 'stop-check.mjs');
let repo = '';

const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (file: string, text: string): void => { mkdirSync(dirname(join(repo, file)), { recursive: true }); writeFileSync(join(repo, file), text); };
const read = (file: string): string => readFileSync(join(repo, file), 'utf8');
const commit = (message: string): void => { git('add', '-A'); git('commit', '-q', '-m', message); };
/** Run the hook as Claude Code does at a stop. */
function stop(input: Record<string, unknown> = {}): { code: number; told: string; blocked: string } {
  const r = spawnSync(process.execPath, [HOOK], { cwd: repo, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
  let told = '';
  try { told = JSON.parse(r.stdout || '{}').systemMessage ?? ''; } catch { told = r.stdout; }
  return { code: r.status ?? -1, told, blocked: r.stderr ?? '' };
}
/** Whether the checks are made to fail (the stand-in test runner reads this file). */
const failChecks = (on: boolean): void => { if (on) write('node_modules/.fail', '1'); else rmSync(join(repo, 'node_modules/.fail'), { force: true }); };

const TEST = `import { it, expect } from 'vitest';
it('adds', () => {
  expect(1 + 1).toBe(2);
  expect(2 + 2).toBe(4);
  expect(3 + 3).toBe(6);
});
`;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'px-stop-hook-'));
  git('init', '-q', '-b', 'dev');
  git('config', 'user.email', 'probe@example.invalid');
  git('config', 'user.name', 'Probe');
  git('config', 'commit.gpgsign', 'false');
  write('.gitignore', 'node_modules/\n');
  // Stand-ins for the typecheck and the test runner: they pass unless told to fail.
  const stub = `import fs from 'node:fs'; import path from 'node:path';\nif (fs.existsSync(path.join(process.cwd(), 'node_modules/.fail'))) { console.error('FAIL a check failed'); process.exit(1); }\n`;
  write('node_modules/typescript/bin/tsc', stub.replace(/import (\w+) from '([^']+)';/g, "const $1 = require('$2');"));
  write('node_modules/vitest/vitest.mjs', stub);
  write('src/x.ts', 'export const x = 1;\n// eslint-disable-next-line\nexport const y = 2;\n');
  write('tests/unit/a.test.ts', TEST);
  write('tests/unit/file-size-baseline.json', '{\n  "src/big.ts": 900\n}\n');
  write('tests/probes/look-baseline.json', '{\n  "Home": { "smallTarget": 5 }\n}\n');
  write('tests/unit/fixtures/rules.ts', 'export const WINDOW = 10;\n');
  write('tsconfig.json', '{ "compilerOptions": { "strict": true } }\n');
  commit('start');
});
afterEach(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

const dropAssertion = (): void => write('tests/unit/a.test.ts', TEST.replace('  expect(2 + 2).toBe(4);\n', ''));

describe('the stop hook: what it lets through', () => {
  it('a tree with nothing changed stops at once, and says nothing', () => {
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
  });

  it('a harmless change passes, and passes again without re-running', () => {
    write('src/x.ts', read('src/x.ts') + 'export const z = 3;\n');
    expect(stop().code).toBe(0);
    failChecks(true); // a second run would fail if the checks ran again
    expect(stop().code).toBe(0);
  });

  it('a failing check sends Claude back with the reason', () => {
    write('src/x.ts', read('src/x.ts') + 'export const z = 3;\n');
    failChecks(true);
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/Checks failed/);
  });
});

describe('the stop hook: a weakened check is named', () => {
  it('an assertion removed: Claude is sent back once, then the owner is told once', () => {
    dropAssertion();
    const first = stop();
    expect(first.code).toBe(2);
    expect(first.blocked).toMatch(/a\.test\.ts: 1 assertion removed/);
    const second = stop({ stop_hook_active: true });
    expect(second.code).toBe(0);
    expect(second.told).toMatch(/a\.test\.ts: 1 assertion removed/);
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
  });

  it('with no saved state, a weakening committed in the first turn is still named (H3)', () => {
    dropAssertion();
    commit('work');
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/1 assertion removed/);
  });

  it('the notice survives a later edit elsewhere (H1)', () => {
    stop();
    dropAssertion();
    commit('work');
    expect(stop().code).toBe(2);
    write('src/x.ts', read('src/x.ts') + 'export const z = 3;\n');
    const r = stop({ stop_hook_active: true });
    expect(r.code).toBe(0);
    expect(r.told).toMatch(/1 assertion removed/);
  });

  it('the notice survives a commit that touches no code, and an amend (H2)', () => {
    stop();
    dropAssertion();
    commit('work');
    expect(stop().code).toBe(2);
    write('README.md', 'notes\n');
    commit('docs');
    git('commit', '-q', '--amend', '-m', 'docs, and why the assertion went');
    const r = stop({ stop_hook_active: true });
    expect(r.code).toBe(0);
    expect(r.told).toMatch(/1 assertion removed/);
  });

  it('the same weakening is not sent back or told a second time (H11)', () => {
    dropAssertion();
    expect(stop().code).toBe(2);
    write('src/x.ts', read('src/x.ts') + 'export const z = 3;\n');
    const second = stop();
    expect(second.code).toBe(0);
    expect(second.told).toMatch(/1 assertion removed/);
    write('src/x.ts', read('src/x.ts') + 'export const w = 4;\n');
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
  });

  it('a weakening that was put back is not told to the owner', () => {
    dropAssertion();
    expect(stop().code).toBe(2);
    write('tests/unit/a.test.ts', TEST);
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
  });

  it('a renamed test that lost an assertion is named (H4)', () => {
    git('mv', 'tests/unit/a.test.ts', 'tests/unit/b.test.ts');
    write('tests/unit/b.test.ts', TEST.replace('  expect(2 + 2).toBe(4);\n', ''));
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/b\.test\.ts: 1 assertion removed/);
  });

  it('a test renamed so the runner no longer finds it is named (H5)', () => {
    git('mv', 'tests/unit/a.test.ts', 'tests/unit/a.test.ts.off');
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/no longer run/);
  });

  it('an assertion commented out, or swapped for one that cannot fail, is named (H6)', () => {
    write('tests/unit/a.test.ts', TEST.replace('  expect(2 + 2).toBe(4);', '  // expect(2 + 2).toBe(4);').replace('  expect(3 + 3).toBe(6);', '  expect(true).toBe(true);'));
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/assertions? removed/);
    expect(r.blocked).toMatch(/cannot fail/);
  });

  it('a new test file that loses assertions before it is ever committed is named (H7)', () => {
    write('tests/unit/new.test.ts', TEST);
    expect(stop().code).toBe(0);
    write('tests/unit/new.test.ts', TEST.replace('  expect(2 + 2).toBe(4);\n', ''));
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/new\.test\.ts: 1 assertion removed/);
  });

  it('an acceptance probe edited after it was written is named, committed or not (H7)', () => {
    write('tests/probes/piece-acceptance.mjs', '// @acceptance: written from the request before the build.\ncheck("a", true);\ncheck("b", true);\n');
    expect(stop().code).toBe(0);
    write('tests/probes/piece-acceptance.mjs', '// @acceptance: written from the request before the build.\ncheck("a", true);\ncheck("b", true);\ncheck("c", true);\n');
    commit('the piece, with its probe');
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/piece-acceptance\.mjs: an acceptance probe was edited/);
  });

  it('a raised baseline is named, under tests/unit and under tests/probes, nested or flat (H8)', () => {
    write('tests/unit/file-size-baseline.json', '{\n  "src/big.ts": 950\n}\n');
    write('tests/probes/look-baseline.json', '{\n  "Home": { "smallTarget": 50 }\n}\n');
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/file-size-baseline\.json: the baseline was raised \(src\/big\.ts 900 -> 950\)/);
    expect(r.blocked).toMatch(/look-baseline\.json: the baseline was raised \(Home > smallTarget 5 -> 50\)/);
  });

  it('a lowered baseline is not named', () => {
    write('tests/unit/file-size-baseline.json', '{\n  "src/big.ts": 850\n}\n');
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
  });

  it('a change to what a check counts, or to the compiler settings, is named (H9)', () => {
    write('tests/unit/fixtures/rules.ts', 'export const WINDOW = 40;\n');
    write('tsconfig.json', '{ "compilerOptions": { "strict": false } }\n');
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/fixtures\/rules\.ts/);
    expect(r.blocked).toMatch(/tsconfig\.json/);
  });

  it('a silenced error is named; a file merely renamed with one already in it is not (H10)', () => {
    git('mv', 'src/x.ts', 'src/y.ts');
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
    write('src/y.ts', read('src/y.ts') + '// @ts-ignore\nexport const bad: number = "no";\n');
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/y\.ts: 1 type or lint error silenced/);
  });

  it('a test moved without git is not reported as deleted (H14)', () => {
    renameSync(join(repo, 'tests/unit/a.test.ts'), join(repo, 'tests/unit/moved.test.ts'));
    expect(stop()).toEqual({ code: 0, told: '', blocked: '' });
  });

  it('a test deleted is named', () => {
    rmSync(join(repo, 'tests/unit/a.test.ts'));
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/a\.test\.ts: the test file was deleted/);
  });

  it('when a check fails and one was weakened, both reach Claude, and the owner if Claude stops anyway (H13)', () => {
    dropAssertion();
    failChecks(true);
    const first = stop();
    expect(first.code).toBe(2);
    expect(first.blocked).toMatch(/Checks failed/);
    expect(first.blocked).toMatch(/1 assertion removed/);
    const second = stop({ stop_hook_active: true });
    expect(second.code).toBe(0);
    expect(second.told).toMatch(/still failing/);
    expect(second.told).toMatch(/1 assertion removed/);
  });

  it('a file in a new folder is checked, not skipped (H15)', () => {
    write('src/feat/a.ts', 'export const a = 1;\n');
    expect(stop().code).toBe(0);
    write('src/feat/a.ts', 'export const a = 2;\n');
    failChecks(true);
    expect(stop().code).toBe(2);
  });

  it('a check put back and then weakened again is named again (review of 2026-11-15, second pass)', () => {
    dropAssertion();
    expect(stop().code).toBe(2);
    write('tests/unit/a.test.ts', TEST);
    expect(stop().code).toBe(0);
    dropAssertion();
    const again = stop();
    expect(again.code).toBe(2);
    expect(again.blocked).toMatch(/1 assertion removed/);
    expect(stop({ stop_hook_active: true }).told).toMatch(/1 assertion removed/);
  });

  it('a failing test whose reported time differs from run to run still lets the second stop end, and tells the owner', () => {
    // The real runner prints each failing test with how long it took; that number is never the same twice.
    write('node_modules/vitest/vitest.mjs', "console.error('FAIL tests/unit/a.test.ts');\nconsole.error(' × adds ' + process.hrtime.bigint() + 'ms');\nprocess.exit(1);\n");
    write('src/x.ts', read('src/x.ts') + 'export const z = 3;\n');
    expect(stop().code).toBe(2);
    for (let i = 0; i < 3; i++) {
      const next = stop({ stop_hook_active: true });
      expect(next.code).toBe(0);
      expect(next.told).toMatch(/still failing/);
    }
  });

  it('a change of more than 40 files runs the whole suite and can pass, and stays passed', () => {
    for (let i = 0; i < 41; i++) write(`src/many/f${i}.ts`, `export const v${i} = ${i};\n`);
    const first = stop();
    expect(first).toEqual({ code: 0, told: '', blocked: '' });
    failChecks(true); // a second run would fail if the checks ran again
    expect(stop().code).toBe(0);
    failChecks(false);
    commit('many');
    expect(stop().code).toBe(0);
  });

  it('a change of more than 40 files with a failing suite is sent back', () => {
    for (let i = 0; i < 41; i++) write(`src/many/f${i}.ts`, `export const v${i} = ${i};\n`);
    failChecks(true);
    const r = stop();
    expect(r.code).toBe(2);
    expect(r.blocked).toMatch(/The unit tests/);
  });

  it('keeps its record inside .git, out of the working tree', () => {
    dropAssertion();
    stop();
    expect(existsSync(join(repo, '.git', 'claude-stop-check.json'))).toBe(true);
    expect(git('status', '--porcelain')).not.toMatch(/claude-stop-check/);
  });
});
