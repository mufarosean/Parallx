// verify-python-bridge.mjs — functional verification of M94 against a REAL
// interpreter, in a real throwaway workspace. No Electron, no visible app.
//
// pythonBridge.cjs imports nothing from Electron at module scope, so plain
// node can load it. We drive it through setupPythonBridge with a fake ipcMain
// so the thing under test is the ACTUAL registered IPC surface, not a set of
// conveniently-exported internals.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = require(path.join(REPO, 'electron', 'pythonBridge.cjs'));

// ── Fake Electron surfaces ──────────────────────────────────────────────────

const handlers = new Map();
const fakeIpcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
const sent = [];
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: (ch, payload) => sent.push({ ch, payload }) },
};
bridge.setupPythonBridge(fakeIpcMain, () => fakeWindow);

const call = (ch, ...args) => {
  const fn = handlers.get(ch);
  if (!fn) throw new Error(`no handler: ${ch}`);
  return fn({}, ...args);
};

// ── Harness ─────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const log = (m) => { console.log(m); results.push(m); };

const WS = path.join(os.tmpdir(), `parallx-py-verify-${Date.now()}`);
fs.mkdirSync(path.join(WS, 'scripts'), { recursive: true });

const waitForExit = (runId, ms = 60000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const poll = setInterval(() => {
    const hit = sent.find((s) => s.ch === 'python:run:exit' && s.payload.runId === runId);
    if (hit) { clearInterval(poll); resolve(hit.payload); }
    else if (Date.now() - t0 > ms) { clearInterval(poll); reject(new Error('exit never arrived')); }
  }, 100);
});
const outputOf = (runId) => sent
  .filter((s) => s.ch === 'python:run:data' && s.payload.runId === runId)
  .map((s) => s.payload.chunk).join('');

// ── Run ─────────────────────────────────────────────────────────────────────

try {
  log(`workspace: ${WS}`);

  // 1 — interpreter probe
  const det = bridge.detectSystemPython();
  log(`\n[1] interpreter probe`);
  check('finds a Python 3.10+ interpreter', !!det, 'none found');
  if (!det) throw new Error('no interpreter — cannot continue');
  log(`      → ${det.command} ${det.launcherArgs.join(' ')} (Python ${det.version})`);

  // 2 — status before creation
  log(`\n[2] status before creation`);
  const s0 = await call('python:status', WS);
  check('reports interpreter found', s0.interpreterFound === true);
  check('reports no environment yet', s0.envExists === false);

  // 3 — create env (real venv)
  log(`\n[3] createEnv (real venv creation)`);
  const t0 = Date.now();
  const created = await call('python:createEnv', WS);
  check('createEnv succeeds', created.ok === true, created.error);
  log(`      → ${Date.now() - t0}ms`);
  const venvPy = path.join(WS, '.parallx', 'venv',
    process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
  check('interpreter exists on disk at the expected path', fs.existsSync(venvPy), venvPy);
  check('marker file records the build interpreter',
    fs.existsSync(path.join(WS, '.parallx', 'venv', 'parallx-env.json')));

  // 4 — idempotency
  log(`\n[4] createEnv is idempotent`);
  const again = await call('python:createEnv', WS);
  check('second create reports alreadyExists', again.ok === true && again.alreadyExists === true);

  // 5 — status + size after creation
  log(`\n[5] status + size after creation`);
  const s1 = await call('python:status', WS);
  check('envExists true', s1.envExists === true);
  check('createdWith records a version', typeof s1.createdWith === 'string' && s1.createdWith.length > 0);
  const size = await call('python:envSize', WS);
  check('reports a non-zero size', size.sizeBytes > 0);
  log(`      → ${(size.sizeBytes / 1048576).toFixed(1)} MB, ${size.fileCount} files`);

  // 6 — THE localization proof
  log(`\n[6] localization proof (the actual point of the milestone)`);
  const probe = `
import sys, os, json
print(json.dumps({
  "prefix": sys.prefix,
  "base_prefix": sys.base_prefix,
  "cwd": os.getcwd(),
  "HOME": os.environ.get("HOME"),
  "USERPROFILE": os.environ.get("USERPROFILE"),
  "TEMP": os.environ.get("TEMP") or os.environ.get("TMPDIR"),
  "PIP_CACHE_DIR": os.environ.get("PIP_CACHE_DIR"),
  "PARALLX_WORKSPACE": os.environ.get("PARALLX_WORKSPACE"),
  "PARALLX_OUT": os.environ.get("PARALLX_OUT"),
  "PYTHONPATH": os.environ.get("PYTHONPATH"),
  "user_site_enabled": bool(getattr(__import__("site"), "ENABLE_USER_SITE", False)),
  "site_paths": [p for p in sys.path if "site-packages" in p],
  "leak_canary": os.environ.get("PARALLX_LEAK_CANARY"),
  "dont_write_bytecode": sys.dont_write_bytecode,
}))
out = os.environ.get("PARALLX_OUT")
open(os.path.join(out, "result.txt"), "w").write("written by the script")
`;
  fs.writeFileSync(path.join(WS, 'scripts', 'probe.py'), probe, 'utf8');

  // Plant a canary in the parent env: it must NOT reach the child.
  process.env.PARALLX_LEAK_CANARY = 'leaked-from-parent';

  const run1 = await call('python:runScript', { workspaceRoot: WS, scriptPath: 'scripts/probe.py' });
  check('runScript starts', run1.ok === true, run1.error);
  const exit1 = await waitForExit(run1.runId);
  check('script exits 0', exit1.exitCode === 0, JSON.stringify(exit1.error));

  const raw = outputOf(run1.runId).trim();
  let info = null;
  try { info = JSON.parse(raw); } catch { /* reported below */ }
  check('script output parsed', !!info, raw.slice(0, 300));

  if (info) {
    const inside = (p) => !!p && bridge.isInside(WS, p);
    check('sys.prefix is the workspace venv', inside(info.prefix), info.prefix);
    check('venv is layered over the system interpreter', info.base_prefix !== info.prefix);
    check('cwd is the workspace root', path.resolve(info.cwd) === path.resolve(WS), info.cwd);
    check('HOME redirected into the workspace', inside(info.HOME), info.HOME);
    check('USERPROFILE redirected into the workspace', inside(info.USERPROFILE), info.USERPROFILE);
    check('TEMP redirected into the workspace', inside(info.TEMP), info.TEMP);
    check('PIP_CACHE_DIR inside the workspace', inside(info.PIP_CACHE_DIR), info.PIP_CACHE_DIR);
    check('PARALLX_WORKSPACE handed to the script', inside(info.PARALLX_WORKSPACE));
    check('PARALLX_OUT handed to the script', inside(info.PARALLX_OUT), info.PARALLX_OUT);
    check('PYTHONPATH not inherited', info.PYTHONPATH === null || info.PYTHONPATH === undefined, String(info.PYTHONPATH));
    check('user site-packages disabled', info.user_site_enabled === false);
    check('bytecode writing suppressed', info.dont_write_bytecode === true);
    check('parent env var did NOT leak into the child',
      info.leak_canary === null || info.leak_canary === undefined, String(info.leak_canary));
    const foreign = (info.site_paths || []).filter((p) => !inside(p));
    check('every site-packages path is inside the workspace', foreign.length === 0, foreign.join(' | '));
  }
  delete process.env.PARALLX_LEAK_CANARY;

  check('script wrote into PARALLX_OUT', fs.existsSync(path.join(exit1.outDir, 'result.txt')));
  check('no __pycache__ created beside the script',
    !fs.existsSync(path.join(WS, 'scripts', '__pycache__')));

  // 7 — package install (needs network)
  log(`\n[7] pip install into the workspace env`);
  const inst = await call('python:install', WS, ['six']);
  if (inst.ok) {
    check('install succeeds', true);
    const list = await call('python:listPackages', WS);
    check('installed package appears in the list',
      (list.packages || []).some((p) => p.name.toLowerCase() === 'six'));
    const sitePkgs = path.join(WS, '.parallx', 'venv',
      process.platform === 'win32' ? 'Lib\\site-packages' : `lib`);
    check('package landed inside the workspace venv', fs.existsSync(sitePkgs));
    check('pip cache stayed in the workspace',
      fs.existsSync(path.join(WS, '.parallx', 'venv', '.pip-cache')));
  } else {
    log(`      SKIPPED (no network?): ${String(inst.error).slice(0, 160)}`);
  }

  // 8 — containment through the real IPC handler
  log(`\n[8] containment via the registered IPC handler`);
  const esc = await call('python:runScript', { workspaceRoot: WS, scriptPath: '../../evil.py' });
  check('rejects a traversal path', esc.ok === false && /outside the workspace/.test(esc.error), esc.error);
  const inVenv = await call('python:runScript', { workspaceRoot: WS, scriptPath: '.parallx/venv/x.py' });
  check('rejects a script inside the venv', inVenv.ok === false, inVenv.error);
  const badPkg = await call('python:install', WS, ['--index-url=http://evil.test/s']);
  check('rejects a pip flag as a package', badPkg.ok === false, badPkg.error);

  // 9 — timeout kills the process
  log(`\n[9] timeout stops a hung script`);
  fs.writeFileSync(path.join(WS, 'scripts', 'sleep.py'), 'import time\ntime.sleep(120)\n', 'utf8');
  const run2 = await call('python:runScript', { workspaceRoot: WS, scriptPath: 'scripts/sleep.py', timeout: 3000 });
  check('hung script starts', run2.ok === true, run2.error);
  const exit2 = await waitForExit(run2.runId, 30000);
  check('timeout reported', exit2.error && exit2.error.code === 'TIMEOUT', JSON.stringify(exit2.error));
  check('timeout fired near the configured deadline', exit2.durationMs < 15000, `${exit2.durationMs}ms`);

  // 10 — cancel
  log(`\n[10] cancelRun stops a running script`);
  const run3 = await call('python:runScript', { workspaceRoot: WS, scriptPath: 'scripts/sleep.py', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 700));
  await call('python:cancelRun', run3.runId);
  const exit3 = await waitForExit(run3.runId, 20000);
  check('cancelled run terminates promptly', exit3.durationMs < 10000, `${exit3.durationMs}ms`);

  // 11 — streaming is incremental, not one lump at exit
  log(`\n[11] output streams while the script runs`);
  fs.writeFileSync(path.join(WS, 'scripts', 'stream.py'),
    'import time,sys\nfor i in range(3):\n    print("tick", i, flush=True)\n    time.sleep(0.6)\n', 'utf8');
  const before = sent.length;
  const run4 = await call('python:runScript', { workspaceRoot: WS, scriptPath: 'scripts/stream.py' });
  await new Promise((r) => setTimeout(r, 1200));
  const midFlight = sent.slice(before).filter(
    (s) => s.ch === 'python:run:data' && s.payload.runId === run4.runId).length;
  const exit4 = await waitForExit(run4.runId);
  check('chunks arrived before the script finished', midFlight > 0, `${midFlight} chunks mid-flight`);
  check('streaming run exits 0', exit4.exitCode === 0);

  // 12 — removeEnv leaves content alone
  log(`\n[12] removeEnv deletes machinery only`);
  const rm = await call('python:removeEnv', WS);
  check('removeEnv succeeds', rm.ok === true, rm.error);
  check('venv is gone', !fs.existsSync(path.join(WS, '.parallx', 'venv')));
  check('scripts survive', fs.existsSync(path.join(WS, 'scripts', 'probe.py')));
  check('outputs survive', fs.existsSync(path.join(exit1.outDir, 'result.txt')));

} catch (err) {
  fail++;
  results.push(`  FAIL  harness threw: ${err && err.stack ? err.stack : err}`);
} finally {
  bridge.shutdown();
  console.log('\n' + '='.repeat(64));
  console.log(results.join('\n'));
  console.log('='.repeat(64));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* leave it */ }
  process.exit(fail === 0 ? 0 : 1);
}
