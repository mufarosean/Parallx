// electron/doclingBridge.cjs — Manages the Docling Python bridge service
//
// Responsibilities:
//   - Detect Python 3.10+ availability
//   - Check if `docling` package is installed
//   - Start/stop the FastAPI bridge server (tools/docling-bridge/)
//   - Health check polling
//   - Convert documents via HTTP calls to the bridge
//   - Graceful shutdown on app exit
//
// Design:
//   - Runs in Electron main process (CommonJS)
//   - The Python service binds to 127.0.0.1 only
//   - Emits status events via callbacks (no Node EventEmitter — keep it simple)
//   - Falls back silently when Python/Docling unavailable

const { spawn, exec, execSync } = require('child_process');
const { promisify } = require('util');

/** A shell command's stdout, off the main thread; rejects when it fails or times out. */
const run = promisify(exec);
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default port for the Docling bridge. Will auto-increment if busy. */
const DEFAULT_PORT = 7779;

/** Maximum port attempts before giving up. */
const MAX_PORT_ATTEMPTS = 10;

/** Health check polling interval (ms). */
const HEALTH_POLL_INTERVAL = 1000;

/** Maximum time to wait for the service to become healthy (ms). */
const HEALTH_TIMEOUT = 60_000;

/** HTTP request timeout for conversion calls (ms). 5 min for large docs. */
const CONVERT_TIMEOUT = 300_000;

/** Time to wait for graceful shutdown before SIGKILL (ms). */
const SHUTDOWN_GRACE_MS = 5000;

// ─── State ──────────────────────────────────────────────────────────────────

/**
 * @typedef {'unavailable' | 'starting' | 'available' | 'downloading-models' | 'error'} DoclingStatus
 */

/**
 * @typedef {Object} DoclingConvertResult
 * @property {string} markdown
 * @property {number} page_count
 * @property {number} tables_found
 * @property {number} elapsed_ms
 * @property {string[]} diagnostics
 */

/** @type {import('child_process').ChildProcess | null} */
let _process = null;

/** @type {number | null} */
let _port = null;

/** @type {DoclingStatus} */
let _status = 'unavailable';

/** @type {string | null} */
let _pythonPath = null;

/** @type {boolean} */
let _doclingInstalled = false;

/** @type {((status: DoclingStatus) => void) | null} */

/** @type {boolean} */
let _shutdownRequested = false;

/** @type {string | null} App root passed from main.cjs; used to pin TMPDIR. */
let _appRoot = null;

/**
 * Where the reader runs. 'managed': the engine Parallx set up itself, in a
 * tool runtime (electron/runtimeBridge.cjs, declared in doclingRuntime.cjs).
 * 'system': a Docling someone installed into their own Python, as before.
 * @type {'managed' | 'system' | null}
 */
let _engine = null;

/** @type {(() => any) | null} The runtime bridge's main-process API, loaded on first use. */
let _runtimeApi = null;

/** The managed engine's declaration, or null before the app root is known. */
function engineSpec() {
  const root = _appRoot || path.join(__dirname, '..');
  return require('./doclingRuntime.cjs').doclingRuntimeSpec(root);
}

/** The managed engine's Python and environment when it is set up; null otherwise. */
async function managedLaunch() {
  if (!_runtimeApi) return null;
  try { return await _runtimeApi().launch(engineSpec()); } catch { return null; }
}

/** @type {number} */
let _restartCount = 0;

/** Maximum automatic restarts. */
const MAX_RESTARTS = 1;

// ─── Python Detection ───────────────────────────────────────────────────────

/**
 * Find a Python 3.10+ executable on the system. Asynchronous: each probe
 * used to run with execSync and held the main process (every IPC handler
 * with it) for up to five seconds per candidate.
 * @returns {Promise<string | null>} Path to Python executable, or null if not found.
 */
async function detectPython() {
  if (_pythonPath) return _pythonPath;

  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py -3']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const { stdout } = await run(`${cmd} --version 2>&1`, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      const version = stdout.trim();

      // Parse "Python 3.x.y"
      const match = version.match(/Python\s+(\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major >= 3 && minor >= 10) {
          _pythonPath = cmd;
          return _pythonPath;
        }
      }
    } catch {
      // Command not found or errored — try next
    }
  }

  return null;
}

/**
 * Check if the `docling` Python package is installed.
 * @returns {Promise<boolean>}
 */
async function checkDoclingInstalled() {
  if (await managedLaunch()) { _doclingInstalled = true; return true; }
  return checkSystemDocling();
}

/** Is Docling importable from the system's own Python? */
async function checkSystemDocling() {
  const python = await detectPython();
  if (!python) return false;

  try {
    await run(`${python} -c "import docling; print(docling.__version__)"`, {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    _doclingInstalled = true;
    return true;
  } catch {
    _doclingInstalled = false;
    return false;
  }
}

// ─── Port Detection ─────────────────────────────────────────────────────────

/**
 * Find an available port starting from `startPort`.
 * @param {number} startPort
 * @returns {Promise<number>}
 */
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryPort(port) {
      if (attempt >= MAX_PORT_ATTEMPTS) {
        reject(new Error(`No available port found after ${MAX_PORT_ATTEMPTS} attempts`));
        return;
      }

      const server = net.createServer();
      server.once('error', () => {
        attempt++;
        tryPort(port + 1);
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    }

    tryPort(startPort);
  });
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

/**
 * Make an HTTP request to the Docling bridge.
 * @param {'GET' | 'POST'} method
 * @param {string} endpoint — e.g. '/health'
 * @param {object} [body]
 * @param {number} [timeout]
 * @returns {Promise<any>}
 */
function httpRequest(method, endpoint, body, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: '127.0.0.1',
      port: _port,
      path: endpoint,
      method,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch {
          resolve(responseData);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${endpoint} timed out after ${timeout}ms`));
    });

    if (data) req.write(data);
    req.end();
  });
}

// ─── Service Lifecycle ──────────────────────────────────────────────────────

/**
 * Set status and notify listener.
 * @param {DoclingStatus} status
 */
function _setStatus(status) {
  if (_status === status) return;
  _status = status;
}

/**
 * Start the Docling bridge service.
 * @returns {Promise<boolean>} true if service started successfully.
 */
async function startService() {
  if (_process) return true; // Already running

  // The engine Parallx set up comes first; a Docling in the system's own
  // Python is used only when there is none.
  const managed = await managedLaunch();
  let python = managed ? managed.python : null;
  if (!managed) {
    python = await detectPython();
    if (!python) {
      console.log('[DoclingBridge] No document reader is set up and Python 3.10+ was not found');
      _setStatus('unavailable');
      return false;
    }
    if (!(await checkSystemDocling())) {
      console.log('[DoclingBridge] No document reader is set up');
      _setStatus('unavailable');
      return false;
    }
  }
  _engine = managed ? 'managed' : 'system';
  _doclingInstalled = true;

  try {
    _setStatus('starting');
    _port = await findAvailablePort(DEFAULT_PORT);

    const bridgePath = path.join(__dirname, '..', 'tools', 'docling-bridge');
    const serverModule = path.join(bridgePath, 'parallx_docling', 'server.py');

    // Verify the server module exists
    if (!fs.existsSync(serverModule)) {
      console.error('[DoclingBridge] Server module not found:', serverModule);
      _setStatus('error');
      return false;
    }

    _shutdownRequested = false;

    // Pin TMPDIR to APP_ROOT/data/tmp so Python's tempfile writes stay inside
    // the app tree and never touch a world-readable system temp dir.
    const appTmpDir = _appRoot ? path.join(_appRoot, 'data', 'tmp') : undefined;
    // The managed engine gets the runtime's own rebuilt environment: its
    // caches and temp files stay inside the runtime, and nothing is fetched.
    const spawnEnv = managed
      ? managed.env
      : appTmpDir
        ? { ...process.env, TMPDIR: appTmpDir, TEMP: appTmpDir, TMP: appTmpDir }
        : process.env;
    _process = spawn(python, [serverModule, '--port', String(_port)], {
      cwd: bridgePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
      windowsHide: true,
    });

    // Capture stdout for PORT: line
    let portDetected = false;
    _process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('PORT:') && !portDetected) {
          portDetected = true;
          const reportedPort = parseInt(line.slice(5).trim(), 10);
          if (reportedPort && reportedPort !== _port) {
            _port = reportedPort;
          }
        }
      }
    });

    // Log stderr from Python process
    _process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log('[DoclingBridge:py]', msg);
      }
    });

    // Handle process exit
    _process.on('exit', (code, signal) => {
      console.log('[DoclingBridge] Python process exited (code=%s, signal=%s)', code, signal);
      _process = null;

      if (!_shutdownRequested && _restartCount < MAX_RESTARTS) {
        _restartCount++;
        console.log('[DoclingBridge] Attempting restart (%d/%d)', _restartCount, MAX_RESTARTS);
        _setStatus('starting');
        startService().catch((err) => {
          console.error('[DoclingBridge] Restart failed:', err);
          _setStatus('error');
        });
      } else if (!_shutdownRequested) {
        _setStatus('error');
      }
    });

    _process.on('error', (err) => {
      console.error('[DoclingBridge] Failed to start Python process:', err);
      _process = null;
      _setStatus('error');
    });

    // Wait for service to become healthy
    const healthy = await _waitForHealth();
    if (healthy) {
      _setStatus('available');
      _restartCount = 0; // Reset on successful start
      return true;
    } else {
      _setStatus('error');
      await stopService();
      return false;
    }

  } catch (err) {
    console.error('[DoclingBridge] Start failed:', err);
    _setStatus('error');
    return false;
  }
}

/**
 * Poll /health until the service responds or timeout.
 * @returns {Promise<boolean>}
 */
async function _waitForHealth() {
  const start = Date.now();

  while (Date.now() - start < HEALTH_TIMEOUT) {
    try {
      const health = await httpRequest('GET', '/health', null, 3000);
      if (health && health.status === 'ok') {
        if (health.models_loading) {
          _setStatus('downloading-models');
        }
        return true;
      }
    } catch {
      // Service not ready yet
    }

    // Check if process died
    if (!_process) return false;

    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL));
  }

  console.error('[DoclingBridge] Health check timed out after %dms', HEALTH_TIMEOUT);
  return false;
}

/**
 * Stop the Docling bridge service gracefully.
 */
async function stopService() {
  _shutdownRequested = true;

  if (!_process) {
    _setStatus('unavailable');
    return;
  }

  const proc = _process;
  _process = null;

  // Try graceful shutdown first
  try {
    if (process.platform === 'win32') {
      // Windows: taskkill the process tree
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true, timeout: SHUTDOWN_GRACE_MS });
      } catch {
        // Best effort
      }
    } else {
      proc.kill('SIGTERM');

      // Wait for graceful exit
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
          resolve(undefined);
        }, SHUTDOWN_GRACE_MS);

        proc.once('exit', () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
  } catch {
    // Process already dead
  }

  _port = null;
  _setStatus('unavailable');
}

// ─── Document Conversion ────────────────────────────────────────────────────

/**
 * Convert a document to structured Markdown via Docling.
 *
 * @param {string} filePath — Absolute path to the document
 * @param {{ ocr?: boolean }} [options]
 * @returns {Promise<DoclingConvertResult>}
 */
async function convertDocument(filePath, options = {}) {
  if (_status !== 'available') {
    throw new Error(`Docling bridge not available (status: ${_status})`);
  }

  const body = {
    path: filePath,
    ocr: options.ocr ?? false,
  };

  const result = await httpRequest('POST', '/convert', body, CONVERT_TIMEOUT);

  if (result?.detail) {
    throw new Error(`Docling conversion failed: ${result.detail}`);
  }

  return keepReading(filePath, result);
}

// ─── Readings ───────────────────────────────────────────────────────────────
//
// A reading is where everything on a document's pages is: the lines of a
// scanned page with their boxes, every block, every table's cells. The reader
// returns it with the text. It is kept here, one file per document under
// <app>/data/readings, and handed out by path for as long as the document's
// size and modified time are the ones it was read at. The viewer's text layer
// for a scan, the place a citation lights up, and a scan's page text all come
// from it; the index only needs the Markdown, so the reading is not sent on.

function readingsDir() {
  return path.join(_appRoot || path.join(__dirname, '..'), 'data', 'readings');
}

function readingFile(filePath) {
  const key = require('crypto').createHash('sha256').update(path.resolve(String(filePath)).toLowerCase()).digest('hex').slice(0, 40);
  return path.join(readingsDir(), `${key}.json`);
}

/** Store a conversion's reading and return the result without it. */
async function keepReading(filePath, result) {
  if (!result || typeof result !== 'object' || !('reading' in result)) return result;
  const { reading, ...rest } = result;
  if (reading && Array.isArray(reading.pages)) {
    try {
      const st = await fs.promises.stat(filePath);
      await fs.promises.mkdir(readingsDir(), { recursive: true });
      const file = readingFile(filePath);
      await fs.promises.writeFile(`${file}.tmp`, JSON.stringify({ path: path.resolve(filePath), size: st.size, mtimeMs: Math.round(st.mtimeMs), reading }));
      await fs.promises.rename(`${file}.tmp`, file);
    } catch (err) {
      console.warn('[DoclingBridge] The reading could not be kept for', filePath, err && err.message);
    }
  }
  return rest;
}

/**
 * The reading kept for a document, or null when there is none or the
 * document has changed since it was read.
 * @param {string} filePath
 */
async function getReading(filePath) {
  try {
    const kept = JSON.parse(await fs.promises.readFile(readingFile(filePath), 'utf8'));
    const st = await fs.promises.stat(filePath);
    if (kept.size !== st.size || kept.mtimeMs !== Math.round(st.mtimeMs)) return null;
    return kept.reading || null;
  } catch {
    return null;
  }
}

/**
 * Convert multiple documents in a batch.
 *
 * @param {{ path: string; ocr?: boolean }[]} files
 * @returns {Promise<DoclingConvertResult[]>}
 */
async function convertBatch(files) {
  if (_status !== 'available') {
    throw new Error(`Docling bridge not available (status: ${_status})`);
  }

  const body = {
    files: files.map((f) => ({ path: f.path, ocr: f.ocr ?? false })),
  };

  const result = await httpRequest('POST', '/convert/batch', body, CONVERT_TIMEOUT);
  const results = result?.results ?? [];
  return Promise.all(results.map((r, i) => (files[i] ? keepReading(files[i].path, r) : r)));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get current bridge status.
 * @returns {{ status: DoclingStatus, port: number | null, pythonPath: string | null, doclingInstalled: boolean }}
 */
function getStatus() {
  return {
    status: _status,
    port: _port,
    pythonPath: _pythonPath,
    doclingInstalled: _doclingInstalled,
    engine: _engine,
  };
}

/**
 * Check if the bridge is available and ready for conversions.
 * @returns {boolean}
 */
function isAvailable() {
  return _status === 'available';
}

/**
 * Install the `docling` Python package via pip.
 *
 * Returns a result object with install output and whether it succeeded.
 * Does NOT start the service — caller can do that after a successful install.
 *
 * @returns {Promise<{ ok: boolean, pythonPath: string | null, output: string, alreadyInstalled: boolean }>}
 */
async function installDocling() {
  if (await managedLaunch()) {
    return { ok: true, pythonPath: null, output: 'The document reader is already set up.', alreadyInstalled: true };
  }
  if (!_runtimeApi) {
    return { ok: false, pythonPath: null, output: 'The document reader can only be set up in the desktop app.', alreadyInstalled: false };
  }
  // Set up in a tool runtime: its own Python, packages from the lock file by
  // hash, the reader's models by hash. Progress goes out on runtimes:progress
  // under the engine's id. A stopped or failed set-up carries on where it was.
  const r = await _runtimeApi().install(engineSpec());
  return {
    ok: !!(r && r.ok),
    pythonPath: null,
    output: r && r.ok ? 'The document reader is set up.' : (r && r.error) || 'Setting up stopped.',
    alreadyInstalled: false,
    stopped: !!(r && r.stopped),
  };
}

/** The managed engine: where it stands, what this computer has, how much it fetches. */
async function engineStatus(withSize) {
  if (!_runtimeApi) return { state: 'absent', installing: false, machine: { ok: false, problems: ['The document reader needs the desktop app.'] } };
  const api = _runtimeApi();
  const spec = engineSpec();
  const [st, machine] = await Promise.all([api.status(spec, withSize === true), api.check(spec)]);
  return { ...st, machine, engine: _engine, running: _status === 'available', packageBytes: require('./doclingRuntime.cjs').PACKAGE_BYTES };
}

/** Stop a set-up in progress. */
function cancelInstall() {
  return _runtimeApi ? _runtimeApi().cancel(engineSpec().id) : false;
}

/** Remove the managed engine from this computer (the service is stopped first). */
async function removeEngine() {
  if (!_runtimeApi) return { ok: false, error: 'The document reader needs the desktop app.' };
  if (_engine === 'managed') await stopService();
  const r = await _runtimeApi().remove(engineSpec());
  if (r && r.ok) { _engine = null; _doclingInstalled = false; }
  return r;
}

/** Give the bridge the runtime bridge's main-process API (main.cjs, loaded on first use). */
function setRuntimeApi(getApi) {
  _runtimeApi = getApi;
}

/**
 * Synchronous shutdown for use in before-quit handlers where async isn't awaited.
 * On Windows uses execSync(taskkill); on other platforms sends SIGKILL.
 */
function stopServiceSync() {
  _shutdownRequested = true;
  if (!_process) return;
  const proc = _process;
  _process = null;
  try {
    if (process.platform === 'win32' && proc.pid) {
      // Fire-and-forget tree kill — taskkill outlives us and finishes the
      // job; execSync here used to block quit teardown for up to 3s.
      try {
        require('child_process')
          .spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, detached: true, stdio: 'ignore' })
          .unref();
      } catch { /* best-effort */ }
    } else {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }
  } catch { /* ignore */ }
  _port = null;
  _setStatus('unavailable');
}

/** Set the app root so docling's temp files land in APP_ROOT/data/tmp. */
function setAppRoot(appRoot) {
  _appRoot = appRoot;
}

// ─── IPC ────────────────────────────────────────────────────────────────────
//
// Manages the Docling Python bridge for intelligent document extraction.
// The renderer falls back to the legacy extractors when it is unavailable.

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ isAllowedReadPath: (p: string) => boolean }} opts  the same boundary as every file read
 */
function registerIpc(ipcMain, opts) {
  const allowed = opts.isAllowedReadPath;

  // ── docling:status ──
  ipcMain.handle('docling:status', () => {
    return getStatus();
  });

  // ── docling:start ──
  // Explicitly request the bridge to start (e.g. after workspace open).
  ipcMain.handle('docling:start', async () => {
    try {
      const started = await startService();
      return { ok: started, ...getStatus() };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // ── docling:convert ──
  // Convert a single rich document to structured Markdown via Docling.
  ipcMain.handle('docling:convert', async (_event, filePath, options) => {
    try {
      const result = await convertDocument(filePath, options || {});
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // ── docling:convertBatch ──
  // Convert multiple documents in a single batch call.
  ipcMain.handle('docling:convertBatch', async (_event, files) => {
    try {
      const results = await convertBatch(files || []);
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: err.message || String(err), results: [] };
    }
  });

  // ── docling:install ──
  // Install the Docling Python package via pip. Returns { ok, pythonPath, output, alreadyInstalled }.
  ipcMain.handle('docling:install', async () => {
    try {
      return await installDocling();
    } catch (err) {
      return { ok: false, pythonPath: null, output: err.message || String(err), alreadyInstalled: false };
    }
  });

  // ── docling:reading ──
  // Where everything on a document's pages is, as the reader last found it;
  // null when it has not been read or has changed since. Paths go through the
  // same boundary as every file read.
  ipcMain.handle('docling:reading', async (_event, filePath) => {
    try {
      if (typeof filePath !== 'string' || !allowed(filePath)) return null;
      return await getReading(filePath);
    } catch { return null; }
  });

  // ── docling:engine ──
  // The reader's own engine: where it stands, stop a set-up, remove it.
  ipcMain.handle('docling:engineStatus', async (_event, withSize) => {
    try { return await engineStatus(withSize === true); }
    catch (err) { return { state: 'absent', installing: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('docling:cancelInstall', () => cancelInstall());
  ipcMain.handle('docling:removeEngine', async () => {
    try { return await removeEngine(); }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
}

module.exports = {
  detectPython,
  checkDoclingInstalled,
  startService,
  stopService,
  stopServiceSync,
  convertDocument,
  convertBatch,
  getReading,
  getStatus,
  isAvailable,
  installDocling,
  engineStatus,
  cancelInstall,
  removeEngine,
  setRuntimeApi,
  registerIpc,
  setAppRoot,
};
