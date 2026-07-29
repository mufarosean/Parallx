// Does install/create progress actually stream to the renderer, live?
// The bug was that runToCompletion buffered everything and returned at the
// end, so a 30-second pip install produced zero UI signal.

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
  else { fail++; out.push(`  FAIL  ${n}${d ? ' — ' + String(d).slice(0, 200) : ''}`); }
};

const WS = path.join(os.tmpdir(), `parallx-progress-${Date.now()}`);
fs.mkdirSync(WS, { recursive: true });

// Capture every progress event WITH the time it arrived, so we can prove it
// streamed rather than arriving in one lump at the end.
const events = [];
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (ch, payload) => { if (ch === 'python:progress') events.push({ at: Date.now(), ...payload }); },
  },
};
const handlers = new Map();
bridge.setupPythonBridge({ handle: (c, f) => handlers.set(c, f) }, () => fakeWindow);

try {
  // ── create ──
  const createStart = Date.now();
  const created = await handlers.get('python:createEnv')({}, WS);
  const createEnd = Date.now();
  check('environment created', created.ok === true, created.error);

  const createEvents = events.filter((e) => e.phase === 'create');
  check('createEnv emits progress at all', createEvents.length > 0,
    'the panel would show a spinner and nothing else');
  check('progress announces the phase before work starts',
    createEvents[0]?.chunk?.includes('Creating environment'), createEvents[0]?.chunk);
  check('progress arrives BEFORE the operation returns',
    createEvents.some((e) => e.at < createEnd), 'all events landed after completion — not streaming');
  check('progress is workspace-tagged',
    createEvents.every((e) => e.workspaceRoot && bridge.isInside(WS, e.workspaceRoot)));
  out.push(`    create: ${createEvents.length} events over ${createEnd - createStart}ms`);

  // ── install (the case reported) ──
  events.length = 0;
  const installStart = Date.now();
  const installed = await handlers.get('python:install')({}, WS, ['pandas']);
  const installEnd = Date.now();
  check('pandas installed', installed.ok === true, installed.error);

  const inst = events.filter((e) => e.phase === 'install');
  check('install emits progress', inst.length > 0);
  check('the pip command is echoed first', inst[0]?.chunk?.includes('pip install pandas'), inst[0]?.chunk);
  check('progress streams DURING the install, not after',
    inst.filter((e) => e.at < installEnd - 500).length > 1,
    `${inst.filter((e) => e.at < installEnd - 500).length} of ${inst.length} arrived early`);

  const text = inst.map((e) => e.chunk).join('');
  check('pip names what it is collecting', /Collecting|Downloading|Using cached/i.test(text),
    text.slice(0, 300));
  check('pip reports success', /Successfully installed|already satisfied/i.test(text), text.slice(-300));
  out.push(`    install: ${inst.length} events over ${installEnd - installStart}ms`);

  // Spread proves streaming: first and last event separated in time.
  if (inst.length > 1) {
    const spread = inst[inst.length - 1].at - inst[0].at;
    check('events are spread across the operation', spread > 200, `${spread}ms spread`);
    out.push(`    spread: ${spread}ms between first and last progress event`);
  }

  // ── uninstall ──
  events.length = 0;
  const removed = await handlers.get('python:uninstall')({}, WS, ['pandas']);
  check('pandas removed', removed.ok === true, removed.error);
  check('uninstall emits progress', events.filter((e) => e.phase === 'uninstall').length > 0);

} catch (err) {
  fail++; out.push(`  FAIL  harness threw: ${err && err.stack}`);
} finally {
  try { bridge.shutdown(); } catch {}
  console.log(out.join('\n'));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  await new Promise((r) => setTimeout(r, 800));
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch {}
  process.exit(fail === 0 ? 0 : 1);
}
