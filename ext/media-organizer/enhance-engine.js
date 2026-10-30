// enhance-engine.js — Enhance's engine: SeedVR2 7B sharp, in a runtime the
// app installs once on the user's click (docs/ENHANCE.md; the core side is
// electron/runtimeBridge.cjs). The editor's Enhance and the library's Upscale
// of one photo enlarge through moEnhanceRun; Upscale of several photos goes
// through moEnhanceRunMany, one run that loads the model once for all of them.
//
// This file declares the runtime (Python, the package lists in engine/, the
// two model files with their sizes and SHA-256), shows the card that sets it
// up, and runs engine/enhance.py. Before each run it reads the graphics
// card's free memory and picks the size of the pieces the picture is cut
// into; with too little free it says so instead of starting.

import { moEl } from './dom.js';

const RUNTIME_ID = 'seedvr2-enhance';
const HF = 'https://huggingface.co';
const FILES = [
  { name: 'ema_vae_fp16.safetensors', url: `${HF}/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors`, bytes: 501324814, sha256: '20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1' },
  { name: 'seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors', url: `${HF}/AInVFX/SeedVR2_comfyUI/resolve/main/seedvr2_ema_7b_sharp_fp8_e4m3fn_mixed_block35_fp16.safetensors`, bytes: 8466296338, sha256: '0d2c5b8be0fda94351149c5115da26aef4f4932a7a2a928c6f184dda9186e0be' },
];
/** Packages (PyTorch is most of it) and Python, on top of the model files. */
const PACKAGE_BYTES = 3.6 * 1024 ** 3;
/**
 * The size of an enlarged piece, by the graphics memory free when a run
 * starts. Measured on an RTX 5090 with the model loaded: a 4096 px piece
 * peaked at 19.4 GB, a 2048 px piece at 11.5 GB.
 */
const PIECES = [{ out: 4096, freeMiB: 21000 }, { out: 2048, freeMiB: 13000 }];
export const MO_ENHANCE_MIN_FREE_MIB = PIECES[PIECES.length - 1].freeMiB;

let extDir = '';
const listeners = new Set();
const runListeners = new Map();   // runId -> onProgress
/** What the card shows. status: null (not asked yet) | 'absent' | 'partial' | 'ready'. */
const engine = { status: null, machine: null, installing: false, step: null, error: '', asked: false };

const bridge = () => (typeof window !== 'undefined' && window.parallxElectron && window.parallxElectron.optionalBridges) || null;
const sep = () => (extDir.includes('\\') ? '\\' : '/');
const enginePath = (...parts) => [extDir, 'engine', ...parts].join(sep());
const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const changed = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* a closed panel */ } } };

/** The runtime's declaration, checked again by the core. */
export function moEnhanceSpec() {
  return {
    id: RUNTIME_ID,
    title: 'Enhance',
    python: '3.13.16',
    locks: { win32: enginePath('requirements-win.lock'), linux: enginePath('requirements-linux.lock') },
    files: FILES,
    needs: { platforms: ['win32-x64', 'linux-x64'], gpu: 'nvidia', minVramMiB: 15000, minDriver: 570, diskBytes: 20 * 1024 ** 3 },
    selftest: { script: enginePath('selftest.py'), args: [] },
  };
}

/** How much it downloads, for the card. */
export const MO_ENHANCE_DOWNLOAD_BYTES = FILES.reduce((n, f) => n + f.bytes, 0) + PACKAGE_BYTES;

/** Ask the core where the engine stands and what this computer has. */
export async function moEnhanceRefresh() {
  const b = bridge();
  engine.asked = true;
  if (!b) { engine.status = 'absent'; engine.machine = { ok: false, problems: ['Enhance needs the desktop app.'] }; changed(); return engine; }
  try {
    const [st, machine] = await Promise.all([b.invoke('runtimes:status', moEnhanceSpec()), b.invoke('runtimes:check', moEnhanceSpec())]);
    engine.status = st && st.state ? st.state : 'absent';
    engine.installing = !!(st && st.installing);
    engine.machine = machine && Array.isArray(machine.problems) ? machine : { ok: false, problems: [(st && st.error) || (machine && machine.error) || 'The engine could not be checked.'] };
  } catch (err) {
    engine.status = 'absent';
    engine.machine = { ok: false, problems: [(err && err.message) || String(err)] };
  }
  changed();
  return engine;
}

/** Is the engine set up and ready? Asks the core the first time. */
export async function moEnhanceReady() {
  if (engine.status === null) await moEnhanceRefresh();
  return engine.status === 'ready';
}

async function setUp() {
  const b = bridge();
  if (!b || engine.installing) return;
  engine.installing = true; engine.error = ''; engine.step = { label: 'Starting', fraction: 0 };
  changed();
  const r = await b.invoke('runtimes:install', moEnhanceSpec()).catch((err) => ({ ok: false, error: (err && err.message) || String(err) }));
  engine.installing = false; engine.step = null;
  engine.error = r && r.ok ? '' : (r && r.error) || 'Setting up stopped.';
  await moEnhanceRefresh();
}

async function stop() {
  const b = bridge();
  if (b) await b.invoke('runtimes:cancel', RUNTIME_ID).catch(() => {});
}

async function remove(api) {
  const b = bridge();
  if (!b) return;
  const st = await b.invoke('runtimes:status', moEnhanceSpec(), true).catch(() => null);
  const size = st && st.bytesOnDisk ? ` It frees ${gb(st.bytesOnDisk)}.` : '';
  const ok = await api.window.showWarningMessage(`Remove the Enhance engine from this computer?${size} Setting it up again downloads it again.`, { title: 'Remove' }, { title: 'Cancel' });
  if (!ok || ok.title !== 'Remove') return;
  const r = await b.invoke('runtimes:remove', moEnhanceSpec());
  if (r && !r.ok) api.window.showErrorMessage(r.error || 'The engine could not be removed.');
  await moEnhanceRefresh();
}

/** Commands for the card's buttons, and the progress the core sends. */
export function moEnhanceActivate(api, dir) {
  extDir = dir || '';
  const subs = [
    api.commands.registerCommand('media-organizer.enhance.setUp', () => setUp()),
    api.commands.registerCommand('media-organizer.enhance.stopSetUp', () => stop()),
    api.commands.registerCommand('media-organizer.enhance.removeEngine', () => remove(api)),
    api.commands.registerCommand('media-organizer.enhance.checkAgain', () => moEnhanceRefresh()),
  ];
  const b = bridge();
  if (b) {
    const off = b.on('runtimes:progress', (p) => {
      if (!p || p.id !== RUNTIME_ID) return;
      if (p.kind === 'install' && engine.installing) { engine.step = p; changed(); }
      if (p.kind === 'run' && runListeners.has(p.runId)) runListeners.get(p.runId)(p.data || {});
    });
    subs.push({ dispose: off });
  }
  return subs;
}

/**
 * The card that sets the engine up: what this computer has, what it
 * downloads, progress while it installs, and what went wrong. `whenReady`
 * runs once the engine is ready (the caller shows its own controls then).
 */
export function moEnhanceCard(api, whenReady) {
  const ui = api.ui;
  const el = moEl('div', 'mo-edit-setup mo-enhance-setup');
  let wasReady = engine.status === 'ready';
  let live = null;   // while setting up: the parts progress changes, so Stop stays the same button
  function render() {
    if (engine.installing && live) {
      const s = engine.step || {};
      const pct = Math.round((s.fraction || 0) * 100);
      live.label.textContent = s.label || 'Working';
      live.fill.style.width = `${pct}%`;
      live.bar.setAttribute('aria-valuenow', String(pct));
      live.bytes.textContent = s.total ? `${gb(s.received || 0)} of ${gb(s.total)}` : '';
      return;
    }
    live = null;
    el.replaceChildren();
    const title = (t) => el.appendChild(moEl('div', 'mo-edit-setup-title', { textContent: t }));
    const para = (t) => el.appendChild(moEl('p', null, { textContent: t }));
    const row = () => el.appendChild(moEl('div', 'mo-enhance-row'));
    if (engine.status === 'ready') {
      if (!wasReady) { wasReady = true; queueMicrotask(() => whenReady && whenReady()); }
      return;
    }
    if (!engine.asked || engine.status === null) { para('Checking this computer…'); return; }
    if (engine.installing) {
      const s = engine.step || {};
      title('Setting up Enhance');
      const label = para(s.label || 'Working');
      label.setAttribute('aria-live', 'polite');
      const bar = moEl('div', 'mo-edit-progress', { role: 'progressbar', 'aria-label': 'Setting up Enhance', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((s.fraction || 0) * 100)) });
      const fill = moEl('div', 'mo-edit-progress-fill');
      fill.style.width = `${Math.round((s.fraction || 0) * 100)}%`;
      bar.appendChild(fill);
      el.appendChild(bar);
      const bytes = el.appendChild(moEl('div', 'mo-practice-dim', { textContent: s.total ? `${gb(s.received || 0)} of ${gb(s.total)}` : '' }));
      para('You can keep working. Stopping keeps what is done; setting up again carries on from there.');
      ui.createButton(row(), { id: 'media-organizer.enhance.stopSetUp', label: 'Stop', size: 'sm', command: 'media-organizer.enhance.stopSetUp' });
      live = { label, bar, fill, bytes };
      return;
    }
    const m = engine.machine || { ok: false, problems: [] };
    if (!m.ok) {
      title('Enhance cannot run on this computer');
      for (const p of m.problems) para(p);
      ui.createButton(row(), { id: 'media-organizer.enhance.checkAgain', label: 'Check Again', size: 'sm', command: 'media-organizer.enhance.checkAgain' });
      return;
    }
    const card = (m.cards || []).slice().sort((a, b) => b.vramMiB - a.vramMiB)[0];
    title('Set up Enhance');
    para('Enhance enlarges photos with SeedVR2, an AI model that runs on this computer. Your photos never leave it.');
    para(`It downloads about ${Math.round(MO_ENHANCE_DOWNLOAD_BYTES / 1024 ** 3)} GB once and keeps about 15 GB on disk, for every workspace.${card ? ` It will run on the ${card.name}.` : ''}`);
    if (engine.status === 'partial') para('Setting up stopped part of the way. It carries on from where it stopped.');
    if (engine.error) el.appendChild(moEl('p', 'mo-enhance-error', { role: 'alert', textContent: engine.error }));
    ui.createButton(row(), { id: 'media-organizer.enhance.setUp', label: engine.status === 'partial' ? 'Carry On Setting Up' : 'Set Up Enhance', kind: 'primary', size: 'sm', command: 'media-organizer.enhance.setUp' });
  }
  listeners.add(render);
  render();
  if (!engine.asked) void moEnhanceRefresh();
  return { el, dispose: () => listeners.delete(render) };
}

/**
 * Enlarge `input` into `output` (a PNG) `scale` times. onProgress({ label,
 * fraction }). opts.workDir: where the pieces go (in the workspace; the caller
 * removes it). Throws an Error whose message is for the user.
 */
export async function moEnhanceRun(input, output, scale, onProgress, opts = {}) {
  const b = await readyBridge();
  const piece = await pickPiece(b);
  const runId = newRunId();
  if (opts.onRunId) opts.onRunId(runId);
  runListeners.set(runId, (d) => {
    if (!onProgress) return;
    let label = 'Enlarging'; let fraction = 0;
    if (d.stage === 'read' || d.stage === 'plan') { label = 'Reading the picture'; fraction = 0.02; }
    else if (d.stage === 'enlarge') {
      const total = Math.max(1, d.total || 1);
      label = d.done ? `Enlarging piece ${Math.min(d.done + 1, total)} of ${total}` : `Loading the model and enlarging piece 1 of ${total}`;
      if (d.done >= total) label = 'Enlarged';
      fraction = 0.05 + 0.85 * ((d.done || 0) / total);
    } else if (d.stage === 'join') { label = 'Joining the pieces'; fraction = 0.92; }
    else if (d.stage === 'done') { label = 'Done'; fraction = 1; }
    try { onProgress({ label, fraction }); } catch { /* the caller closed */ }
  });
  try {
    const r = await b.invoke('runtimes:run', moEnhanceSpec(), enginePath('enhance.py'), ['--input', input, '--output', output, '--scale', String(scale), '--piece-out', String(piece.out), ...(opts.workDir ? ['--work-dir', opts.workDir] : [])], runId);
    if (r && r.ok) return;
    if (r && r.stopped) throw Object.assign(new Error('Stopped.'), { stopped: true });
    throw new Error(failureOf(r));
  } finally {
    runListeners.delete(runId);
  }
}

async function readyBridge() {
  const b = bridge();
  if (!b) throw new Error('Enhance needs the desktop app.');
  if (!(await moEnhanceReady())) throw new Error('Enhance is not set up yet. Choose Set Up Enhance in the Enhance tool.');
  return b;
}
/** Large pieces when there is room; otherwise small ones. The engine moves what does not fit to
 *  system memory, so it still runs (slower) when another program, such as an Ollama model, holds the card. */
async function pickPiece(b) {
  const machine = await b.invoke('runtimes:check', moEnhanceSpec());
  const card = machine && machine.cards && machine.cards[0];
  return (card && PIECES.find((p) => card.freeMiB >= p.freeMiB)) || PIECES[PIECES.length - 1];
}
const newRunId = () => `enhance-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function failureOf(r) {
  const said = /ENHANCE-ERROR: (.*)/.exec(String((r && r.stderr) || ''));
  return said ? said[1].trim() : (r && r.error) || 'The enlargement failed.';
}

/** The engine's options for a batch: the job list, the scale, the piece size, the work folder. */
export function moEnhanceManyArgs(jobsPath, scale, pieceOut, workDir) {
  return ['--jobs', jobsPath, '--scale', String(scale), '--piece-out', String(pieceOut), '--work-dir', workDir];
}

/**
 * Follows a batch's progress lines (engine/enhance_batch.py) for `count`
 * photos. The returned function takes one line and gives what to show,
 * { index, label, fraction } with the fraction over the whole batch; a
 * finished photo gives { photo: { index, ok, error, work } }; anything else null.
 */
export function moEnhanceManyProgress(count) {
  let finished = 0;
  let started = false;   // a piece is back, so the model is loaded
  const n = Math.max(1, count);
  return (d) => {
    if (!d || typeof d !== 'object') return null;
    if (d.stage === 'read') return { index: 0, label: 'Reading the pictures', fraction: 0 };
    if (d.stage === 'enlarge') {
      const total = Math.max(1, d.total || 1);
      const done = Math.min(d.done || 0, total);
      if (done > 0) started = true;
      const label = done >= total ? 'Enlarged'
        : started ? `Enlarging piece ${done + 1} of ${total}` : `Loading the model and enlarging piece 1 of ${total}`;
      return { index: d.photo, label, fraction: Math.min(1, (finished + done / total) / n) };
    }
    if (d.stage === 'photo') {
      finished++;
      if (d.ok) started = true;
      return { photo: { index: d.photo, ok: !!d.ok, error: d.ok ? '' : String(d.error || 'The enlargement failed.'), work: d.work || '' } };
    }
    return null;
  };
}

/**
 * Enlarge many pictures in one run, so the model loads once for all of them.
 * jobs: [{ input, output }], each output a PNG. opts.workDir (required: the
 * job list and every piece go there; the caller removes it), opts.onRunId,
 * opts.onPhoto({ index, ok, error, work }) as each picture is finished (work:
 * its folder of pieces, done with). onProgress({ index, label, fraction }).
 * Resolves { ok, stopped, error }: a picture never reported failed with `error`.
 */
export async function moEnhanceRunMany(jobs, scale, onProgress, opts = {}) {
  const b = await readyBridge();
  if (!opts.workDir) throw new Error('Enhance needs a work folder.');
  const jobsPath = opts.workDir + (opts.workDir.includes('\\') ? '\\' : '/') + 'jobs.json';
  const wrote = await window.parallxElectron.fs.writeFile(jobsPath, JSON.stringify(jobs.map((j) => ({ input: j.input, output: j.output }))), 'utf8');
  if (wrote && wrote.error) throw new Error('The list of pictures could not be written.');
  const piece = await pickPiece(b);
  const runId = newRunId();
  if (opts.onRunId) opts.onRunId(runId);
  const follow = moEnhanceManyProgress(jobs.length);
  runListeners.set(runId, (d) => {
    const v = follow(d);
    try {
      if (v && v.photo) { if (opts.onPhoto) opts.onPhoto(v.photo); } else if (v && onProgress) onProgress(v);
    } catch { /* the caller closed */ }
  });
  try {
    const r = await b.invoke('runtimes:run', moEnhanceSpec(), enginePath('enhance.py'), moEnhanceManyArgs(jobsPath, scale, piece.out, opts.workDir), runId);
    if (r && r.ok) return { ok: true, stopped: false, error: '' };
    if (r && r.stopped) return { ok: false, stopped: true, error: 'Stopped.' };
    return { ok: false, stopped: false, error: failureOf(r) };
  } finally {
    runListeners.delete(runId);
  }
}

/** Stop a run started by moEnhanceRun (its runId came through opts.onRunId). */
export async function moEnhanceStop(runId) {
  const b = bridge();
  if (b && runId) await b.invoke('runtimes:cancel', runId).catch(() => {});
}
