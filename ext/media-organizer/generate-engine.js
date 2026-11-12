// generate-engine.js — Generate's engine: Qwen-Image-2.1, in a runtime the app
// installs once on the user's click (the core side is
// electron/runtimeBridge.cjs; Enhance's engine, enhance-engine.js, is the
// same kind of thing).
//
// This file declares the runtime (Python, the package list, the model's 24
// files with their sizes and SHA-256, read from engine/generate-models.json)
// and runs engine/generate.py on one job. What Generate is, and why an edit is
// a patch cut out at the photo's own size and laid back, is in that script.
//
// The model takes about 19 GB of graphics memory while it works and does not
// share the card with a loaded chat model; the script says so in words when
// there is not enough free.

const RUNTIME_ID = 'qwen-image-generate';
/** Packages (PyTorch is most of it) and Python, on top of the model files. */
const PACKAGE_BYTES = 5.5 * 1024 ** 3;

let extDir = '';
let files = null;   // the model's files, read once from generate-models.json
const runListeners = new Map();   // runId -> onProgress
let stopListening = null;

const bridge = () => (typeof window !== 'undefined' && window.parallxElectron && window.parallxElectron.optionalBridges) || null;
const sep = () => (extDir.includes('\\') ? '\\' : '/');
const enginePath = (...parts) => [extDir, 'engine', ...parts].join(sep());

/** Where the extension lives, and the model's file list (read through the extension's own file access). */
export function moGenerateActivate(dir, modelFiles) {
  extDir = dir;
  files = (modelFiles || []).map((f) => ({ name: f.name, url: f.url, bytes: f.bytes, sha256: f.sha256 }));
  const b = bridge();
  if (b && !stopListening) {
    stopListening = b.on('runtimes:progress', (p) => {
      if (!p || p.id !== RUNTIME_ID || p.kind !== 'run') return;
      const fn = runListeners.get(p.runId);
      if (fn) { try { fn(p.data || {}); } catch { /* a closed panel */ } }
    });
  }
  return { dispose: () => { if (stopListening) { stopListening(); stopListening = null; } runListeners.clear(); } };
}

/** The runtime's declaration, checked again by the core. */
export function moGenerateSpec() {
  return {
    id: RUNTIME_ID,
    title: 'Generate',
    python: '3.13.16',
    locks: { win32: enginePath('requirements-generate-win.lock') },
    files: files || [],
    needs: { platforms: ['win32-x64'], gpu: 'nvidia', minVramMiB: 24000, minDriver: 570, diskBytes: 45 * 1024 ** 3 },
    selftest: { script: enginePath('selftest-generate.py'), args: [] },
  };
}

/** How much setting it up downloads, in bytes. */
export function moGenerateDownloadBytes() {
  return (files || []).reduce((n, f) => n + f.bytes, 0) + PACKAGE_BYTES;
}

/** { state: 'absent' | 'partial' | 'ready', installing, machine: { ok, problems } }. */
export async function moGenerateStatus() {
  const b = bridge();
  if (!b) return { state: 'absent', installing: false, machine: { ok: false, problems: ['Generate needs the desktop app.'] } };
  const [st, machine] = await Promise.all([b.invoke('runtimes:status', moGenerateSpec()), b.invoke('runtimes:check', moGenerateSpec())]);
  return { state: (st && st.state) || 'absent', installing: !!(st && st.installing), machine: machine && Array.isArray(machine.problems) ? machine : { ok: false, problems: [(st && st.error) || 'The engine could not be checked.'] } };
}

/** What a progress line from the script means, as { label, fraction }. */
export function moGenerateProgress(d) {
  if (!d || typeof d !== 'object') return { label: 'Working', fraction: 0 };
  if (d.stage === 'load') return { label: 'Loading the model', fraction: 0.03 };
  if (d.stage === 'generate') {
    const of = Math.max(1, d.of || 1);
    const within = Math.min(1, (d.step || 0) / Math.max(1, d.steps || 1));
    const label = of > 1 ? `Generating ${d.try} of ${of}` : 'Generating';
    return { label, fraction: 0.05 + 0.93 * ((Math.max(1, d.try || 1) - 1 + within) / of) };
  }
  if (d.stage === 'try') return { label: 'Laying it back', fraction: 0.05 + 0.93 * ((d.try || 1) / Math.max(1, d.of || 1)) };
  if (d.stage === 'done') return { label: 'Done', fraction: 1 };
  return { label: 'Working', fraction: 0 };
}

/**
 * Run one job (a JSON file the caller wrote: input, mask, instruction,
 * output, steps, seed, tries). onProgress({ label, fraction }). Resolves the
 * script's result ({ box, tries, peak_gb }); throws an Error whose message is
 * for the user.
 */
export async function moGenerateRun(jobPath, onProgress, opts = {}) {
  const b = bridge();
  if (!b) throw new Error('Generate needs the desktop app.');
  const runId = `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (opts.onRunId) opts.onRunId(runId);
  let result = null;
  runListeners.set(runId, (d) => {
    if (d.stage === 'done') result = d;
    if (onProgress) onProgress(moGenerateProgress(d));
  });
  try {
    const r = await b.invoke('runtimes:run', moGenerateSpec(), enginePath('generate.py'), ['--job', jobPath], runId);
    if (r && r.stopped) throw Object.assign(new Error('Stopped.'), { stopped: true });
    if (!r || !r.ok) {
      const said = String((r && (r.stderr || r.error)) || '');
      const m = said.match(/GENERATE-ERROR:\s*(.+)/);
      throw new Error(m ? m[1].trim() : (r && r.code === 'NOT_READY') ? 'Generate is not set up yet.' : 'Generate stopped before it finished.');
    }
    if (!result) throw new Error('Generate finished without a result.');
    return { box: result.box, tries: result.tries, peakGb: result.peak_gb, modelSize: result.model_size };
  } finally {
    runListeners.delete(runId);
  }
}

/** Stop a run. */
export async function moGenerateStop(runId) {
  const b = bridge();
  if (b && runId) await b.invoke('runtimes:cancel', runId).catch(() => {});
}
