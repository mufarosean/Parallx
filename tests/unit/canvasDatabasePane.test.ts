// canvasDatabasePane.test.ts — the database table while it is being used
// (Medium list in docs/CANVAS_ASSESSMENT_2026-10-03.md), on a real SQLite
// database with the app's migrations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { realSqlite } from './realSqlite';
import { JSDOM } from 'jsdom';

// node:sqlite cannot load in vitest's jsdom environment, so the DOM is made here.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
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
const titles = () => [...host.querySelectorAll('.canvas-db-cell__titletext')].map((e) => e.textContent);
const mount = (databaseId: string) => {
  pane = new DatabaseEditorPane(host, databaseId, { db: dbs, openPage: () => {}, renamePage: (id, t) => pages.updatePage(id, { title: t }).then(() => {}) });
};

describe('the table while it is used', () => {
  it('a row added in a filtered view shows in that view', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const status = await dbs.addProperty(d.id, 'Status', 'select', { options: [{ value: 'Doing', color: 'blue' }] });
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { filter: { conjunction: 'and', rules: [{ propertyId: status.id, op: 'equals', value: 'Doing' }] } });
    mount(d.id);
    await until(() => !!host.querySelector('.canvas-db-newbtn'));
    (host.querySelector('.canvas-db-newbtn') as HTMLElement).click();
    await until(() => titles().length === 1);
    const [row] = await dbs.listRows(d.id);
    expect(row!.values[status.id]).toBe('Doing');
  });

  it('a change elsewhere does not throw away a name being typed', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const note = await dbs.addProperty(d.id, 'Note', 'text');
    const a = await dbs.addRow(d.id, 'First');
    const b = await dbs.addRow(d.id, 'Second');
    mount(d.id);
    await until(() => titles().length === 2);

    (host.querySelector('.canvas-db-cell__titletext') as HTMLElement).click();
    const input = host.querySelector('.canvas-db-titleinput') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    input.value = 'First, renamed';

    // Another writer changes a different row meanwhile.
    await dbs.setCellValue(d.id, b.pageId, note.id, 'from elsewhere');
    await new Promise((r) => setTimeout(r, 100));
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('First, renamed');

    input.blur();
    await until(() => titles().includes('First, renamed'));
    expect((await dbs.listRows(d.id)).find((r) => r.pageId === a.pageId)!.title).toBe('First, renamed');
    // The change made meanwhile is shown once the field is left.
    await until(() => host.textContent!.includes('from elsewhere'));
  });

  it('a write that changes nothing shown does not rebuild the table', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    await dbs.addRow(d.id, 'Only');
    mount(d.id);
    await until(() => titles().length === 1);
    const table = host.querySelector('.canvas-db-table');
    (dbs as any)._onDidChangeRows.fire(d.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(host.querySelector('.canvas-db-table')).toBe(table);
  });
});
