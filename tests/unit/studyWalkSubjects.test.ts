// studyWalkSubjects.test.ts — New Subject with a sources folder and a question
// bank, and Remove Unit (ext/study/src/27-subjects.js), after the student
// walk-through (2026-11-23): through the generated main.js against SQLite with
// every migration and the in-memory door of tests/unit/fixtures/studyDoor.ts.
//
// What is held here: one unit per paper (a file joins the bank's unit whose
// name it holds: in its Material, its name in Also Called; any other file is
// its own unit and holds its file), and none made twice by the read that
// follows; Remove Unit puts the row in the Trash, leaves the questions and
// every other unit, and the questions that still name it do not make it
// again, until a row of its name is back in Units.

import { describe, it, expect, afterEach } from 'vitest';
import { studyHarness, type Study } from './fixtures/studyDoor';

const NAMES = ['__testables', '_stSubjects', 'stCreateSubject', 'stRemoveUnit', 'stSubjectsShown', 'stSubjectEnqueue', 'stSubjectFlush', 'stSubjectsReset', 'registerSubjects'];
let live: Study | null = null;
afterEach(() => { live?.stSubjectsReset(); live = null; });

const FILES = ['Mack 1994 - Measuring the Variability.pdf', 'Clark 2003 - LDF Curve Fitting.pdf', 'Brosius 1993 - Loss Development.pdf', 'Mackenzie 2001 - Notes.pdf'];
const BANK_COLUMNS = [{ name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: ['Mack', 'Clark', 'Friedland'] }];
const BANK_ROWS = [
  { title: 'Q1 about Mack?', values: { 'Model Answer': 'A1', Paper: 'Mack' } }, { title: 'Q2 about Mack?', values: { 'Model Answer': 'A2', Paper: 'Mack' } },
  { title: 'Q3 about Clark?', values: { 'Model Answer': 'A3', Paper: 'Clark' } }, { title: 'Q4 about Friedland?', values: { 'Model Answer': 'A4', Paper: 'Friedland' } },
];

async function made({ folder = 'Readings', bank = true } = {}) {
  const h = studyHarness(NAMES);
  live = h.S;
  h.api.workspace.fs.readdir = async (uri: any) => (/Readings$/.test(String(uri && (uri.fsPath || uri.path || uri))) ? FILES.map((name) => ({ name, type: 1 })) : []);
  const settle = async () => { for (let i = 0; i < 4; i++) for (const st of [...h.S._stSubjects.values()]) await h.S.stSubjectEnqueue(st, () => h.S.stSubjectFlush(st)); };
  const db = bank ? h.person.database('Conceptual Questions', BANK_COLUMNS, BANK_ROWS) : null;
  const subject = await h.S.stCreateSubject({ name: 'Exam 7', folder, ...(db ? { questionsDb: db.id } : {}) });
  await settle();
  const units = () => h.byTitle('Units');
  const unit = (name: string) => units().rows.find((r) => r.title === name)!;
  return { ...h, settle, subject, bank: db, units, unit };
}

describe('New Subject with a sources folder and a question bank', () => {
  it('makes one unit per paper, none twice: the bank\'s units in its order, then the files that match none', async () => {
    const h = await made();
    expect(h.units().rows.map((r) => r.title)).toEqual(['Mack', 'Clark', 'Friedland', 'Brosius 1993 - Loss Development', 'Mackenzie 2001 - Notes']);
    expect(h.units().rows.map((r) => r.values.Order)).toEqual([1, 2, 3, 4, 5]);
    expect(h.units().rows.map((r) => r.values.Questions)).toEqual([2, 1, 1, 0, 0]);
  });

  it('a file that holds a bank unit\'s name joins it: in its Material, its name without the ending in Also Called', async () => {
    const h = await made();
    expect(h.unit('Mack').values.Material).toEqual([{ name: 'Mack 1994 - Measuring the Variability.pdf', src: 'parallx-media://workspace/Readings/Mack%201994%20-%20Measuring%20the%20Variability.pdf' }]);
    expect(h.unit('Mack').values['Also Called']).toBe('Mack 1994 - Measuring the Variability');
    expect(h.unit('Clark').values['Also Called']).toBe('Clark 2003 - LDF Curve Fitting');
    expect([h.unit('Friedland').values.Material, h.unit('Friedland').values['Also Called']]).toEqual([undefined, undefined]);
  });

  it('a file that matches no bank unit is its own unit and holds its file', async () => {
    const h = await made();
    expect(h.unit('Mackenzie 2001 - Notes').values.Material).toEqual([{ name: 'Mackenzie 2001 - Notes.pdf', src: 'parallx-media://workspace/Readings/Mackenzie%202001%20-%20Notes.pdf' }]);
    expect(h.unit('Mackenzie 2001 - Notes').values['Also Called']).toBeUndefined();
    expect(JSON.stringify(h.unit('Mack').values.Material)).not.toContain('Mackenzie');
  });

  it('with no bank, each file is a unit that holds its file; with no folder, the bank\'s units alone', async () => {
    const own = await made({ bank: false });
    expect(own.units().rows.map((r) => [r.title, (r.values.Material as any[]).length])).toEqual([['Brosius 1993 - Loss Development', 1], ['Clark 2003 - LDF Curve Fitting', 1], ['Mack 1994 - Measuring the Variability', 1], ['Mackenzie 2001 - Notes', 1]]);
    own.S.stSubjectsReset();
    const plain = await made({ folder: '' });
    expect(plain.units().rows.map((r) => r.title)).toEqual(['Mack', 'Clark', 'Friedland']);
  });
});

describe('Remove Unit', () => {
  it('puts the unit\'s row out of Units and leaves its questions, the bank and every other unit as they were', async () => {
    const h = await made();
    const others = () => JSON.stringify(h.units().rows.filter((r) => r.title !== 'Friedland'));
    const before = others(); const bank = JSON.stringify(h.bank!.rows);
    expect(await h.S.stRemoveUnit(h.subject.id, h.unit('Friedland').pageId)).toBe(true);
    await h.settle();
    expect(h.units().rows.map((r) => r.title)).toEqual(['Mack', 'Clark', 'Brosius 1993 - Loss Development', 'Mackenzie 2001 - Notes']);
    expect(h.S.stSubjectsShown()[0].units.map((u: any) => u.name)).not.toContain('Friedland');
    expect([others(), JSON.stringify(h.bank!.rows)]).toEqual([before, bank]);
    expect(h.one('SELECT removed_units FROM st_subjects').removed_units).toBe('["Friedland"]');
  });

  it('is not undone by the questions that still name the unit, now or after Study was off and on again', async () => {
    const h = await made();
    await h.S.stRemoveUnit(h.subject.id, h.unit('Friedland').pageId);
    h.person.edit(h.bank!, 'Q4 about Friedland?', { values: { 'Model Answer': 'A4, again' } });
    await h.settle();
    expect(h.units().rows.map((r) => r.title)).not.toContain('Friedland');
    h.S.stSubjectsReset();
    h.S.registerSubjects({ subscriptions: [] });
    await new Promise((r) => setTimeout(r, 0));
    await h.settle();
    expect(h.units().rows.map((r) => r.title)).not.toContain('Friedland');
    // The total still counts its question: it is asked in a session over the whole subject.
    expect(h.S.stSubjectsShown()[0].total).toBe(4);
  });

  it('a row of its name added to Units again is the unit back, with its questions', async () => {
    const h = await made();
    await h.S.stRemoveUnit(h.subject.id, h.unit('Friedland').pageId);
    await h.settle();
    h.person.add(h.units(), 'Friedland', {});
    await h.settle();
    expect(h.unit('Friedland').values.Questions).toBe(1);
    expect(h.one('SELECT removed_units FROM st_subjects').removed_units).toBe('[]');
    // Taken away in the table itself (not by Remove Unit), it is made again from its questions, as before.
    h.person.remove(h.units(), 'Friedland');
    await h.settle();
    expect(h.units().rows.map((r) => r.title)).toContain('Friedland');
  });

  it('answers false for a unit that is not there, and writes nothing', async () => {
    const h = await made();
    const n = h.writes.length;
    expect(await h.S.stRemoveUnit(h.subject.id, 'no-such-row')).toBe(false);
    expect(h.writes.slice(n)).toEqual([]);
  });
});
