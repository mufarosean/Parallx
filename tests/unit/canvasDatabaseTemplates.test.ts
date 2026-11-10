// canvasDatabaseTemplates.test.ts — new-row templates (docs/DATABASES.md
// step 7): pages under the database that a new row starts from.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { createRowFromTemplate, createTemplate, defaultTemplateId, listTemplates, removeTemplate, setDefaultTemplate, type ITemplatePages } from '../../src/built-in/canvas/database/templates';
import { realSqlite } from './realSqlite';
import { installDatabaseCommandStub } from './databaseCommandStub';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}
installDatabaseCommandStub();

let env: ReturnType<typeof realSqlite>;
let pagesSvc: CanvasDataService;
let dbs: DatabaseDataService;
let pages: ITemplatePages;
beforeEach(() => {
  env = realSqlite();
  (window as any).parallxElectron = { database: env.bridge };
  pagesSvc = new CanvasDataService();
  dbs = new DatabaseDataService(pagesSvc);
  pages = {
    getPage: (id) => pagesSvc.getPage(id),
    updatePage: (id, patch) => pagesSvc.updatePage(id, patch).then(() => {}),
    createPage: async (parent, title) => (await pagesSvc.createPage(parent, title)).id,
  };
});
afterEach(() => { dbs.dispose(); pagesSvc.dispose(); delete (window as any).parallxElectron; });

describe('templates', () => {
  it('a template is a page under the database, not a row; its home is the database', async () => {
    const d = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
    const t = await createTemplate(dbs, pages, d.id, 'Reading note');
    expect((await pagesSvc.getPage(t))?.parentId).toBe(d.id);
    expect(await dbs.listRows(d.id)).toHaveLength(0);
    expect(await dbs.getHomeDatabaseForPage(t)).toBe(d.id);
    expect(await listTemplates(dbs, pages, d.id)).toEqual([{ id: t, title: 'Reading note', icon: null, isDefault: false }]);
  });

  it('a row from a template copies its values, title, icon, cover and content; the seed wins', async () => {
    const d = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
    const status = await dbs.addProperty(d.id, 'Status', 'select', { options: [{ value: 'To read', color: 'gray' }] });
    const rating = await dbs.addProperty(d.id, 'Rating', 'number');
    const t = await createTemplate(dbs, pages, d.id, 'Reading note');
    await dbs.setCellValue(d.id, t, status.id, 'To read');
    await dbs.setCellValue(d.id, t, rating.id, 3);
    const content = JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Why I picked it:' }] }] } });
    await pagesSvc.updatePage(t, { icon: 'book', coverUrl: 'linear-gradient(90deg, #000, #fff)', content });
    const id = await createRowFromTemplate(dbs, pages, d.id, t, { [rating.id]: 5 });
    const rows = await dbs.listRows(d.id);
    expect(rows.map((r) => r.pageId)).toEqual([id]);
    expect(rows[0]!.values[status.id]).toBe('To read');
    expect(rows[0]!.values[rating.id]).toBe(5);
    const page = await pagesSvc.getPage(id);
    expect(page?.title).toBe('Reading note');
    expect(page?.icon).toBe('book');
    expect(page?.coverUrl).toBe('linear-gradient(90deg, #000, #fff)');
    expect(page?.content).toContain('Why I picked it');
    // The template itself stays out of the rows.
    expect(rows.some((r) => r.pageId === t)).toBe(false);
  });

  it('a default template is what New makes; removing it clears the default', async () => {
    const d = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
    const t = await createTemplate(dbs, pages, d.id, 'Note');
    expect(await defaultTemplateId(dbs, pages, d.id)).toBeNull();
    await setDefaultTemplate(dbs, d.id, t);
    expect(await defaultTemplateId(dbs, pages, d.id)).toBe(t);
    const host = document.createElement('div'); document.body.appendChild(host);
    const pane = new DatabaseEditorPane(host, d.id, { db: dbs, openPage: () => {}, renamePage: async () => {}, getPage: pages.getPage, updatePage: pages.updatePage, createPage: pages.createPage });
    const until = async (check: () => boolean) => { const end = Date.now() + 2500; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => !!host.querySelector('[data-px-id="database.newRow"]'));
    expect(host.querySelector('[data-px-id="database.templates"]')).not.toBeNull();
    (host.querySelector('[data-px-id="database.newRow"]') as HTMLElement).click();
    await until(() => host.querySelectorAll('.canvas-db-row').length === 1);
    expect((await dbs.listRows(d.id))[0]!.title).toBe('Note');
    pane.dispose(); host.remove();
    await removeTemplate(dbs, d.id, t);
    expect(await listTemplates(dbs, pages, d.id)).toEqual([]);
    expect(await defaultTemplateId(dbs, pages, d.id)).toBeNull();
  });
});
