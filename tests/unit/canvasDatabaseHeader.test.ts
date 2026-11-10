// canvasDatabaseHeader.test.ts — a database's identity (docs/DATABASES.md
// step 2): icon, cover, description and lock, on a real SQLite database.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { getDatabaseConfig, readDatabaseConfig, updateDatabaseMeta } from '../../src/built-in/canvas/database/databaseMeta';
import { realSqlite } from './realSqlite';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
let dbs: DatabaseDataService;
let host: HTMLElement;
let pane: DatabaseEditorPane | null = null;

beforeEach(() => {
  env = realSqlite();
  (window as any).parallxElectron = { database: env.bridge };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  pane?.dispose(); pane = null;
  host.remove();
  dbs.dispose();
  pages.dispose();
  delete (window as any).parallxElectron;
});
const until = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const mount = (databaseId: string) => {
  pane = new DatabaseEditorPane(host, databaseId, {
    db: dbs, openPage: () => {},
    renamePage: (id, t) => pages.updatePage(id, { title: t }).then(() => {}),
    getPage: (id) => pages.getPage(id),
    updatePage: (id, patch) => pages.updatePage(id, patch).then(() => {}),
    onDidChangePage: (l) => pages.onDidChangePage((e) => l(e.pageId)),
  });
};
const q = (sel: string) => host.querySelector<HTMLElement>(sel);

describe('database meta (description, lock, config)', () => {
  it('stores a description and a lock, and open editors hear about it', async () => {
    const d = await dbs.createDatabase({ title: 'Books' });
    let heard = 0;
    dbs.onDidChangeStructure(() => { heard++; });
    await updateDatabaseMeta(dbs, d.id, { description: 'What I read', isLocked: true });
    const info = await dbs.getDatabase(d.id);
    expect(info?.description).toBe('What I read');
    expect(info?.isLocked).toBe(true);
    expect(heard).toBe(1);
    await updateDatabaseMeta(dbs, d.id, { description: '' });
    expect((await dbs.getDatabase(d.id))?.description).toBeNull();
  });
  it('keeps settings as JSON and reads odd ones as defaults', async () => {
    const d = await dbs.createDatabase({ title: 'Books' });
    expect(await getDatabaseConfig(dbs, d.id)).toEqual({ templates: [], defaultTemplate: null });
    await updateDatabaseMeta(dbs, d.id, { config: { templates: ['t1'] } });
    await updateDatabaseMeta(dbs, d.id, { config: { defaultTemplate: 't1' } });
    expect(await getDatabaseConfig(dbs, d.id)).toEqual({ templates: ['t1'], defaultTemplate: 't1' });
    expect(readDatabaseConfig('not json')).toEqual({ templates: [], defaultTemplate: null });
  });
});

describe('the header', () => {
  it('shows an icon button, a description field and the database menu; the icon writes to the page', async () => {
    const d = await dbs.createDatabase({ title: 'Books' });
    mount(d.id);
    await until(() => !!q('[data-px-id="database.icon"]'));
    expect(q('[data-px-id="database.menu"]')).not.toBeNull();
    // The description field appears when asked for, not before.
    expect(q('.canvas-db-description')).toBeNull();
    q('[data-px-id="database.addDescription"]')!.click();
    await until(() => !!q('.canvas-db-description--empty'));
    expect(q('[data-px-id="database.addIcon"]')).not.toBeNull();
    expect(q('[data-px-id="database.addCover"]')).not.toBeNull();
    // The icon is set the way the picker sets it.
    await pages.updatePage(d.id, { icon: 'book' });
    await until(() => !q('[data-px-id="database.addIcon"]'));
    expect(q('[data-px-id="database.icon"]')?.title).toBe('Change Icon…');
  });

  it('a description typed in is saved on blur', async () => {
    const d = await dbs.createDatabase({ title: 'Books' });
    mount(d.id);
    await until(() => !!q('[data-px-id="database.addDescription"]'));
    q('[data-px-id="database.addDescription"]')!.click();
    await until(() => !!q('.canvas-db-description'));
    const desc = q('.canvas-db-description')!;
    desc.textContent = 'Everything read since 2020';
    desc.dispatchEvent(new FocusEvent('blur'));
    await until(() => false, 100).catch(() => {});
    expect((await dbs.getDatabase(d.id))?.description).toBe('Everything read since 2020');
  });

  it('a cover on the page shows above the header, with Change, Reposition and Remove', async () => {
    const d = await dbs.createDatabase({ title: 'Books' });
    await pages.updatePage(d.id, { coverUrl: 'https://example.test/cover.jpg', coverYOffset: 0.25 });
    mount(d.id);
    await until(() => !!q('.canvas-db-cover'));
    const cover = q('.canvas-db-cover')!;
    expect(cover.style.backgroundPosition).toMatch(/center 25(\.0)?%/);
    expect(q('[data-px-id="database.cover.change"]')).not.toBeNull();
    expect(q('[data-px-id="database.cover.reposition"]')).not.toBeNull();
    q('[data-px-id="database.cover.remove"]')!.click();
    await until(() => !q('.canvas-db-cover'));
    expect((await pages.getPage(d.id))?.coverUrl).toBeNull();
  });

  it('locked: no title editing, no new column, no new view; the column menu keeps only view settings', async () => {
    const d = await dbs.createDatabase({ title: 'Books' });
    await updateDatabaseMeta(dbs, d.id, { isLocked: true });
    mount(d.id);
    await until(() => !!q('.canvas-db-header__title'));
    expect(q('.canvas-db-header__title')?.getAttribute('contenteditable')).not.toBe('true');
    expect(q('[data-px-id="database.addProperty"]')).toBeNull();
    expect(q('[data-px-id="database.addView"]')).toBeNull();
    expect(q('[data-px-id="database.icon"]')).toBeNull();
    // Rows still change: a new row can be added.
    expect(q('[data-px-id="database.newRow"]')).not.toBeNull();
  });
});
