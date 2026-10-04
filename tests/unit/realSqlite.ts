// realSqlite.ts — an in-memory SQLite database with the app's migrations
// (foreign keys on), behind the same bridge shape the data services use, so
// tests exercise the real SQL.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function realSqlite() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(__dirname, '../../src/services/db-migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try { db.exec(readFileSync(join(dir, file), 'utf8')); } catch { /* vector tables need an extension */ }
  }
  const p = (params: unknown[] | undefined) => (params ?? []) as any[];
  const bridge = {
    get: async (sql: string, params?: unknown[]) => { try { return { error: null, row: db.prepare(sql).get(...p(params)) ?? null }; } catch (e: any) { return { error: { code: 'ERR', message: e.message }, row: null }; } },
    all: async (sql: string, params?: unknown[]) => { try { return { error: null, rows: db.prepare(sql).all(...p(params)) }; } catch (e: any) { return { error: { code: 'ERR', message: e.message }, rows: [] }; } },
    run: async (sql: string, params?: unknown[]) => { try { const r = db.prepare(sql).run(...p(params)); return { error: null, changes: Number(r.changes) }; } catch (e: any) { return { error: { code: 'ERR', message: e.message }, changes: 0 }; } },
    runTransaction: async (ops: Array<{ type: string; sql: string; params?: unknown[] }>) => {
      try {
        db.exec('BEGIN');
        const results = ops.map((o) => (o.type === 'all' ? db.prepare(o.sql).all(...p(o.params)) : o.type === 'get' ? db.prepare(o.sql).get(...p(o.params)) : db.prepare(o.sql).run(...p(o.params))));
        db.exec('COMMIT');
        return { error: null, results };
      } catch (e: any) { try { db.exec('ROLLBACK'); } catch { /* */ } return { error: { code: 'ERR', message: e.message }, results: [] }; }
    },
  };
  // The AI tools' handle (IBuiltInToolDatabase).
  const toolDb = {
    isOpen: true,
    get: async (sql: string, params?: unknown[]) => db.prepare(sql).get(...p(params)) ?? undefined,
    all: async (sql: string, params?: unknown[]) => db.prepare(sql).all(...p(params)),
    run: async (sql: string, params?: unknown[]) => { db.prepare(sql).run(...p(params)); },
  };
  return { db, bridge, toolDb };
}
