// databaseWriteStream.test.ts — the unified data stream's source (P2).
//
// Every persistent SQL mutation passes DatabaseService (throwing style)
// or its asBridge() adapter (the envelope style the five built-in data
// services consume). Both paths must land on onDidWrite — that event IS
// the workspace data stream, with no per-surface opt-in.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, tableFromSql } from '../../src/services/databaseService';

function fakeElectronDb() {
  const calls: string[] = [];
  const db = {
    calls,
    failNext: false,
    open: async () => ({ error: null, dbPath: '/ws/.parallx/data.db' }),
    close: async () => ({ error: null }),
    migrate: async () => ({ error: null }),
    isOpen: async () => ({ isOpen: true }),
    run: async (sql: string) => {
      calls.push(`run:${sql}`);
      return db.failNext
        ? { error: { code: 'X', message: 'boom' } }
        : { error: null, changes: 1, lastInsertRowid: 7 };
    },
    get: async (sql: string) => { calls.push(`get:${sql}`); return { error: null, row: { a: 1 } }; },
    all: async (sql: string) => { calls.push(`all:${sql}`); return { error: null, rows: [{ a: 1 }] }; },
    runTransaction: async (ops: { type: string; sql: string }[]) => {
      calls.push(`tx:${ops.length}`);
      return db.failNext ? { error: { code: 'X', message: 'boom' } } : { error: null, results: [] };
    },
  };
  return db;
}

describe('tableFromSql', () => {
  it('parses the target table from mutation statements', () => {
    expect(tableFromSql('INSERT INTO dashboard_widgets (a) VALUES (?)')).toBe('dashboard_widgets');
    expect(tableFromSql('insert or ignore into dashboard_pages (id) values (?)')).toBe('dashboard_pages');
    expect(tableFromSql('UPDATE planner_tasks SET x = ? WHERE id = ?')).toBe('planner_tasks');
    expect(tableFromSql('DELETE FROM ws_items WHERE id = ?')).toBe('ws_items');
    expect(tableFromSql('CREATE TABLE IF NOT EXISTS pages (id TEXT)')).toBe('pages');
    expect(tableFromSql('SELECT * FROM pages')).toBeNull();
  });
});

describe('the write stream', () => {
  let service: DatabaseService;
  let electronDb: ReturnType<typeof fakeElectronDb>;
  let writes: { table: string | null; sql: string }[];

  beforeEach(async () => {
    electronDb = fakeElectronDb();
    (window as never as { parallxElectron: unknown }).parallxElectron = { database: electronDb };
    service = new DatabaseService();
    writes = [];
    service.onDidWrite((e) => writes.push(e));
    await service.openForWorkspace('/ws');
  });

  afterEach(() => {
    service.dispose();
    delete (window as never as { parallxElectron?: unknown }).parallxElectron;
  });

  it('service-path writes land on the stream with their table', async () => {
    await service.run('INSERT INTO pages (id) VALUES (?)', ['p1']);
    expect(writes).toEqual([{ table: 'pages', sql: 'INSERT INTO pages (id) VALUES (?)' }]);
  });

  it('tool-bridge writes land on the SAME stream — envelope semantics intact', async () => {
    const bridge = service.asBridge();

    const ok = await bridge.run('UPDATE planner_tasks SET x = 1');
    expect(ok.error).toBeNull();
    expect(ok.changes).toBe(1);
    expect(writes.map((w) => w.table)).toEqual(['planner_tasks']);

    // Failures return the envelope (never throw) and do NOT emit.
    electronDb.failNext = true;
    const bad = await bridge.run('UPDATE planner_tasks SET x = 2');
    expect(bad.error?.message).toBe('boom');
    expect(writes).toHaveLength(1);
  });

  it('reads never emit', async () => {
    const bridge = service.asBridge();
    await service.get('SELECT * FROM pages');
    await bridge.all('SELECT * FROM pages');
    await bridge.get('SELECT * FROM pages WHERE id = ?', ['x']);
    expect(writes).toEqual([]);
  });

  it('transactions emit one event per run op, on both paths', async () => {
    await service.runTransaction([
      { type: 'run', sql: 'INSERT INTO a (x) VALUES (1)' },
      { type: 'get', sql: 'SELECT 1' },
      { type: 'run', sql: 'DELETE FROM b' },
    ] as never);
    expect(writes.map((w) => w.table)).toEqual(['a', 'b']);

    await service.asBridge().runTransaction([
      { type: 'run', sql: 'UPDATE c SET x = 1' },
    ] as never);
    expect(writes.map((w) => w.table)).toEqual(['a', 'b', 'c']);
  });

  it('asBridge is a stable singleton', () => {
    expect(service.asBridge()).toBe(service.asBridge());
  });
});
