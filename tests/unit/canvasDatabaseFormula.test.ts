// canvasDatabaseFormula.test.ts — the formula property (docs/DATABASES.md
// step 6): the language, its errors, and the column it makes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { evaluateFormula, formulaResultType, formulaValue, isFormulaError, parseFormula } from '../../src/built-in/canvas/database/formula';
import { realSqlite } from './realSqlite';
import { installDatabaseCommandStub } from './databaseCommandStub';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}
installDatabaseCommandStub();

const row: Record<string, unknown> = { Pages: 320, Read: true, Title: 'Letters', Started: '2026-11-03', Ended: '2026-11-10', Tags: ['stoic', 'letters'], Empty: null, Price: '12.5' };
const f = (src: string) => formulaValue(src, (n) => row[n]);

describe('the formula language', () => {
  it('does arithmetic with precedence, text, comparisons and logic', () => {
    expect(f('1 + 2 * 3')).toBe(7);
    expect(f('(1 + 2) * 3')).toBe(9);
    expect(f('2 ^ 3 ^ 2')).toBe(512);
    expect(f('10 % 4 - -1')).toBe(3);
    expect(f('prop("Pages") / 10')).toBe(32);
    expect(f('"Read: " + prop("Title")')).toBe('Read: Letters');
    expect(f('prop("Pages") > 300 && prop("Read")')).toBe(true);
    expect(f('prop("Pages") > 300 ? "long" : "short"')).toBe('long');
    expect(f('!prop("Read") || prop("Empty") == ""')).toBe(true);
    expect(f('prop("Price") * 2')).toBe(25);
  });
  it('has the common functions, with the method form too', () => {
    expect(f('if(prop("Read"), "done", "not yet")')).toBe('done');
    // Only the branch taken runs: an error in the other is no error.
    expect(f('if(empty(prop("Empty")), "none", dateBetween(prop("Empty"), prop("Started"), "days"))')).toBe('none');
    expect(f('or(true, 1 / 0)')).toBe(true);
    expect(f('round(10 / 3, 2)')).toBe(3.33);
    expect(f('max(1, 5, 3) + min(4, 2)')).toBe(7);
    expect(f('length(prop("Title"))')).toBe(7);
    expect(f('prop("Title").upper()')).toBe('LETTERS');
    expect(f('join(prop("Tags"), " / ")')).toBe('stoic / letters');
    expect(f('contains(prop("Tags"), "stoic")')).toBe(true);
    expect(f('empty(prop("Empty"))')).toBe(true);
    expect(f('format(prop("Pages")) + " pages"')).toBe('320 pages');
    expect(f('replaceAll("a-b-c", "-", "+")')).toBe('a+b+c');
    expect(f('slice("Letters", 0, 3)')).toBe('Let');
    expect(f('sum(prop("Pages"), 10, 20)')).toBe(350);
    expect(f('toNumber("1,200")')).toBe(1200);
  });
  it('works with dates as the cells store them', () => {
    expect(f('dateBetween(prop("Ended"), prop("Started"), "days")')).toBe(7);
    expect(f('dateAdd(prop("Started"), 1, "weeks")')).toBe('2026-11-10');
    expect(f('dateSubtract(prop("Started"), 1, "months")')).toBe('2026-10-03');
    expect(f('year(prop("Started"))')).toBe(2026);
    expect(f('month(prop("Started"))')).toBe(11);
    expect(f('formatDate(prop("Started"), "DD/MM/YYYY")')).toBe('03/11/2026');
    expect(typeof f('today()')).toBe('string');
    expect(String(f('now()'))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
  it('says what is wrong instead of guessing', () => {
    const bad = (src: string) => { const v = f(src); return isFormulaError(v) ? v.error : `value ${JSON.stringify(v)}`; };
    expect(bad('prop("Pages") +')).toMatch(/ends too soon/);
    expect(bad('prop(Pages)')).toMatch(/a property is prop\("Pages"\)/);
    expect(bad('1 / 0')).toMatch(/Division by zero/);
    expect(bad('nope(1)')).toMatch(/Unknown function nope/);
    expect(bad('"open')).toMatch(/never closed/);
    expect(bad('Pages * 2')).toMatch(/Unknown name "Pages"/);
    expect(bad('"a" - 1')).toMatch(/Expected a number/);
    expect(formulaValue('', () => null)).toBeNull();
    expect(() => evaluateFormula(parseFormula('1 +'), () => null)).toThrow();
  });
  it('tells a cell how to show the result', () => {
    expect(formulaResultType([3])).toBe('number');
    expect(formulaResultType([true])).toBe('checkbox');
    expect(formulaResultType(['2026-11-03'])).toBe('date');
    expect(formulaResultType(['2026-11-03T09:00'])).toBe('datetime');
    expect(formulaResultType([['a']])).toBe('tags');
    expect(formulaResultType([null, { error: 'x' }, 'words'])).toBe('text');
  });
});

describe('a formula column', () => {
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
    host = document.createElement('div'); document.body.appendChild(host);
  });
  afterEach(() => { pane?.dispose(); pane = null; host.remove(); dbs.dispose(); pages.dispose(); delete (window as any).parallxElectron; });
  const until = async (check: () => boolean) => { const end = Date.now() + 2500; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };

  it('computes per row from the other properties, is read-only, shows a number as one and an error as one', async () => {
    const d = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
    const pagesN = await dbs.addProperty(d.id, 'Pages', 'number');
    await dbs.addRow(d.id, 'Letters', { [pagesN.id]: 320 });
    await dbs.addRow(d.id, 'Blank');
    const hours = await dbs.addProperty(d.id, 'Hours', 'formula', { expression: 'round(prop("Pages") / 40, 1)' });
    const broken = await dbs.addProperty(d.id, 'Broken', 'formula', { expression: 'prop("Nope") + 1' });
    pane = new DatabaseEditorPane(host, d.id, { db: dbs, openPage: () => {}, renamePage: async () => {} });
    await until(() => [...host.querySelectorAll('.canvas-db-th__name')].map((e) => e.textContent).includes('Broken'));
    const rows = [...host.querySelectorAll('.canvas-db-row')];
    const letters = rows.find((r) => r.textContent?.includes('Letters'))!;
    const computed = [...letters.querySelectorAll<HTMLElement>('.canvas-db-cell__value--computed')].map((c) => c.textContent);
    expect(computed[0]).toBe('8');
    expect(letters.querySelector('.canvas-db-cell__error')?.textContent).toMatch(/No property named "Nope"/);
    const blank = rows.find((r) => r.textContent?.includes('Blank'))!;
    expect([...blank.querySelectorAll('.canvas-db-cell__value--computed')][0]!.textContent).toBe('0');
    // Nobody types into a formula.
    await expect(dbs.setCellValue(d.id, (await dbs.listRows(d.id))[0]!.pageId, hours.id, 5)).rejects.toThrow(/computed/);
    void broken;
    // Sorting by the formula works on its numbers.
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { sort: [{ propertyId: hours.id, dir: 'desc' }] });
    await until(() => [...host.querySelectorAll('.canvas-db-cell__titletext')].map((e) => e.textContent)[0] === 'Letters');
  });
});
