// canvasDatabaseTable.test.ts — the table view done right (docs/DATABASES.md
// step 1): column widths, wrap, freeze, order, the calculations row and how a
// row opens, on a real SQLite database with the app's migrations.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { TITLE_KEY } from '../../src/built-in/canvas/database/databaseTypes';
import { calculate, calcOptionsFor } from '../../src/built-in/canvas/database/calculations';
import { readViewConfig, visibleProperties, moveInOrder, placeInOrder, frozenKeys, patchRecord } from '../../src/built-in/canvas/database/viewConfig';
import { realSqlite } from './realSqlite';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}

describe('calculations (pure)', () => {
  it('counts, sums and dates by what a column holds', () => {
    expect(calculate('count', ['a', '', null], 'text')).toBe('3');
    expect(calculate('count_empty', ['a', '', null], 'text')).toBe('2');
    expect(calculate('percent_not_empty', ['a', '', null, 'b'], 'text')).toBe('50%');
    expect(calculate('count_unique', [['x', 'y'], ['y'], null], 'tags')).toBe('2');
    expect(calculate('sum', [1, 2.5, null, '3'], 'number')).toBe('6.5');
    expect(calculate('average', [2, 4], 'number')).toBe('3');
    expect(calculate('median', [1, 10, 3], 'number')).toBe('3');
    expect(calculate('range', [1, 10, 3], 'number')).toBe('9');
    expect(calculate('earliest', ['2026-03-02', '2025-12-31', null], 'date')).toBe('2025-12-31');
    expect(calculate('date_range', ['2026-03-02', '2026-03-01'], 'date')).toBe('1 day');
    expect(calculate('percent_checked', [true, false, 'true', null], 'checkbox')).toBe('50%');
    expect(calculate('none', [1], 'number')).toBe('');
  });
  it('offers number calculations only to number-like columns, date ones to dates, checked ones to checkboxes', () => {
    const kinds = (t: Parameters<typeof calcOptionsFor>[0]) => calcOptionsFor(t).map((o) => o.kind);
    expect(kinds('number')).toContain('sum');
    expect(kinds('text')).not.toContain('sum');
    expect(kinds('date')).toContain('earliest');
    expect(kinds('checkbox')).toContain('percent_checked');
    expect(kinds('checkbox')).not.toContain('count_empty');
  });
});

describe('view config (pure)', () => {
  const props = [
    { id: 'a', databaseId: 'd', name: 'A', type: 'text' as const, config: {}, sortOrder: 1 },
    { id: 'b', databaseId: 'd', name: 'B', type: 'text' as const, config: {}, sortOrder: 2 },
    { id: 'c', databaseId: 'd', name: 'C', type: 'text' as const, config: {}, sortOrder: 3 },
  ];
  it('reads defaults from an empty or odd config', () => {
    const cfg = readViewConfig({ widths: { a: 'wide' }, openIn: 'nowhere', freeze: 7 });
    expect(cfg.widths).toEqual({});
    expect(cfg.openIn).toBe('side');
    expect(cfg.freeze).toBeNull();
  });
  it('orders by the view, then by sort order, and leaves hidden columns out', () => {
    expect(visibleProperties(props, { config: { order: ['c'], hidden: ['b'] } }).map((p) => p.id)).toEqual(['c', 'a']);
  });
  it('moves and places columns', () => {
    expect(moveInOrder(props, { config: {} }, 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(props, { config: {} }, 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(placeInOrder(props, { config: {} }, 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(placeInOrder(props, { config: {} }, 'a', null)).toEqual(['b', 'c', 'a']);
  });
  it('freezes up to and including a column, Name first', () => {
    expect(frozenKeys(props, 'b')).toEqual([TITLE_KEY, 'a', 'b']);
    expect(frozenKeys(props, TITLE_KEY)).toEqual([TITLE_KEY]);
    expect(frozenKeys(props, 'zzz')).toEqual([]);
  });
  it('patches one key of a record setting and can clear it', () => {
    const c1 = patchRecord({}, 'wrap', 'a', true);
    expect(c1).toEqual({ wrap: { a: true } });
    expect(patchRecord(c1, 'wrap', 'a', null)).toEqual({ wrap: {} });
  });
});

describe('the table on a real database', () => {
  let env: ReturnType<typeof realSqlite>;
  let pages: CanvasDataService;
  let dbs: DatabaseDataService;
  let host: HTMLElement;
  let pane: DatabaseEditorPane | null = null;
  const opened: { id: string; side: boolean }[] = [];

  beforeEach(() => {
    env = realSqlite();
    (window as any).parallxElectron = { database: env.bridge };
    pages = new CanvasDataService();
    dbs = new DatabaseDataService(pages);
    host = document.createElement('div');
    document.body.appendChild(host);
    opened.length = 0;
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
      db: dbs,
      openPage: (id) => opened.push({ id, side: false }),
      openPageBeside: (id) => opened.push({ id, side: true }),
      renamePage: (id, t) => pages.updatePage(id, { title: t }).then(() => {}),
    });
  };
  const headers = () => [...host.querySelectorAll('.canvas-db-th__name')].map((e) => e.textContent);

  async function seed() {
    const d = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
    const rating = await dbs.addProperty(d.id, 'Rating', 'number');
    const read = await dbs.addProperty(d.id, 'Read', 'checkbox');
    const a = await dbs.addRow(d.id, 'Meditations', { [rating.id]: 5, [read.id]: true });
    await dbs.addRow(d.id, 'Sisyphus', { [rating.id]: 3, [read.id]: false });
    return { d, rating, read, a };
  }

  it('renders the columns in the view order, with the widths the view saved, and a count under Name', async () => {
    const { d, rating, read } = await seed();
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { config: { order: [read.id, rating.id], widths: { [TITLE_KEY]: 333, [rating.id]: 99 } } });
    mount(d.id);
    await until(() => headers().length === 3);
    expect(headers()).toEqual(['Name', 'Read', 'Rating']);
    const cols = [...host.querySelectorAll('col')].map((c) => (c as HTMLElement).style.width);
    expect(cols.slice(0, 3)).toEqual(['333px', '160px', '99px']);
    const calc = host.querySelector('.canvas-db-calc .canvas-db-calc__value');
    expect(calc?.textContent).toBe('2');
  });

  it('a dragged grip saves the column width; the view keeps it', async () => {
    const { d, rating } = await seed();
    mount(d.id);
    await until(() => headers().length === 3);
    const th = [...host.querySelectorAll<HTMLElement>('.canvas-db-th')].find((t) => t.textContent?.includes('Rating'))!;
    const grip = th.querySelector<HTMLElement>('.canvas-db-resize')!;
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, button: 0 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 160 }));
    await until(() => (host.querySelectorAll('col')[1] as HTMLElement | undefined)?.style.width === '80px' || false, 3000);
    const [view] = await dbs.listViews(d.id);
    // jsdom's header measures 0 wide, so the drag's 60px lands on the 80px floor; what matters is that it was saved.
    expect(readViewConfig(view!.config).widths[rating.id]).toBe(80);
  });

  it('wrap and freeze show on the cells and are kept per view', async () => {
    const { d, rating } = await seed();
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { config: { wrap: { [rating.id]: true }, freeze: TITLE_KEY } });
    mount(d.id);
    await until(() => headers().length === 3);
    const firstRow = host.querySelector('.canvas-db-row')!;
    const cells = [...firstRow.querySelectorAll<HTMLElement>('.canvas-db-cell')];
    expect(cells[0]!.classList.contains('canvas-db-col--frozen')).toBe(true);
    expect(cells[0]!.classList.contains('canvas-db-col--frozen-last')).toBe(true);
    expect(cells[1]!.classList.contains('canvas-db-col--frozen')).toBe(false);
    expect(cells[1]!.classList.contains('canvas-db-cell--wrap')).toBe(true);
  });

  it('a chosen calculation shows its result under the column', async () => {
    const { d, rating } = await seed();
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { config: { calc: { [rating.id]: 'sum' } } });
    mount(d.id);
    await until(() => headers().length === 3);
    const values = [...host.querySelectorAll('.canvas-db-calc__value')].map((e) => e.textContent);
    expect(values).toEqual(['2', '8']);
  });

  it('Open goes beside the table by default, and as a page when the view says so', async () => {
    const { d, a } = await seed();
    mount(d.id);
    await until(() => headers().length === 3);
    (host.querySelector('.canvas-db-openbtn') as HTMLElement).click();
    expect(opened).toEqual([{ id: a.pageId, side: true }]);
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { config: { openIn: 'full' } });
    await until(() => (pane!.activeView?.config as any)?.openIn === 'full');
    await new Promise((r) => setTimeout(r, 50));
    (host.querySelector('.canvas-db-openbtn') as HTMLElement).click();
    expect(opened[1]).toEqual({ id: a.pageId, side: false });
  });

  it('arrow keys move between cells; a checkbox cell toggles on Space', async () => {
    const { d, read } = await seed();
    mount(d.id);
    await until(() => headers().length === 3);
    const first = host.querySelector<HTMLElement>('td[role="gridcell"]')!;
    expect(first.tabIndex).toBe(0);
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(first);
    expect(second.getAttribute('role')).toBe('gridcell');
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const third = document.activeElement as HTMLElement;
    expect(third.querySelector('.canvas-db-checkbtn')).not.toBeNull();
    third.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await until(() => false, 150).catch(() => {});
    const rows = await dbs.listRows(d.id);
    expect(rows[0]!.values[read.id]).toBe(false);
  });

  it('the AI tool that names its columns gets exactly those; a bare database starts with Status', async () => {
    const named = await dbs.createDatabase({ title: 'Named', seedDefaults: false });
    expect((await dbs.listProperties(named.id)).map((p) => p.name)).toEqual([]);
    const bare = await dbs.createDatabase({ title: 'Bare' });
    expect((await dbs.listProperties(bare.id)).map((p) => p.name)).toEqual(['Status']);
  });
});
