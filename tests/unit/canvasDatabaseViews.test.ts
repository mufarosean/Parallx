// canvasDatabaseViews.test.ts — views, round 2 (docs/DATABASES.md step 4):
// list, gallery, calendar, timeline, chart, and the board's sub-groups.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { addDays, daysBetween, monthGrid, weekdayLabels, weekdayOf, monthTitle, dayOfValue } from '../../src/built-in/canvas/database/calendarDates';
import { chartData } from '../../src/built-in/canvas/database/chartData';
import { readViewConfig } from '../../src/built-in/canvas/database/viewConfig';
import { firstImageSrc } from '../../src/built-in/canvas/database/pagePreview';
import { asViewType } from '../../src/built-in/canvas/database/databaseTypes';
import { defaultConfigFor } from '../../src/built-in/canvas/properties/propertyTypeMeta';
import { realSqlite } from './realSqlite';
import { installDatabaseCommandStub } from './databaseCommandStub';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}
installDatabaseCommandStub();

describe('calendar days (pure)', () => {
  it('adds days across a month and a year, and counts them back', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-01', '2026-03-05')).toBe(4);
    expect(daysBetween('2026-03-05', '2026-03-01')).toBe(-4);
  });
  it('lays a month out in six weeks from the chosen week start', () => {
    const sun = monthGrid('2026-11', 0);
    expect(sun).toHaveLength(6);
    expect(sun.every((w) => w.length === 7)).toBe(true);
    expect(sun[0]![0]!.key).toBe('2026-11-01'); // Nov 1 2026 is a Sunday
    expect(weekdayOf('2026-11-01')).toBe(0);
    const mon = monthGrid('2026-11', 1);
    expect(mon[0]![0]!.key).toBe('2026-10-26');
    expect(mon[0]![0]!.inMonth).toBe(false);
    expect(weekdayLabels(1)).toHaveLength(7);
    expect(monthTitle('2026-11', 'en-US')).toBe('November 2026');
    expect(dayOfValue('2026-11-09T14:30')).toBe('2026-11-09');
    expect(dayOfValue('soon')).toBeNull();
  });
});

describe('chart data (pure)', () => {
  const props = [
    { id: 'g', databaseId: 'd', name: 'Genre', type: 'select' as const, config: { options: [{ value: 'Fiction', color: 'blue' }, { value: 'History', color: 'green' }] }, sortOrder: 1 },
    { id: 'n', databaseId: 'd', name: 'Pages', type: 'number' as const, config: {}, sortOrder: 2 },
    { id: 'c', databaseId: 'd', name: 'Read', type: 'checkbox' as const, config: {}, sortOrder: 3 },
  ];
  const row = (id: string, values: Record<string, unknown>) => ({ pageId: id, title: id, icon: null, sortOrder: 1, values, createdAt: '', updatedAt: '' });
  const rows = [row('a', { g: 'Fiction', n: 100, c: true }), row('b', { g: 'History', n: 300, c: false }), row('c', { g: 'History', n: 200, c: true }), row('d', { n: 50 })];
  it('counts rows per option in the option order, the no-value group last', () => {
    const d = chartData(rows, props, readViewConfig({ chart: { kind: 'bar', groupBy: 'g', measure: 'count', aggregate: 'count' } }));
    expect(d.slices.map((s) => [s.label, s.value])).toEqual([['Fiction', 1], ['History', 2], ['No Genre', 1]]);
    expect(d.total).toBe(4);
    expect(d.measureLabel).toBe('Count');
  });
  it('sums and averages a number per group; a checkbox makes two groups', () => {
    const sum = chartData(rows, props, readViewConfig({ chart: { kind: 'donut', groupBy: 'g', measure: 'n', aggregate: 'sum' } }));
    expect(sum.slices.map((s) => s.value)).toEqual([100, 500, 50]);
    expect(sum.measureLabel).toBe('Sum of Pages');
    const avg = chartData(rows, props, readViewConfig({ chart: { kind: 'line', groupBy: 'c', measure: 'n', aggregate: 'average' } }));
    expect(avg.slices.map((s) => [s.label, s.value])).toEqual([['Checked', 150], ['Unchecked', 175]]);
  });
});

describe('page preview (pure)', () => {
  it('finds the first picture in a page, or none', () => {
    const doc = JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }, { type: 'image', attrs: { src: 'parallx-media://workspace/a.png' } }] } });
    expect(firstImageSrc(doc)).toBe('parallx-media://workspace/a.png');
    expect(firstImageSrc(JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: [{ type: 'paragraph' }] } }))).toBeNull();
    expect(firstImageSrc('')).toBeNull();
  });
  it('an unknown view type reads as a table', () => {
    expect(asViewType('gallery')).toBe('gallery');
    expect(asViewType('mystery')).toBe('table');
  });
});

describe('the views on a real database', () => {
  let env: ReturnType<typeof realSqlite>;
  let pages: CanvasDataService;
  let dbs: DatabaseDataService;
  let host: HTMLElement;
  let pane: DatabaseEditorPane | null = null;
  const opened: string[] = [];
  beforeEach(() => {
    env = realSqlite();
    (window as any).parallxElectron = { database: env.bridge };
    pages = new CanvasDataService();
    dbs = new DatabaseDataService(pages);
    host = document.createElement('div');
    document.body.appendChild(host);
    opened.length = 0;
  });
  afterEach(() => { pane?.dispose(); pane = null; host.remove(); dbs.dispose(); pages.dispose(); delete (window as any).parallxElectron; });
  const until = async (check: () => boolean, ms = 2500) => {
    const end = Date.now() + ms;
    while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
  };
  const mount = (id: string) => {
    pane = new DatabaseEditorPane(host, id, {
      db: dbs, openPage: (p) => opened.push(p), renamePage: (p, t) => pages.updatePage(p, { title: t }).then(() => {}),
      getPage: (p) => pages.getPage(p), updatePage: (p, patch) => pages.updatePage(p, patch).then(() => {}),
    });
  };
  const q = (sel: string) => host.querySelector<HTMLElement>(sel);
  const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];

  async function seed() {
    const d = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
    const status = await dbs.addProperty(d.id, 'Status', 'status', defaultConfigFor('status'));
    const read = await dbs.addProperty(d.id, 'Finished', 'checkbox');
    const start = await dbs.addProperty(d.id, 'Started', 'date');
    const end = await dbs.addProperty(d.id, 'Ended', 'date');
    const pagesN = await dbs.addProperty(d.id, 'Pages', 'number');
    const files = await dbs.addProperty(d.id, 'Cover', 'files');
    await dbs.addRow(d.id, 'Meditations', { [status.id]: 'Done', [read.id]: true, [start.id]: '2026-11-03', [end.id]: '2026-11-06', [pagesN.id]: 250, [files.id]: ['https://x.test/m.png'] });
    await dbs.addRow(d.id, 'Sisyphus', { [status.id]: 'In progress', [read.id]: false, [start.id]: '2026-11-10', [pagesN.id]: 120 });
    await dbs.addRow(d.id, 'Later', { [status.id]: 'Not started', [pagesN.id]: 80 });
    const [view] = await dbs.listViews(d.id);
    return { d, status, read, start, end, pagesN, files, view: view! };
  }

  it('list: a line per row with its properties at the right', async () => {
    const { d, view } = await seed();
    await dbs.updateView(d.id, view.id, { type: 'list' });
    mount(d.id);
    await until(() => qa('.canvas-db-list__row').length === 3);
    expect(qa('.canvas-db-list__row .canvas-db-pill').map((p) => p.textContent)).toContain('Done');
  });

  it('gallery: a card per row, the preview from the files property', async () => {
    const { d, view, files } = await seed();
    await dbs.updateView(d.id, view.id, { type: 'gallery', config: { preview: files.id, cardSize: 'small' } });
    mount(d.id);
    await until(() => qa('.canvas-db-card--gallery').length === 3);
    expect(q('.canvas-db-gallery--small')).not.toBeNull();
    expect(qa('.canvas-db-card__img').map((i) => i.getAttribute('src'))).toEqual(['https://x.test/m.png']);
  });

  it('calendar: rows sit on their day; + on a day makes a row there; a chip moves by keys', async () => {
    const { d, view, start } = await seed();
    await dbs.updateView(d.id, view.id, { type: 'calendar', config: { dateProperty: start.id } });
    mount(d.id);
    await until(() => qa('.canvas-db-calday').length === 42);
    // The month shown is today's; the seeded rows are in November 2026, so navigate there if needed.
    const today = new Date();
    const monthsAway = (2026 - today.getFullYear()) * 12 + (10 - today.getMonth());
    for (let i = 0; i < Math.abs(monthsAway); i++) {
      q(monthsAway > 0 ? '[data-px-id="database.calendar.next"]' : '[data-px-id="database.calendar.prev"]')!.click();
    }
    await until(() => !!q('[data-day="2026-11-03"] .canvas-db-calchip'));
    expect(q('[data-day="2026-11-03"] .canvas-db-calchip')?.textContent).toContain('Meditations');
    expect(qa('.canvas-db-caltray .canvas-db-calchip').map((c) => c.textContent)).toEqual([expect.stringContaining('Later')]);
    // + on the 20th.
    (q('[data-day="2026-11-20"] .canvas-db-calday__add') as HTMLElement).click();
    await until(() => (pane as any)._rows.length === 4);
    const rows = await dbs.listRows(d.id);
    expect(rows.find((r) => r.title === 'Untitled')!.values[start.id]).toBe('2026-11-20');
    // Ctrl+Shift+Right moves Meditations a day on.
    await until(() => !!q('[data-day="2026-11-03"] .canvas-db-calchip'));
    q('[data-day="2026-11-03"] .canvas-db-calchip')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, shiftKey: true, bubbles: true }));
    await until(() => !!q('[data-day="2026-11-04"] .canvas-db-calchip'));
  });

  it('timeline: a bar from start to end, one day wide without an end; arrows move it', async () => {
    const { d, view, start, end } = await seed();
    await dbs.updateView(d.id, view.id, { type: 'timeline', config: { dateProperty: start.id, endDateProperty: end.id } });
    mount(d.id);
    await until(() => qa('.canvas-db-tl__bar').length >= 1);
    const today = new Date();
    const monthsAway = (2026 - today.getFullYear()) * 12 + (10 - today.getMonth());
    for (let i = 0; i < Math.abs(monthsAway); i++) q(monthsAway > 0 ? '[data-px-id="database.timeline.next"]' : '[data-px-id="database.timeline.prev"]')!.click();
    await until(() => qa('.canvas-db-tl__bar').length === 2);
    const bars = qa('.canvas-db-tl__bar');
    const med = bars.find((b) => b.textContent?.includes('Meditations'))!;
    const sis = bars.find((b) => b.textContent?.includes('Sisyphus'))!;
    // Nov 3 to Nov 6 is four days; the window starts a week before the 1st (Oct 25), so the 3rd is day 9.
    expect(med.style.left).toBe(`${9 * 34}px`);
    expect(med.style.width).toBe(`${4 * 34 - 4}px`);
    expect(sis.style.width).toBe(`${1 * 34 - 4}px`);
    med.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(() => false, 150).catch(() => {});
    const rows = await dbs.listRows(d.id);
    const m = rows.find((r) => r.title === 'Meditations')!;
    expect(m.values[start.id]).toBe('2026-11-04');
    expect(m.values[end.id]).toBe('2026-11-07');
    expect(qa('.canvas-db-caltray .canvas-db-calchip')).toHaveLength(1);
  });

  it('chart: bars per status with a legend of the numbers; a donut sums pages', async () => {
    const { d, view, status, pagesN } = await seed();
    await dbs.updateView(d.id, view.id, { type: 'chart', config: { chart: { kind: 'bar', groupBy: status.id, measure: 'count', aggregate: 'count' } } });
    mount(d.id);
    await until(() => qa('.canvas-db-chart__bar').length === 3);
    expect(qa('.canvas-db-chart__key').map((k) => k.textContent)).toEqual(['Not started1', 'In progress1', 'Done1']);
    await dbs.updateView(d.id, view.id, { config: { chart: { kind: 'donut', groupBy: status.id, measure: pagesN.id, aggregate: 'sum' } } });
    await until(() => qa('.canvas-db-chart__slice').length === 3);
    expect(q('.canvas-db-chart__center')?.textContent).toBe('450');
    expect(q('.canvas-db-chart__title')?.textContent).toBe('Sum of Pages by Status');
  });

  it('board: a lane per sub-group value, columns per status inside each', async () => {
    const { d, view, status, read } = await seed();
    await dbs.updateView(d.id, view.id, { type: 'board', groupBy: status.id, config: { subGroupBy: read.id } });
    mount(d.id);
    await until(() => qa('.canvas-db-lane').length === 2);
    const lanes = qa('.canvas-db-lane');
    expect(lanes[0]!.querySelector('.canvas-db-lane__title')?.textContent).toBe('Finished: checked');
    expect(lanes[0]!.querySelectorAll('.canvas-db-card')).toHaveLength(1);
    expect(lanes[1]!.querySelectorAll('.canvas-db-card')).toHaveLength(2);
    expect(lanes[1]!.querySelectorAll('.canvas-db-board__col')).toHaveLength(3);
  });

  it('every view type opens from the add menu and renders', async () => {
    const { d } = await seed();
    mount(d.id);
    await until(() => !!q('.canvas-db-table'));
    for (const t of ['list', 'gallery', 'calendar', 'timeline', 'chart', 'board'] as const) {
      const v = await dbs.addView(d.id, t, t);
      (pane as any)._activeViewId = v.id;
      await until(() => qa('.canvas-db-tab').length >= 2);
      await until(() => !!q({ list: '.canvas-db-list', gallery: '.canvas-db-gallery', calendar: '.canvas-db-calgrid', timeline: '.canvas-db-tl', chart: '.canvas-db-chart', board: '.canvas-db-board' }[t]));
    }
  });
});
