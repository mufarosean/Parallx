// canvasDatabaseIntegrity.test.ts — database integrity
// (docs/CANVAS_ASSESSMENT_2026-10-03.md, "Database data integrity"), on a
// real SQLite database with the app's migrations.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { applyFilter } from '../../src/built-in/canvas/database/databaseViewModel';
import { createSetPagePropertyTool } from '../../src/built-in/canvas/ai/pageTools';
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

describe('the AI property tool writes through the database service, in the column\'s shape', () => {
  async function setup() {
    const d = await dbs.createDatabase({ title: 'Projects' });
    const row = await dbs.addRow(d.id, 'My Page');
    const tool = createSetPagePropertyTool(env.toolDb as never, dbs);
    const set = (propertyName: string, value: unknown) =>
      tool.handler({ pageId: row.pageId, propertyName, value }, { isCancellationRequested: false } as never);
    const props = () => dbs.listProperties(d.id);
    const cell = async (name: string) => {
      const prop = (await props()).find((p) => p.name === name)!;
      return (await dbs.getRowValues(d.id, row.pageId))[prop.id];
    };
    return { d, row, set, props, cell };
  }

  it('sets an existing column, creating select options for new names', async () => {
    const { set, cell, props } = await setup();
    const res = await set('status', 'Blocked');
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain("Set property 'status'");
    expect(res.content).toContain('Projects');
    expect(await cell('Status')).toBe('Blocked');
    const status = (await props()).find((p) => p.name === 'Status')!;
    expect((status.config['options'] as { value: string }[]).map((o) => o.value)).toContain('Blocked');
  });

  it('creates a missing column with the type the value implies', async () => {
    const { set, props, cell } = await setup();
    await set('priority', 5);
    await set('done', true);
    await set('labels', ['a', 'b']);
    await set('tags', '["Journal","Daily"]'); // a stringified array (small models) is the array
    await set('note', '[not json');
    const byName = Object.fromEntries((await props()).map((p) => [p.name, p.type]));
    expect(byName).toMatchObject({ priority: 'number', done: 'checkbox', labels: 'tags', tags: 'tags', note: 'text' });
    expect(await cell('tags')).toEqual(['Journal', 'Daily']);
    expect(await cell('note')).toBe('[not json');
  });

  it('stores a value in the column\'s own shape: "false" in a checkbox is unchecked, "5" in a number is 5', async () => {
    const { d, set, cell } = await setup();
    await dbs.addProperty(d.id, 'Done', 'checkbox');
    await dbs.addProperty(d.id, 'Estimate', 'number');
    await dbs.addProperty(d.id, 'Due', 'date');
    await set('Done', 'false');
    await set('Estimate', '5');
    await set('Due', '2026-10-04T15:30');
    expect(await cell('Done')).toBe(false);
    expect(await cell('Estimate')).toBe(5);
    expect(await cell('Due')).toBe('2026-10-04');
  });

  it('refuses a value the column cannot take, and changes nothing', async () => {
    const { d, set, cell } = await setup();
    await dbs.addProperty(d.id, 'Estimate', 'number');
    await set('Estimate', 3);
    const res = await set('Estimate', 'about a week');
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/number/);
    expect(await cell('Estimate')).toBe(3);
  });
});

describe('filters read values by their type', () => {
  async function rowsWith(type: 'checkbox' | 'number' | 'date' | 'datetime', values: unknown[]) {
    const d = await dbs.createDatabase({ title: 'T' });
    const prop = await dbs.addProperty(d.id, 'P', type);
    for (const [i, v] of values.entries()) {
      const row = await dbs.addRow(d.id, `r${i}`);
      if (v !== undefined) env.db.prepare('INSERT INTO page_property_values (page_id, property_id, database_id, value) VALUES (?, ?, ?, ?)').run(row.pageId, prop.id, d.id, JSON.stringify(v));
    }
    const rows = await dbs.listRows(d.id);
    const match = (op: string, value?: unknown) => applyFilter(rows, { conjunction: 'and', rules: [{ propertyId: prop.id, op: op as never, value }] }, () => type)
      .map((r) => r.title).sort();
    return match;
  }

  it('checkbox: never-set, cleared, false and "false" are all unchecked', async () => {
    const match = await rowsWith('checkbox', [undefined, null, false, 'false', true]);
    expect(match('is_empty')).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(match('equals', 'false')).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(match('is_not_empty')).toEqual(['r4']);
    expect(match('equals', 'true')).toEqual(['r4']);
  });

  it('number: equals compares numbers, so 5 equals "5.0"', async () => {
    const match = await rowsWith('number', [5, 5.5, 10, '7']);
    expect(match('equals', '5.0')).toEqual(['r0']);
    expect(match('greater_than', '6')).toEqual(['r2', 'r3']);
    expect(match('not_equals', '5')).toEqual(['r1', 'r2', 'r3']);
  });

  it('date: a day rule matches times on that day; before and after agree with it', async () => {
    const match = await rowsWith('datetime', ['2026-10-03T23:00', '2026-10-04T09:30', '2026-10-04T18:00', '2026-10-05T00:10']);
    expect(match('equals', '2026-10-04')).toEqual(['r1', 'r2']);
    expect(match('less_than', '2026-10-04')).toEqual(['r0']);
    expect(match('greater_than', '2026-10-04')).toEqual(['r3']);
  });
});

describe('select and tag options can be renamed and removed', () => {
  async function setup() {
    const d = await dbs.createDatabase({ title: 'Tasks' });
    const status = (await dbs.listProperties(d.id)).find((p) => p.name === 'Status')!;
    const tags = await dbs.addProperty(d.id, 'Tags', 'tags', { options: [{ value: 'art', color: 'red' }, { value: 'work', color: 'blue' }] });
    const a = await dbs.addRow(d.id, 'A');
    const b = await dbs.addRow(d.id, 'B');
    await dbs.setCellValue(d.id, a.pageId, status.id, 'In progress');
    await dbs.setCellValue(d.id, b.pageId, status.id, 'Done');
    await dbs.setCellValue(d.id, a.pageId, tags.id, ['art', 'work']);
    await dbs.setCellValue(d.id, b.pageId, tags.id, ['work']);
    const cell = async (pageId: string, propId: string) => (await dbs.getRowValues(d.id, pageId))[propId];
    return { d, status, tags, a, b, cell };
  }

  it('renaming an option renames it in every cell and in filters on it', async () => {
    const { d, status, tags, a, b, cell } = await setup();
    const [view] = await dbs.listViews(d.id);
    await dbs.updateView(d.id, view!.id, { filter: { conjunction: 'and', rules: [{ propertyId: tags.id, op: 'equals', value: 'work' }] } });

    await dbs.setOptions(d.id, tags.id, [{ value: 'art', color: 'red' }, { value: 'Job', color: 'blue' }], { work: 'Job' });
    await dbs.setOptions(d.id, status.id, [{ value: 'To do', color: 'gray' }, { value: 'Doing', color: 'blue' }, { value: 'Done', color: 'green' }], { 'In progress': 'Doing' });

    expect(await cell(a.pageId, tags.id)).toEqual(['art', 'Job']);
    expect(await cell(b.pageId, tags.id)).toEqual(['Job']);
    expect(await cell(a.pageId, status.id)).toBe('Doing');
    expect(await cell(b.pageId, status.id)).toBe('Done');
    expect((await dbs.listViews(d.id))[0]!.filter.rules[0]!.value).toBe('Job');
  });

  it('removing an option takes it out of the cells that held it', async () => {
    const { d, status, tags, a, b, cell } = await setup();
    await dbs.setOptions(d.id, tags.id, [{ value: 'art', color: 'red' }]);
    await dbs.setOptions(d.id, status.id, [{ value: 'To do', color: 'gray' }, { value: 'In progress', color: 'blue' }]);
    expect(await cell(a.pageId, tags.id)).toEqual(['art']);
    expect(await cell(b.pageId, tags.id)).toEqual([]);
    expect(await cell(a.pageId, status.id)).toBe('In progress');
    expect(await cell(b.pageId, status.id)).toBeNull();
  });

  it('two options with one name are refused, and nothing changes', async () => {
    const { d, tags, a, cell } = await setup();
    await expect(dbs.setOptions(d.id, tags.id, [{ value: 'art', color: 'red' }, { value: 'art', color: 'blue' }], { work: 'art' }))
      .rejects.toThrow(/same name/);
    expect(await cell(a.pageId, tags.id)).toEqual(['art', 'work']);
  });
});

describe('the workspace Tags and Page properties databases are found by role, not title', () => {
  it('a user database named "Tags" is never taken over', async () => {
    const mine = await dbs.createDatabase({ title: 'Tags' }); // the user's own: it has the default Status column
    const { databaseId } = await dbs.ensureWorkspaceDatabase('tags', { name: 'Tags', type: 'tags' });
    expect(databaseId).not.toBe(mine.id);
    expect((await dbs.listProperties(mine.id)).map((p) => p.name)).toEqual(['Status']);
  });

  it('the app\'s own Tags database made before roles is adopted, and found again after a rename', async () => {
    const old = await dbs.createDatabase({ title: 'Tags', seedDefaults: false });
    await dbs.addProperty(old.id, 'Tags', 'tags');
    const first = await dbs.ensureWorkspaceDatabase('tags', { name: 'Tags', type: 'tags' });
    expect(first.databaseId).toBe(old.id);

    await pages.updatePage(old.id, { title: 'My labels' });
    const again = await dbs.ensureWorkspaceDatabase('tags', { name: 'Tags', type: 'tags' });
    expect(again.databaseId).toBe(old.id);
  });

  it('two calls give one database; one in the Trash gives up the role', async () => {
    const a = await dbs.ensureWorkspaceDatabase('page-properties');
    const b = await dbs.ensureWorkspaceDatabase('page-properties');
    expect(b.databaseId).toBe(a.databaseId);
    await pages.archivePage(a.databaseId);
    const c = await dbs.ensureWorkspaceDatabase('page-properties');
    expect(c.databaseId).not.toBe(a.databaseId);
  });
});
