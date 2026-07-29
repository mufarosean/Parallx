// verify-python-responsiveness.mjs — the main process must stay responsive
// while Python operations run (M97 follow-up).
//
// Reported from the running app: a workspace on a USB stick, and "the whole
// app lags when installation is happening".
//
// The cause was `getEnvSize` — a fully SYNCHRONOUS readdirSync/statSync walk of
// the venv, executed in the Electron MAIN process, which routes every IPC
// message and window event. A venv with ipykernel is ~10,000 files; walking it
// synchronously starves the event loop completely. It ran on every status
// refresh, including right after an install, when the tree is largest and the
// disk busiest.
//
// ── How this measures, and why it took three attempts ───────────────────────
//
// The metric is what fraction of scheduled timer ticks actually fire while the
// work runs. Two earlier attempts were wrong in instructive ways:
//
//   1. "Worst delay between consecutive ticks" — a TRAP. A fully blocking
//      operation prevents the timer firing at all, so the worst delay stays 0
//      and reads as perfect. The broken code PASSED that assertion.
//
//   2. "At least 80% of ticks fire" — an absolute threshold, and above what
//      Windows can deliver. Its default timer quantum is ~15.6ms, so a 20ms
//      interval fires ~64% of the naive expectation even on a completely idle
//      process. Measured here: idle scores 65% at 20ms, 81% at 50ms, 88% at
//      100ms. An absolute bar would fail a healthy machine.
//
// So: a 50ms interval (above the quantum), and every assertion is relative to
// an idle BASELINE measured on this machine at run time. Separation is huge —
// idle ~81%, the old synchronous walk 0% — so any sane ratio discriminates.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = require(path.join(REPO, 'electron', 'pythonBridge.cjs'));

let pass = 0, fail = 0;
const out = [];
const check = (n, c, d = '') => {
  if (c) { pass++; out.push(`  PASS  ${n}`); }
  else { fail++; out.push(`  FAIL  ${n}${d ? ' — ' + String(d).slice(0, 220) : ''}`); }
};

const TICK_MS = 50;

/** Run `work` while a timer ticks; report the fraction of ticks that fired. */
async function measure(work) {
  let ticks = 0;
  const startedAt = Date.now();
  const timer = setInterval(() => { ticks++; }, TICK_MS);
  try {
    const result = await work();
    const wall = Date.now() - startedAt;
    const expected = Math.floor(wall / TICK_MS);
    // Too short to schedule a tick at all — vacuously healthy.
    const health = expected < 2 ? 100 : Math.round((100 * ticks) / expected);
    return { ticks, expected, health, wall, result };
  } finally {
    clearInterval(timer);
  }
}

const WS = path.join(os.tmpdir(), `parallx-resp-${Date.now()}`);
fs.mkdirSync(WS, { recursive: true });

const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };
const handlers = new Map();
bridge.setupPythonBridge({ handle: (c, f) => handlers.set(c, f) }, () => fakeWindow);

try {
  // ── Calibrate against this machine, doing nothing ──
  const idle = await measure(() => new Promise((r) => setTimeout(r, 1000)));
  out.push(`    baseline (idle): ${idle.health}% of scheduled ticks fired`);
  check('baseline is measurable', idle.health > 30,
    `${idle.health}% — the machine is too loaded for this measurement to mean anything`);
  const floor = Math.round(idle.health * 0.5);
  out.push(`    a run is considered healthy at ≥ ${floor}% (half the idle baseline)`);

  // ── Build a genuinely large tree ──
  out.push('  … creating environment and installing ipykernel (slow, once)');
  const created = await handlers.get('python:createEnv')({}, WS);
  check('environment created', created.ok === true, created.error);
  const installed = await handlers.get('python:install')({}, WS, ['ipykernel']);
  check('ipykernel installed', installed.ok === true, installed.error);

  // ── The regression this file exists for ──
  const cold = await measure(() => handlers.get('python:envSize')({}, WS));
  const size = cold.result;
  check('size walk returns a real result', (size.fileCount ?? 0) > 500,
    `${size.fileCount} files — expected thousands for ipykernel`);
  out.push(`    walked ${size.fileCount.toLocaleString()} files / ${(size.sizeBytes / 1048576).toFixed(1)} MB in ${cold.wall}ms`);
  out.push(`    size walk: ${cold.ticks}/${cold.expected} ticks fired (${cold.health}%)`);
  check('event loop keeps turning during the size walk', cold.health >= floor,
    `${cold.health}% vs ${floor}% floor — the old synchronous walk scored 0%`);

  // ── Caching ──
  const warm = await measure(() => handlers.get('python:envSize')({}, WS));
  check('second call is served from cache', warm.result.cached === true, JSON.stringify(warm.result));
  check('cached call returns immediately', warm.wall < 50, `${warm.wall}ms`);

  // ── Invalidation ──
  const before = size.fileCount;
  await handlers.get('python:install')({}, WS, ['six']);
  const after = await handlers.get('python:envSize')({}, WS);
  check('installing invalidates the cache', after.cached === false, JSON.stringify(after));
  check('the refreshed count reflects the new package', after.fileCount >= before, `${before} → ${after.fileCount}`);

  // ── One walk per tree, however many callers ──
  bridge.invalidateSizeCache(WS);
  const pair = await Promise.all([
    handlers.get('python:envSize')({}, WS),
    handlers.get('python:envSize')({}, WS),
  ]);
  check('concurrent size requests share one walk',
    pair[0].fileCount === pair[1].fileCount, JSON.stringify(pair.map((r) => r.fileCount)));

  // ── And during pip itself ──
  const during = await measure(() => handlers.get('python:install')({}, WS, ['six']));
  out.push(`    during pip install: ${during.ticks}/${during.expected} ticks fired (${during.health}%)`);
  check('event loop keeps turning during an install', during.health >= floor,
    `${during.health}% vs ${floor}% floor`);

} catch (err) {
  fail++; out.push(`  FAIL  harness threw: ${err && err.stack}`);
} finally {
  try { bridge.shutdown(); } catch { /* best-effort */ }
  console.log(out.join('\n'));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  await new Promise((r) => setTimeout(r, 1000));
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* leave it */ }
  process.exit(fail === 0 ? 0 : 1);
}
