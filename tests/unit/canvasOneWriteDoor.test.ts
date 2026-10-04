// canvasOneWriteDoor.test.ts — every page write from outside the editor goes
// through the data service (docs/CANVAS_ASSESSMENT_2026-10-03.md, architecture
// 2), on a real SQLite database with the app's migrations.  The AI tools are
// wired the way canvas/main.ts wires them (dataServicePageWriter).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { dataServicePageWriter } from '../../src/built-in/canvas/ai/pageWriter';
import { createEditPageTool, createSetPageStyleTool } from '../../src/built-in/canvas/ai/pageTools';
import { createEditBlockTool } from '../../src/built-in/canvas/ai/blockTools';

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
  // The tools' own database handle (IBuiltInToolDatabase).
  const toolDb = {
    isOpen: true,
    get: async (sql: string, params: unknown[] = []) => db.prepare(sql).get(...(params as any[])) ?? undefined,
    all: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as any[])),
    run: async (sql: string, params: unknown[] = []) => { db.prepare(sql).run(...(params as any[])); },
  };
  return { db, bridge, toolDb };
}

const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const docJson = (...blocks: unknown[]) => JSON.stringify({ type: 'doc', content: blocks });
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* none */ } }) } as never;

describe('One write door: AI and card writes go through the data service', () => {
  let service: CanvasDataService;
  let db: DatabaseSync;
  let toolDb: any;
  beforeEach(() => {
    const env = sqliteBridge();
    db = env.db;
    toolDb = env.toolDb;
    (globalThis as any).window = { parallxElectron: { database: env.bridge } };
    service = new CanvasDataService(60_000); // a debounce that never fires on its own
  });
  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });
  const stored = (id: string) => (db.prepare('SELECT content FROM pages WHERE id = ?').get(id) as any).content as string;

  async function pageWith(...blocks: unknown[]) {
    const page = await service.createPage(null, 'Notes');
    await service.updatePage(page.id, { content: docJson(...blocks) });
    await service.getPage(page.id); // the editor opened it
    return page.id;
  }

  it('an AI edit keeps what the user typed a moment before (it was still waiting to save)', async () => {
    const id = await pageWith(para('a', 'first'));
    service.scheduleContentSave(id, docJson(para('a', 'first, and what I just typed')));

    const tool = createEditPageTool(toolDb, undefined, undefined, dataServicePageWriter(service as any));
    const res = await tool.handler({ pageId: id, markdown: 'added by AI', mode: 'append' }, token);

    expect(res.isError).toBeFalsy();
    expect(stored(id)).toContain('what I just typed');
    expect(stored(id)).toContain('added by AI');
  });

  it('an AI edit that starts while a save is being written does not overwrite it', async () => {
    const id = await pageWith(para('a', 'first'));
    const saving = service.updatePage(id, { content: docJson(para('a', 'saved by the editor')) });

    const tool = createEditPageTool(toolDb, undefined, undefined, dataServicePageWriter(service as any));
    const res = await tool.handler({ pageId: id, markdown: 'added by AI', mode: 'append' }, token);
    await saving;

    expect(res.isError).toBeFalsy();
    expect(stored(id)).toContain('saved by the editor');
    expect(stored(id)).toContain('added by AI');
  });

  it('a page whose content cannot be read is not written over by an AI edit', async () => {
    const id = await pageWith(para('a', 'first'));
    db.prepare('UPDATE pages SET content = ? WHERE id = ?').run('{not json', id);

    const writer = dataServicePageWriter(service as any);
    const edit = await createEditPageTool(toolDb, undefined, undefined, writer)
      .handler({ pageId: id, markdown: 'new', mode: 'replace' }, token);
    const block = await createEditBlockTool(toolDb, undefined, writer)
      .handler({ pageId: id, blockId: 'a', newContent: 'x' }, token);

    expect(edit.isError).toBe(true);
    expect(edit.content).toMatch(/cannot be read/);
    expect(block.isError).toBe(true);
    expect(stored(id)).toBe('{not json');
  });

  it('a block edit lands on the page as it is now, keeping typing that was waiting to save', async () => {
    const id = await pageWith(para('a', 'one'), para('b', 'two'));
    service.scheduleContentSave(id, docJson(para('a', 'one plus typing'), para('b', 'two')));

    const res = await createEditBlockTool(toolDb, undefined, dataServicePageWriter(service as any))
      .handler({ pageId: id, blockId: 'b', newContent: 'TWO' }, token);

    expect(res.isError).toBeFalsy();
    expect(stored(id)).toContain('one plus typing');
    expect(stored(id)).toContain('TWO');
  });

  it('an AI style change leaves the pending typing to save', async () => {
    const id = await pageWith(para('a', 'first'));
    service.scheduleContentSave(id, docJson(para('a', 'typed')));

    const res = await createSetPageStyleTool(toolDb, undefined, undefined, dataServicePageWriter(service as any))
      .handler({ pageId: id, style: { icon: '🌱', fullWidth: true } }, token);
    await service.flushPendingSaves();

    expect(res.isError).toBeFalsy();
    const row = db.prepare('SELECT icon, full_width, content FROM pages WHERE id = ?').get(id) as any;
    expect(row).toMatchObject({ icon: '🌱', full_width: 1 });
    expect(row.content).toContain('typed');
  });

  it('renaming a child retitles its card without losing typing waiting to save on the parent', async () => {
    const parent = await service.createPage(null, 'Parent');
    const child = await service.createPage(parent.id, 'Child');
    const card = { type: 'pageBlock', attrs: { id: 'card', pageId: child.id, title: 'Child', icon: null } };
    await service.updatePage(parent.id, { content: docJson(para('p', 'intro'), card) });
    await service.getPage(parent.id);
    // The parent is open and the user just typed in it.
    service.scheduleContentSave(parent.id, docJson(para('p', 'intro, edited'), card));

    await service.updatePage(child.id, { title: 'Renamed' });
    // The card retitle runs after the title write; let it finish.
    await new Promise((r) => setTimeout(r, 20));
    await service.flushPendingSaves();

    const content = stored(parent.id);
    expect(content).toContain('intro, edited');
    expect(content).toContain('"title":"Renamed"');
  });
});
