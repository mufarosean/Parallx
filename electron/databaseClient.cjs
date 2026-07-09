// electron/databaseClient.cjs — async proxies to the SQLite worker thread
//
// Drop-in replacements for the singletons in database.cjs, with every method
// returning a Promise resolved from electron/databaseWorker.cjs.  The main
// process never executes a SQL statement on its own event loop — saving,
// version-history checkpoints, and indexing can no longer stall user input
// ("typing freezes while saving").
//
// API parity notes:
//   • `databaseManager.isOpen` / `currentPath` stay SYNCHRONOUS properties
//     (main.cjs reads them inline) — mirrored locally from open()/close()
//     outcomes rather than round-tripping to the worker.
//   • Renderer-facing behavior is unchanged: the ipcMain handlers were
//     already async, they now await these proxies.
//   • Close-on-quit is fire-and-forget: WAL-mode SQLite recovers cleanly
//     from a missing close (that is the point of WAL), and the worker dies
//     with the process.

'use strict';

const { Worker } = require('worker_threads');
const path = require('path');

let _worker = null;
let _nextId = 1;
const _pending = new Map(); // id → { resolve, reject }

function ensureWorker() {
  if (_worker) return _worker;
  _worker = new Worker(path.join(__dirname, 'databaseWorker.cjs'));
  _worker.on('message', (msg) => {
    const entry = _pending.get(msg.id);
    if (!entry) return;
    _pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error));
  });
  const failAll = (reason) => {
    for (const { reject } of _pending.values()) {
      reject(new Error(`[databaseClient] worker unavailable: ${reason}`));
    }
    _pending.clear();
    _worker = null; // next call respawns
  };
  _worker.on('error', (err) => {
    console.error('[databaseClient] DB worker error:', err);
    failAll(err?.message ?? 'worker error');
  });
  _worker.on('exit', (code) => {
    if (code !== 0) console.error(`[databaseClient] DB worker exited with code ${code}`);
    failAll(`exit ${code}`);
  });
  // The worker must not keep the process alive on quit.
  _worker.unref();
  return _worker;
}

function call(target, method, args) {
  const worker = ensureWorker();
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    worker.postMessage({ id, target, method, args });
  });
}

/** Terminate the worker (app shutdown). Pending calls reject. */
async function disposeDatabaseWorker() {
  if (!_worker) return;
  const w = _worker;
  _worker = null;
  try { await w.terminate(); } catch { /* already gone */ }
}

// ─── Async workspace-database proxy ─────────────────────────────────────────

class AsyncDatabaseManager {
  _isOpen = false;
  _currentPath = null;

  /** @returns {boolean} last-known open state (mirrored; sync for handler reads) */
  get isOpen() { return this._isOpen; }

  /** @returns {string | null} */
  get currentPath() { return this._currentPath; }

  async open(dbPath) {
    await call('db', 'open', [dbPath]);
    this._isOpen = true;
    this._currentPath = dbPath;
  }

  async close() {
    this._isOpen = false;
    this._currentPath = null;
    await call('db', 'close', []);
  }

  migrate(migrationsDir) { return call('db', 'migrate', [migrationsDir]); }
  run(sql, params = []) { return call('db', 'run', [sql, params]); }
  get(sql, params = []) { return call('db', 'get', [sql, params]); }
  all(sql, params = []) { return call('db', 'all', [sql, params]); }
  runTransaction(operations) { return call('db', 'runTransaction', [operations]); }
  dropToolData(migrationPrefix, tablePrefix) { return call('db', 'dropToolData', [migrationPrefix, tablePrefix]); }
}

// ─── Async extension-database proxy ─────────────────────────────────────────

class AsyncExtensionDatabaseManager {
  /** @type {Set<string>} mirrored open extension ids (sync isOpen reads) */
  _open = new Set();

  async open(extensionId, workspacePath) {
    const dbPath = await call('extDb', 'open', [extensionId, workspacePath]);
    this._open.add(extensionId);
    return dbPath;
  }

  async close(extensionId) {
    this._open.delete(extensionId);
    await call('extDb', 'close', [extensionId]);
  }

  async closeAll() {
    this._open.clear();
    await call('extDb', 'closeAll', []);
  }

  /** @returns {boolean} last-known open state (mirrored) */
  isOpen(extensionId) { return this._open.has(extensionId); }

  migrate(extensionId, migrationsDir) { return call('extDb', 'migrate', [extensionId, migrationsDir]); }
  run(extensionId, sql, params = []) { return call('extDb', 'run', [extensionId, sql, params]); }
  get(extensionId, sql, params = []) { return call('extDb', 'get', [extensionId, sql, params]); }
  all(extensionId, sql, params = []) { return call('extDb', 'all', [extensionId, sql, params]); }
  runTransaction(extensionId, operations) { return call('extDb', 'runTransaction', [extensionId, operations]); }
}

const databaseManager = new AsyncDatabaseManager();
const extensionDatabaseManager = new AsyncExtensionDatabaseManager();

module.exports = {
  databaseManager,
  extensionDatabaseManager,
  disposeDatabaseWorker,
};
