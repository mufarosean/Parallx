#!/usr/bin/env node
// scripts/preserve-slice.mjs
//
// Executable preservation gate for slice/milestone closure. Required to be
// green before closing any slice that touches a preservation surface defined
// in /memories/repo/orchestrator-discipline.md and PARALLX_MANIFEST.md §11.
//
// Steps (run sequentially; bail on first failure):
//   1. tsc --noEmit
//   2. vitest run (unit suite)
//   3. Playwright canvas e2e (tests/e2e/09-canvas.spec.ts)
//   4. Playwright cross-tool preservation specs (workspaces, explorer)
//
// On success writes .slice-closure-ok with a JSON receipt containing the HEAD
// sha and timestamp. scripts/check-slice-closure.mjs reads that receipt.
//
// Exit code 0 = green. Anything else = preservation regression; do not close
// the slice.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const PRESERVATION_E2E_SPECS = [
  'tests/e2e/09-canvas.spec.ts',
  'tests/e2e/08-workspaces.spec.ts',
  'tests/e2e/02-explorer.spec.ts',
];

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`\nFAIL: ${label} exited with code ${res.status}`);
    process.exit(res.status ?? 1);
  }
  console.log(`PASS: ${label}`);
}

function gitSha() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return (res.stdout || '').trim();
}

run('tsc --noEmit', 'npx', ['tsc', '--noEmit']);
run('unit suite (vitest)', 'npx', ['vitest', 'run']);
run('preservation e2e', 'npx', ['playwright', 'test', ...PRESERVATION_E2E_SPECS]);

const receipt = {
  ok: true,
  head: gitSha(),
  timestamp: new Date().toISOString(),
  steps: ['tsc', 'vitest', 'playwright-preservation'],
  preservationSpecs: PRESERVATION_E2E_SPECS,
};

const receiptDir = join(repoRoot, '.slice-closure');
mkdirSync(receiptDir, { recursive: true });
writeFileSync(join(receiptDir, 'last-run.json'), JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(join(repoRoot, '.slice-closure-ok'), `${receipt.head}\n${receipt.timestamp}\n`);

console.log('\nALL PRESERVATION GATES GREEN');
console.log(`HEAD: ${receipt.head}`);
console.log('Receipt: .slice-closure/last-run.json');
console.log('Marker:  .slice-closure-ok');
