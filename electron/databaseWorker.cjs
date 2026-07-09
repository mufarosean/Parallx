// electron/databaseWorker.cjs — SQLite executor worker thread
//
// Hosts the REAL DatabaseManager + ExtensionDatabaseManager (better-sqlite3,
// synchronous) inside a worker_thread so their blocking execution never runs
// on the Electron main process.  The main process routes user input; a
// multi-megabyte page save or version-history checkpoint executed there
// stalls keystrokes — the "typing freezes while saving" bug.  In here, a slow
// statement blocks only this worker's queue, never the UI.
//
// Protocol (parentPort messages):
//   request : { id: number, target: 'db' | 'extDb', method: string, args: any[] }
//   response: { id: number, ok: true,  result: any }
//           | { id: number, ok: false, error: string }
//
// Property reads (isOpen / currentPath) are exposed as methods of the same
// name.  Results cross the thread boundary via structured clone (BigInt from
// lastInsertRowid survives; better-sqlite3 returns plain objects).

'use strict';

const { parentPort } = require('worker_threads');
const { DatabaseManager, ExtensionDatabaseManager } = require('./database.cjs');

const db = new DatabaseManager();
const extDb = new ExtensionDatabaseManager();

/** Dispatch a method call, mapping getter-backed names onto property reads. */
function dispatch(target, method, args) {
  if (target === 'db') {
    switch (method) {
      case 'isOpen': return db.isOpen;
      case 'currentPath': return db.currentPath;
      case 'open': return db.open(...args);
      case 'close': return db.close(...args);
      case 'migrate': return db.migrate(...args);
      case 'run': return db.run(...args);
      case 'get': return db.get(...args);
      case 'all': return db.all(...args);
      case 'runTransaction': return db.runTransaction(...args);
      case 'dropToolData': return db.dropToolData(...args);
      default: throw new Error(`[databaseWorker] Unknown db method: ${method}`);
    }
  }
  if (target === 'extDb') {
    switch (method) {
      case 'isOpen': return extDb.isOpen(...args);
      case 'open': return extDb.open(...args);
      case 'close': return extDb.close(...args);
      case 'closeAll': return extDb.closeAll(...args);
      case 'migrate': return extDb.migrate(...args);
      case 'run': return extDb.run(...args);
      case 'get': return extDb.get(...args);
      case 'all': return extDb.all(...args);
      case 'runTransaction': return extDb.runTransaction(...args);
      default: throw new Error(`[databaseWorker] Unknown extDb method: ${method}`);
    }
  }
  throw new Error(`[databaseWorker] Unknown target: ${target}`);
}

parentPort.on('message', (msg) => {
  const { id, target, method, args } = msg;
  try {
    const result = dispatch(target, method, args ?? []);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
});
