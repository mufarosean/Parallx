// canvasDatabaseRetype.test.ts — Change Type (docs/DATABASES.md): a column's
// values carried to another type, text that repeats becoming a select.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { RETYPE_TYPES, canRetype, changePropertyType, convertValue, retypeConfig, retypeMenuItems } from '../../src/built-in/canvas/database/propertyRetype';
import type { IDatabaseProperty } from '../../src/built-in/canvas/database/databaseTypes';
import { realSqlite } from './realSqlite';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event']) (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];

const prop = (type: IDatabaseProperty['type'], config: Record<string, unknown> = {}): IDatabaseProperty => ({ id: 'p', databaseId: 'd', name: 'P', type, config, sortOrder: 0 });

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

describe('convertValue', () => {
  it('text becomes a select option, a comma list becomes tags, and back', () => {
    expect(convertValue(prop('text'), 'select', ' Seneca ')).toBe('Seneca');
    expect(convertValue(prop('text'), 'tags', 'stoic, roman, stoic')).toEqual(['stoic', 'roman']);
    expect(convertValue(prop('tags'), 'select', ['a', 'b'])).toBe('a');
    expect(convertValue(prop('tags'), 'text', ['a', 'b'])).toBe('a, b');
    expect(convertValue(prop('select'), 'tags', 'a')).toEqual(['a']);
    expect(convertValue(prop('text'), 'select', '')).toBeNull();
  });
  it('numbers, dates, checkboxes and emails convert when they fit, clear when they do not', () => {
    expect(convertValue(prop('text'), 'number', '1,200.5')).toBe(1200.5);
    expect(convertValue(prop('text'), 'number', 'twelve')).toBeNull();
    expect(convertValue(prop('number'), 'text', 42)).toBe('42');
    expect(convertValue(prop('text'), 'date', '2026-11-10')).toBe('2026-11-10');
    expect(convertValue(prop('text'), 'date', 'someday')).toBeNull();
    expect(convertValue(prop('datetime'), 'date', '2026-11-10T09:30')).toBe('2026-11-10');
    expect(convertValue(prop('text'), 'checkbox', 'yes')).toBe(true);
    expect(convertValue(prop('checkbox'), 'text', true)).toBe('Checked');
    expect(convertValue(prop('checkbox'), 'number', true)).toBe(1);
    expect(convertValue(prop('text'), 'email', 'me@example.com')).toBe('me@example.com');
    expect(convertValue(prop('text'), 'email', 'not an address')).toBeNull();
  });
});

describe('retypeConfig', () => {
  it('builds an option per distinct value with cycling colours, keeps old colours, and groups a status', () => {
    const cfg = retypeConfig(prop('text'), 'select', ['Seneca', 'Camus', 'Seneca', null]) as { options: { value: string; color: string }[] };
    expect(cfg.options.map((o) => o.value)).toEqual(['Seneca', 'Camus']);
    expect(cfg.options[0]!.color).not.toBe(cfg.options[1]!.color);
    expect(cfg.options.every((o) => o.color !== 'default')).toBe(true);
    const kept = retypeConfig(prop('select', { options: [{ value: 'Seneca', color: 'purple' }] }), 'tags', [['Seneca'], ['Camus']]) as { options: { value: string; color: string; group?: string }[] };
    expect(kept.options[0]).toEqual({ value: 'Seneca', color: 'purple' });
    const status = retypeConfig(prop('select', { options: [{ value: 'Open', color: 'blue' }] }), 'status', ['Open']) as { options: { value: string; group?: string }[] };
    expect(status.options[0]).toMatchObject({ value: 'Open', group: 'todo' });
    expect(status.options.map((o) => o.value)).toContain('Done');
    expect(retypeConfig(prop('select', { options: [{ value: 'a', color: 'red' }] }), 'number', [1])).toEqual({ format: 'number' });
  });
});

describe('changePropertyType', () => {
  it('turns a repeated text column into a select: options made, cells kept, the view reads them as options', async () => {
    const db = await dbs.createDatabase({ title: 'Quotes', seedDefaults: false });
    const author = await dbs.addProperty(db.id, 'Author', 'text');
    await dbs.addRow(db.id, 'q1', { [author.id]: 'Marcus Aurelius' });
    await dbs.addRow(db.id, 'q2', { [author.id]: 'Seneca' });
    await dbs.addRow(db.id, 'q3', { [author.id]: 'Marcus Aurelius' });
    await dbs.addRow(db.id, 'q4');
    expect(await changePropertyType(dbs, db.id, author, 'select')).toBe(true);
    const after = (await dbs.listProperties(db.id)).find((p) => p.id === author.id)!;
    expect(after.type).toBe('select');
    expect((after.config as { options: { value: string }[] }).options.map((o) => o.value)).toEqual(['Marcus Aurelius', 'Seneca']);
    const rows = await dbs.listRows(db.id);
    expect(rows.map((r) => r.values[author.id] ?? null)).toEqual(['Marcus Aurelius', 'Seneca', 'Marcus Aurelius', null]);
    // A new author typed into the select is added as an option (no prompt change needed for the daily routine).
    await dbs.setCellValue(db.id, rows[3]!.pageId, author.id, 'Epictetus');
    const again = (await dbs.listProperties(db.id)).find((p) => p.id === author.id)!;
    expect((again.config as { options: { value: string }[] }).options.map((o) => o.value)).toContain('Epictetus');
  });

  it('asks before clearing values that do not fit, and keeps the type when refused', async () => {
    const db = await dbs.createDatabase({ title: 'T', seedDefaults: false });
    const p = await dbs.addProperty(db.id, 'Pages', 'text');
    const a = await dbs.addRow(db.id, 'a', { [p.id]: '320' });
    await dbs.addRow(db.id, 'b', { [p.id]: 'many' });
    const asked: number[][] = [];
    expect(await changePropertyType(dbs, db.id, p, 'number', async (lost, total) => { asked.push([lost, total]); return false; })).toBe(false);
    expect(asked).toEqual([[1, 2]]);
    expect((await dbs.listProperties(db.id)).find((x) => x.id === p.id)!.type).toBe('text');
    expect(await changePropertyType(dbs, db.id, p, 'number', async () => true)).toBe(true);
    const rows = await dbs.listRows(db.id);
    expect(rows.find((r) => r.pageId === a.pageId)!.values[p.id]).toBe(320);
    expect(rows.find((r) => r.title === 'b')!.values[p.id] ?? null).toBeNull();
  });

  it('refuses computed and relation columns; the menu offers every plain type with the current one checked', () => {
    expect(canRetype(prop('formula'))).toBe(false);
    expect(canRetype(prop('relation'))).toBe(false);
    expect(canRetype(prop('files'))).toBe(false);
    expect(canRetype(prop('url'))).toBe(true);
    const items = retypeMenuItems(dbs, 'd', prop('select'));
    expect(items.length).toBe(RETYPE_TYPES.length);
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Select']);
    expect(items.every((i) => i.icon)).toBe(true);
  });
});
