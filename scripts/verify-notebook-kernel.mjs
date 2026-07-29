// verify-notebook-kernel.mjs — end-to-end notebook verification (M96)
//
// Drives the REAL notebookKernelBridge against a REAL ipykernel in a real
// throwaway workspace, through a fake ipcMain/BrowserWindow. No Electron, no
// visible app. Same approach as scripts/verify-python-bridge.mjs, and for the
// same reason: unit tests cannot spawn a kernel, and every interesting failure
// in this subsystem is a process or protocol failure.
//
// Usage:  node scripts/verify-notebook-kernel.mjs
//
// Costs one venv + `pip install ipykernel` on first run (~1 minute). Pass an
// existing workspace path as argv[2] to reuse its environment.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonBridge = require(path.join(REPO, 'electron', 'pythonBridge.cjs'));
const kernelBridge = require(path.join(REPO, 'electron', 'notebookKernelBridge.cjs'));

// ── Harness ─────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const lines = [];
const log = (m) => { console.log(m); lines.push(m); };
function check(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  PASS  ${name}`); }
  else { fail++; lines.push(`  FAIL  ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`); }
}

/** Every event the bridge pushed toward the renderer. */
const events = [];
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: (_ch, payload) => events.push(payload.event) },
};
kernelBridge.setupNotebookKernelBridge({ handle: () => {} }, () => fakeWindow);

const WS = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.tmpdir(), `parallx-nb-verify-${Date.now()}`);
const EPHEMERAL = !process.argv[2];

let requestSeq = 0;
const nextId = () => `req-${++requestSeq}`;

function eventsFor(requestId) {
  return events.filter((e) => e.requestId === requestId);
}

/** Run code and resolve with everything the kernel said about it. */
async function run(code, timeoutMs = 30000) {
  const id = nextId();
  const posted = kernelBridge.post(WS, { id, type: 'execute', code });
  if (!posted.ok) throw new Error(`post failed: ${posted.error}`);

  const t0 = Date.now();
  for (;;) {
    const reply = events.find((e) => e.requestId === id && e.type === 'reply' && e.of === 'execute');
    if (reply) break;
    if (Date.now() - t0 > timeoutMs) throw new Error(`no reply for ${JSON.stringify(code).slice(0, 60)}`);
    await new Promise((r) => setTimeout(r, 40));
  }
  // Let any trailing iopub land — the kernel sends idle before the reply, but
  // the two channels are independent sockets.
  await new Promise((r) => setTimeout(r, 250));

  const mine = eventsFor(id);
  return {
    id,
    reply: mine.find((e) => e.type === 'reply' && e.of === 'execute'),
    stdout: mine.filter((e) => e.type === 'stream' && e.name === 'stdout').map((e) => e.text).join(''),
    stderr: mine.filter((e) => e.type === 'stream' && e.name === 'stderr').map((e) => e.text).join(''),
    result: mine.find((e) => e.type === 'execute_result'),
    displays: mine.filter((e) => e.type === 'display_data'),
    error: mine.find((e) => e.type === 'error'),
    clears: mine.filter((e) => e.type === 'clear_output'),
    executionCount: mine.find((e) => e.type === 'execute_input')?.executionCount,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

try {
  log(`workspace: ${WS}${EPHEMERAL ? ' (temporary)' : ' (reused)'}`);
  fs.mkdirSync(WS, { recursive: true });

  // ── 1. Environment ──
  log('\n[1] workspace environment');
  const created = await pythonBridge_createEnv(WS);
  check('workspace venv exists', created, 'could not create the environment');

  log('    installing ipykernel (first run only)…');
  const t0 = Date.now();
  const deps = await kernelBridge.checkKernelDeps(WS);
  if (!deps.ready) {
    const install = await pythonBridge_install(WS, ['ipykernel']);
    check('ipykernel installs into the workspace env', install.ok, install.error);
    log(`    → ${Math.round((Date.now() - t0) / 1000)}s`);
  } else {
    log('    → already present');
  }
  const readiness = await kernelBridge.checkKernelDeps(WS);
  check('readiness probe reports ready', readiness.ready === true, readiness.reason);

  // ── 2. Start ──
  log('\n[2] kernel start');
  const started = await kernelBridge.startKernel(WS);
  check('kernel starts', started.ok === true, started.error || started.detail);
  check('reports a python version', typeof started.pythonVersion === 'string', JSON.stringify(started));
  log(`    → Python ${started.pythonVersion}`);

  const second = await kernelBridge.startKernel(WS);
  check('start is idempotent', second.ok === true && second.alreadyRunning === true);

  // ── 3. Execution basics ──
  log('\n[3] execution');
  const hello = await run('print("hello from the kernel")');
  check('stdout streams back', hello.stdout.includes('hello from the kernel'), JSON.stringify(hello.stdout));
  check('reply is ok', hello.reply?.status === 'ok', JSON.stringify(hello.reply));
  check('execution count is reported', typeof hello.executionCount === 'number');

  const expr = await run('6 * 7');
  check('expression produces execute_result', !!expr.result);
  check('result carries text/plain', expr.result?.data?.['text/plain'] === '42', JSON.stringify(expr.result?.data));

  // ── 4. THE point of a notebook: state persists between cells ──
  log('\n[4] persistent kernel state (what a notebook is FOR)');
  await run('import math\ncounter = 0\ndata = [1, 2, 3]');
  const usesState = await run('counter += len(data)\nprint(counter, math.floor(3.7))');
  check('variables survive across cells', usesState.stdout.trim() === '3 3', JSON.stringify(usesState.stdout));
  const again = await run('counter += 10\nprint(counter)');
  check('mutations accumulate across cells', again.stdout.trim() === '13', JSON.stringify(again.stdout));

  // ── 5. Errors ──
  log('\n[5] errors and tracebacks');
  const boom = await run('1 / 0');
  check('error event is emitted', !!boom.error);
  check('error names the exception', boom.error?.ename === 'ZeroDivisionError', boom.error?.ename);
  check('traceback has frames', (boom.error?.traceback?.length ?? 0) > 0);
  check('traceback carries ANSI colour', (boom.error?.traceback ?? []).join('').includes('['),
    'no escape codes — the ANSI renderer would be pointless');
  check('reply status is error', boom.reply?.status === 'error', JSON.stringify(boom.reply));
  const afterError = await run('print("still alive")');
  check('kernel survives an error', afterError.stdout.includes('still alive'));

  // ── 6. Rich output ──
  log('\n[6] rich output');
  const html = await run('from IPython.display import display, HTML\ndisplay(HTML("<b>bold</b>"))');
  check('display_data is emitted', html.displays.length > 0);
  check('html mime is present', !!html.displays[0]?.data?.['text/html'], JSON.stringify(html.displays[0]?.data));

  const png = await run([
    'import base64',
    'from IPython.display import display, Image',
    // A 1×1 transparent PNG — no matplotlib needed to prove the image path.
    'raw = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")',
    'display(Image(data=raw, format="png"))',
  ].join('\n'));
  check('image/png arrives as base64', typeof png.displays[0]?.data?.['image/png'] === 'string',
    JSON.stringify(Object.keys(png.displays[0]?.data ?? {})));

  const cleared = await run([
    'from IPython.display import clear_output',
    'print("first")',
    'clear_output(wait=True)',
    'print("second")',
  ].join('\n'));
  check('clear_output is reported', cleared.clears.length > 0);
  check('clear_output carries the wait flag', cleared.clears[0]?.wait === true, JSON.stringify(cleared.clears[0]));

  // ── 7. Output correlation ──
  log('\n[7] output correlation');
  const a = nextId(), b = nextId();
  kernelBridge.post(WS, { id: a, type: 'execute', code: 'print("AAA")' });
  kernelBridge.post(WS, { id: b, type: 'execute', code: 'print("BBB")' });
  await new Promise((r) => setTimeout(r, 3000));
  const aOut = eventsFor(a).filter((e) => e.type === 'stream').map((e) => e.text).join('');
  const bOut = eventsFor(b).filter((e) => e.type === 'stream').map((e) => e.text).join('');
  check('queued cells keep their own output', aOut.includes('AAA') && !aOut.includes('BBB'), `a=${JSON.stringify(aOut)}`);
  check('second cell keeps its own output', bOut.includes('BBB') && !bOut.includes('AAA'), `b=${JSON.stringify(bOut)}`);

  // ── 7b. Execution timing ──
  //
  // The service measures from execute_input (the kernel picking the cell up)
  // to the reply, so queue time is excluded. Verify against a cell that
  // sleeps a known amount.
  log('\n[7b] execution timing');
  const timingT0 = Date.now();
  const slept = await run('import time\ntime.sleep(1.5)\nprint("slept")');
  const wall = Date.now() - timingT0;
  check('a timed cell completes', slept.reply?.status === 'ok');
  check('wall time reflects the sleep', wall >= 1400, wall + 'ms');
  const inputEvt = eventsFor(slept.id).find((e) => e.type === 'execute_input');
  const replyEvt = eventsFor(slept.id).find((e) => e.type === 'reply');
  check('execute_input precedes the reply, so timing has both ends',
    !!inputEvt && !!replyEvt && events.indexOf(inputEvt) < events.indexOf(replyEvt));
  // ── 8. Interrupt ──
  //
  // Tested with a CPU-BOUND loop, not time.sleep. That is not the harness
  // taking the easy case: measured on Windows / ipykernel 7.3.0, signal-mode
  // interrupt stops a busy loop in 0.1s but cannot wake a thread blocked in
  // time.sleep(), because on Windows interrupt_main() does not break a
  // blocking sleep. Jupyter behaves the same way. A runaway computation — the
  // common case — is interruptible; a blocked one needs Restart. The
  // limitation is probed separately below so it stays pinned rather than
  // rediscovered.
  log('\n[8] interrupt');
  const longId = nextId();
  kernelBridge.post(WS, { id: longId, type: 'execute', code: 'i = 0\nwhile True:\n    i += 1' });
  await new Promise((r) => setTimeout(r, 1500));
  kernelBridge.post(WS, { id: nextId(), type: 'interrupt' });

  const interruptStart = Date.now();
  let interrupted = null;
  while (Date.now() - interruptStart < 20000) {
    interrupted = events.find((e) => e.requestId === longId && e.type === 'reply' && e.of === 'execute');
    if (interrupted) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check('interrupt ends a running computation', !!interrupted, 'the loop never returned');
  const interruptErr = eventsFor(longId).find((e) => e.type === 'error');
  check('interrupt surfaces as KeyboardInterrupt', interruptErr?.ename === 'KeyboardInterrupt', interruptErr?.ename);
  check('interrupt is prompt', Date.now() - interruptStart < 10000, `${Date.now() - interruptStart}ms`);

  const afterInterrupt = await run('print("usable")');
  check('kernel usable after interrupt', afterInterrupt.stdout.includes('usable'));

  // Pin the known limitation. Not a failure — a record. If a future ipykernel
  // or CPython makes blocking sleeps interruptible on Windows, this line
  // starts saying so and the docs can be updated.
  const sleepId = nextId();
  kernelBridge.post(WS, { id: sleepId, type: 'execute', code: 'import time\ntime.sleep(20)' });
  await new Promise((r) => setTimeout(r, 1200));
  kernelBridge.post(WS, { id: nextId(), type: 'interrupt' });
  await new Promise((r) => setTimeout(r, 4000));
  const sleepEnded = !!events.find((e) => e.requestId === sleepId && e.type === 'reply' && e.of === 'execute');
  log(`    known limitation — interrupt wakes a blocking time.sleep: ${sleepEnded ? 'YES (improved!)' : 'no'}`);
  // Let the sleep finish so it cannot bleed into the restart test below.
  for (let i = 0; i < 220 && !events.find((e) => e.requestId === sleepId && e.type === 'reply'); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }

  // ── 9. Restart ──
  log('\n[9] restart');
  await run('survivor = "should not survive"');
  const restartId = nextId();
  kernelBridge.post(WS, { id: restartId, type: 'restart' });
  const restartStart = Date.now();
  let restartReply = null;
  while (Date.now() - restartStart < 60000) {
    restartReply = events.find((e) => e.requestId === restartId && e.type === 'reply' && e.of === 'restart');
    if (restartReply) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check('restart completes', !!restartReply, 'no restart reply');
  await new Promise((r) => setTimeout(r, 1000));

  const gone = await run('print(survivor)');
  check('restart clears every variable', gone.error?.ename === 'NameError',
    `expected NameError, got ${gone.error?.ename ?? gone.stdout}`);
  const fresh = await run('print("fresh kernel")');
  check('kernel works after restart', fresh.stdout.includes('fresh kernel'));

  // ── 10. Protocol framing ──
  log('\n[10] protocol framing');
  const seen = [];
  const reader = kernelBridge.createLineReader((obj) => seen.push(obj), () => {});
  // Split across chunk boundaries the way a real pipe does.
  reader(Buffer.from('{"type":"a"}\n{"ty'));
  reader(Buffer.from('pe":"b"}\n'));
  reader(Buffer.from('{"type":"c"}\n{"type":"d"}\n'));
  check('reassembles objects split across chunks', seen.length === 4 && seen[1].type === 'b',
    JSON.stringify(seen));
  const big = await run('print("x" * 200000)');
  check('large output survives framing', big.stdout.length > 199000, `${big.stdout.length} chars`);

  // ── 11. Stop ──
  log('\n[11] stop');
  const stopped = await kernelBridge.stopKernel(WS);
  check('kernel stops', stopped.ok === true);
  await new Promise((r) => setTimeout(r, 500));
  const finalStatus = kernelBridge.statusOf(WS);
  check('status reports not running', finalStatus.running === false, JSON.stringify(finalStatus));
  const afterStop = kernelBridge.post(WS, { id: nextId(), type: 'execute', code: 'print(1)' });
  check('execute after stop fails cleanly', afterStop.ok === false && afterStop.code === 'NOT_RUNNING',
    JSON.stringify(afterStop));

} catch (err) {
  fail++;
  lines.push(`  FAIL  harness threw: ${err && err.stack ? err.stack : err}`);
} finally {
  try { kernelBridge.shutdownAll(); } catch { /* best-effort */ }
  try { pythonBridge.shutdown(); } catch { /* best-effort */ }

  console.log('\n' + '='.repeat(66));
  console.log(lines.join('\n'));
  console.log('='.repeat(66));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);

  if (EPHEMERAL) {
    // Give Windows a moment to release the kernel's file handles.
    await new Promise((r) => setTimeout(r, 1200));
    try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* leave it */ }
  }
  process.exit(fail === 0 ? 0 : 1);
}

// ── pythonBridge helpers (its IPC handlers are the public surface) ───────────

async function pythonBridge_createEnv(workspaceRoot) {
  const handlers = new Map();
  pythonBridge.setupPythonBridge({ handle: (ch, fn) => handlers.set(ch, fn) }, () => fakeWindow);
  const res = await handlers.get('python:createEnv')({}, workspaceRoot);
  return res.ok === true;
}

async function pythonBridge_install(workspaceRoot, packages) {
  const handlers = new Map();
  pythonBridge.setupPythonBridge({ handle: (ch, fn) => handlers.set(ch, fn) }, () => fakeWindow);
  return handlers.get('python:install')({}, workspaceRoot, packages);
}
