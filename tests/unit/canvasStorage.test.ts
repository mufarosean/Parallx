// canvasStorage.test.ts — storage items from docs/CANVAS_ASSESSMENT_2026-10-03.md
// ("Storage"), on a real SQLite database with the app's migrations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { realSqlite } from './realSqlite';

let env: ReturnType<typeof realSqlite>;
let service: CanvasDataService;
let failNextContentWrite = false;

beforeEach(() => {
  env = realSqlite();
  const bridge = {
    ...env.bridge,
    run: async (sql: string, params?: unknown[]) => {
      if (failNextContentWrite && /^UPDATE pages SET/.test(sql) && /content = \?/.test(sql)) {
        failNextContentWrite = false;
        return { error: { code: 'SQLITE_BUSY', message: 'database is locked' }, changes: 0 };
      }
      return env.bridge.run(sql, params);
    },
  };
  (globalThis as any).window = { parallxElectron: { database: bridge } };
  service = new CanvasDataService(50);
});
afterEach(() => {
  vi.useRealTimers();
  service.dispose();
  delete (globalThis as any).window;
});

const docJson = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'a' }, content: [{ type: 'text', text }] }] });
const stored = (id: string) => (env.db.prepare('SELECT content FROM pages WHERE id = ?').get(id) as any).content as string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('a retried save keeps the same checks as the first attempt', () => {
  it('a retry does not overwrite content another writer saved meanwhile', async () => {
    const page = await service.createPage(null, 'P');
    await service.updatePage(page.id, { content: docJson('original') });
    await service.getPage(page.id);

    failNextContentWrite = true;
    service.scheduleContentSave(page.id, docJson('typed, then the save failed'));
    await wait(120); // debounce fires and fails; a retry is scheduled (1 s)

    // Another writer (an AI edit) lands before the retry.
    await service.rewritePageContent(page.id, () => JSON.parse(docJson('written by the AI')));

    await wait(1300); // the retry fires
    expect(stored(page.id)).toContain('written by the AI');
  });

  it('a retry with nothing newer in between still saves', async () => {
    const page = await service.createPage(null, 'P');
    await service.updatePage(page.id, { content: docJson('original') });
    await service.getPage(page.id);
    failNextContentWrite = true;
    service.scheduleContentSave(page.id, docJson('typed'));
    await wait(1400);
    expect(stored(page.id)).toContain('typed');
  });
});

describe('restoring a version', () => {
  const card = (pageId: string, title: string) => ({ type: 'pageBlock', attrs: { id: `card-${pageId}`, pageId, title, icon: null } });
  const docOf = (...blocks: unknown[]) => JSON.stringify({ type: 'doc', content: blocks });
  const p = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });

  it('brings back the title with the content', async () => {
    const page = await service.createPage(null, 'Plan v1');
    await service.updatePage(page.id, { content: docOf(p('a', 'first draft')) });
    await service.checkpointPageNow(page.id, 'user');
    const [rev] = await service.listPageRevisions(page.id);
    await service.updatePage(page.id, { title: 'Plan v2', content: docOf(p('a', 'second draft')) });

    await service.restorePageRevision(page.id, rev!.id);
    const after = await service.getPage(page.id);
    expect(after!.title).toBe('Plan v1');
    expect(after!.content).toContain('first draft');
  });

  it('keeps sub-page cards in step with the children the page has now', async () => {
    const parent = await service.createPage(null, 'Parent');
    const old = await service.createPage(parent.id, 'Old child');
    await service.updatePage(parent.id, { content: docOf(p('a', 'intro'), card(old.id, 'Old child')) });
    await service.checkpointPageNow(parent.id, 'user');
    const [rev] = await service.listPageRevisions(parent.id);

    // Since then: the old child moved away, a new child was added.
    await service.movePage(old.id, null);
    const fresh = await service.createPage(parent.id, 'New child');
    await service.updatePage(parent.id, { content: docOf(p('a', 'intro, edited'), card(fresh.id, 'New child')) });

    await service.restorePageRevision(parent.id, rev!.id);
    const content = (await service.getPage(parent.id))!.content;
    expect(content).toContain('"text":"intro"');
    expect(content).not.toContain(old.id);   // no card pulling the moved page back
    expect(content).toContain(fresh.id);     // the new child keeps its card
    expect((await service.getPage(old.id))!.parentId).toBeNull();
  });
});

describe('restoring a page from the Trash puts its card back where it was', () => {
  const card = (pageId: string) => ({ type: 'pageBlock', attrs: { id: `card-${pageId}`, pageId, title: 'Child', icon: null } });
  const p = (id: string, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
  const ids = (content: string) => (JSON.parse(content).doc.content as any[]).map((b) => b.type === 'pageBlock' ? `card:${b.attrs.pageId}` : b.attrs.id);

  it('between the same blocks, not at the end', async () => {
    const parent = await service.createPage(null, 'Parent');
    const child = await service.createPage(parent.id, 'Child');
    await service.updatePage(parent.id, { content: JSON.stringify({ type: 'doc', content: [p('a', 'one'), card(child.id), p('b', 'two'), p('c', 'three')] }) });

    await service.archivePage(child.id);
    expect(ids((await service.getPage(parent.id))!.content)).toEqual(['a', 'b', 'c']);
    await service.restorePage(child.id);
    expect(ids((await service.getPage(parent.id))!.content)).toEqual(['a', `card:${child.id}`, 'b', 'c']);
  });

  it('first on the page stays first; when its neighbour is gone it goes at the end', async () => {
    const parent = await service.createPage(null, 'Parent');
    const first = await service.createPage(parent.id, 'First');
    const later = await service.createPage(parent.id, 'Later');
    await service.updatePage(parent.id, { content: JSON.stringify({ type: 'doc', content: [card(first.id), p('a', 'one'), card(later.id), p('b', 'two')] }) });
    await service.archivePage(first.id);
    await service.archivePage(later.id);
    // While they are in the Trash, the block before "Later" is deleted.
    await service.updatePage(parent.id, { content: JSON.stringify({ type: 'doc', content: [p('b', 'two')] }) });

    await service.restorePage(first.id);
    await service.restorePage(later.id);
    expect(ids((await service.getPage(parent.id))!.content)).toEqual([`card:${first.id}`, 'b', `card:${later.id}`]);
  });
});

describe('page order survives many moves into one gap', () => {
  it('a hundred moves between the same two pages keep a strict order', async () => {
    const parent = await service.createPage(null, 'Parent');
    const a = await service.createPage(parent.id, 'A');
    const b = await service.createPage(parent.id, 'B');
    const moved: string[] = [];
    // Each new page goes right after A, so every move halves the A–next gap.
    for (let i = 0; i < 100; i++) {
      const pg = await service.createPage(null, `P${i}`);
      await service.movePage(pg.id, parent.id, a.id);
      moved.unshift(`P${i}`);
    }
    const order = (await service.getChildren(parent.id)).map((p) => p.title);
    expect(order).toEqual(['A', ...moved, 'B']);
    const sorts = (await service.getChildren(parent.id)).map((p) => p.sortOrder);
    expect(new Set(sorts).size).toBe(sorts.length);
  });
});
