// canvasDatabaseRows.test.ts — adding database rows (Medium list in
// docs/CANVAS_ASSESSMENT_2026-10-03.md), on a real SQLite database with the
// app's migrations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { applyFilter, seedForFilter } from '../../src/built-in/canvas/database/databaseViewModel';
import type { IFilterConfig } from '../../src/built-in/canvas/database/databaseTypes';
import { realSqlite } from './realSqlite';

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
let dbs: DatabaseDataService;
let failTransaction = false;

beforeEach(() => {
  env = realSqlite();
  const bridge = {
    ...env.bridge,
    runTransaction: async (ops: any[]) => {
      if (failTransaction && ops.some((o) => /INSERT INTO database_pages/.test(o.sql))) {
        return { error: { code: 'SQLITE_BUSY', message: 'database is locked' } };
      }
      return env.bridge.runTransaction(ops);
    },
  };
  (globalThis as any).window = { parallxElectron: { database: bridge } };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
  failTransaction = false;
});
afterEach(() => {
  dbs.dispose();
  pages.dispose();
  delete (globalThis as any).window;
});

const pageCount = () => (env.db.prepare('SELECT COUNT(*) AS n FROM pages').get() as any).n as number;

describe('a new row in a filtered view stays in that view', () => {
  it('starts with the values the filter asks for, and shows', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const status = await dbs.addProperty(d.id, 'Status', 'select', { options: [{ value: 'Doing', color: 'blue' }] });
    const tags = await dbs.addProperty(d.id, 'Tags', 'tags', { options: [] });
    const done = await dbs.addProperty(d.id, 'Done', 'checkbox');
    const props = await dbs.listProperties(d.id);
    const typeOf = (id: string) => props.find((p) => p.id === id)?.type;
    const filter: IFilterConfig = { conjunction: 'and', rules: [
      { propertyId: status.id, op: 'equals', value: 'Doing' },
      { propertyId: tags.id, op: 'contains', value: 'urgent' },
      { propertyId: done.id, op: 'equals', value: false },
      { propertyId: '__title', op: 'contains', value: 'Fix' },
    ] };

    const seed = seedForFilter(filter, typeOf);
    expect(seed).toEqual({ title: 'Fix', values: { [status.id]: 'Doing', [tags.id]: ['urgent'], [done.id]: false } });

    await dbs.addRow(d.id, seed.title, seed.values);
    const shown = applyFilter(await dbs.listRows(d.id), filter, typeOf);
    expect(shown).toHaveLength(1);
    // The new tag became an option, as typing it would.
    const tagProp = (await dbs.listProperties(d.id)).find((p) => p.id === tags.id)!;
    expect((tagProp.config as any).options.map((o: any) => o.value)).toContain('urgent');
  });

  it('"any of" needs one rule satisfied; rules a value cannot meet are left alone', () => {
    const typeOf = (id: string) => (id === 'n' ? 'number' : 'select') as any;
    expect(seedForFilter({ conjunction: 'or', rules: [{ propertyId: 's', op: 'equals', value: 'A' }, { propertyId: 'n', op: 'equals', value: 3 }] }, typeOf))
      .toEqual({ values: { s: 'A' } });
    expect(seedForFilter({ conjunction: 'and', rules: [{ propertyId: 'n', op: 'greater_than', value: 3 }, { propertyId: 's', op: 'is_empty' }] }, typeOf))
      .toEqual({ values: {} });
  });
});

describe('adding a row is one step', () => {
  it('a value the column cannot hold is refused before any page is made', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const n = await dbs.addProperty(d.id, 'Estimate', 'number');
    const before = pageCount();
    await expect(dbs.addRow(d.id, 'Row', { [n.id]: 'lots' })).rejects.toThrow(/number/);
    expect(pageCount()).toBe(before);
  });

  it('when the membership write fails, the new page is removed again', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const before = pageCount();
    failTransaction = true;
    await expect(dbs.addRow(d.id, 'Row')).rejects.toThrow(/locked/);
    expect(pageCount()).toBe(before);
    failTransaction = false;
    await dbs.addRow(d.id, 'Row');
    expect(await dbs.listRows(d.id)).toHaveLength(1);
  });

  it('fires one rows change for the row and its values', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const s = await dbs.addProperty(d.id, 'Status', 'select', { options: [{ value: 'A', color: 'red' }] });
    const t = await dbs.addProperty(d.id, 'Note', 'text');
    let rowsEvents = 0;
    const sub = dbs.onDidChangeRows(() => { rowsEvents++; });
    await dbs.addRow(d.id, 'Row', { [s.id]: 'A', [t.id]: 'hello' });
    sub.dispose();
    expect(rowsEvents).toBe(1);
    const [row] = await dbs.listRows(d.id);
    expect(row!.values).toMatchObject({ [s.id]: 'A', [t.id]: 'hello' });
  });
});
