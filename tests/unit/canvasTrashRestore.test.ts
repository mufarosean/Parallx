// canvasTrashRestore.test.ts — C3 from docs/CANVAS_ASSESSMENT_2026-10-03.md,
// on a real SQLite database (the app's migrations, foreign keys on), so the
// delete cascade under test is the real one.  Written to fail first.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';

// ── Real SQLite (the app's migrations, foreign keys on) ──────────────────────

function sqliteBridge() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(__dirname, '../../src/services/db-migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try { db.exec(readFileSync(join(dir, file), 'utf8')); } catch { /* vector tables need an extension */ }
  }
  const bridge = {
    get: async (sql: string, params: unknown[] = []) => { try { return { error: null, row: db.prepare(sql).get(...(params as any[])) ?? null }; } catch (e: any) { return { error: { message: e.message }, row: null }; } },
    all: async (sql: string, params: unknown[] = []) => { try { return { error: null, rows: db.prepare(sql).all(...(params as any[])) }; } catch (e: any) { return { error: { message: e.message }, rows: [] }; } },
    run: async (sql: string, params: unknown[] = []) => { try { const r = db.prepare(sql).run(...(params as any[])); return { error: null, changes: Number(r.changes) }; } catch (e: any) { return { error: { message: e.message }, changes: 0 }; } },
    runTransaction: async (ops: Array<{ type: string; sql: string; params?: unknown[] }>) => {
      try {
        db.exec('BEGIN');
        const results = ops.map((o) => (o.type === 'all' ? db.prepare(o.sql).all(...((o.params ?? []) as any[])) : o.type === 'get' ? db.prepare(o.sql).get(...((o.params ?? []) as any[])) : db.prepare(o.sql).run(...((o.params ?? []) as any[]))));
        db.exec('COMMIT');
        return { error: null, results };
      } catch (e: any) { try { db.exec('ROLLBACK'); } catch { /* */ } return { error: { message: e.message }, results: [] }; }
    },
  };
  return { db, bridge };
}

// ── C3: Trash and restore ────────────────────────────────────────────────────

describe('C3: Empty Trash never deletes a page that is not in the Trash', () => {
  let service: CanvasDataService;
  let db: DatabaseSync;
  beforeEach(() => {
    const env = sqliteBridge();
    db = env.db;
    (globalThis as any).window = { parallxElectron: { database: env.bridge } };
    service = new CanvasDataService();
  });
  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });
  const row = (id: string) => db.prepare('SELECT id, parent_id, is_archived FROM pages WHERE id = ?').get(id) as any;

  it('a child restored out of a trashed parent survives Empty Trash, at the top level', async () => {
    const parent = await service.createPage(null, 'Parent');
    const child = await service.createPage(parent.id, 'Child');
    await service.archivePage(parent.id);
    await service.restorePage(child.id);
    expect(row(child.id)).toMatchObject({ is_archived: 0, parent_id: null });
    await service.permanentlyDeletePage(parent.id);
    expect(row(parent.id)).toBeUndefined();
    expect(row(child.id)).toMatchObject({ is_archived: 0 });
  });

  it('a permanent delete of a page that is not in the Trash is refused', async () => {
    const page = await service.createPage(null, 'Live');
    await expect(service.permanentlyDeletePage(page.id)).rejects.toThrow(/not in the Trash/);
    expect(row(page.id)).toBeDefined();
  });

  it('a live page nested under a trashed one is lifted out before the delete', async () => {
    const parent = await service.createPage(null, 'Parent');
    const child = await service.createPage(parent.id, 'Child');
    await service.archivePage(parent.id);
    db.prepare('UPDATE pages SET is_archived = 0 WHERE id = ?').run(child.id); // live under a trashed parent
    await service.permanentlyDeletePage(parent.id);
    expect(row(child.id)).toMatchObject({ is_archived: 0, parent_id: null });
  });

  it('Empty Trash reads the Trash when it runs, not a list from earlier', async () => {
    const a = await service.createPage(null, 'A');
    const b = await service.createPage(null, 'B');
    await service.archivePage(a.id);
    await service.archivePage(b.id);
    await service.restorePage(b.id);
    await service.emptyTrash();
    expect(row(a.id)).toBeUndefined();
    expect(row(b.id)).toMatchObject({ is_archived: 0 });
  });
});
