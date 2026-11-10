// canvasDatabaseTypes.test.ts — property types, round 2 (docs/DATABASES.md
// step 3): status, email, phone, files, ID, created and last edited time.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { coerceCellValue, missingOptions } from '../../src/built-in/canvas/database/cellValues';
import { withDerivedValues, timestampToLocalDatetime } from '../../src/built-in/canvas/database/rowCompute';
import { PROPERTY_TYPE_META, defaultConfigFor, statusGroupOf } from '../../src/built-in/canvas/properties/propertyTypeMeta';
import { cellToCsvText, csvTextToValue } from '../../src/built-in/canvas/database/databaseCsv';
import { applyFilter, groupRows } from '../../src/built-in/canvas/database/databaseViewModel';
import { calculate } from '../../src/built-in/canvas/database/calculations';
import type { PropertyType } from '../../src/built-in/canvas/properties/propertyTypes';
import { realSqlite } from './realSqlite';

describe('one stored shape per new type', () => {
  it('status takes an option name; email an address; phone and text anything; files names and sources', () => {
    expect(coerceCellValue('status', 'Done')).toEqual({ ok: true, value: 'Done' });
    expect(coerceCellValue('status', ['Done'])).toEqual({ ok: true, value: 'Done' });
    expect(coerceCellValue('email', 'a@b.co')).toEqual({ ok: true, value: 'a@b.co' });
    expect(coerceCellValue('email', 'not an address').ok).toBe(false);
    expect(coerceCellValue('email', '')).toEqual({ ok: true, value: null });
    expect(coerceCellValue('phone', '+1 555 0100')).toEqual({ ok: true, value: '+1 555 0100' });
    expect(coerceCellValue('files', ['https://x.test/a.pdf', { name: 'Notes', src: 'parallx-media://workspace/.parallx/media/n.md' }]))
      .toEqual({ ok: true, value: [{ name: 'a.pdf', src: 'https://x.test/a.pdf' }, { name: 'Notes', src: 'parallx-media://workspace/.parallx/media/n.md' }] });
    expect(coerceCellValue('files', [{ nope: 1 }]).ok).toBe(false);
  });
  it('an ID is a whole number; computed types refuse a write', () => {
    expect(coerceCellValue('unique_id', 7)).toEqual({ ok: true, value: 7 });
    expect(coerceCellValue('unique_id', '12')).toEqual({ ok: true, value: 12 });
    expect(coerceCellValue('unique_id', 1.5).ok).toBe(false);
    for (const t of ['created_time', 'last_edited_time', 'formula', 'rollup'] as PropertyType[]) {
      const r = coerceCellValue(t, 'x');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/computed/);
    }
  });
  it('a status name that is not an option yet becomes one, as a select name does', () => {
    expect(missingOptions('status', 'Blocked', [{ value: 'Done' }])).toEqual(['Blocked']);
  });
  it('every property type has its meta entry and a starting config', () => {
    const all: PropertyType[] = ['text', 'number', 'checkbox', 'date', 'datetime', 'tags', 'select', 'url', 'status', 'email', 'phone', 'files', 'unique_id', 'created_time', 'last_edited_time', 'formula', 'relation', 'rollup'];
    for (const t of all) {
      expect(PROPERTY_TYPE_META.find((m) => m.type === t), t).toBeTruthy();
      expect(typeof defaultConfigFor(t)).toBe('object');
    }
    const status = defaultConfigFor('status');
    expect(statusGroupOf(status, 'Done')).toBe('complete');
    expect(statusGroupOf(status, 'In progress')).toBe('in_progress');
    expect(statusGroupOf(status, 'Whatever')).toBe('todo');
  });
});

describe('computed values (pure)', () => {
  const prop = (id: string, type: PropertyType) => ({ id, databaseId: 'd', name: id, type, config: {}, sortOrder: 0 });
  const row = { pageId: 'p', title: 't', icon: null, sortOrder: 1, values: { a: 1 }, createdAt: '2026-03-02 10:30:00', updatedAt: '2026-03-05 08:00:00' };
  it('created and last edited time come from the page, as local datetimes', () => {
    const [r] = withDerivedValues([row], [prop('a', 'number'), prop('c', 'created_time'), prop('e', 'last_edited_time')]);
    expect(r!.values.a).toBe(1);
    expect(r!.values.c).toBe(timestampToLocalDatetime('2026-03-02 10:30:00'));
    expect(String(r!.values.c)).toMatch(/^2026-03-0\dT\d{2}:\d{2}$/);
    expect(r!.values.e).toBe(timestampToLocalDatetime('2026-03-05 08:00:00'));
  });
  it('they filter and calculate like dates', () => {
    const rows = withDerivedValues([row, { ...row, pageId: 'q', createdAt: '2026-04-01 00:00:00' }], [prop('c', 'created_time')]);
    const typeOf = () => 'created_time' as PropertyType;
    expect(applyFilter(rows, { conjunction: 'and', rules: [{ propertyId: 'c', op: 'greater_than', value: '2026-03-15' }] }, typeOf).map((r) => r.pageId)).toEqual(['q']);
    expect(calculate('earliest', rows.map((r) => r.values.c), 'created_time')).toMatch(/^2026-03-0\d$/);
  });
  it('rows without computed properties are untouched', () => {
    expect(withDerivedValues([row], [prop('a', 'number')])[0]!.values).toBe(row.values);
  });
});

describe('CSV knows the new types', () => {
  it('files export as their sources and import back; email and status are text', () => {
    expect(cellToCsvText('files', [{ name: 'a', src: 'https://x/a.pdf' }, { name: 'b', src: 'https://x/b.png' }])).toBe('https://x/a.pdf, https://x/b.png');
    expect(csvTextToValue('files', 'https://x/a.pdf, https://x/b.png')).toEqual({ ok: true, value: [{ name: 'a.pdf', src: 'https://x/a.pdf' }, { name: 'b.png', src: 'https://x/b.png' }] });
    expect(csvTextToValue('email', 'me@x.co')).toEqual({ ok: true, value: 'me@x.co' });
    expect(csvTextToValue('status', 'Done')).toEqual({ ok: true, value: 'Done' });
    expect(cellToCsvText('created_time', '2026-03-02T10:30')).toBe('2026-03-02T10:30');
  });
});

describe('on a real database', () => {
  let env: ReturnType<typeof realSqlite>;
  let pages: CanvasDataService;
  let dbs: DatabaseDataService;
  beforeEach(() => {
    env = realSqlite();
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.parallxElectron = { database: env.bridge };
    pages = new CanvasDataService();
    dbs = new DatabaseDataService(pages);
  });
  afterEach(() => { dbs.dispose(); pages.dispose(); delete (globalThis as any).window.parallxElectron; });

  it('an ID column numbers existing rows in order, and each new row takes the next number', async () => {
    const d = await dbs.createDatabase({ title: 'Tickets', seedDefaults: false });
    const a = await dbs.addRow(d.id, 'First');
    const b = await dbs.addRow(d.id, 'Second');
    const id = await dbs.addProperty(d.id, 'ID', 'unique_id', defaultConfigFor('unique_id'));
    let rows = await dbs.listRows(d.id);
    expect(rows.find((r) => r.pageId === a.pageId)!.values[id.id]).toBe(1);
    expect(rows.find((r) => r.pageId === b.pageId)!.values[id.id]).toBe(2);
    const c = await dbs.addRow(d.id, 'Third');
    await dbs.removeRow(d.id, b.pageId);
    const e = await dbs.addRow(d.id, 'Fourth');
    rows = await dbs.listRows(d.id);
    expect(rows.find((r) => r.pageId === c.pageId)!.values[id.id]).toBe(3);
    // A deleted row's number is not reused.
    expect(rows.find((r) => r.pageId === e.pageId)!.values[id.id]).toBe(4);
    // Nobody types an ID.
    await expect(dbs.setCellValue(d.id, e.pageId, id.id, 'nine')).rejects.toThrow(/whole number/);
  });

  it('a status column groups a board by its options, and a new status name becomes an option', async () => {
    const d = await dbs.createDatabase({ title: 'Tasks', seedDefaults: false });
    const status = await dbs.addProperty(d.id, 'Status', 'status', defaultConfigFor('status'));
    await dbs.addRow(d.id, 'Write', { [status.id]: 'Done' });
    await dbs.addRow(d.id, 'Review', { [status.id]: 'Blocked' });
    const props = await dbs.listProperties(d.id);
    const options = (props[0]!.config as { options: { value: string; group?: string }[] }).options;
    expect(options.map((o) => o.value)).toEqual(['Not started', 'In progress', 'Done', 'Blocked']);
    const groups = groupRows(await dbs.listRows(d.id), status.id, options.map((o) => o.value));
    expect(groups.map((g) => [g.key, g.rows.length])).toEqual([['Not started', 0], ['In progress', 0], ['Done', 1], ['Blocked', 1]]);
  });

  it('an email that is not one is refused and nothing is stored; files keep names and sources', async () => {
    const d = await dbs.createDatabase({ title: 'People', seedDefaults: false });
    const email = await dbs.addProperty(d.id, 'Email', 'email');
    const files = await dbs.addProperty(d.id, 'Files', 'files');
    const r = await dbs.addRow(d.id, 'Ada', { [email.id]: 'ada@example.com', [files.id]: ['https://example.test/cv.pdf'] });
    await expect(dbs.setCellValue(d.id, r.pageId, email.id, 'nope')).rejects.toThrow(/address/);
    const [row] = await dbs.listRows(d.id);
    expect(row!.values[email.id]).toBe('ada@example.com');
    expect(row!.values[files.id]).toEqual([{ name: 'cv.pdf', src: 'https://example.test/cv.pdf' }]);
  });
});
