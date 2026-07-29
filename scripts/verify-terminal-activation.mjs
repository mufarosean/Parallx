// verify-terminal-activation.mjs — terminal venv activation (M97)
//
// Proves the terminal overlay does what `activate` does and nothing more: the
// venv goes first on PATH, VIRTUAL_ENV is set, and the user's own environment
// survives intact. That last part is the whole point of it being an OVERLAY
// rather than the containment rebuild buildChildEnv performs — a terminal that
// lost git, node and the user's PATH would be worse than one with no venv.
//
// Usage: node scripts/verify-terminal-activation.mjs

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonBridge = require(path.join(REPO, 'electron', 'pythonBridge.cjs'));

let pass = 0, fail = 0;
const lines = [];
const log = (m) => { console.log(m); lines.push(m); };
function check(name, cond, detail = '') {
  if (cond) { pass++; lines.push(`  PASS  ${name}`); }
  else { fail++; lines.push(`  FAIL  ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`); }
}

const WS = path.join(os.tmpdir(), `parallx-term-verify-${Date.now()}`);
const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };

function handlers() {
  const map = new Map();
  pythonBridge.setupPythonBridge({ handle: (ch, fn) => map.set(ch, fn) }, () => fakeWindow);
  return map;
}

/** Run a command through a shell with the given env, exactly as terminal:exec does. */
function shellExec(command, env, cwd) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const proc = spawn(command, {
      cwd, env, shell: isWin ? 'powershell.exe' : true, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    proc.stdout.on('data', (d) => out += d);
    proc.stderr.on('data', (d) => err += d);
    proc.on('error', (e) => resolve({ out: '', err: String(e.message), code: -1 }));
    proc.on('close', (code) => resolve({ out: out.trim(), err: err.trim(), code }));
  });
}

try {
  fs.mkdirSync(WS, { recursive: true });
  log(`workspace: ${WS}`);

  // ── 1. No venv → the environment is returned untouched ──
  log('\n[1] no environment yet');
  const before = pythonBridge.buildTerminalEnv(WS, { ...process.env });
  const pathKeyB = Object.keys(before).find((k) => k.toUpperCase() === 'PATH');
  check('PATH is unchanged when there is no venv',
    before[pathKeyB] === process.env[pathKeyB] || before[pathKeyB] === process.env.PATH);
  check('VIRTUAL_ENV is not invented', before.VIRTUAL_ENV === undefined);
  const info0 = pythonBridge.terminalEnvInfo(WS);
  check('envInfo reports inactive', info0.active === false);

  // ── 2. Create the environment ──
  log('\n[2] create the workspace environment');
  const h = handlers();
  const created = await h.get('python:createEnv')({}, WS);
  check('environment created', created.ok === true, created.error);

  const info = pythonBridge.terminalEnvInfo(WS);
  check('envInfo reports active', info.active === true);
  check('envInfo points at .parallx/venv', pythonBridge.isInside(WS, info.venvPath || ''), info.venvPath);

  // ── 3. The overlay ──
  log('\n[3] activation overlay');
  const env = pythonBridge.buildTerminalEnv(WS, { ...process.env, TERM: 'xterm-256color' });
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const entries = String(env[pathKey]).split(path.delimiter);

  check('venv bin is FIRST on PATH', path.resolve(entries[0]) === path.resolve(info.binDir),
    entries[0]);
  check('VIRTUAL_ENV is set', env.VIRTUAL_ENV === info.venvPath, env.VIRTUAL_ENV);
  check('VIRTUAL_ENV_PROMPT is set for prompt themes', typeof env.VIRTUAL_ENV_PROMPT === 'string');
  check('PYTHONHOME is cleared', env.PYTHONHOME === undefined);
  check('does not add a duplicate PATH key',
    Object.keys(env).filter((k) => k.toUpperCase() === 'PATH').length === 1,
    Object.keys(env).filter((k) => k.toUpperCase() === 'PATH').join(','));

  // THE distinguishing property vs buildChildEnv: the user's own environment
  // survives. A terminal stripped of git/node/ssh would be useless.
  const originalPath = String(process.env[pathKey] || process.env.PATH || '');
  const originalEntries = originalPath.split(path.delimiter).filter(Boolean);
  const kept = originalEntries.filter((e) => entries.some((x) => path.resolve(x) === path.resolve(e)));
  check('every original PATH entry survives', kept.length === originalEntries.length,
    `${kept.length}/${originalEntries.length} kept`);
  check('inherited variables survive (TERM overlay applied)', env.TERM === 'xterm-256color');
  const canary = 'PARALLX_TERMINAL_CANARY';
  process.env[canary] = 'present';
  try {
    check('inherited user variables survive', pythonBridge.buildTerminalEnv(WS, { ...process.env })[canary] === 'present');
  } finally { delete process.env[canary]; }

  // Contrast with the containment rebuild, so the two cannot silently converge.
  const contained = pythonBridge.buildChildEnv(WS);
  check('buildChildEnv still SCRUBS (they have not converged)',
    String(contained.PATH).split(path.delimiter).length < entries.length,
    `contained=${String(contained.PATH).split(path.delimiter).length} terminal=${entries.length}`);
  check('buildChildEnv redirects HOME, buildTerminalEnv does not',
    pythonBridge.isInside(WS, contained.HOME) && !pythonBridge.isInside(WS, env.HOME || env.USERPROFILE || 'x'));

  // ── 4. Idempotence ──
  log('\n[4] idempotence');
  const twice = pythonBridge.buildTerminalEnv(WS, pythonBridge.buildTerminalEnv(WS, { ...process.env }));
  const twiceEntries = String(twice[pathKey]).split(path.delimiter);
  const binCount = twiceEntries.filter((e) => path.resolve(e) === path.resolve(info.binDir)).length;
  check('re-activating does not stack duplicate PATH entries', binCount === 1, `${binCount} copies`);

  // ── 5. A REAL shell resolves the venv interpreter ──
  log('\n[5] real shell resolution');
  const which = process.platform === 'win32'
    ? '(Get-Command python).Source'
    : 'command -v python';
  const resolved = await shellExec(which, env, WS);
  check('`python` resolves inside the workspace venv',
    pythonBridge.isInside(WS, resolved.out.trim()),
    `resolved to: ${resolved.out || resolved.err}`);

  const ver = await shellExec('python -c "import sys; print(sys.prefix)"', env, WS);
  check('sys.prefix is the workspace venv', pythonBridge.isInside(WS, ver.out.trim()), ver.out || ver.err);

  const pipWhere = await shellExec('python -c "import sys,os; print(os.path.dirname(sys.executable))"', env, WS);
  check('pip/console scripts come from the venv bin',
    path.resolve(pipWhere.out.trim()) === path.resolve(info.binDir),
    pipWhere.out || pipWhere.err);

  // Without the overlay, the same shell must NOT resolve into the venv —
  // otherwise the test proves nothing.
  const bare = await shellExec(which, { ...process.env }, WS);
  check('control: unactivated shell does NOT use the venv',
    !pythonBridge.isInside(WS, bare.out.trim()),
    `bare resolved to: ${bare.out || '(none)'}`);

  // ── 6. Removing the environment deactivates future shells ──
  log('\n[6] after removing the environment');
  await h.get('python:removeEnv')({}, WS);
  const after = pythonBridge.buildTerminalEnv(WS, { ...process.env });
  check('no VIRTUAL_ENV once the venv is gone', after.VIRTUAL_ENV === undefined);
  check('envInfo reports inactive again', pythonBridge.terminalEnvInfo(WS).active === false);

} catch (err) {
  fail++;
  lines.push(`  FAIL  harness threw: ${err && err.stack ? err.stack : err}`);
} finally {
  try { pythonBridge.shutdown(); } catch { /* best-effort */ }
  console.log('\n' + '='.repeat(64));
  console.log(lines.join('\n'));
  console.log('='.repeat(64));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* leave it */ }
  process.exit(fail === 0 ? 0 : 1);
}
