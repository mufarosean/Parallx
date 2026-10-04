// canvasDatabaseIntegrity.test.ts — database integrity
// (docs/CANVAS_ASSESSMENT_2026-10-03.md, "Database data integrity"), on a
// real SQLite database with the app's migrations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { applyFilter } from '../../src/built-in/canvas/database/databaseViewModel';
import { realSqlite } from './realSqlite';

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
let dbs: DatabaseDataService;

beforeEach(() => {
  env = realSqlite();
  (globalThis as any).window = { parallxElectron: { database: env.bridge } };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
});
afterEach(() => {
  dbs.dispose();
  pages.dispose();
  delete (globalThis as any).window;
});

describe('deleting a property cleans the views that used it', () => {
  it('filter, sort, grouping and column settings on it are removed; the view shows its rows again', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const prio = await dbs.addProperty(d.id, 'Priority', 'select', { options: [{ value: 'High', color: 'red' }] });
    const keep = await dbs.addProperty(d.id, 'Notes', 'text');
    const row = await dbs.addRow(d.id, 'Write report');
    await dbs.setCellValue(d.id, row.pageId, prio.id, 'High');
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, {
      filter: { conjunction: 'and', rules: [{ propertyId: prio.id, op: 'equals', value: 'High' }, { propertyId: keep.id, op: 'is_empty' }] },
      sort: [{ propertyId: prio.id, dir: 'asc' }, { propertyId: '__title', dir: 'desc' }],
      groupBy: prio.id,
      config: { hidden: [prio.id, keep.id], widths: { [prio.id]: 120, [keep.id]: 200 } },
    });

    await dbs.deleteProperty(d.id, prio.id);

    const after = (await dbs.listViews(d.id))[0]!;
    expect(after.filter.rules).toEqual([{ propertyId: keep.id, op: 'is_empty' }]);
    expect(after.sort).toEqual([{ propertyId: '__title', dir: 'desc' }]);
    expect(after.groupBy).toBeNull();
    expect(after.config).toEqual({ hidden: [keep.id], widths: { [keep.id]: 200 } });
    expect(applyFilter(await dbs.listRows(d.id), after.filter).map((r) => r.title)).toEqual(['Write report']);
  });

  it('a view saved earlier with a rule on a property that no longer exists is repaired when read', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    await dbs.addRow(d.id, 'Row');
    const [view] = await dbs.listViews(d.id);
    env.db.prepare('UPDATE database_views SET filter_config = ? WHERE id = ?')
      .run(JSON.stringify({ conjunction: 'and', rules: [{ propertyId: 'gone', op: 'equals', value: 'x' }] }), view!.id);

    const repaired = (await dbs.listViews(d.id))[0]!;
    expect(repaired.filter.rules).toEqual([]);
    const stored = env.db.prepare('SELECT filter_config FROM database_views WHERE id = ?').get(view!.id) as any;
    expect(JSON.parse(stored.filter_config).rules).toEqual([]);
  });
});
