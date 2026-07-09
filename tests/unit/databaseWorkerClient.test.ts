// databaseWorkerClient.test.ts — the SQLite worker-thread client (node env).
//
// Saving must never run on the Electron main process's event loop (it routes
// user input — synchronous better-sqlite3 there froze typing during
// version-history checkpoints).  These tests drive the REAL worker
// (electron/databaseWorker.cjs) through the async proxies in
// databaseClient.cjs: full query surface, transaction semantics including
// the expectChanges rollback guard, tool-data drops, and the sync isOpen
// mirror that main.cjs handlers read inline.
//
// ABI NOTE: better-sqlite3 in this repo is compiled for ELECTRON's Node ABI
// (electron-rebuild), so plain-node vitest cannot load it — the suite skips
// itself in that case.  The SAME checks then run under the real ABI via:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/dbWorkerSmoke.cjs
// (exit 0 = all pass; verified in CI-less environments by exit code).

import { describe, expect, it, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// @ts-expect-error — CJS module without type declarations
import dbClient from '../../electron/databaseClient.cjs';

const { databaseManager, disposeDatabaseWorker } = dbClient;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-dbworker-'));
const dbPath = path.join(tmpDir, 'data.db');

// Ground-truth ABI probe: ask the WORKER (where better-sqlite3 actually
// loads) whether it can serve — the test process loading the module proves
// nothing about the worker's runtime.
const workerServes = await (async () => {
  try {
    await databaseManager.open(dbPath);
    return true;
  } catch (err) {
    if (/NODE_MODULE_VERSION|worker unavailable/.test(String(err))) return false;
    throw err;
  }
})();

afterAll(async () => {
  await disposeDatabaseWorker();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe.skipIf(!workerServes)('database worker client', () => {
  it('opens, mirrors isOpen synchronously, and executes DDL/DML off-thread', async () => {
    // (opened by the probe above)
    expect(databaseManager.isOpen).toBe(true);
    expect(databaseManager.currentPath).toBe(dbPath);

    await databaseManager.run('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)');
    const ins = await databaseManager.run(
      'INSERT INTO notes (id, body) VALUES (?, ?)', ['n1', 'hello'],
    );
    expect(ins.changes).toBe(1);

    const row = await databaseManager.get('SELECT body FROM notes WHERE id = ?', ['n1']);
    expect(row.body).toBe('hello');

    const rows = await databaseManager.all('SELECT id FROM notes');
    expect(rows).toHaveLength(1);
  });

  it('large payloads round-trip (the checkpoint-sized write path)', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024); // ~2 MB, a large study page
    await databaseManager.run('INSERT INTO notes (id, body) VALUES (?, ?)', ['big', big]);
    const row = await databaseManager.get('SELECT body FROM notes WHERE id = ?', ['big']);
    expect(row.body.length).toBe(big.length);
  });

  it('runTransaction: $lastRowId sentinel and atomic rollback on expectChanges miss', async () => {
    await databaseManager.run('CREATE TABLE t (n INTEGER)');
    const results = await databaseManager.runTransaction([
      { type: 'run', sql: 'INSERT INTO t (n) VALUES (?)', params: [7] },
      { type: 'get', sql: 'SELECT n FROM t WHERE rowid = ?', params: ['$lastRowId'] },
    ]);
    expect(results[1].n).toBe(7);

    // Guarded op matching 0 rows must roll back the WHOLE transaction.
    await expect(databaseManager.runTransaction([
      { type: 'run', sql: 'INSERT INTO t (n) VALUES (?)', params: [8] },
      { type: 'run', sql: 'UPDATE t SET n = 9 WHERE n = 999', params: [], expectChanges: true },
    ])).rejects.toThrow(/revision conflict/);
    const rows = await databaseManager.all('SELECT n FROM t');
    expect(rows.map((r: any) => r.n)).toEqual([7]); // the 8 rolled back
  });

  it('dropToolData removes prefixed tables', async () => {
    await databaseManager.run('CREATE TABLE mo_items (id TEXT)');
    const res = await databaseManager.dropToolData('media-organizer', 'mo_');
    expect(res.droppedTables).toContain('mo_items');
  });

  it('errors surface as rejected promises, not crashes', async () => {
    await expect(databaseManager.run('TOTALLY NOT SQL')).rejects.toThrow();
    // worker still alive and serving
    const row = await databaseManager.get('SELECT 1 AS ok');
    expect(row.ok).toBe(1);
  });

  it('close flips the mirror and further queries fail cleanly', async () => {
    await databaseManager.close();
    expect(databaseManager.isOpen).toBe(false);
    await expect(databaseManager.get('SELECT 1')).rejects.toThrow(/No database is open/);
  });
});
