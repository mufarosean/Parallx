// canvasDatabaseRelations.test.ts — relation and rollup (docs/DATABASES.md
// step 5): links across databases, synced both ways, and summaries over them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { DatabaseEditorPane } from '../../src/built-in/canvas/database/databaseEditorPane';
import { createRelationProperty, loadRelatedDatabases, relationConfig, relationIds, setRelationValue } from '../../src/built-in/canvas/database/relations';
import { rollupDisplayProperty, rollupOptionsFor, rollupValue } from '../../src/built-in/canvas/database/rollups';
import { withDerivedValues } from '../../src/built-in/canvas/database/rowCompute';
import { applyFilter, applySort } from '../../src/built-in/canvas/database/databaseViewModel';
import { coerceCellValue } from '../../src/built-in/canvas/database/cellValues';
import { TITLE_KEY } from '../../src/built-in/canvas/database/databaseTypes';
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
beforeEach(() => {
  env = realSqlite();
  (window as any).parallxElectron = { database: env.bridge };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
});
afterEach(() => { dbs.dispose(); pages.dispose(); delete (window as any).parallxElectron; });

async function library() {
  const authors = await dbs.createDatabase({ title: 'Authors', seedDefaults: false });
  const born = await dbs.addProperty(authors.id, 'Born', 'number');
  const seneca = await dbs.addRow(authors.id, 'Seneca', { [born.id]: -4 });
  const camus = await dbs.addRow(authors.id, 'Camus', { [born.id]: 1913 });
  const books = await dbs.createDatabase({ title: 'Books', seedDefaults: false });
  const pagesN = await dbs.addProperty(books.id, 'Pages', 'number');
  return { authors, born, seneca, camus, books, pagesN };
}

describe('relations', () => {
  it('a relation cell holds page ids; the coercion takes ids or {id} objects', () => {
    expect(coerceCellValue('relation', ['a', { id: 'b', title: 'B' }, 'a'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(coerceCellValue('relation', [1]).ok).toBe(false);
    expect(coerceCellValue('relation', null)).toEqual({ ok: true, value: [] });
    expect(relationIds([{ id: 'x', title: 'X' }, 'y'])).toEqual(['x', 'y']);
  });

  it('a synced relation makes a mirror, and writes keep both sides true', async () => {
    const { authors, seneca, camus, books } = await library();
    const by = await createRelationProperty(dbs, books.id, 'Author', authors.id, true);
    const cfg = relationConfig(by);
    expect(cfg.databaseId).toBe(authors.id);
    expect(cfg.synced).toBe(true);
    const mirror = (await dbs.listProperties(authors.id)).find((p) => p.id === cfg.syncedWith)!;
    expect(mirror.name).toBe('Books');
    expect(relationConfig(mirror)).toEqual({ databaseId: books.id, synced: true, syncedWith: by.id });

    const letters = await dbs.addRow(books.id, 'Letters from a Stoic');
    await setRelationValue(dbs, books.id, letters.pageId, by, [seneca.pageId]);
    expect((await dbs.getRowValues(authors.id, seneca.pageId))[mirror.id]).toEqual([letters.pageId]);
    // Re-pointing the book moves it on the authors' side.
    await setRelationValue(dbs, books.id, letters.pageId, by, [camus.pageId]);
    expect((await dbs.getRowValues(authors.id, seneca.pageId))[mirror.id]).toEqual([]);
    expect((await dbs.getRowValues(authors.id, camus.pageId))[mirror.id]).toEqual([letters.pageId]);
    // From the other side too.
    await setRelationValue(dbs, authors.id, seneca.pageId, mirror, [letters.pageId]);
    expect((await dbs.getRowValues(books.id, letters.pageId))[by.id]).toEqual(expect.arrayContaining([camus.pageId, seneca.pageId]));
  });

  it('derived rows show related titles, filter and sort by them', async () => {
    const { authors, seneca, camus, books } = await library();
    const by = await createRelationProperty(dbs, books.id, 'Author', authors.id, false);
    await dbs.addRow(books.id, 'Letters', { [by.id]: [seneca.pageId] });
    await dbs.addRow(books.id, 'Sisyphus', { [by.id]: [camus.pageId] });
    const props = await dbs.listProperties(books.id);
    const related = await loadRelatedDatabases(dbs, props);
    const rows = withDerivedValues(await dbs.listRows(books.id), props, {
      relation: (prop, ids) => ids.map((id) => ({ id, title: related.get(relationConfig(prop).databaseId)!.rows.get(id)!.title, icon: null })),
    });
    expect(rows.map((r) => (r.values[by.id] as { title: string }[])[0]!.title)).toEqual(['Seneca', 'Camus']);
    expect(applyFilter(rows, { conjunction: 'and', rules: [{ propertyId: by.id, op: 'contains', value: 'cam' }] }, () => 'relation').map((r) => r.title)).toEqual(['Sisyphus']);
    expect(applySort(rows, [{ propertyId: by.id, dir: 'asc' }]).map((r) => r.title)).toEqual(['Sisyphus', 'Letters']);
  });
});

describe('rollups', () => {
  it('counts, sums and shows the original across the relation', async () => {
    const { authors, born, seneca, camus, books, pagesN } = await library();
    const by = await createRelationProperty(dbs, authors.id, 'Wrote', books.id, false);
    const letters = await dbs.addRow(books.id, 'Letters', { [pagesN.id]: 320 });
    const sisyphus = await dbs.addRow(books.id, 'Sisyphus', { [pagesN.id]: 120 });
    const stranger = await dbs.addRow(books.id, 'The Stranger', { [pagesN.id]: 160 });
    await dbs.setCellValue(authors.id, seneca.pageId, by.id, [letters.pageId]);
    await dbs.setCellValue(authors.id, camus.pageId, by.id, [sisyphus.pageId, stranger.pageId]);
    const count = await dbs.addProperty(authors.id, 'Books', 'rollup', { relationId: by.id, propertyId: TITLE_KEY, function: 'count' });
    const sum = await dbs.addProperty(authors.id, 'Pages', 'rollup', { relationId: by.id, propertyId: pagesN.id, function: 'sum' });
    const titles = await dbs.addProperty(authors.id, 'Titles', 'rollup', { relationId: by.id, propertyId: TITLE_KEY, function: 'show_original' });
    const props = await dbs.listProperties(authors.id);
    const related = await loadRelatedDatabases(dbs, props);
    const rows = withDerivedValues(await dbs.listRows(authors.id), props, {
      relation: (prop, ids) => ids.map((id) => ({ id, title: related.get(relationConfig(prop).databaseId)!.rows.get(id)!.title, icon: null })),
      rollup: (prop, _row, values) => rollupValue(prop, values, props, related),
    });
    const c = rows.find((r) => r.title === 'Camus')!;
    expect(c.values[count.id]).toBe(2);
    expect(c.values[sum.id]).toBe(280);
    expect((c.values[titles.id] as { title: string }[]).map((t) => t.title)).toEqual(['Sisyphus', 'The Stranger']);
    const s = rows.find((r) => r.title === 'Seneca')!;
    expect(s.values[sum.id]).toBe(320);
    // Shown as what it computes: the sum is a number column, the titles a relation.
    expect(rollupDisplayProperty(sum, props, related).type).toBe('number');
    expect(rollupDisplayProperty(titles, props, related).type).toBe('relation');
    expect(rollupOptionsFor('number').map((o) => o.kind)).toContain('sum');
    expect(rollupOptionsFor('text').map((o) => o.kind)).not.toContain('sum');
    void born;
  });

  it('the table shows a rollup as a number with the rollup icon, read-only', async () => {
    const { authors, seneca, books, pagesN } = await library();
    const by = await createRelationProperty(dbs, authors.id, 'Wrote', books.id, false);
    const letters = await dbs.addRow(books.id, 'Letters', { [pagesN.id]: 320 });
    await dbs.setCellValue(authors.id, seneca.pageId, by.id, [letters.pageId]);
    await dbs.addProperty(authors.id, 'Pages', 'rollup', { relationId: by.id, propertyId: pagesN.id, function: 'sum' });
    const host = document.createElement('div'); document.body.appendChild(host);
    const pane = new DatabaseEditorPane(host, authors.id, { db: dbs, openPage: () => {}, renamePage: async () => {} });
    const until = async (check: () => boolean) => { const end = Date.now() + 2500; while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
    await until(() => [...host.querySelectorAll('.canvas-db-th__name')].map((e) => e.textContent).includes('Pages'));
    const row = [...host.querySelectorAll('.canvas-db-row')].find((r) => r.textContent?.includes('Seneca'))!;
    const cells = [...row.querySelectorAll<HTMLElement>('.canvas-db-cell')];
    const texts = cells.map((c) => c.textContent?.trim());
    expect(texts).toContain('Letters');
    expect(texts).toContain('320');
    expect(row.querySelector('.canvas-db-cell__value--computed')?.textContent).toBe('320');
    pane.dispose(); host.remove();
  });
});
