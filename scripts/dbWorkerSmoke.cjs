// scripts/dbWorkerSmoke.cjs — verify the SQLite worker thread under the REAL
// Electron ABI (better-sqlite3 here is compiled for Electron, so plain-node
// vitest cannot load it — see tests/unit/databaseWorkerClient.test.ts).
//
// Run with:  ELECTRON_RUN_AS_NODE=1 npx electron scripts/dbWorkerSmoke.cjs
// Exits 0 when every check passes, 1 with a message otherwise.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { databaseManager, disposeDatabaseWorker } = require('../electron/databaseClient.cjs');

function assert(cond, msg) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-dbworker-smoke-'));
  const dbPath = path.join(tmpDir, 'data.db');

  try {
    assert(databaseManager.isOpen === false, 'isOpen should start false');
    await databaseManager.open(dbPath);
    assert(databaseManager.isOpen === true, 'isOpen mirror after open');
    assert(databaseManager.currentPath === dbPath, 'currentPath mirror');

    await databaseManager.run('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)');
    const ins = await databaseManager.run('INSERT INTO notes (id, body) VALUES (?, ?)', ['n1', 'hello']);
    assert(ins.changes === 1, 'insert changes');

    const row = await databaseManager.get('SELECT body FROM notes WHERE id = ?', ['n1']);
    assert(row.body === 'hello', 'get row');

    // Checkpoint-sized payload (the freeze-causing write path)
    const big = 'x'.repeat(2 * 1024 * 1024);
    const t0 = Date.now();
    await databaseManager.run('INSERT INTO notes (id, body) VALUES (?, ?)', ['big', big]);
    const bigRow = await databaseManager.get('SELECT length(body) AS len FROM notes WHERE id = ?', ['big']);
    assert(bigRow.len === big.length, '2MB payload round-trip');
    console.log(`  2MB write+read via worker: ${Date.now() - t0}ms (off main loop)`);

    // Transaction semantics incl. $lastRowId + expectChanges rollback
    await databaseManager.run('CREATE TABLE t (n INTEGER)');
    const results = await databaseManager.runTransaction([
      { type: 'run', sql: 'INSERT INTO t (n) VALUES (?)', params: [7] },
      { type: 'get', sql: 'SELECT n FROM t WHERE rowid = ?', params: ['$lastRowId'] },
    ]);
    assert(results[1].n === 7, '$lastRowId sentinel');

    let rolledBack = false;
    try {
      await databaseManager.runTransaction([
        { type: 'run', sql: 'INSERT INTO t (n) VALUES (?)', params: [8] },
        { type: 'run', sql: 'UPDATE t SET n = 9 WHERE n = 999', params: [], expectChanges: true },
      ]);
    } catch (err) {
      rolledBack = /revision conflict/.test(err.message);
    }
    assert(rolledBack, 'expectChanges rollback rejects');
    const tRows = await databaseManager.all('SELECT n FROM t');
    assert(tRows.length === 1 && tRows[0].n === 7, 'rollback was atomic');

    // dropToolData
    await databaseManager.run('CREATE TABLE mo_items (id TEXT)');
    const dropped = await databaseManager.dropToolData('media-organizer', 'mo_');
    assert(dropped.droppedTables.includes('mo_items'), 'dropToolData');

    // Errors reject without killing the worker
    let rejected = false;
    try { await databaseManager.run('TOTALLY NOT SQL'); } catch { rejected = true; }
    assert(rejected, 'bad SQL rejects');
    const ok = await databaseManager.get('SELECT 1 AS ok');
    assert(ok.ok === 1, 'worker alive after error');

    await databaseManager.close();
    assert(databaseManager.isOpen === false, 'isOpen mirror after close');

    console.log('DB WORKER SMOKE: ALL CHECKS PASSED');
  } finally {
    await disposeDatabaseWorker();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error(String(err && err.stack || err)); process.exit(1); },
);
