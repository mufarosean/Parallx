// electron/notebookKernelBridge.cjs — one Jupyter kernel per workspace (M96)
//
// Thin by design. The protocol work lives in tools/jupyter-bridge/
// parallx_kernel_host.py, which owns the kernel through jupyter_client; this
// file spawns that host with the workspace's own interpreter, frames the
// newline-delimited JSON in both directions, and manages lifecycle.
//
// Everything about HOW the child is launched — the rebuilt environment, the
// process-tree kill, the machinery directories — is imported from
// pythonBridge.cjs rather than re-derived. The kernel is not a special kind of
// process; it is a workspace Python process that happens to stay alive, and it
// must inherit exactly the same containment as a one-shot script run. A second
// copy of buildChildEnv would be a second thing to keep correct, and the
// failure mode of it drifting is silent (a kernel quietly resolving packages
// from somewhere other than the workspace venv).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const {
  envPaths,
  buildChildEnv,
  ensureMachineryDirs,
  killTree,
  isInside,
} = require('./pythonBridge.cjs');

// ── Constants ───────────────────────────────────────────────────────────────

/** Where the host script lives, relative to this file. */
const HOST_SCRIPT = path.join(__dirname, '..', 'tools', 'jupyter-bridge', 'parallx_kernel_host.py');

/** How long to wait for `ready` before declaring the start a failure. */
const START_TIMEOUT_MS = 90_000;

/**
 * Cap on a single protocol line. A cell that produces a 200 MB base64 image
 * would otherwise be buffered whole in this process and then again in the
 * renderer. Beyond this the line is dropped with an explicit error rather than
 * silently truncated into invalid JSON.
 */
const MAX_LINE_BYTES = 24 * 1024 * 1024;

// ── State ───────────────────────────────────────────────────────────────────

let _getMainWindow = () => null;

/**
 * workspaceRoot → session. At most one kernel per workspace: a notebook is a
 * workspace-scoped tool, and N kernels would mean N interpreters holding N
 * copies of whatever the user loaded.
 */
const _sessions = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

function send(channel, payload) {
  const win = _getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function normalizeRoot(workspaceRoot) {
  return typeof workspaceRoot === 'string' && workspaceRoot ? path.resolve(workspaceRoot) : null;
}

/**
 * Frame a stdout byte stream into newline-delimited JSON objects.
 *
 * Chunk boundaries fall wherever the OS pipe decides, so a chunk can end
 * mid-object and a single chunk can carry several objects. Anything that
 * treats one chunk as one message works right up until output gets large,
 * then corrupts.
 */
function createLineReader(onObject, onProtocolError) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > MAX_LINE_BYTES) {
      buffer = '';
      onProtocolError(`A single kernel message exceeded ${Math.round(MAX_LINE_BYTES / 1048576)} MB and was dropped.`);
      return;
    }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        // The host redirects sys.stdout to stderr precisely so this cannot
        // happen; if it does, something is printing past that guard.
        onProtocolError(`Unparseable line from kernel host: ${line.slice(0, 200)}`);
        continue;
      }
      onObject(parsed);
    }
  };
}

// ── Session ─────────────────────────────────────────────────────────────────

function getSession(workspaceRoot) {
  const root = normalizeRoot(workspaceRoot);
  return root ? _sessions.get(root) : undefined;
}

function statusOf(workspaceRoot) {
  const session = getSession(workspaceRoot);
  if (!session) {
    return { running: false, state: 'not-started', pythonVersion: null, startedAt: null };
  }
  return {
    running: true,
    state: session.state,
    pythonVersion: session.pythonVersion,
    startedAt: session.startedAt,
    pendingRequests: session.pending.size,
  };
}

/**
 * Start the kernel for a workspace. Idempotent: a running kernel is reported,
 * not replaced — `restart` is the explicit way to get a fresh one, and
 * silently swapping it would discard the user's entire session state.
 */
async function startKernel(workspaceRoot) {
  const root = normalizeRoot(workspaceRoot);
  if (!root) return { ok: false, error: 'No workspace.' };

  const existing = _sessions.get(root);
  if (existing) {
    if (existing.starting) {
      // Two notebooks opening at once must not race into two kernels.
      return existing.starting;
    }
    return { ok: true, alreadyRunning: true, ...statusOf(root) };
  }

  const paths = envPaths(root);
  if (!fs.existsSync(paths.pythonExe)) {
    return {
      ok: false,
      code: 'NO_ENV',
      error: 'This workspace has no Python environment yet. Create one in Settings › Python.',
    };
  }
  if (!fs.existsSync(HOST_SCRIPT)) {
    return { ok: false, code: 'NO_HOST', error: `Kernel host script is missing: ${HOST_SCRIPT}` };
  }

  ensureMachineryDirs(root);

  let proc;
  try {
    proc = spawn(paths.pythonExe, [HOST_SCRIPT], {
      cwd: root,
      env: buildChildEnv(root),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { ok: false, error: `Could not start the kernel host: ${err && err.message}` };
  }

  const session = {
    proc,
    root,
    state: 'starting',
    pythonVersion: null,
    startedAt: Date.now(),
    pending: new Map(),   // requestId → { resolve } for command acknowledgement
    stderr: '',
    starting: null,
    ready: false,
  };
  _sessions.set(root, session);

  const startPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.starting = null;
      resolve(value);
    };

    const timer = setTimeout(() => {
      killTree(proc);
      _sessions.delete(root);
      finish({
        ok: false,
        code: 'START_TIMEOUT',
        error: `The kernel did not start within ${Math.round(START_TIMEOUT_MS / 1000)}s.`,
        detail: session.stderr.slice(-2000),
      });
    }, START_TIMEOUT_MS);

    const onProtocolError = (message) => {
      send('notebook:kernel:event', { workspaceRoot: root, event: { type: 'fatal', message } });
    };

    const handleEvent = (event) => {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'ready') {
        session.ready = true;
        session.state = 'idle';
        session.pythonVersion = event.pythonVersion ?? null;
        finish({ ok: true, alreadyRunning: false, ...statusOf(root) });
      } else if (event.type === 'status') {
        session.state = event.state === 'busy' ? 'busy' : event.state === 'idle' ? 'idle' : session.state;
      } else if (event.type === 'fatal' && !session.ready) {
        // Failing before ready means the kernel never came up at all — surface
        // it as a start failure rather than an event nobody is listening for.
        killTree(proc);
        _sessions.delete(root);
        finish({ ok: false, code: event.code ?? 'FATAL', error: event.message });
        return;
      }

      send('notebook:kernel:event', { workspaceRoot: root, event });
    };

    proc.stdout.on('data', createLineReader(handleEvent, onProtocolError));

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      // Bounded: the host logs diagnostics here and a chatty library could
      // otherwise grow this without limit for the life of the kernel.
      session.stderr = (session.stderr + text).slice(-16_000);
      console.log('[NotebookKernel]', text.trimEnd());
    });

    proc.on('error', (err) => {
      _sessions.delete(root);
      finish({ ok: false, error: `Kernel host failed to launch: ${err.message}` });
      send('notebook:kernel:event', {
        workspaceRoot: root,
        event: { type: 'fatal', code: 'SPAWN_ERROR', message: err.message },
      });
    });

    proc.on('close', (code) => {
      _sessions.delete(root);
      if (!settled) {
        finish({
          ok: false,
          code: 'EXITED',
          error: `The kernel host exited (code ${code}) before it was ready.`,
          detail: session.stderr.slice(-2000),
        });
        return;
      }
      send('notebook:kernel:event', {
        workspaceRoot: root,
        event: {
          type: 'fatal',
          code: 'EXITED',
          message: code === 0
            ? 'The kernel stopped.'
            : `The kernel host exited with code ${code}.`,
        },
      });
    });
  });

  session.starting = startPromise;
  return startPromise;
}

/** Write one command line to a running host. */
function post(workspaceRoot, command) {
  const session = getSession(workspaceRoot);
  if (!session) {
    return { ok: false, code: 'NOT_RUNNING', error: 'No kernel is running for this workspace.' };
  }
  try {
    session.proc.stdin.write(JSON.stringify(command) + '\n');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reach the kernel: ${err && err.message}` };
  }
}

/** Stop a workspace's kernel. Graceful first, then the process tree. */
async function stopKernel(workspaceRoot) {
  const root = normalizeRoot(workspaceRoot);
  const session = root ? _sessions.get(root) : undefined;
  if (!session) return { ok: true, stopped: false };

  _sessions.delete(root);
  try {
    session.proc.stdin.write(JSON.stringify({ id: 'shutdown', type: 'shutdown' }) + '\n');
  } catch { /* already gone */ }

  // Give the host a moment to shut the kernel down cleanly (which lets the
  // kernel flush and release its connection files), then take the tree.
  await new Promise((resolve) => setTimeout(resolve, 600));
  killTree(session.proc);
  return { ok: true, stopped: true };
}

/** Stop every kernel. Used by the workspace-scoped teardown. */
function shutdownAll() {
  let count = 0;
  for (const [root, session] of _sessions) {
    try {
      session.proc.stdin.write(JSON.stringify({ id: 'shutdown', type: 'shutdown' }) + '\n');
    } catch { /* already gone */ }
    killTree(session.proc);
    _sessions.delete(root);
    count++;
  }
  return count;
}

// ── Dependency check ────────────────────────────────────────────────────────

/**
 * Whether the workspace environment can host a kernel at all.
 *
 * Checked separately from starting one so the UI can say "install ipykernel"
 * up front instead of surfacing an import traceback from a failed launch.
 */
async function checkKernelDeps(workspaceRoot) {
  const root = normalizeRoot(workspaceRoot);
  if (!root) return { ok: false, ready: false, error: 'No workspace.' };

  const paths = envPaths(root);
  if (!fs.existsSync(paths.pythonExe)) {
    return { ok: true, ready: false, reason: 'NO_ENV' };
  }

  return new Promise((resolve) => {
    const probe = spawn(
      paths.pythonExe,
      ['-c', 'import importlib.util as u,sys; sys.exit(0 if u.find_spec("ipykernel") and u.find_spec("jupyter_client") else 1)'],
      { cwd: root, env: buildChildEnv(root), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] },
    );
    const timer = setTimeout(() => { killTree(probe); resolve({ ok: true, ready: false, reason: 'TIMEOUT' }); }, 30_000);
    probe.on('error', () => { clearTimeout(timer); resolve({ ok: true, ready: false, reason: 'PROBE_FAILED' }); });
    probe.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: true, ready: code === 0, reason: code === 0 ? null : 'MISSING_IPYKERNEL' });
    });
  });
}

// ── IPC ─────────────────────────────────────────────────────────────────────

function setupNotebookKernelBridge(ipcMain, getMainWindow) {
  _getMainWindow = getMainWindow || (() => null);

  ipcMain.handle('notebook:kernel:status', async (_e, workspaceRoot) => {
    try { return { ok: true, ...statusOf(workspaceRoot) }; }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('notebook:kernel:checkDeps', async (_e, workspaceRoot) => {
    try { return await checkKernelDeps(workspaceRoot); }
    catch (err) { return { ok: false, ready: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('notebook:kernel:start', async (_e, workspaceRoot) => {
    try { return await startKernel(workspaceRoot); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('notebook:kernel:stop', async (_e, workspaceRoot) => {
    try { return await stopKernel(workspaceRoot); }
    catch (err) { return { ok: false, error: String(err && err.message) }; }
  });

  ipcMain.handle('notebook:kernel:execute', async (_e, workspaceRoot, requestId, code) => {
    return post(workspaceRoot, { id: String(requestId), type: 'execute', code: String(code ?? '') });
  });

  ipcMain.handle('notebook:kernel:complete', async (_e, workspaceRoot, requestId, code, cursorPos) => {
    return post(workspaceRoot, {
      id: String(requestId), type: 'complete', code: String(code ?? ''), cursorPos: Number(cursorPos) || 0,
    });
  });

  ipcMain.handle('notebook:kernel:interrupt', async (_e, workspaceRoot, requestId) => {
    return post(workspaceRoot, { id: String(requestId ?? 'interrupt'), type: 'interrupt' });
  });

  ipcMain.handle('notebook:kernel:restart', async (_e, workspaceRoot, requestId) => {
    return post(workspaceRoot, { id: String(requestId ?? 'restart'), type: 'restart' });
  });
}

module.exports = {
  setupNotebookKernelBridge,
  shutdownAll,
  // Exported for the headless verification harness and tests.
  startKernel,
  stopKernel,
  statusOf,
  checkKernelDeps,
  post,
  createLineReader,
  isInside,
  HOST_SCRIPT,
};
