// studySubjectsRecord.test.ts — a subject's record kept in canvas databases
// (ext/study/src/27-subjects.js), through the generated main.js against
// SQLite with every migration and a stand-in for the core's door
// (api.canvas.databases) that keeps its databases in memory and counts every
// write Study makes.
//
// What is held here: adopting a database changes none of its rows; the
// database is the record (a row edited there wins over an edit made in
// Study, a row removed is no longer drawn, a row added is); a result is
// written to its row once, a changed verdict corrects it, a hand edit is
// added to; Study's own writes end in a read that writes nothing; one Work
// Log row per session; and nothing is written once Study is off.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const NAMES = [
  '__testables', '_stSubjects', 'stCreateSubject', 'stRemoveSubject', 'stSubjectsShown', 'stSubjectEnqueue', 'stSubjectFlush', 'stSubjectReconcile', 'stSubjectsReset',
  'stSubjectScope', 'stFixedScopeQuestions', 'stCreateSession', 'stAddSessionItems', 'stAnswerItem', 'stUpdateSession', 'stSaveQuestionEdit', 'stListQuestions', 'stSubjectTouched', 'registerSubjects', 'deactivate',
];
const MIGRATIONS = join(__dirname, '../../ext/study/db/migrations');

type Row = { pageId: string; title: string; values: Record<string, unknown> };
type Col = { id: string; name: string; type: string; config: Record<string, unknown> };
type Db = { id: string; title: string; parentPageId: string | null; columns: Col[]; rows: Row[] };

/** The door, in memory: values by column name, a change event after every write, as the canvas's does. */
function fakeDoor() {
  const dbs = new Map<string, Db>();
  const listeners = new Map<string, Set<(e: { kind: string; pageId?: string }) => void>>();
  const writes: string[] = [];
  let n = 0;
  const id = (p: string) => `${p}-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const fire = (dbId: string, kind: string, pageId?: string) => { for (const l of [...(listeners.get(dbId) || [])]) l(pageId ? { kind, pageId } : { kind }); };
  const need = (dbId: string) => { const d = dbs.get(dbId); if (!d) throw new Error(`Database not found: ${dbId}`); return d; };
  const col = (d: Db, name: string) => { const c = d.columns.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!c) throw new Error(`This database has no column named "${name}".`); return c; };
  const TITLE: Col = { id: 'title', name: 'Name', type: 'title', config: {} };
  const options = (spec: any) => (Array.isArray(spec?.config?.options) ? { options: spec.config.options.map((o: any) => (typeof o === 'string' ? { value: o, color: 'gray' } : o)) } : {});
  const door = {
    list: async () => [...dbs.values()].map((d) => ({ id: d.id, title: d.title })),
    get: async (dbId: string) => { const d = dbs.get(dbId); return d ? { id: d.id, title: d.title, pageId: d.id, parentPageId: d.parentPageId, columns: [TITLE, ...d.columns.map((c) => ({ ...c }))] } : null; },
    create: async (o: { title: string; parentPageId?: string; columns?: any[] }) => {
      const d: Db = { id: id('db'), title: o.title, parentPageId: o.parentPageId ?? null, columns: (o.columns || []).map((s) => ({ id: id('col'), name: s.name, type: s.type, config: { ...(s.config || {}), ...options(s) } })), rows: [] };
      dbs.set(d.id, d); writes.push(`create ${o.title}`);
      return door.get(d.id);
    },
    createPage: async (o: { title: string }) => { writes.push(`page ${o.title}`); return { id: id('page') }; },
    ensureColumns: async (dbId: string, specs: any[]) => {
      const d = need(dbId);
      for (const s of specs) if (!d.columns.some((c) => c.name.toLowerCase() === String(s.name).toLowerCase())) { d.columns.push({ id: id('col'), name: s.name, type: s.type, config: { ...(s.config || {}), ...options(s) } }); writes.push(`column ${d.title}.${s.name}`); fire(dbId, 'columns'); }
      return [TITLE, ...d.columns];
    },
    listRows: async (dbId: string) => need(dbId).rows.map((r) => ({ pageId: r.pageId, title: r.title, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))) })),
    addRow: async (dbId: string, row: { title: string; values?: Record<string, unknown> }) => {
      const d = need(dbId); const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.values || {})) values[col(d, k).name] = v;
      const made = { pageId: id('row'), title: row.title, values };
      d.rows.push(made); writes.push(`add ${d.title}: ${row.title}`); fire(dbId, 'rows', made.pageId);
      return { ...made, values: { ...values } };
    },
    updateRow: async (dbId: string, pageId: string, patch: { title?: string; values?: Record<string, unknown> }) => {
      const d = need(dbId); const r = d.rows.find((x) => x.pageId === pageId);
      if (!r) throw new Error('Row not found');
      for (const [k, v] of Object.entries(patch.values || {})) r.values[col(d, k).name] = v;
      if (patch.title !== undefined) r.title = patch.title;
      writes.push(`update ${d.title}: ${r.title} ${JSON.stringify(patch.values || {})}`); fire(dbId, patch.title !== undefined ? 'rows' : 'cells', pageId);
    },
    removeRow: async (dbId: string, pageId: string) => { const d = need(dbId); d.rows = d.rows.filter((r) => r.pageId !== pageId); fire(dbId, 'rows', pageId); },
    onDidChange: (dbId: string, l: (e: { kind: string; pageId?: string }) => void) => { if (!listeners.has(dbId)) listeners.set(dbId, new Set()); listeners.get(dbId)!.add(l); return { dispose: () => listeners.get(dbId)!.delete(l) }; },
    open: async () => {},
  };
  /** What the person does in the table: the same store, the same events, not counted as Study's writes. */
  const person = {
    database: (title: string, columns: { name: string; type: string; options?: string[] }[], rows: { title: string; values: Record<string, unknown> }[]) => {
      const d: Db = { id: id('db'), title, parentPageId: null, columns: columns.map((c) => ({ id: id('col'), name: c.name, type: c.type, config: c.options ? { options: c.options.map((value) => ({ value, color: 'gray' })) } : {} })), rows: rows.map((r) => ({ pageId: id('row'), title: r.title, values: { ...r.values } })) };
      dbs.set(d.id, d);
      return d;
    },
    edit: (d: Db, title: string, patch: { title?: string; values?: Record<string, unknown> }) => { const r = d.rows.find((x) => x.title === title)!; Object.assign(r.values, patch.values || {}); if (patch.title) r.title = patch.title; fire(d.id, patch.title ? 'rows' : 'cells', r.pageId); },
    add: (d: Db, title: string, values: Record<string, unknown>) => { const r = { pageId: id('row'), title, values }; d.rows.push(r); fire(d.id, 'rows', r.pageId); },
    remove: (d: Db, title: string) => { const r = d.rows.find((x) => x.title === title)!; d.rows = d.rows.filter((x) => x !== r); fire(d.id, 'rows', r.pageId); },
    dropColumn: (d: Db, name: string) => { d.columns = d.columns.filter((c) => c.name !== name); for (const r of d.rows) delete r.values[name]; fire(d.id, 'columns'); },
  };
  return { door, dbs, writes, person, byTitle: (t: string) => [...dbs.values()].find((d) => d.title === t)! };
}

type Study = Record<string, any>;
function loadStudy(): Study {
  const src = readFileSync(join(__dirname, '../../ext/study/main.js'), 'utf8').replace(/^export\s+(?=(?:async\s+)?function|const|let)/gm, '');
  return new Function(`'use strict';\n${src}\nreturn { ${NAMES.map((x) => `${x}: typeof ${x} === 'undefined' ? undefined : ${x}`).join(', ')} };`)() as Study;
}

let live: Study | null = null;
function harness() {
  const S = loadStudy();
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) sql.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const wrap = (fn: () => object) => { try { return { error: null, ...fn() }; } catch (e: any) { return { error: { message: e.message } }; } };
  const fake = fakeDoor();
  const api: any = {
    database: {
      get: async (q: string, p: unknown[] = []) => wrap(() => ({ row: sql.prepare(q).get(...(p as any[])) ?? null })),
      all: async (q: string, p: unknown[] = []) => wrap(() => ({ rows: sql.prepare(q).all(...(p as any[])) })),
      run: async (q: string, p: unknown[] = []) => wrap(() => { const r = sql.prepare(q).run(...(p as any[])); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }),
    },
    workspace: { getConfiguration: () => ({ get: (_k: string, f: unknown) => f }), workspaceFolders: [{ uri: 'file:///ws', name: 'ws' }], fs: { readdir: async () => [] } },
    canvas: { databases: fake.door },
  };
  S.__testables.__setApi(api);
  live = S;
  /** Everything a change asked for has been read and written. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) for (const st of [...S._stSubjects.values()]) await S.stSubjectEnqueue(st, () => S.stSubjectFlush(st));
  };
  const one = (q: string, ...p: unknown[]) => sql.prepare(q).get(...(p as any[])) as any;
  const all = (q: string, ...p: unknown[]) => sql.prepare(q).all(...(p as any[])) as any[];
  return { S, sql, api, one, all, settle, ...fake };
}
afterEach(() => { live?.stSubjectsReset(); live = null; });

const BANK_COLUMNS = [
  { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: ['Mack', 'Clark'] },
  { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' }, { name: 'Last Result', type: 'select', options: ['Correct', 'Incorrect'] },
];
const BANK_ROWS = [
  { title: 'Q1 about Mack?', values: { 'Model Answer': 'A1', Paper: 'Mack', 'Times Attempted': 3, 'Times Correct': 2, 'Last Result': 'Correct' } },
  { title: 'Q2 about Mack?', values: { 'Model Answer': 'A2', Paper: 'Mack' } },
  { title: 'Q3 about Clark?', values: { 'Model Answer': 'A3', Paper: 'Clark', 'Times Attempted': 1, 'Last Result': 'Incorrect' } },
];

async function adopted() {
  const h = harness();
  const bank = h.person.database('Conceptual Questions', BANK_COLUMNS, BANK_ROWS);
  const before = JSON.stringify(bank.rows);
  const subject = await h.S.stCreateSubject({ name: 'Exam 7', questionsDb: bank.id });
  await h.settle();
  return { ...h, bank, before, subject };
}
/** A session over the scope with every question of it as an item, in id order. */
async function sessionOver(h: Awaited<ReturnType<typeof adopted>>, unit = '') {
  const scope = h.S.stSubjectScope(h.subject, unit);
  const questions = (await h.S.stFixedScopeQuestions(scope)).filter((q: any) => !q.hidden);
  const session = await h.S.stCreateSession({ name: scope.label, scope, mode: 'practice', answerFormat: 'type', size: 20 });
  const items = await h.S.stAddSessionItems(session.id, 0, questions.map((q: any) => q.id), questions.map(() => 'short'));
  return { session, items, questions };
}

describe('adopting a database he already has', () => {
  it('changes none of his rows, adds only the column it lacks, and gives Units a row per unit with its numbers', async () => {
    const h = await adopted();
    expect(JSON.stringify(h.bank.rows)).toBe(h.before);
    expect(h.bank.columns.map((c) => c.name)).toEqual(['Model Answer', 'Paper', 'Times Attempted', 'Times Correct', 'Last Result', 'Last Answered']);
    expect(h.bank.columns.find((c) => c.name === 'Last Result')!.config).toEqual({ options: [{ value: 'Correct', color: 'gray' }, { value: 'Incorrect', color: 'gray' }] });
    expect(h.byTitle('Units').rows.map((r) => [r.title, r.values.Questions, r.values.Answered, r.values['Right Last Time']])).toEqual([['Mack', 2, 1, 1], ['Clark', 1, 1, 0]]);
    expect(h.S.stSubjectsShown().map((s: any) => [s.name, s.answered, s.total, s.units.map((u: any) => `${u.name} ${u.answered} of ${u.total}`)])).toEqual([['Exam 7', 2, 3, ['Mack 1 of 2', 'Clark 1 of 1']]]);
    expect(h.dbs.size).toBe(3); // his, Units, Work Log: no second Questions
  });

  it('reads again after its own writes and then writes nothing more', async () => {
    const h = await adopted();
    const settled = h.writes.length;
    await h.settle();
    await h.settle();
    expect(h.writes.slice(settled)).toEqual([]);
  });
});

describe('the database is the record', () => {
  it('a row edited in the table is the question, even one edited in Study before', async () => {
    const h = await adopted();
    const q = (await h.S.stListQuestions({ bankIds: [h.subject.bankId] })).find((x: any) => x.stem === 'Q2 about Mack?');
    // An edit made in Study goes to the row, so the two never disagree.
    await h.S.stSaveQuestionEdit(q, { stem: 'Q2, as he put it in Study?', answer: 'A2 from Study' });
    expect(h.bank.rows[1]).toMatchObject({ title: 'Q2, as he put it in Study?', values: { 'Model Answer': 'A2 from Study' } });
    await h.settle();
    h.person.edit(h.bank, 'Q2, as he put it in Study?', { title: 'Q2, as he put it in the table?', values: { 'Model Answer': 'A2 from the table' } });
    await h.settle();
    const now = (await h.S.stListQuestions({ bankIds: [h.subject.bankId] })).find((x: any) => x.id === q.id);
    expect([now.stem, now.answer, now.edited]).toEqual(['Q2, as he put it in the table?', 'A2 from the table', false]);
  });

  it('a row added is drawn, a row removed is not, and a unit holds only its own', async () => {
    const h = await adopted();
    h.person.add(h.bank, 'Q4 about Clark?', { 'Model Answer': 'A4', Paper: 'Clark' });
    h.person.remove(h.bank, 'Q1 about Mack?');
    await h.settle();
    const stems = async (unit: string) => (await h.S.stFixedScopeQuestions(h.S.stSubjectScope(h.subject, unit))).filter((q: any) => !q.hidden).map((q: any) => q.stem).sort();
    expect(await stems('')).toEqual(['Q2 about Mack?', 'Q3 about Clark?', 'Q4 about Clark?']);
    expect(await stems('Mack')).toEqual(['Q2 about Mack?']);
    expect(await stems('Clark')).toEqual(['Q3 about Clark?', 'Q4 about Clark?']);
    expect(h.S.stSubjectsShown()[0].units.map((u: any) => `${u.name} ${u.answered} of ${u.total}`)).toEqual(['Mack 0 of 1', 'Clark 1 of 2']);
  });

  it('a column Study needs that he deleted is back with the next change of rows, not under his hands', async () => {
    const h = await adopted();
    const units = h.byTitle('Units');
    h.person.dropColumn(units, 'Answered');
    h.person.dropColumn(units, 'Weight');
    await h.settle();
    expect(units.columns.map((c) => c.name)).not.toContain('Answered');
    h.person.add(h.bank, 'Q5 about Mack?', { 'Model Answer': 'A5', Paper: 'Mack', 'Times Attempted': 1 });
    await h.settle();
    expect(units.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['Answered', 'Weight']));
    const mack = units.rows.find((r) => r.title === 'Mack')!;
    expect([mack.values.Questions, mack.values.Answered, mack.values.Weight]).toEqual([3, 2, undefined]);
  });
});

describe('results go back to the row', () => {
  it('once: an attempt and the verdict in the database\'s words; a changed verdict corrects it; a hand edit is added to', async () => {
    const h = await adopted();
    const { session, items, questions } = await sessionOver(h, 'Mack');
    const item = items[questions.findIndex((q: any) => q.stem === 'Q2 about Mack?')];
    const row = () => h.bank.rows.find((r) => r.title === 'Q2 about Mack?')!.values;
    await h.S.stAnswerItem(item.id, { status: 'wrong', typed: 'x', verdict: { rating: 1 } });
    await h.S.stSubjectReconcile(session.id);
    expect([row()['Times Attempted'], row()['Times Correct'], row()['Last Result']]).toEqual([1, undefined, 'Incorrect']);
    expect(String(row()['Last Answered'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The same verdict told again writes nothing.
    await h.settle();
    const quiet = h.writes.length;
    await h.S.stSubjectReconcile(session.id);
    await h.settle();
    expect(h.writes.slice(quiet)).toEqual([]);
    // Mark as Right over the grader.
    await h.S.stAnswerItem(item.id, { status: 'right', verdict: { rating: 3, overruled: 'right' } });
    await h.S.stSubjectReconcile(session.id);
    expect([row()['Times Attempted'], row()['Times Correct'], row()['Last Result']]).toEqual([1, 1, 'Correct']);
    // He corrects the count by hand; Mark as Wrong then takes one off what is there.
    h.person.edit(h.bank, 'Q2 about Mack?', { values: { 'Times Attempted': 40, 'Times Correct': 30 } });
    await h.S.stAnswerItem(item.id, { status: 'wrong', verdict: { rating: 1, overruled: 'wrong' } });
    await h.S.stSubjectReconcile(session.id);
    expect([row()['Times Attempted'], row()['Times Correct'], row()['Last Result']]).toEqual([40, 29, 'Incorrect']);
    // No other row of his was touched, and the unit followed.
    expect(h.bank.rows.filter((r) => r.title !== 'Q2 about Mack?').map((r) => r.values)).toEqual([BANK_ROWS[0].values, BANK_ROWS[2].values]);
    const mack = h.byTitle('Units').rows.find((r) => r.title === 'Mack')!;
    expect([mack.values.Questions, mack.values.Answered, mack.values['Right Last Time']]).toEqual([2, 2, 1]);
    expect(String(mack.values['Last Worked'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('one Work Log row per session: made with the first answer, updated after, none with no answer', async () => {
    const h = await adopted();
    const log = () => h.byTitle('Work Log').rows;
    const { session, items } = await sessionOver(h, 'Mack');
    await h.S.stSubjectReconcile(session.id);
    expect(log()).toEqual([]);
    await h.S.stAnswerItem(items[0].id, { status: 'right', verdict: { rating: 3 } });
    await h.S.stUpdateSession(session.id, { seconds: 61 });
    await h.S.stSubjectReconcile(session.id);
    const mackRow = h.byTitle('Units').rows.find((r) => r.title === 'Mack')!.pageId;
    expect(log().map((r) => [r.title, r.values.Minutes, r.values.Unit, r.values.Tool, r.values.Kind, r.values.Items, r.values.Right, r.values.Confirmed, r.values.Origin])).toEqual([['Exam 7 · Mack', 2, [mackRow], 'Study', 'Questions', 1, 1, true, 'App']]);
    // He notes something in the row; the session goes on (the tab closing reports its time).
    h.person.edit(h.byTitle('Work Log'), 'Exam 7 · Mack', { values: { Minutes: 15 } });
    await h.S.stAnswerItem(items[1].id, { status: 'wrong', verdict: { rating: 1 } });
    await h.S.stSubjectReconcile(session.id, { seconds: 61 });
    expect(log().length).toBe(1);
    // Only what changed is written: his minutes stand until the session's own minutes move.
    expect([log()[0].values.Items, log()[0].values.Right, log()[0].values.Minutes]).toEqual([2, 1, 15]);
    await h.S.stSubjectReconcile(session.id, { seconds: 200 });
    expect([log().length, log()[0].values.Minutes]).toEqual([1, 4]);
  });
});

describe('turned off, removed', () => {
  it('Remove Subject forgets it in Study and writes nothing to the databases', async () => {
    const h = await adopted();
    const stored = JSON.stringify([...h.dbs.values()]);
    const writes = h.writes.length;
    await h.S.stRemoveSubject(h.subject.id);
    expect(h.S.stSubjectsShown()).toEqual([]);
    expect(h.one('SELECT COUNT(*) AS n FROM st_subjects').n + h.one("SELECT COUNT(*) AS n FROM st_questions WHERE provider_id LIKE 'subject:%'").n + h.one("SELECT COUNT(*) AS n FROM st_banks WHERE kind = 'subject'").n).toBe(0);
    expect(JSON.stringify([...h.dbs.values()])).toBe(stored);
    expect(h.writes.length).toBe(writes);
    // A change in what was its database is no longer heard.
    h.person.add(h.bank, 'Q9?', { Paper: 'Mack' });
    await h.settle();
    expect(h.writes.length).toBe(writes);
  });

  it('once Study is off a change in a database writes nothing, and on again the subject is back with what changed meanwhile', async () => {
    const h = await adopted();
    const writes = h.writes.length;
    await h.S.deactivate();
    h.person.edit(h.bank, 'Q2 about Mack?', { values: { 'Times Attempted': 2 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.writes.length).toBe(writes);
    expect(h.S.stSubjectsShown()).toEqual([]);
    // On again: the same subject, read from its databases as they are now.
    h.S.__testables.__setApi(h.api);
    h.S.registerSubjects({ subscriptions: [] });
    await vi.waitFor(() => { expect(h.S.stSubjectsShown()[0]?.ready).toBe(true); });
    await h.settle();
    expect(h.S.stSubjectsShown()[0].units.map((u: any) => `${u.name} ${u.answered} of ${u.total}`)).toEqual(['Mack 2 of 2', 'Clark 1 of 1']);
    expect(h.byTitle('Units').rows.find((r) => r.title === 'Mack')!.values.Answered).toBe(2);
  });
});
