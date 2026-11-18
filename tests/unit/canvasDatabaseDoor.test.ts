// canvasDatabaseDoor.test.ts — `api.canvas.databases`, the door any tool has
// to canvas databases, over the real DatabaseDataService and the app's SQL:
// what a tool can make, read and write, what it hears, and the columns a
// tool keeps (the person and the chat cannot write them; the owner can).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { createDatabaseDoor } from '../../src/built-in/canvas/database/databaseDoor';
import { isPersonEditable, keptBy, keptByLabel, setKeeperNames } from '../../src/built-in/canvas/database/keptColumns';
import { changePropertyType } from '../../src/built-in/canvas/database/propertyRetype';
import { createDatabaseTools } from '../../src/built-in/canvas/ai/databaseTools';
import { renderTableView } from '../../src/built-in/canvas/database/tableView';
import { DisposableStore, type IDisposable } from '../../src/platform/lifecycle';
import { createCanvasDatabasesApi, setCanvasDatabasesHost, type CanvasDatabasesApi, type CanvasDatabaseChange } from '../../src/api/bridges/canvasDatabasesBridge';
import { realSqlite } from './realSqlite';
import { installDatabaseCommandStub } from './databaseCommandStub';
// @ts-expect-error — jsdom ships no types here
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTableCellElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'DOMRect', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  (globalThis as any)[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}
installDatabaseCommandStub();

const OWNER = 'acme.tracker';
const OTHER = 'acme.other';

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
let dbs: DatabaseDataService;
let subs: IDisposable[];
let otherSubs: IDisposable[];
let door: CanvasDatabasesApi;
let otherDoor: CanvasDatabasesApi;
let opened: string[];

beforeEach(() => {
  env = realSqlite();
  (window as any).parallxElectron = { database: env.bridge };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
  opened = [];
  setCanvasDatabasesHost(createDatabaseDoor(dbs, pages, async (id) => { opened.push(id); }));
  setKeeperNames((id) => (id === OWNER ? 'Tracker' : undefined));
  subs = []; otherSubs = [];
  door = createCanvasDatabasesApi(OWNER, subs);
  otherDoor = createCanvasDatabasesApi(OTHER, otherSubs);
});
afterEach(() => {
  for (const s of [...subs, ...otherSubs]) s.dispose();
  setCanvasDatabasesHost(null); setKeeperNames(null);
  dbs.dispose(); pages.dispose(); delete (window as any).parallxElectron;
});

const names = (cols: readonly { name: string }[]): string[] => cols.map((c) => c.name);

describe('api.canvas.databases: making and reading', () => {
  it('creates a database with exactly the named columns, the title column first and no Status', async () => {
    const made = await door.create({ title: 'Units', columns: [{ name: 'Order', type: 'number' }, { name: 'Kind', type: 'select', config: { options: ['Short', 'Essay'] } }] });
    expect(made.title).toBe('Units');
    expect(names(made.columns)).toEqual(['Name', 'Order', 'Kind']);
    expect(made.columns[0]!.type).toBe('title');
    expect(names(made.columns)).not.toContain('Status');
    expect((made.columns[2]!.config.options as { value: string }[]).map((o) => o.value)).toEqual(['Short', 'Essay']);
    // The same through get, and in the list.
    expect(await door.get(made.id)).toEqual(made);
    expect(await door.list()).toEqual([{ id: made.id, title: 'Units' }]);
    expect(await door.get('no-such-database')).toBeNull();
  });

  it('a database made with no columns has only its title column', async () => {
    const made = await door.create({ title: 'Bare' });
    expect(names(made.columns)).toEqual(['Name']);
  });

  it('makes a page and puts a database under it', async () => {
    const page = await door.createPage({ title: 'Exam 7' });
    const made = await door.create({ title: 'Units', parentPageId: page.id });
    expect(made.parentPageId).toBe(page.id);
    expect((await pages.getPage(page.id))?.title).toBe('Exam 7');
    expect(dbs.isDatabase(page.id)).toBe(false);
    const child = await door.createPage({ title: 'Notes', parentPageId: page.id });
    expect((await pages.getPage(child.id))?.parentId).toBe(page.id);
  });

  it('ensureColumns adds what is missing by name, whatever the case, and changes nothing that is there', async () => {
    const made = await door.create({ title: 'Log', columns: [{ name: 'Minutes', type: 'number' }, { name: 'Kind', type: 'select', config: { options: ['Reading'] } }] });
    const wanted = [
      { name: 'minutes', type: 'text' },                                       // there already, as a number: left as it is
      { name: 'Kind', type: 'select', config: { options: ['Reading', 'Cards'] } }, // one option missing
      { name: 'Confirmed', type: 'checkbox' },                                 // missing
    ];
    const after = await door.ensureColumns(made.id, wanted);
    expect(names(after)).toEqual(['Name', 'Minutes', 'Kind', 'Confirmed']);
    expect(after.find((c) => c.name === 'Minutes')!.type).toBe('number');
    expect(after.find((c) => c.name === 'Minutes')!.id).toBe(made.columns[1]!.id);
    expect((after.find((c) => c.name === 'Kind')!.config.options as { value: string }[]).map((o) => o.value)).toEqual(['Reading', 'Cards']);
    // A second time changes nothing and tells nobody.
    const heard: CanvasDatabaseChange[] = [];
    door.onDidChange(made.id, (e) => heard.push(e));
    expect(await door.ensureColumns(made.id, wanted)).toEqual(after);
    expect(heard).toEqual([]);
  });

  it('a column type the app does not have is refused by name', async () => {
    await expect(door.create({ title: 'X', columns: [{ name: 'Mood', type: 'emoji' }] })).rejects.toThrow(/Mood.*emoji/);
  });

  it('rows go in and come back with their values under the column names', async () => {
    const units = await door.create({ title: 'Units' });
    const mack = await door.addRow(units.id, { title: 'Mack' });
    const made = await door.create({ title: 'Questions', columns: [
      { name: 'Answer', type: 'text' }, { name: 'Attempts', type: 'number' }, { name: 'Last Result', type: 'select' },
      { name: 'Last Answered', type: 'date' }, { name: 'Confirmed', type: 'checkbox' }, { name: 'Unit', type: 'relation', config: { databaseId: units.id } },
      { name: 'Made', type: 'created_time' }, { name: 'Twice', type: 'formula', config: { expression: 'prop("Attempts") * 2' } },
    ] });
    const row = await door.addRow(made.id, { title: 'What is a tail factor?', values: { Answer: 'Development past the triangle.', attempts: '3', 'Last Result': 'Right', 'Last Answered': '2026-11-18', Confirmed: true, Unit: [mack.pageId] } });
    const read = await door.listRows(made.id);
    expect(read).toHaveLength(1);
    expect(read[0]!.pageId).toBe(row.pageId);
    expect(read[0]!.title).toBe('What is a tail factor?');
    expect(read[0]!.values).toMatchObject({ Answer: 'Development past the triangle.', Attempts: 3, 'Last Result': 'Right', 'Last Answered': '2026-11-18', Confirmed: true, Unit: [mack.pageId], Twice: 6 });
    expect(typeof read[0]!.values.Made).toBe('string');
    // The new option is an option now, as when a person types one.
    expect(((await door.get(made.id))!.columns.find((c) => c.name === 'Last Result')!.config.options as { value: string }[]).map((o) => o.value)).toEqual(['Right']);

    await door.updateRow(made.id, row.pageId, { title: 'What is a tail?', values: { Attempts: 4, 'Last Result': 'Wrong' } });
    const again = (await door.listRows(made.id))[0]!;
    expect(again.title).toBe('What is a tail?');
    expect(again.values).toMatchObject({ Answer: 'Development past the triangle.', Attempts: 4, 'Last Result': 'Wrong', Twice: 8 });

    await door.removeRow(made.id, row.pageId);
    expect(await door.listRows(made.id)).toEqual([]);
  });

  it('a value for a column the database does not have is refused, and nothing is written', async () => {
    const made = await door.create({ title: 'Q', columns: [{ name: 'Attempts', type: 'number' }] });
    await expect(door.addRow(made.id, { title: 'A', values: { Attempts: 1, Atempts: 2 } })).rejects.toThrow(/Atempts/);
    expect(await door.listRows(made.id)).toEqual([]);
    const row = await door.addRow(made.id, { title: 'A', values: { Attempts: 1 } });
    await expect(door.updateRow(made.id, row.pageId, { values: { Attempts: 5, Nope: 1 } })).rejects.toThrow(/Nope/);
    expect((await door.listRows(made.id))[0]!.values.Attempts).toBe(1);
    await expect(door.updateRow(made.id, row.pageId, { values: { Attempts: 'many' } })).rejects.toThrow(/Attempts/);
    await expect(door.updateRow(made.id, 'not-a-row', { values: { Attempts: 2 } })).rejects.toThrow(/not a row/i);
    await expect(door.listRows('no-such-database')).rejects.toThrow(/not found/i);
  });

  it('reads two thousand rows in a few queries, not one per row', async () => {
    const made = await door.create({ title: 'Big', columns: [{ name: 'Attempts', type: 'number' }, { name: 'Answer', type: 'text' }] });
    const [attempts, answer] = [made.columns[1]!.id, made.columns[2]!.id];
    env.db.exec('BEGIN');
    const page = env.db.prepare("INSERT INTO pages (id, parent_id, title, sort_order) VALUES (?, ?, ?, ?)");
    const member = env.db.prepare('INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)');
    const value = env.db.prepare('INSERT INTO page_property_values (page_id, property_id, database_id, value) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 2000; i++) {
      page.run(`row-${i}`, made.id, `Question ${i}`, i);
      member.run(made.id, `row-${i}`, i);
      value.run(`row-${i}`, attempts, made.id, String(i));
      value.run(`row-${i}`, answer, made.id, JSON.stringify(`Answer ${i}`));
    }
    env.db.exec('COMMIT');
    let queries = 0;
    for (const k of ['get', 'all', 'run', 'runTransaction'] as const) {
      const real = env.bridge[k] as (...a: unknown[]) => Promise<unknown>;
      (env.bridge as any)[k] = (...a: unknown[]) => { queries++; return real(...a); };
    }
    const rows = await door.listRows(made.id);
    expect(rows).toHaveLength(2000);
    expect(rows[1999]).toMatchObject({ pageId: 'row-1999', title: 'Question 1999', values: { Attempts: 1999, Answer: 'Answer 1999' } });
    expect(queries).toBeLessThanOrEqual(4);
  });

  it('opens a database the way the app does', async () => {
    const made = await door.create({ title: 'Units' });
    await door.open(made.id);
    expect(opened).toEqual([made.id]);
  });
});

describe('api.canvas.databases: hearing changes', () => {
  it('hears what a person does in the table: a cell, a new row, a rename, a removed row, a column', async () => {
    const made = await door.create({ title: 'Q', columns: [{ name: 'Attempts', type: 'number' }] });
    const col = made.columns[1]!.id;
    const heard: CanvasDatabaseChange[] = [];
    const other: CanvasDatabaseChange[] = [];
    door.onDidChange(made.id, (e) => heard.push(e));
    door.onDidChange((await door.create({ title: 'Elsewhere' })).id, (e) => other.push(e));
    // The engine is what the table, the board and the chat's tools write through.
    const row = await dbs.addRow(made.id, 'A question');
    await dbs.setCellValue(made.id, row.pageId, col, 2);
    await dbs.renameRow(made.id, row.pageId, 'A better question');
    const extra = await dbs.addProperty(made.id, 'Answer', 'text');
    await dbs.deleteProperty(made.id, extra.id);
    await dbs.removeRow(made.id, row.pageId);
    expect(heard).toEqual([
      { kind: 'rows', pageId: row.pageId },
      { kind: 'cells', pageId: row.pageId },
      { kind: 'rows', pageId: row.pageId },
      { kind: 'columns' },
      { kind: 'columns' },
      { kind: 'rows', pageId: row.pageId },
    ]);
    expect(other).toEqual([]);
  });

  it('hears a row retitled from its own page', async () => {
    const made = await door.create({ title: 'Q' });
    const row = await door.addRow(made.id, { title: 'Before' });
    const heard: CanvasDatabaseChange[] = [];
    door.onDidChange(made.id, (e) => heard.push(e));
    await pages.updatePage(row.pageId, { title: 'After' });
    expect(heard).toEqual([{ kind: 'rows', pageId: row.pageId }]);
  });

  it('a database in the Trash says so and lists no rows; its going there and its coming back are heard, and a row\'s too', async () => {
    const made = await door.create({ title: 'Q' });   // no rows: nothing else speaks for it
    const heard: CanvasDatabaseChange[] = [];
    door.onDidChange(made.id, (e) => heard.push(e));
    const turn = () => new Promise((r) => setTimeout(r, 0));
    expect(await door.get(made.id)).not.toHaveProperty('trashed');
    await pages.archivePage(made.id);
    expect(heard).toEqual([{ kind: 'rows' }]);
    expect(await door.get(made.id)).toMatchObject({ id: made.id, title: 'Q', trashed: true });
    expect(await door.list()).toEqual([]);
    heard.length = 0;
    await pages.restorePage(made.id);
    expect(heard).toEqual([{ kind: 'rows' }]);
    expect(await door.get(made.id)).not.toHaveProperty('trashed');
    expect(await door.list()).toEqual([{ id: made.id, title: 'Q' }]);
    // A row sent to the Trash from its own page, and restored.
    const row = await door.addRow(made.id, { title: 'A' });
    heard.length = 0;
    await pages.archivePage(row.pageId); await turn();
    expect(heard).toEqual([{ kind: 'rows', pageId: row.pageId }]);
    expect(await door.listRows(made.id)).toEqual([]);
    heard.length = 0;
    await pages.restorePage(row.pageId); await turn();
    expect(heard).toEqual([{ kind: 'rows', pageId: row.pageId }]);
    expect((await door.listRows(made.id)).map((r) => r.title)).toEqual(['A']);
  });

  it('a database with rows restored from the Trash is heard as itself, so a listener reads its rows again', async () => {
    const made = await door.create({ title: 'Q' });
    await door.addRow(made.id, { title: 'A' });
    await pages.archivePage(made.id);
    await new Promise((r) => setTimeout(r, 0));
    const heard: CanvasDatabaseChange[] = [];
    door.onDidChange(made.id, (e) => heard.push(e));
    await pages.restorePage(made.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(heard).toContainEqual({ kind: 'rows' });
    expect((await door.listRows(made.id)).map((r) => r.title)).toEqual(['A']);
  });

  it('several values in one update are one write and one event', async () => {
    const made = await door.create({ title: 'Q', columns: [{ name: 'Attempts', type: 'number' }, { name: 'Correct', type: 'number' }, { name: 'Last Result', type: 'select', config: { options: ['Right', 'Wrong'] } }, { name: 'Last Answered', type: 'date' }] });
    const row = await door.addRow(made.id, { title: 'A' });
    const heard: CanvasDatabaseChange[] = [];
    door.onDidChange(made.id, (e) => heard.push(e));
    let writes = 0;
    for (const k of ['run', 'runTransaction'] as const) {
      const real = env.bridge[k] as (...a: unknown[]) => Promise<unknown>;
      (env.bridge as any)[k] = (...a: unknown[]) => { writes++; return real(...a); };
    }
    await door.updateRow(made.id, row.pageId, { values: { Attempts: 1, Correct: 1, 'Last Result': 'Right', 'Last Answered': '2026-11-18' } });
    expect(writes).toBe(1);
    expect(heard).toEqual([{ kind: 'cells', pageId: row.pageId }]);
  });

  it('stops hearing when disposed, and when the tool goes off', async () => {
    const made = await door.create({ title: 'Q' });
    const heard: string[] = [];
    const first = door.onDidChange(made.id, () => heard.push('first'));
    door.onDidChange(made.id, () => heard.push('second'));
    first.dispose();
    await dbs.addRow(made.id, 'A');
    expect(heard).toEqual(['second']);
    for (const s of subs.splice(0)) s.dispose();   // what the app does when a tool is turned off
    await dbs.addRow(made.id, 'B');
    expect(heard).toEqual(['second']);
  });
});

describe('a column kept by a tool', () => {
  async function kept() {
    const made = await door.create({ title: 'Units', columns: [{ name: 'Weight', type: 'number' }, { name: 'Answered', type: 'number', config: { computedBy: true } }] });
    const [weight, answered] = [made.columns[1]!, made.columns[2]!];
    const row = await door.addRow(made.id, { title: 'Mack', values: { Weight: 10, Answered: 3 } });
    const prop = async () => (await dbs.listProperties(made.id)).find((p) => p.id === answered.id)!;
    return { made, weight, answered, row, prop };
  }

  it('is stamped with the tool that asked, whatever id it names', async () => {
    const made = await door.create({ title: 'U', columns: [{ name: 'A', type: 'number', config: { computedBy: OTHER } }, { name: 'B', type: 'number' }] });
    expect(made.columns[1]!.config.computedBy).toBe(OWNER);
    expect(made.columns[2]!.config.computedBy).toBeUndefined();
    const after = await otherDoor.ensureColumns(made.id, [{ name: 'A', type: 'number', config: { computedBy: true } }, { name: 'C', type: 'date', config: { computedBy: OWNER } }]);
    expect(after.find((c) => c.name === 'A')!.config.computedBy).toBe(OWNER);   // there already: not taken over
    expect(after.find((c) => c.name === 'C')!.config.computedBy).toBe(OTHER);
  });

  it('is written by its tool through the door', async () => {
    const { made, row } = await kept();
    expect((await door.listRows(made.id))[0]!.values).toMatchObject({ Weight: 10, Answered: 3 });
    await door.updateRow(made.id, row.pageId, { values: { Answered: 4 } });
    expect((await door.listRows(made.id))[0]!.values.Answered).toBe(4);
  });

  it('is not written by the person, by another tool or by the chat, and each is told who keeps it', async () => {
    const { made, answered, weight, row } = await kept();
    // The person: every view and the row's own page store a cell through this call.
    await expect(dbs.setCellValue(made.id, row.pageId, answered.id, 99)).rejects.toThrow(/Answered.*kept by Tracker/i);
    await dbs.setCellValue(made.id, row.pageId, weight.id, 12);
    // Another tool.
    await expect(otherDoor.updateRow(made.id, row.pageId, { values: { Answered: 99 } })).rejects.toThrow(/kept by Tracker/i);
    await expect(otherDoor.addRow(made.id, { title: 'Sneak', values: { Answered: 99 } })).rejects.toThrow(/kept by Tracker/i);
    // The chat's tools.
    const add = createDatabaseTools(dbs).find((t) => t.name === 'canvas_add_database_row')!;
    const said = await add.handler({ databaseId: made.id, title: 'From chat', values: { Weight: 5, Answered: 99 } }, { isCancellationRequested: false } as never);
    expect(said.content).toMatch(/Values not set:.*Answered.*kept by Tracker/i);
    const rows = await door.listRows(made.id);
    expect(rows.map((r) => [r.title, r.values.Weight, r.values.Answered ?? null])).toEqual([['Mack', 12, 3], ['From chat', 5, null]]);
  });

  it('a new row a person adds does not start with a kept value', async () => {
    const { made, answered, weight } = await kept();
    // A view filtered on the kept column seeds the new row with it; a template copies its cells.
    const row = await dbs.addRow(made.id, 'New', { [answered.id]: 3, [weight.id]: 2 });
    expect(row.values).toEqual({ [weight.id]: 2 });
    expect((await door.listRows(made.id)).find((r) => r.title === 'New')!.values).toEqual({ Weight: 2 });
  });

  it('keeps its type and its keeper against the person, and can still be deleted', async () => {
    const { made, prop } = await kept();
    expect(await changePropertyType(dbs, made.id, await prop(), 'text', async () => true)).toBe(false);
    await expect(dbs.updateProperty(made.id, (await prop()).id, { type: 'text' })).rejects.toThrow(/kept by Tracker/i);
    await dbs.updateProperty(made.id, (await prop()).id, { name: 'Done', config: { format: 'percent' } });
    expect(await prop()).toMatchObject({ name: 'Done', type: 'number', config: { format: 'percent', computedBy: OWNER } });
    await dbs.deleteProperty(made.id, (await prop()).id);
    expect(await prop()).toBeUndefined();
    // Its tool puts it back.
    const back = await door.ensureColumns(made.id, [{ name: 'Answered', type: 'number', config: { computedBy: true } }]);
    expect(back.find((c) => c.name === 'Answered')!.config.computedBy).toBe(OWNER);
  });

  it('says who keeps it, by the tool\'s name; a tool the app does not know is one that is off', async () => {
    const { prop } = await kept();
    const p = await prop();
    expect(keptBy(p)).toBe(OWNER);
    expect(isPersonEditable(p)).toBe(false);
    expect(keptByLabel(p)).toBe('Kept by Tracker');
    setKeeperNames(() => undefined);
    expect(keptByLabel(p)).toBe('Kept by a tool that is off');
    expect(isPersonEditable(p)).toBe(false);
    expect(isPersonEditable({ type: 'number', config: {} })).toBe(true);
    expect(isPersonEditable({ type: 'formula', config: {} })).toBe(false);
    expect(keptByLabel({ config: {} })).toBeNull();
  });

  it('in the table its cell opens no editor and says who keeps it; the column beside it still edits', async () => {
    const { made, row } = await kept();
    const body = document.createElement('div'); document.body.appendChild(body);
    const props = await dbs.listProperties(made.id);
    const rows = await dbs.listRows(made.id);
    const view = (await dbs.listViews(made.id))[0]!;
    let editors = 0;
    const store = new DisposableStore();
    renderTableView(body, { view, props, rows }, {
      setCell: async () => {}, renameRow: async () => {}, openRow: () => {}, addRow: async () => {}, updateView: async () => {},
      openHeaderMenu: () => {}, openAddProperty: () => {}, openRowMenu: () => {}, openCalcMenu: () => {},
      editorFor: () => { editors++; return document.createElement('input'); }, rowIcon: () => null,
    }, store);
    const cells = [...body.querySelectorAll<HTMLElement>('tr.canvas-db-row td[role="gridcell"]')];
    const [, weightTd, answeredTd] = cells;
    expect(row.title).toBe('Mack');
    expect(answeredTd!.dataset.editable).toBeUndefined();
    answeredTd!.querySelector<HTMLElement>('.canvas-db-cell__value')!.click();
    expect(editors).toBe(0);
    const says = [answeredTd!, ...answeredTd!.querySelectorAll('*')].flatMap((n) => [n.getAttribute('title'), n.getAttribute('aria-description')]).filter(Boolean).join(' | ');
    expect(says).toMatch(/Kept by Tracker/);
    expect(weightTd!.dataset.editable).toBe('true');
    weightTd!.querySelector<HTMLElement>('.canvas-db-cell__value')!.click();
    expect(editors).toBe(1);
    store.dispose(); body.remove();
  });

  it('in the table Enter on a kept cell, or a tap on it, shows who keeps it; Escape takes the words away', async () => {
    const { made } = await kept();
    const body = document.createElement('div'); document.body.appendChild(body);
    const store = new DisposableStore();
    renderTableView(body, { view: (await dbs.listViews(made.id))[0]!, props: await dbs.listProperties(made.id), rows: await dbs.listRows(made.id) }, {
      setCell: async () => {}, renameRow: async () => {}, openRow: () => {}, addRow: async () => {}, updateView: async () => {},
      openHeaderMenu: () => {}, openAddProperty: () => {}, openRowMenu: () => {}, openCalcMenu: () => {},
      editorFor: () => document.createElement('input'), rowIcon: () => null,
    }, store);
    const [, weightTd, answeredTd] = [...body.querySelectorAll<HTMLElement>('tr.canvas-db-row td[role="gridcell"]')];
    const shown = (): string => [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((t) => t.style.display !== 'none').map((t) => t.textContent).join('|');
    const press = (on: HTMLElement, key: string): boolean => on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(shown()).toBe('');
    // The keyboard: the cell has the focus, Enter is the key that would edit another cell.
    answeredTd!.focus();
    press(answeredTd!, 'Enter');
    expect(shown()).toBe('Kept by Tracker');
    press(answeredTd!, 'Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe('');
    // A finger: a tap is a click with no hover before it.
    answeredTd!.querySelector<HTMLElement>('.canvas-db-cell__value')!.click();
    expect(shown()).toBe('Kept by Tracker');
    // A press elsewhere takes it away; a cell he can edit says nothing of the kind.
    document.body.dispatchEvent(new (window as any).Event('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe('');
    weightTd!.focus();
    press(weightTd!, 'Enter');
    expect(shown()).toBe('');
    store.dispose(); body.remove();
  });

  it('a kept checkbox is shown, not a button to press', async () => {
    const made = await door.create({ title: 'Log', columns: [{ name: 'Confirmed', type: 'checkbox', config: { computedBy: true } }, { name: 'Mine', type: 'checkbox' }] });
    await door.addRow(made.id, { title: 'A', values: { Confirmed: true } });
    const body = document.createElement('div'); document.body.appendChild(body);
    const store = new DisposableStore();
    renderTableView(body, { view: (await dbs.listViews(made.id))[0]!, props: await dbs.listProperties(made.id), rows: await dbs.listRows(made.id) }, {
      setCell: async () => {}, renameRow: async () => {}, openRow: () => {}, addRow: async () => {}, updateView: async () => {},
      openHeaderMenu: () => {}, openAddProperty: () => {}, openRowMenu: () => {}, openCalcMenu: () => {},
      editorFor: () => document.createElement('input'), rowIcon: () => null,
    }, store);
    const [, keptTd, mineTd] = [...body.querySelectorAll<HTMLElement>('tr.canvas-db-row td[role="gridcell"]')];
    expect(keptTd!.querySelector('button')).toBeNull();
    expect(keptTd!.querySelector('[aria-label="Checked"]')).not.toBeNull();
    expect(mineTd!.querySelector('button')).not.toBeNull();
    store.dispose(); body.remove();
  });
});

describe('api.canvas.databases with the canvas away', () => {
  it('every call fails with one clear sentence, and asking for the door or listening throws nothing', async () => {
    setCanvasDatabasesHost(null);
    const mine: IDisposable[] = [];
    const away = createCanvasDatabasesApi(OWNER, mine);
    const heard: CanvasDatabaseChange[] = [];
    const sub = away.onDidChange('some-id', (e) => heard.push(e));
    for (const call of [
      () => away.list(), () => away.get('x'), () => away.create({ title: 'X' }), () => away.createPage({ title: 'X' }),
      () => away.ensureColumns('x', []), () => away.listRows('x'), () => away.addRow('x', { title: 'A' }),
      () => away.updateRow('x', 'p', { title: 'B' }), () => away.removeRow('x', 'p'), () => away.open('x'),
    ]) {
      await expect(call()).rejects.toThrow('Canvas databases are not available');
    }
    // The canvas arrives later: a listener set before it hears from then on.
    setCanvasDatabasesHost(createDatabaseDoor(dbs, pages, async () => {}));
    const made = await away.create({ title: 'Late' });
    const late: CanvasDatabaseChange[] = [];
    away.onDidChange(made.id, (e) => late.push(e));
    await dbs.addRow(made.id, 'A');
    expect(late).toHaveLength(1);
    sub.dispose();
    for (const s of mine) s.dispose();
  });
});
