// studyWork.test.ts — the Work Log's rows from what the tools report and from
// Study's own reading and discussion clocks (ext/study/src/16-work-model.js,
// 32-work.js), through the generated main.js against SQLite with every
// migration, the stand-in for the core's door, and the core's real work point.
//
// What is held here: a report becomes one row per tool, unit and local day;
// the unit is found as Progress finds it (name, then Also Called; a card's tag
// before its deck); work for no unit is in no row; the row grows; a second
// sync writes nothing; a row he changed or took out is his and no second row
// is made; a row he adds is never touched; a tool turned off leaves its rows
// and carries them on when it is back; reading counts for the unit whose
// Material holds the PDF in front, discussion for the unit a chat was opened
// from; and where the minutes came from is read from the Work Log alone.
// No test depends on today's date, the zone or the machine's speed.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { studyHarness, type Study } from './fixtures/studyDoor';
import { registerWorkProvider, type IWorkEntry } from '../../src/services/workProviders';

const NAMES = [
  '__testables', '_stSubjects', 'stCreateSubject', 'stSubjectEnqueue', 'stSubjectFlush', 'stSubjectsReset', 'stActivation', 'deactivate',
  'stWorkSync', 'stWorkReset', 'stWorkKeep', 'stReadingTargets', 'stReadingLook', 'stChatLook', 'stWorkTieChat', 'stWorkUnitOfQuestion', 'stDiscussUnitPrompt', 'registerWork',
];
let live: Study | null = null;
const registered: { dispose(): void }[] = [];
afterEach(() => { for (const d of registered.splice(0)) d.dispose(); live?.stWorkReset(); live?.stSubjectsReset(); live = null; vi.useRealTimers(); });

const BANK_COLUMNS = [{ name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: ['Mack', 'Clark'] }];
const BANK_ROWS = [{ title: 'Q1 about Mack?', values: { 'Model Answer': 'A1', Paper: 'Mack' } }, { title: 'Q2 about Clark?', values: { 'Model Answer': 'A2', Paper: 'Clark' } }];
const DAY = '2026-03-10';

/** A subject with the units Mack (also called Chain Ladder) and Clark, and a tool's provider whose report the test sets. */
async function setup() {
  const h = studyHarness(NAMES);
  const S = h.S;
  live = S;
  const settle = async () => { for (let i = 0; i < 4; i++) for (const st of [...S._stSubjects.values()]) await S.stSubjectEnqueue(st, () => S.stSubjectFlush(st)); };
  const bank = h.person.database('Conceptual Questions', BANK_COLUMNS, BANK_ROWS);
  const subject = await S.stCreateSubject({ name: 'Exam 7', questionsDb: bank.id });
  await settle();
  const units = h.byTitle('Units');
  const log = h.byTitle('Work Log');
  const mack = units.rows.find((r) => r.title === 'Mack')!;
  const clark = units.rows.find((r) => r.title === 'Clark')!;
  await h.door.updateRow(units.id, mack.pageId, { values: { 'Also Called': 'Chain Ladder' } });
  await settle();
  let report: IWorkEntry[] = [];
  const provider = { id: 'drills.items', displayName: 'Drills', kind: 'Problems', toolId: 'drills', work: () => report, onDidChange: () => ({ dispose() {} }) };
  let reg = registerWorkProvider(provider);
  registered.push({ dispose: () => reg.dispose() });
  const sync = async () => { await S.stWorkSync(S.stActivation()); await settle(); };
  const rowsOf = (): Record<string, any>[] => log.rows.map((r) => ({ title: r.title, ...r.values }));
  return {
    ...h, S, subject, units, log, mack, clark, settle, sync, rowsOf,
    says: (entries: IWorkEntry[]) => { report = entries; },
    off: () => reg.dispose(),
    on: () => { reg = registerWorkProvider(provider); },
  };
}
const entry = (label: string, minutes: number, items = 0, day = DAY, right?: number): IWorkEntry => ({ day, groups: [{ group: label.toLowerCase(), label }], minutes, items, ...(right === undefined ? {} : { right }) });

describe('the pure part', () => {
  const T = studyHarness(['__testables']).S.__testables;
  const units = [{ name: 'Mack', rowId: 'u1', also: 'Chain Ladder' }, { name: 'Clark', rowId: 'u2', also: '' }];

  it('finds the unit as Progress does, and takes the first of a piece of work\'s groups that any unit claims', () => {
    expect(T.stWorkUnitIndex(units, [{ group: 'tag:chain-ladder', label: 'chain-ladder' }])).toBe(0);
    expect(T.stWorkUnitIndex(units, [{ group: 'tag:zeta', label: 'zeta' }, { group: 'deck:1', label: 'CLARK' }])).toBe(1);
    expect(T.stWorkUnitIndex(units, [{ group: 'tag:clark', label: 'clark' }, { group: 'deck:1', label: 'Mack' }])).toBe(1);
    expect(T.stWorkUnitIndex(units, [{ group: 'tag:zeta', label: 'zeta' }])).toBe(-1);
    expect(T.stWorkUnitIndex(units, [])).toBe(-1);
  });
  it('makes one row of a tool, a unit and a day, whole minutes to the nearest, and no row of nothing', () => {
    const source = { id: 'tool:x', tool: 'Drills', kind: 'Problems' };
    const out = T.stWorkWanted(source, [
      { day: DAY, groups: [{ group: 'clark', label: 'Clark' }], minutes: 15, items: 1 }, { day: DAY, groups: [{ group: 'clark', label: 'Clark' }], minutes: 10.4, items: 1 },
      { day: DAY, groups: [{ group: 'h', label: 'Hürlimann' }], minutes: 30, items: 1 }, { day: '2026-03-11', groups: [{ group: 'mack', label: 'Mack' }], minutes: 0.2, items: 0 },
      { day: 'soon', groups: [{ group: 'mack', label: 'Mack' }], minutes: 9, items: 1 },
    ], units);
    expect(out).toEqual([{ key: `tool:x\u0000u2\u0000${DAY}`, source: 'tool:x', tool: 'Drills', kind: 'Problems', unitRow: 'u2', unit: 'Clark', day: DAY, minutes: 25, items: 2, right: null }]);
    expect(T.stWorkWanted(source, [{ day: DAY, groups: [{ group: 'tag:mack', label: 'mack' }], minutes: 0.2, items: 2, right: 1 }], units)[0]).toMatchObject({ minutes: 0, items: 2, right: 1 });
  });
  it('writes the Work Log\'s own cells: the day, the unit\'s row, the tool\'s name and kind, Origin App', () => {
    const [w] = T.stWorkWanted({ id: 'tool:x', tool: 'Drills', kind: 'Problems' }, [{ day: DAY, groups: [{ group: 'mack', label: 'Mack' }], minutes: 7, items: 2 }], units);
    expect(T.stWorkRowValues(w)).toEqual({ title: 'Drills · Mack', values: { Date: `${DAY}T00:00`, Minutes: 7, Unit: ['u1'], Tool: 'Drills', Kind: 'Problems', Items: 2, Right: null, Confirmed: true, Origin: 'App' } });
    expect(Object.keys(T.stWorkRowValues(w).values)).toEqual(T.ST_WORK_CELLS);
  });
  it('brings a row of today down to nothing when its source reports it no more (time taken back for idleness), and only then', () => {
    // Found by the review of piece B: a first reading of the day left on screen grew its row to the idle time; the clock took the stretch back; the row kept it.
    const reading = { id: 'study:reading', tool: 'Study', kind: 'Reading' };
    const drills = { id: 'tool:x', tool: 'Drills', kind: 'Problems' };
    const key = (source: string, unit: string, day: string) => `${source}\u0000${unit}\u0000${day}`;
    const rec = (his = false) => ({ rowId: 'r', written: { Minutes: 10 }, pending: null, his });
    const recs = new Map([
      [key('study:reading', 'u1', DAY), rec()],            // today, reported no more: down to nothing
      [key('study:reading', 'u2', DAY), rec()],            // today, still reported: left to the usual path
      [key('study:reading', 'u1', '2026-03-01'), rec()],   // an older day: left as it was
      [key('tool:x', 'u1', DAY), rec(true)],               // his: never touched
      [key('tool:gone', 'u1', DAY), rec()],                // a tool that cannot say now: its rows stay
      [key('tool:x', 'u9', DAY), rec()],                   // a unit that is no longer there
    ]);
    const stillWanted = T.stWorkWanted(reading, [{ day: DAY, unitRow: 'u2', minutes: 12, items: 0 }], units);
    const gone = T.stWorkGone([reading, drills], recs, stillWanted, units, DAY);
    expect(gone).toEqual([{ key: key('study:reading', 'u1', DAY), source: 'study:reading', tool: 'Study', kind: 'Reading', unitRow: 'u1', unit: 'Mack', day: DAY, minutes: 0, items: 0, right: null }]);
    // What is written for it is a row of no minutes, which differs from the ten it holds, so it is updated.
    const values = T.stWorkRowValues(gone[0]).values;
    expect(values.Minutes).toBe(0);
    expect(T.stWorkDecide(values, rec(), { pageId: 'r', values: { Minutes: 10 } }).act).toBe('update');
    // Once written, it is the same and nothing more is done.
    expect(T.stWorkSame(values, values)).toBe(true);
  });
  it('decides: add what was never written; leave what he changed or took out; update what is as it was written', () => {
    const values = { Minutes: 9, Items: 2 };
    const rec = { rowId: 'r', written: { Minutes: 7, Items: 2 }, pending: null, his: false };
    expect(T.stWorkDecide(values, null, null)).toEqual({ act: 'add' });
    expect(T.stWorkDecide(values, { ...rec, his: true }, { values: { Minutes: 7, Items: 2 } })).toEqual({ act: 'none' });
    expect(T.stWorkDecide({ Minutes: 7, Items: 2 }, rec, { values: { Minutes: 40 } })).toEqual({ act: 'none' });
    expect(T.stWorkDecide(values, rec, null)).toEqual({ act: 'his' });
    expect(T.stWorkDecide(values, rec, { values: { Minutes: 40, Items: 2 } })).toEqual({ act: 'his' });
    expect(T.stWorkDecide(values, rec, { values: { Minutes: 7, Items: 2 } })).toEqual({ act: 'update', values: { Minutes: 9 } });
    // A write cut short between the table and Study's own record: the row already says it, and it is not his.
    expect(T.stWorkDecide(values, { ...rec, pending: { Minutes: 9, Items: 2 } }, { values: { Minutes: 9, Items: 2 } })).toEqual({ act: 'none', settle: true });
  });
  it('says a time with its unit', () => {
    expect([0, 25, 59.6, 60, 65, 120, 125].map(T.stWorkTimeWords)).toEqual(['0 min', '25 min', '1 h', '1 h', '1 h 5 min', '2 h', '2 h 5 min']);
  });
  it('reads where the minutes came from off the Work Log: by kind (else tool), today and Monday to Sunday of today\'s week', () => {
    // 2026-03-11 is a Wednesday: its week is Monday the 9th to Sunday the 15th.
    const row = (date: string, minutes: number, kind: string, tool = '') => ({ values: { Date: date, Minutes: minutes, Kind: kind, Tool: tool } });
    const b = T.stWorkBreakdown([
      row('2026-03-11T10:00', 25, 'Problems', 'Worksheets'), row('2026-03-11', 12, 'Cards'), row('2026-03-10T23:30', 48, 'Cards'), row('2026-03-09T08:00', 30, 'Questions', 'Study'),
      row('2026-03-08T08:00', 500, 'Problems'), row('2026-03-16T08:00', 90, 'Problems'), row('2026-03-12T09:00', 20, '', 'Tutor'), row('2026-03-12T09:00', 5, ''), row('', 9, 'Cards'), row('2026-03-11T09:00', 0, 'Reading'),
    ], '2026-03-11');
    expect(b.rows).toEqual([
      { name: 'Questions', today: 0, week: 30 }, { name: 'Problems', today: 25, week: 25 }, { name: 'Cards', today: 12, week: 60 },
      { name: 'Other', today: 0, week: 5 }, { name: 'Tutor', today: 0, week: 20 },
    ]);
    expect([b.today, b.week, b.monday, b.sunday]).toEqual([37, 140, '2026-03-09', '2026-03-15']);
  });
});

describe('a tool\'s report becomes rows of the Work Log', () => {
  it('one row per tool, unit and day, by name and by Also Called; work for no unit is in no row; a second sync writes nothing', async () => {
    const h = await setup();
    h.says([entry('Clark', 15, 1), entry('Clark', 10, 1), entry('Hürlimann', 30, 1), entry('chain-ladder', 3.2, 1, DAY, 1)]);
    await h.sync();
    expect(h.rowsOf()).toEqual([
      { title: 'Drills · Clark', Date: `${DAY}T00:00`, Minutes: 25, Unit: [h.clark.pageId], Tool: 'Drills', Kind: 'Problems', Items: 2, Right: null, Confirmed: true, Origin: 'App' },
      { title: 'Drills · Mack', Date: `${DAY}T00:00`, Minutes: 3, Unit: [h.mack.pageId], Tool: 'Drills', Kind: 'Problems', Items: 1, Right: 1, Confirmed: true, Origin: 'App' },
    ]);
    // The tool's name is one of the Tool column's options now, beside Study's own.
    expect((h.log.columns.find((c) => c.name === 'Tool')!.config.options as { value: string }[]).map((o) => o.value)).toEqual(['Study', 'Drills']);
    const settled = h.writes.length;
    await h.sync();
    await h.sync();
    expect(h.writes.slice(settled)).toEqual([]);
  });

  it('the row grows with the day\'s work: the same row, only the cells that changed', async () => {
    const h = await setup();
    h.says([entry('Clark', 5, 1)]);
    await h.sync();
    const row = h.log.rows[0].pageId;
    const settled = h.writes.length;
    h.says([entry('Clark', 9.4, 2)]);
    await h.sync();
    expect(h.log.rows.map((r) => [r.pageId, r.values.Minutes, r.values.Items])).toEqual([[row, 9, 2]]);
    expect(h.writes.slice(settled)).toEqual(['update Work Log: Drills · Clark {"Minutes":9,"Items":2}']);
    // It follows the tool down too: a stretch that ended idle was taken back.
    h.says([entry('Clark', 6, 2)]);
    await h.sync();
    expect(h.log.rows[0].values.Minutes).toBe(6);
  });

  it('a row he changed is his: it is not written again, and no second row is made for that tool, unit and day', async () => {
    const h = await setup();
    h.says([entry('Clark', 25, 2)]);
    await h.sync();
    const row = h.log.rows[0].pageId;
    await h.door.updateRow(h.log.id, row, { values: { Minutes: 40 } });
    await h.settle();
    h.says([entry('Clark', 31, 3)]);
    await h.sync();
    h.says([entry('Clark', 55, 4)]);
    await h.sync();
    expect(h.log.rows.map((r) => [r.pageId, r.values.Minutes, r.values.Items])).toEqual([[row, 40, 2]]);
    expect(h.one('SELECT his FROM st_work_rows').his).toBe(1);
    // Even typed back to what Study wrote, it stays his.
    await h.door.updateRow(h.log.id, row, { values: { Minutes: 25 } });
    h.says([entry('Clark', 60, 4)]);
    await h.sync();
    expect(h.log.rows[0].values.Minutes).toBe(25);
  });

  it('a row he adds for the same tool, unit and day is never touched, and Study\'s own row goes on beside it', async () => {
    const h = await setup();
    h.says([entry('Clark', 25, 2)]);
    await h.sync();
    const mine = await h.door.addRow(h.log.id, { title: 'My own count', values: { Date: `${DAY}T20:00`, Minutes: 50, Unit: [h.clark.pageId], Tool: 'Drills', Kind: 'Problems', Origin: 'Manual' } });
    const before = JSON.stringify(h.log.rows.find((r) => r.pageId === mine.pageId));
    h.says([entry('Clark', 30, 3)]);
    await h.sync();
    expect(JSON.stringify(h.log.rows.find((r) => r.pageId === mine.pageId))).toBe(before);
    expect(h.log.rows.map((r) => r.values.Minutes)).toEqual([30, 50]);
  });

  it('a row he took out stays out', async () => {
    const h = await setup();
    h.says([entry('Clark', 25, 2)]);
    await h.sync();
    await h.door.removeRow(h.log.id, h.log.rows[0].pageId);
    await h.settle();
    h.says([entry('Clark', 30, 3)]);
    await h.sync();
    expect(h.log.rows).toEqual([]);
  });

  it('a tool turned off leaves its rows; on again, the same rows carry on with no second copy', async () => {
    const h = await setup();
    h.says([entry('Clark', 25, 2), entry('Clark', 3, 1, '2026-03-11')]);
    await h.sync();
    const ids = h.log.rows.map((r) => r.pageId);
    h.off();
    const settled = h.writes.length;
    await h.sync();
    expect(h.writes.slice(settled)).toEqual([]);
    expect(h.log.rows.map((r) => r.values.Minutes)).toEqual([25, 3]);
    h.on();
    h.says([entry('Clark', 25, 2), entry('Clark', 7, 2, '2026-03-11')]);
    await h.sync();
    expect(h.log.rows.map((r) => [r.pageId, r.values.Minutes])).toEqual([[ids[0], 25], [ids[1], 7]]);
  });

  it('a tool that cannot say now leaves its rows as they are', async () => {
    const h = await setup();
    h.says([entry('Clark', 25, 2)]);
    await h.sync();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.off();
    const broken = registerWorkProvider({ id: 'drills.items', displayName: 'Drills', kind: 'Problems', toolId: 'drills', work: () => { throw new Error('closed'); }, onDidChange: () => ({ dispose() {} }) });
    registered.push(broken);
    await h.sync();
    expect(h.log.rows.map((r) => r.values.Minutes)).toEqual([25]);
    warn.mockRestore();
  });

  it('writes nothing once Study is off', async () => {
    const h = await setup();
    h.says([entry('Clark', 25, 2)]);
    const token = h.S.stActivation();
    await h.S.deactivate();
    const settled = h.writes.length;
    await h.S.stWorkSync(token);
    expect(h.writes.slice(settled)).toEqual([]);
    expect(h.log.rows).toEqual([]);
  });
});

describe('reading and discussion', () => {
  const PDF = '/ws/Readings/Mack 1994.pdf';
  async function withMaterial() {
    const h = await setup();
    await h.door.updateRow(h.units.id, h.mack.pageId, { values: { Material: [{ name: 'Mack 1994.pdf', src: 'parallx-media://workspace/Readings/Mack%201994.pdf' }] } });
    await h.settle();
    const editors: { isShowing: boolean; isActive: boolean; typeId: string; filePath?: string }[] = [];
    h.api.editors = { get openEditors() { return editors; }, onDidChangeOpenEditors: () => ({ dispose() {} }) };
    return { ...h, editors, bucket: `${h.subject.id}|${h.mack.pageId}` };
  }

  it('a PDF in front that a unit\'s Material holds is that unit\'s reading; behind another tab, or of no unit, it is nobody\'s', async () => {
    const h = await withMaterial();
    h.editors.push({ isShowing: true, isActive: true, typeId: 'parallx.editor.pdf', filePath: PDF });
    expect(h.S.stReadingTargets()).toEqual([h.bucket]);
    h.editors[0].isShowing = false;
    expect(h.S.stReadingTargets()).toEqual([]);
    h.editors[0] = { isShowing: true, isActive: true, typeId: 'parallx.editor.pdf', filePath: '/ws/Zehnwirth 1994.pdf' };
    expect(h.S.stReadingTargets()).toEqual([]);
    h.editors[0] = { isShowing: true, isActive: true, typeId: 'text', filePath: PDF };
    expect(h.S.stReadingTargets()).toEqual([]);
  });

  it('the reading clock runs only while such a PDF is in front, and its seconds become a Reading row of the unit', async () => {
    vi.useFakeTimers({ now: new Date(2026, 2, 10, 12, 0, 0).getTime(), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const h = await withMaterial();
    const timers = vi.getTimerCount();
    h.S.stReadingLook(h.S.stActivation());
    expect(vi.getTimerCount()).toBe(timers);
    h.editors.push({ isShowing: true, isActive: true, typeId: 'parallx.editor.pdf', filePath: PDF });
    h.S.stReadingLook(h.S.stActivation());
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    vi.advanceTimersByTime(6 * 60_000);
    // The PDF's tab goes behind another: the clock hands over and stops.
    h.editors[0].isShowing = false;
    h.S.stReadingLook(h.S.stActivation());
    expect(vi.getTimerCount()).toBe(timers);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));
    await h.sync();
    const day = h.api.work.dayOf(new Date(2026, 2, 10, 12, 0, 0).getTime());
    expect(h.rowsOf()).toEqual([{ title: 'Study · Mack', Date: `${day}T00:00`, Minutes: 6, Unit: [h.mack.pageId], Tool: 'Study', Kind: 'Reading', Items: 0, Right: null, Confirmed: true, Origin: 'App' }]);
  });

  it('a chat counts only when it was opened from a unit, and only while it is the one on screen', async () => {
    vi.useFakeTimers({ now: new Date(2026, 2, 10, 12, 0, 0).getTime(), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const h = await setup();
    let shown: { id: string; showing: boolean } | undefined = { id: 'chat-1', showing: true };
    h.api.chat = { shownSession: () => shown, onDidChangeShownSession: () => ({ dispose() {} }) };
    const timers = vi.getTimerCount();
    await h.S.stChatLook(h.S.stActivation());
    expect(vi.getTimerCount()).toBe(timers);                 // any other chat: no clock
    expect(await h.S.stWorkTieChat(h.subject.id, h.clark.pageId)).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    vi.advanceTimersByTime(3 * 60_000);
    shown = { id: 'chat-1', showing: false };                // its panel closed: nothing counts
    vi.advanceTimersByTime(3 * 60_000);
    shown = { id: 'chat-2', showing: true };                 // New Chat: the clock stops
    await h.S.stChatLook(h.S.stActivation());
    // The clock is gone; the one timer left is the sync its last seconds asked for, which runs and leaves none.
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(timers);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 0));
    await h.sync();
    expect(h.rowsOf().map((r) => [r.title, r.Kind, r.Minutes, r.Unit])).toEqual([['Study · Clark', 'Discussion', 3, [h.clark.pageId]]]);
    expect(h.one('SELECT session_id, unit_row FROM st_unit_chats')).toEqual({ session_id: 'chat-1', unit_row: h.clark.pageId });
  });

  it('knows the unit of a subject\'s question, and stages a prompt that names the unit and its material', async () => {
    const h = await setup();
    expect(h.S.stWorkUnitOfQuestion({ providerId: `subject:${h.subject.id}`, providerRef: JSON.stringify({ paper: 'clark' }) })).toEqual({ subjectId: h.subject.id, unitRow: h.clark.pageId });
    expect(h.S.stWorkUnitOfQuestion({ providerId: 'bank:1', providerRef: '{"paper":"Clark"}' })).toBeNull();
    const text = h.S.stDiscussUnitPrompt('Exam 7', 'Clark', ['Clark 2003.pdf']);
    expect(text).toMatch(/^I want to talk through Clark \(Exam 7\)\./);
    expect(text).toMatch(/Clark 2003\.pdf/);
  });
});
