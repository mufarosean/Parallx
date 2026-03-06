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

const { spawn, execSync } = require('child_process');
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
let _onStatusChange = null;

/** @type {boolean} */
let _shutdownRequested = false;

/** @type {number} */
let _restartCount = 0;

/** Maximum automatic restarts. */
const MAX_RESTARTS = 1;

// ─── Python Detection ───────────────────────────────────────────────────────

/**
 * Find a Python 3.10+ executable on the system.
 * @returns {string | null} Path to Python executable, or null if not found.
 */
function detectPython() {
  if (_pythonPath) return _pythonPath;

  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py -3']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const version = execSync(`${cmd} --version 2>&1`, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      }).trim();

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
 * @returns {boolean}
 */
function checkDoclingInstalled() {
  const python = detectPython();
  if (!python) return false;

  try {
    execSync(`${python} -c "import docling; print(docling.__version__)"`, {
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
  if (_onStatusChange) {
    try { _onStatusChange(status); }
    catch (e) { console.error('[DoclingBridge] Status callback error:', e); }
  }
}

/**
 * Start the Docling bridge service.
 * @returns {Promise<boolean>} true if service started successfully.
 */
async function startService() {
  if (_process) return true; // Already running

  const python = detectPython();
  if (!python) {
    console.log('[DoclingBridge] Python 3.10+ not found');
    _setStatus('unavailable');
    return false;
  }

  if (!checkDoclingInstalled()) {
    console.log('[DoclingBridge] Docling package not installed');
    _setStatus('unavailable');
    return false;
  }

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

    _process = spawn(python, [serverModule, '--port', String(_port)], {
      cwd: bridgePath,
      stdio: ['pipe', 'pipe', 'pipe'],
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

  return result;
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
  return result?.results ?? [];
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
  };
}

/**
 * Register a status change callback.
 * @param {(status: DoclingStatus) => void} callback
 */
function onStatusChange(callback) {
  _onStatusChange = callback;
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
  const python = detectPython();
  if (!python) {
    return {
      ok: false,
      pythonPath: null,
      output: 'Python 3.10+ not found. Please install Python 3.10 or later from https://www.python.org/downloads/',
      alreadyInstalled: false,
    };
  }

  // Check if already installed
  if (checkDoclingInstalled()) {
    return {
      ok: true,
      pythonPath: python,
      output: 'Docling is already installed.',
      alreadyInstalled: true,
    };
  }

  // Run pip install
  try {
    const { execSync: execSyncLocal } = require('child_process');
    const output = execSyncLocal(
      `${python} -m pip install docling`,
      {
        encoding: 'utf-8',
        timeout: 300000, // 5 min — first install downloads models
        windowsHide: true,
      },
    );

    // Verify installation
    const installed = checkDoclingInstalled();
    return {
      ok: installed,
      pythonPath: python,
      output: installed
        ? 'Docling installed successfully.'
        : `pip install appeared to succeed but import verification failed.\n${output}`,
      alreadyInstalled: false,
    };
  } catch (/** @type {any} */ err) {
    return {
      ok: false,
      pythonPath: python,
      output: `pip install docling failed:\n${err.stderr || err.stdout || err.message || String(err)}`,
      alreadyInstalled: false,
    };
  }
}

module.exports = {
  detectPython,
  checkDoclingInstalled,
  startService,
  stopService,
  convertDocument,
  convertBatch,
  getStatus,
  onStatusChange,
  isAvailable,
  installDocling,
};
