// studySubjectsRecord.test.ts — a subject's record kept in canvas databases
// (ext/study/src/27-subjects.js), through the generated main.js against
// SQLite with every migration and a stand-in for the core's door
// (api.canvas.databases) that keeps its databases in memory and counts every
// write Study makes (tests/unit/fixtures/studyDoor.ts).
//
// What is held here: adopting a database changes none of its rows; the
// database is the record (a row edited there wins over an edit made in
// Study, a row removed is no longer drawn, a row added is); a result is
// written to its row once, a changed verdict corrects it, a hand edit is
// added to; Study's own writes end in a read that writes nothing; one Work
// Log row per session; and nothing is written once Study is off.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { studyHarness, type Study } from './fixtures/studyDoor';

const NAMES = [
  '__testables', '_stSubjects', 'stCreateSubject', 'stRemoveSubject', 'stSubjectsShown', 'stSubjectEnqueue', 'stSubjectFlush', 'stSubjectReconcile', 'stSubjectsReset',
  'stSubjectScope', 'stFixedScopeQuestions', 'stCreateSession', 'stAddSessionItems', 'stAnswerItem', 'stUpdateSession', 'stSaveQuestionEdit', 'stListQuestions', 'stSubjectTouched', 'registerSubjects', 'deactivate', 'stSubjectDatabasesOffered',
];
let live: Study | null = null;
function harness() {
  const h = studyHarness(NAMES);
  const S = h.S;
  live = S;
  /** Everything a change asked for has been read and written. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) for (const st of [...S._stSubjects.values()]) await S.stSubjectEnqueue(st, () => S.stSubjectFlush(st));
  };
  return { ...h, settle };
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
    // A first answer that is not right: none correct is written as 0, not left empty.
    expect([row()['Times Attempted'], row()['Times Correct'], row()['Last Result']]).toEqual([1, 0, 'Incorrect']);
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

/** Study off and on again, as a restart: the subjects are loaded and what was left unwritten is written. */
async function restart(h: Awaited<ReturnType<typeof adopted>>) {
  await h.S.deactivate();
  return async () => {
    h.S.__testables.__setApi(h.api);
    h.S.registerSubjects({ subscriptions: [] });
    await vi.waitFor(() => { expect(h.S.stSubjectsShown()[0]?.ready).toBe(true); });
    await h.settle();
  };
}
const MARKED = { kind: 'marked', materialIds: [], label: 'Marked questions' };
const shownUnits = (h: { S: Study }, i = 0) => h.S.stSubjectsShown()[i].units.map((u: any) => `${u.name} ${u.answered} of ${u.total}`);

describe('a result finds its row whatever the session was drawn from', () => {
  it('a subject\'s question answered in a session over the marked set is written to its row, and logged in its subject', async () => {
    const h = await adopted();
    const q = (await h.S.stListQuestions({ bankIds: [h.subject.bankId] })).find((x: any) => x.stem === 'Q2 about Mack?');
    const session = await h.S.stCreateSession({ name: 'Marked questions', scope: MARKED, mode: 'practice', answerFormat: 'type', size: 20 });
    const items = await h.S.stAddSessionItems(session.id, 0, [q.id], ['short']);
    await h.S.stAnswerItem(items[0].id, { status: 'right', typed: 'x', verdict: { rating: 3 } });
    await h.S.stSubjectReconcile(session.id);
    const row = h.bank.rows.find((r) => r.title === 'Q2 about Mack?')!.values;
    expect([row['Times Attempted'], row['Times Correct'], row['Last Result']]).toEqual([1, 1, 'Correct']);
    expect(h.byTitle('Work Log').rows.map((r) => [r.title, r.values.Items, r.values.Right])).toEqual([['Marked questions', 1, 1]]);
    expect(h.byTitle('Units').rows.find((r) => r.title === 'Mack')!.values.Answered).toBe(2);
  });

  it('a session over two subjects writes to each, and each Work Log has one row counting only its own', async () => {
    const h = await adopted();
    const other = h.person.database('GLM Questions', BANK_COLUMNS, [{ title: 'G1?', values: { 'Model Answer': 'B1', Paper: 'Clark' } }, { title: 'G2?', values: { 'Model Answer': 'B2', Paper: 'Clark' } }]);
    const second = await h.S.stCreateSubject({ name: 'GLMs', questionsDb: other.id });
    await h.settle();
    const pick = async (bankId: number, stem: string) => (await h.S.stListQuestions({ bankIds: [bankId] })).find((x: any) => x.stem === stem);
    const qs = [await pick(h.subject.bankId, 'Q2 about Mack?'), await pick(second.bankId, 'G1?'), await pick(second.bankId, 'G2?')];
    const session = await h.S.stCreateSession({ name: 'Marked questions', scope: MARKED, mode: 'practice', answerFormat: 'type', size: 20 });
    const items = await h.S.stAddSessionItems(session.id, 0, qs.map((q: any) => q.id), qs.map(() => 'short'));
    await h.S.stAnswerItem(items[0].id, { status: 'wrong', typed: 'x', verdict: { rating: 1 } });
    await h.S.stAnswerItem(items[1].id, { status: 'right', typed: 'x', verdict: { rating: 3 } });
    await h.S.stAnswerItem(items[2].id, { status: 'right', typed: 'x', verdict: { rating: 3 } });
    await h.S.stSubjectReconcile(session.id);
    await h.S.stSubjectReconcile(session.id);
    const log = (id: string) => h.dbs.get(id)!.rows.map((r) => [r.values.Items, r.values.Right]);
    expect(log(h.subject.logDb)).toEqual([[1, 0]]);
    expect(log(second.logDb)).toEqual([[2, 2]]);
    expect(other.rows.map((r) => r.values['Times Attempted'])).toEqual([1, 1]);
    expect(h.all('SELECT session_id, subject_id FROM st_subject_logs ORDER BY subject_id').map((r) => [r.session_id, r.subject_id])).toEqual([[session.id, h.subject.id], [session.id, second.id]]);
  });

  it('a session finished before its results were written is written at the next start, once', async () => {
    const h = await adopted();
    const { session, items, questions } = await sessionOver(h, 'Mack');
    await h.S.stAnswerItem(items[questions.findIndex((q: any) => q.stem === 'Q2 about Mack?')].id, { status: 'right', typed: 'x', verdict: { rating: 3 } });
    await h.S.stUpdateSession(session.id, { finishedAt: Date.now(), seconds: 90 });
    const row = () => h.bank.rows.find((r) => r.title === 'Q2 about Mack?')!.values;
    const on = await restart(h);
    await on();
    await vi.waitFor(() => { expect(h.byTitle('Work Log').rows.length).toBe(1); });
    expect([row()['Times Attempted'], row()['Times Correct'], row()['Last Result']]).toEqual([1, 1, 'Correct']);
    // The next start finds its mark and writes nothing.
    await h.settle();
    const writes = h.writes.length;
    await (await restart(h))();
    await new Promise((r) => setTimeout(r, 30));
    await h.settle();
    expect(h.writes.slice(writes)).toEqual([]);
    expect(row()['Times Attempted']).toBe(1);
  });
});

describe('units, as the tables name them', () => {
  it('a unit renamed in Units is renamed in the questions that name it in words; the old name does not come back as a second unit', async () => {
    const h = await adopted();
    const units = h.byTitle('Units');
    h.person.edit(units, 'Mack', { title: 'Mack (1993)' });
    await h.settle();
    expect(units.rows.map((r) => r.title)).toEqual(['Mack (1993)', 'Clark']);
    expect(h.bank.rows.map((r) => r.values.Paper)).toEqual(['Mack (1993)', 'Mack (1993)', 'Clark']);
    // A select takes only a word it has.
    expect((h.bank.columns.find((c) => c.name === 'Paper')!.config.options as { value: string }[]).map((o) => o.value)).toContain('Mack (1993)');
    expect(shownUnits(h)).toEqual(['Mack (1993) 1 of 2', 'Clark 1 of 1']);
    expect(units.rows[0].values).toMatchObject({ Questions: 2, Answered: 1 });
    // And then nothing more is written.
    const quiet = h.writes.length;
    await h.settle();
    expect(h.writes.slice(quiet)).toEqual([]);
  });

  it('a Unit pointing at a Units row that is gone names no unit, not one called by a page id', async () => {
    const h = harness();
    const subject = await h.S.stCreateSubject({ name: 'GLMs' });
    await h.settle();
    const units = h.dbs.get(subject.unitsDb)!, questions = h.dbs.get(subject.questionsDb)!;
    h.person.add(units, 'Chapter 1', {});
    const unitId = units.rows[0].pageId;
    h.person.add(questions, 'What is a link?', { Answer: 'g(mu)', Unit: [unitId] });
    await h.settle();
    expect(shownUnits(h)).toEqual(['Chapter 1 0 of 1']);
    h.person.remove(units, 'Chapter 1');
    await h.settle();
    expect(units.rows.map((r) => r.title)).toEqual([]);
    expect(h.S.stSubjectsShown()[0]).toMatchObject({ total: 1, units: [] });
  });

  it('a Unit column of his that is a relation to another database names units by that database\'s rows', async () => {
    const h = harness();
    const topics = h.person.database('Topics', [], [{ title: 'Reserving', values: {} }, { title: 'Pricing', values: {} }]);
    const bank = h.person.database('Bank', [{ name: 'Model Answer', type: 'text' }, { name: 'Topic', type: 'relation' }], [
      { title: 'R1?', values: { 'Model Answer': 'a', Topic: [topics.rows[0].pageId] } },
      { title: 'P1?', values: { 'Model Answer': 'b', Topic: [topics.rows[1].pageId] } },
      { title: 'Lost?', values: { 'Model Answer': 'c', Topic: ['row-0000-4000-8000-00000000dead'] } },
    ]);
    bank.columns.find((c) => c.name === 'Topic')!.config = { databaseId: topics.id };
    await h.S.stCreateSubject({ name: 'Exam', questionsDb: bank.id, mapping: { answer: 'Model Answer', unit: 'Topic', attempts: '', correct: '', lastResult: '', lastAnswered: '' } });
    await h.settle();
    expect(h.byTitle('Units').rows.map((r) => [r.title, r.values.Questions])).toEqual([['Reserving', 1], ['Pricing', 1]]);
    expect(h.S.stSubjectsShown()[0].total).toBe(3);
  });

  it('a mapped column renamed while Study was off is followed by its id, not given an empty twin under the old name', async () => {
    const h = await adopted();
    const on = await restart(h);
    h.person.renameColumn(h.bank, 'Times Attempted', 'Tries');
    await on();
    expect(h.bank.columns.map((c) => c.name)).toEqual(['Model Answer', 'Paper', 'Tries', 'Times Correct', 'Last Result', 'Last Answered']);
    expect(JSON.parse(h.one('SELECT mapping_json FROM st_subjects').mapping_json).attempts.name).toBe('Tries');
    expect(shownUnits(h)).toEqual(['Mack 1 of 2', 'Clark 1 of 1']);
  });
});

describe('the Trash is not the end of a database', () => {
  it('with its questions in the Trash the subject says so, writes nothing and puts no question aside; restored, it is as it was', async () => {
    const h = await adopted();
    const writes = h.writes.length;
    const unitsBefore = JSON.stringify(h.byTitle('Units').rows);
    h.person.trash(h.bank);
    await h.settle();
    expect(h.S.stSubjectsShown()[0]).toMatchObject({ problem: 'Its questions database is in the Trash.', problemTag: 'in the Trash' });
    expect(h.writes.slice(writes)).toEqual([]);
    expect(JSON.stringify(h.byTitle('Units').rows)).toBe(unitsBefore);
    expect(h.all("SELECT provider_id, hidden FROM st_questions").map((q) => [q.provider_id, q.hidden])).toEqual([1, 2, 3].map(() => [`subject:${h.subject.id}`, 0]));
    h.person.restore(h.bank);
    await h.settle();
    expect(h.S.stSubjectsShown()[0]).toMatchObject({ problem: '', answered: 2, total: 3 });
    expect(shownUnits(h)).toEqual(['Mack 1 of 2', 'Clark 1 of 1']);
    expect(h.writes.slice(writes)).toEqual([]);
  });

  it('an answer given while the questions are in the Trash is written to its row when they are restored', async () => {
    const h = await adopted();
    const { session, items, questions } = await sessionOver(h, 'Mack');
    const writes = h.writes.length;
    h.person.trash(h.bank);
    await h.settle();
    await h.S.stAnswerItem(items[questions.findIndex((q: any) => q.stem === 'Q2 about Mack?')].id, { status: 'right', typed: 'x', verdict: { rating: 3 } });
    await h.S.stSubjectReconcile(session.id);
    expect(h.writes.slice(writes)).toEqual([]);
    h.person.restore(h.bank);
    await h.settle();
    await vi.waitFor(() => { expect(h.bank.rows.find((r) => r.title === 'Q2 about Mack?')!.values['Times Attempted']).toBe(1); });
  });

  it('Units or the Work Log in the Trash is said too, and nothing is written meanwhile', async () => {
    const h = await adopted();
    const writes = h.writes.length;
    h.person.trash(h.byTitle('Work Log'));
    await h.settle();
    expect(h.S.stSubjectsShown()[0].problem).toBe('Its Work Log is in the Trash.');
    h.person.restore(h.byTitle('Work Log'));
    h.person.trash(h.byTitle('Units'));
    await h.settle();
    expect(h.S.stSubjectsShown()[0].problem).toBe('Its Units database is in the Trash.');
    h.person.edit(h.bank, 'Q2 about Mack?', { values: { 'Times Attempted': 4 } });
    await h.settle();
    expect(h.writes.slice(writes)).toEqual([]);
  });

  it('a row that comes back is the question it was (its mark, its id), not a new one beside a hidden copy', async () => {
    const h = await adopted();
    h.sql.exec("UPDATE st_questions SET marked = 1 WHERE stem = 'Q1 about Mack?'");
    const was = h.one("SELECT id FROM st_questions WHERE stem = 'Q1 about Mack?'").id;
    const row = h.bank.rows.find((r) => r.title === 'Q1 about Mack?')!;
    h.person.remove(h.bank, 'Q1 about Mack?');
    await h.settle();
    expect(h.one('SELECT provider_id, hidden FROM st_questions WHERE id = ?', was)).toMatchObject({ provider_id: `subject:${h.subject.id}:gone`, hidden: 1 });
    h.person.putBack(h.bank, row);
    await h.settle();
    expect(h.all("SELECT id, provider_id, hidden, marked, bank_id FROM st_questions WHERE stem = 'Q1 about Mack?'").map((q) => ({ ...q }))).toEqual([{ id: was, provider_id: `subject:${h.subject.id}`, hidden: 0, marked: 1, bank_id: h.subject.bankId }]);
    expect(h.one('SELECT count FROM st_banks WHERE id = ?', h.subject.bankId).count).toBe(3);
  });
});

describe('New Subject\'s choice of databases', () => {
  it('leaves out the Units, Questions and Work Log of every subject there is, even before the subjects are loaded', async () => {
    const h = await adopted();
    h.person.database('Reading Notes', [], []);
    expect((await h.S.stSubjectDatabasesOffered()).map((d: any) => d.title)).toEqual(['Reading Notes']);
    h.S.stSubjectsReset(); // as at a start, before the subjects are read from Study's store
    expect((await h.S.stSubjectDatabasesOffered()).map((d: any) => d.title)).toEqual(['Reading Notes']);
  });
});
