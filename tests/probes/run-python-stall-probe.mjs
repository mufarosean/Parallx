// run-python-stall-probe.mjs — live verification of the script stall watchdog.
//
// The `python.runTimeoutMs` limit is a STALL window, not a wall-clock cap: a
// run dies after that long WITHOUT output, while a run that keeps printing
// progress keeps running. vitest cannot exercise this — the watchdog kills a
// real process tree via taskkill — so this probe drives the REAL
// pythonBridge.runScript against real child processes:
//
//   A) heartbeat.py — prints every 0.4s for ~5s with a 1.5s stall window.
//      Under the old wall-clock rule it died at 1.5s; now it must finish.
//   B) silent.py    — prints once, then sleeps silently. Must be killed
//      ~1.5s after its last output, and its process must actually be gone.
//   C) runaway.py   — blows through the 2MB output cap, then keeps printing
//      forever. Post-cap output must NOT count as activity: killed too.
//
// The fake workspace venv is a copied system python.exe + pyvenv.cfg (the
// standard Windows venv layout), so no `python -m venv` install is needed.
//
// Headless: no Electron app, no window (dev machine = study machine).
// Run: node tests/probes/run-python-stall-probe.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const bridge = require_(path.join(ROOT, 'electron', 'pythonBridge.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

// ── Fake workspace with a real-enough venv ──────────────────────────────────

const sys = bridge.detectSystemPython();
if (!sys) {
  console.error('No system Python >= 3.10 found — cannot run this probe.');
  process.exit(2);
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-probe-ws-'));
const p = bridge.envPaths(ws);
fs.mkdirSync(p.binDir, { recursive: true });
fs.copyFileSync(sys.command, p.pythonExe);
// Like a real Windows venv: the exe needs the interpreter DLLs beside it
// (python3xx.dll, vcruntime…), and pyvenv.cfg makes it resolve the stdlib
// from the base installation.
const sysDir = path.dirname(sys.command);
for (const f of fs.readdirSync(sysDir)) {
  if (f.toLowerCase().endsWith('.dll')) fs.copyFileSync(path.join(sysDir, f), path.join(p.binDir, f));
}
fs.writeFileSync(path.join(p.venvDir, 'pyvenv.cfg'),
  `home = ${sysDir}\nversion = ${sys.version}\ninclude-system-site-packages = false\n`);

const marks = path.join(ws, 'marks');
fs.mkdirSync(marks, { recursive: true });
const mark = (name) => path.join(marks, name).replace(/\\/g, '/');

fs.writeFileSync(path.join(ws, 'heartbeat.py'), `
import time
start = time.time()
with open(r"${mark('heartbeat.txt')}", "a") as fh:
    for i in range(12):                      # ~4.8s of work, 0.4s cadence
        print(f"tick {i}", flush=True)
        fh.write(f"{time.time() - start:.2f}\\n"); fh.flush()
        time.sleep(0.4)
    fh.write("done\\n"); fh.flush()
print("done", flush=True)
`);

fs.writeFileSync(path.join(ws, 'silent.py'), `
import os, time
with open(r"${mark('silent.pid')}", "w") as fh:
    fh.write(str(os.getpid()))
print("starting", flush=True)                # last output, then silence
time.sleep(30)
with open(r"${mark('silent-survived.txt')}", "w") as fh:
    fh.write("should never exist")
`);

fs.writeFileSync(path.join(ws, 'runaway.py'), `
import os, time
with open(r"${mark('runaway.pid')}", "w") as fh:
    fh.write(str(os.getpid()))
for _ in range(40):                          # ~2.5MB fast: past the 2MB cap
    print("x" * 65536, flush=True)
while True:                                  # endless post-cap chatter
    print("still here", flush=True)
    time.sleep(0.1)
`);

// ── A: heartbeat outlives the old wall-clock limit ──────────────────────────

console.log('\n=== stall watchdog probe (window: 1.5s) ===\n');

const a = await bridge.runScript(ws, 'heartbeat.py', [], { timeout: 1500 });
check('heartbeat: run starts', a.ok === true, a.error);
await sleep(7000);
const beats = fs.existsSync(mark('heartbeat.txt')) ? fs.readFileSync(mark('heartbeat.txt'), 'utf8').trim().split('\n') : [];
check('heartbeat: survived far past the 1.5s window while printing',
  beats.length >= 12 && Number(beats[11]) > 4, `got ${beats.length} beats, last ${beats[beats.length - 1]}`);
check('heartbeat: ran to completion, not killed', beats[beats.length - 1] === 'done', beats[beats.length - 1]);

// ── B: silence kills, and the process is really gone ────────────────────────

const b = await bridge.runScript(ws, 'silent.py', [], { timeout: 1500 });
check('silent: run starts', b.ok === true, b.error);
await sleep(4000);
const silentPid = Number(fs.readFileSync(mark('silent.pid'), 'utf8'));
check('silent: process killed after the stall window', !alive(silentPid), `pid ${silentPid} still alive`);
check('silent: never reached post-sleep code', !fs.existsSync(mark('silent-survived.txt')));

// ── C: post-cap output is not activity ──────────────────────────────────────

const c = await bridge.runScript(ws, 'runaway.py', [], { timeout: 1500 });
check('runaway: run starts', c.ok === true, c.error);
await sleep(6000);
const runawayPid = Number(fs.readFileSync(mark('runaway.pid'), 'utf8'));
check('runaway: endless printing past the output cap cannot keep it alive',
  !alive(runawayPid), `pid ${runawayPid} still alive`);

// ── Cleanup ─────────────────────────────────────────────────────────────────

bridge.cancelWorkspaceRuns(ws);
await sleep(300);
try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(failures === 0 ? '\nAll stall-probe checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
