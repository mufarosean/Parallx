#!/usr/bin/env node
/**
 * M84 / SR-4 fitness harness composer.
 *
 * Invoked by `npm run test:system-fitness`. Behaviour:
 *
 *   1. Allocates a fresh tmp directory for per-module JSON.
 *   2. Forwards `--only <module>` (and any other args) to playwright as
 *      `--grep <module>` so a single module can be exercised in isolation.
 *   3. Runs `npx playwright test --config=playwright.fitness.config.ts`
 *      with PARALLX_FITNESS_OUT set to the tmp directory.
 *   4. Reads every per-module JSON from the tmp directory and composes
 *      the top-level report.
 *   5. Writes the composed report to `data/fitness-reports/<ISO>.json`.
 *   6. Exits 0 if `overallStatus === 'ok'` and playwright succeeded;
 *      otherwise exits with the first non-zero code encountered.
 *
 * Anti-list compliance: pure orchestration; touches no `src/**` or
 * `electron/**` source. The `data/` directory is gitignored.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const REPORT_DIR = join(ROOT, 'data', 'fitness-reports');

function captureProvenance() {
  let gitHead = null;
  try {
    const head = fs.readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const refPath = join(ROOT, '.git', head.slice(5));
      gitHead = fs.readFileSync(refPath, 'utf8').trim().slice(0, 8);
    } else {
      gitHead = head.slice(0, 8);
    }
  } catch { /* not a git checkout */ }
  return {
    gitHead,
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? null,
    hostOs: `${os.platform()} ${os.release()}`,
  };
}

function parseArgs(argv) {
  const out = { passthrough: [], only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) {
      out.only = argv[i + 1];
      i++;
    } else {
      out.passthrough.push(argv[i]);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'parallx-fitness-'));
process.env.PARALLX_FITNESS_OUT = tmpDir;

const playwrightArgs = [
  'playwright',
  'test',
  '--config=playwright.fitness.config.ts',
  ...args.passthrough,
];
if (args.only) playwrightArgs.push('--grep', args.only);

console.log(`[fitness] running playwright; per-module reports → ${tmpDir}`);
const result = spawnSync('npx', playwrightArgs, {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

const playwrightExit = result.status ?? 1;

// Compose per-module JSON files into one report.
let modules = [];
try {
  const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(join(tmpDir, file), 'utf8'));
    modules.push(payload);
  }
} catch (err) {
  console.error('[fitness] failed to read per-module reports:', err);
}

const overallStatus = modules.some((m) => m.status === 'fail') ? 'fail' : 'ok';
const composed = {
  schemaVersion: 1,
  milestone: 'M84',
  ranAt: new Date().toISOString(),
  provenance: captureProvenance(),
  modules,
  overallStatus,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
const reportFile = join(REPORT_DIR, `${composed.ranAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(reportFile, JSON.stringify(composed, null, 2), 'utf8');
console.log(`[fitness] composed report → ${reportFile}`);
console.log(`[fitness] overallStatus = ${overallStatus}; modules = ${modules.length}`);

// Clean up tmp dir.
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

if (playwrightExit !== 0) process.exit(playwrightExit);
if (overallStatus !== 'ok') process.exit(2);
process.exit(0);
