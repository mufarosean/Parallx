// studySubjects.test.ts — the pure parts of a Study subject
// (ext/study/src/12-subject-model.js) through __testables of the generated
// main.js: the mapping guessed from a database's column names, a result as
// the cell its column takes (the database's own words, a checkbox, a new
// database), a unit's numbers counted from the rows, the units proposed from
// a folder listing, and the changes a unit row needs (only what differs).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/study/main.js';

const {
  stSubjectGuessMapping, stSubjectResultCell, stSubjectMeansRight, stSubjectUnitNames, stSubjectCounts,
  stSubjectUnitsFromListing, stSubjectUnitChanges, stSubjectItems, stSubjectMinutes, stSubjectResultOfItem,
  stSubjectLocalDate, stSubjectLocalDateTime, stSubjectColumns, stSubjectLogValues,
} = __testables;

const col = (name: string, type: string, options?: string[]) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), name, type, config: options ? { options: options.map((value) => ({ value, color: 'gray' })) } : {} });
const TITLE = { id: 'title', name: 'Name', type: 'title', config: {} };

describe('the mapping guessed from column names', () => {
  it('reads his database: Model Answer, Paper, Times Attempted, Times Correct, Last Result', () => {
    const cols = [TITLE, col('Model Answer', 'text'), col('Paper', 'select', ['Mack', 'Clark']), col('Times Attempted', 'number'), col('Times Correct', 'number'), col('Last Result', 'select', ['Correct', 'Incorrect']), col('Remarks', 'text')];
    expect(stSubjectGuessMapping(cols)).toEqual({ answer: 'Model Answer', unit: 'Paper', attempts: 'Times Attempted', correct: 'Times Correct', lastResult: 'Last Result', lastAnswered: '' });
  });

  it('reads a database Study made, and never takes the title column', () => {
    const cols = [TITLE, col('Answer', 'text'), col('Unit', 'relation'), col('Kind', 'select', ['Short', 'Essay']), col('Attempts', 'number'), col('Correct', 'number'), col('Last Result', 'select', ['Right', 'Partly', 'Wrong']), col('Last Answered', 'date')];
    expect(stSubjectGuessMapping(cols)).toEqual({ answer: 'Answer', unit: 'Unit', attempts: 'Attempts', correct: 'Correct', lastResult: 'Last Result', lastAnswered: 'Last Answered' });
  });

  it('uses a column once, and the type decides between look-alikes', () => {
    // "Correct" as a checkbox is the result, not the count; "Answered" as a date is when, not the answer.
    const cols = [TITLE, col('Solution', 'text'), col('Chapter', 'text'), col('Tries', 'number'), col('Correct', 'checkbox'), col('Answered', 'date')];
    expect(stSubjectGuessMapping(cols)).toEqual({ answer: 'Solution', unit: 'Chapter', attempts: 'Tries', correct: '', lastResult: 'Correct', lastAnswered: 'Answered' });
  });

  it('leaves every role to add when nothing fits', () => {
    expect(stSubjectGuessMapping([TITLE, col('Decoy', 'files')])).toEqual({ answer: '', unit: '', attempts: '', correct: '', lastResult: '', lastAnswered: '' });
  });
});

describe('a result as its cell', () => {
  it('uses the words a select already has for right and wrong', () => {
    const c = col('Last Result', 'select', ['Correct', 'Incorrect']);
    expect(stSubjectResultCell(c, 'right')).toBe('Correct');
    expect(stSubjectResultCell(c, 'wrong')).toBe('Incorrect');
    // No word for partly there: partly is not right.
    expect(stSubjectResultCell(c, 'partly')).toBe('Incorrect');
  });

  it('writes Right, Partly, Wrong in a new database', () => {
    const c = col('Last Result', 'select', ['Right', 'Partly', 'Wrong']);
    expect(['right', 'partly', 'wrong'].map((r) => stSubjectResultCell(c, r))).toEqual(['Right', 'Partly', 'Wrong']);
    expect(stSubjectResultCell(col('Outcome', 'text'), 'right')).toBe('Right');
    expect(stSubjectResultCell(col('Outcome', 'select', ['Maybe']), 'wrong')).toBe('Wrong');
  });

  it('checks a checkbox when right and unchecks it otherwise', () => {
    const c = col('Got It', 'checkbox');
    expect(stSubjectResultCell(c, 'right')).toBe(true);
    expect(stSubjectResultCell(c, 'wrong')).toBe(false);
    expect(stSubjectResultCell(c, 'partly')).toBe(false);
  });

  it('knows which stored values mean right', () => {
    expect(['Correct', 'right', ' Yes ', true, 'Pass'].map((v) => stSubjectMeansRight(v))).toEqual([true, true, true, true, true]);
    expect(['Incorrect', 'Wrong', '', null, undefined, false, 'Partly', 'Not right'].map((v) => stSubjectMeansRight(v))).toEqual([false, false, false, false, false, false, false, false]);
  });

  it('reads an item\'s final verdict', () => {
    expect(stSubjectResultOfItem({ status: 'right' })).toBe('right');
    expect(stSubjectResultOfItem({ status: 'wrong', verdict: { rating: 1 } })).toBe('wrong');
    expect(stSubjectResultOfItem({ status: 'wrong', verdict: { rating: 2 } })).toBe('partly');
    // His own verdict is never "partly".
    expect(stSubjectResultOfItem({ status: 'wrong', verdict: { rating: 2, overruled: 'wrong' } })).toBe('wrong');
    expect(['pending', 'answered', 'skipped', ''].map((status) => stSubjectResultOfItem({ status }))).toEqual(['', '', '', '']);
  });
});

describe('a unit named by a cell', () => {
  const titles = new Map([['11111111-aaaa-bbbb-cccc-000000000001', 'Mack'], ['11111111-aaaa-bbbb-cccc-000000000002', 'Clark']]);
  it('is the text, the option, each tag, or the rows a relation points at', () => {
    expect(stSubjectUnitNames(' Mack ', titles)).toEqual(['Mack']);
    expect(stSubjectUnitNames(['Mack', 'Clark'], titles)).toEqual(['Mack', 'Clark']);
    expect(stSubjectUnitNames(['11111111-aaaa-bbbb-cccc-000000000002'], titles)).toEqual(['Clark']);
    expect(stSubjectUnitNames([{ id: '11111111-aaaa-bbbb-cccc-000000000001', title: 'Mack 1993' }], titles)).toEqual(['Mack']);
    expect(stSubjectUnitNames(null, titles)).toEqual([]);
    expect(stSubjectUnitNames('', titles)).toEqual([]);
  });
});

describe('a unit\'s numbers, counted from the rows', () => {
  const mapping = { answer: 'Model Answer', unit: 'Paper', attempts: 'Times Attempted', correct: 'Times Correct', lastResult: 'Last Result', lastAnswered: 'Last Answered' };
  const rows = [
    { pageId: 'a', title: 'Q1', values: { Paper: 'Mack', 'Times Attempted': 3, 'Times Correct': 2, 'Last Result': 'Correct', 'Last Answered': '2026-11-10' } },
    { pageId: 'b', title: 'Q2', values: { Paper: 'Mack', 'Times Attempted': 1, 'Last Result': 'Incorrect', 'Last Answered': '2026-11-12' } },
    { pageId: 'c', title: 'Q3', values: { Paper: 'Mack' } },
    { pageId: 'd', title: 'Q4', values: { Paper: 'Clark', 'Times Attempted': '2', 'Last Result': 'Correct' } },
    { pageId: 'e', title: 'Q5', values: { 'Times Attempted': 1 } },
  ];
  it('answered is Attempts over zero, right is what the last result means, last worked the latest date', () => {
    const c = stSubjectCounts(rows, mapping, new Map());
    expect(c.total).toBe(5);
    expect(c.answered).toBe(4);
    expect(c.units).toEqual([
      { name: 'Mack', total: 3, answered: 2, right: 1, lastWorked: '2026-11-12' },
      { name: 'Clark', total: 1, answered: 1, right: 1, lastWorked: '' },
    ]);
  });

  it('writes to a unit row only what differs, and only into columns that are there', () => {
    const counts = stSubjectCounts(rows, mapping, new Map());
    const unitRows = [
      { pageId: 'u1', title: 'Mack', values: { Questions: 3, Answered: 2, 'Right Last Time': 1, 'Last Worked': '2026-11-12' } },
      { pageId: 'u2', title: 'Clark', values: { Questions: 1, Answered: 0 } },
      { pageId: 'u3', title: 'Friedland', values: {} },
    ];
    const all = ['Questions', 'Answered', 'Right Last Time', 'Last Worked'];
    expect(stSubjectUnitChanges(unitRows, counts, all)).toEqual([
      { pageId: 'u2', values: { Answered: 1, 'Right Last Time': 1 } },
      { pageId: 'u3', values: { Questions: 0, Answered: 0, 'Right Last Time': 0 } },
    ]);
    // A kept column he deleted is not written until it is back.
    expect(stSubjectUnitChanges(unitRows, counts, ['Questions', 'Right Last Time'])).toEqual([
      { pageId: 'u2', values: { 'Right Last Time': 1 } },
      { pageId: 'u3', values: { Questions: 0, 'Right Last Time': 0 } },
    ]);
  });

  it('turns rows into questions by their page id, with the unit and the kind', () => {
    const items = stSubjectItems([
      { pageId: 'a', title: ' What is X? ', values: { 'Model Answer': 'It is X.', Paper: 'Mack', Kind: 'Essay' } },
      { pageId: 'b', title: 'No answer yet', values: {} },
      { pageId: 'c', title: '   ', values: { 'Model Answer': 'An answer with no question.' } },
    ], mapping, new Map());
    expect(items).toEqual([
      { ref: 'a', question: 'What is X?', answer: 'It is X.', unit: 'Mack', kind: 'essay' },
      { ref: 'b', question: 'No answer yet', answer: '', unit: '', kind: 'short' },
    ]);
  });
});

describe('units proposed from a folder', () => {
  const DIR = 2, FILE = 1;
  it('one per subfolder when there are subfolders, in name order', () => {
    expect(stSubjectUnitsFromListing([
      { name: 'C Friedland', type: DIR }, { name: 'syllabus.txt', type: FILE }, { name: 'A Mack 1993', type: DIR }, { name: '.git', type: DIR }, { name: 'B Clark 2003', type: DIR },
    ])).toEqual(['A Mack 1993', 'B Clark 2003', 'C Friedland']);
  });
  it('else one per pdf, md, markdown or txt file, named without its extension, numbers in order', () => {
    expect(stSubjectUnitsFromListing([
      { name: '10 Tails.md', type: FILE }, { name: '02 Link Functions.md', type: FILE }, { name: '01 Introduction.PDF', type: FILE }, { name: '04 Offsets.markdown', type: FILE },
      { name: '03 Deviance.txt', type: FILE }, { name: '05 Figures.docx', type: FILE }, { name: 'cover.png', type: FILE }, { name: '.hidden.md', type: FILE }, { name: '03 Deviance.pdf', type: FILE },
    ])).toEqual(['01 Introduction', '02 Link Functions', '03 Deviance', '04 Offsets', '10 Tails']);
  });
  it('nothing from an empty folder', () => {
    expect(stSubjectUnitsFromListing([])).toEqual([]);
    expect(stSubjectUnitsFromListing(null)).toEqual([]);
  });
});

describe('the work log', () => {
  it('counts the session\'s own minutes, rounded up, at least one', () => {
    expect([0, 1, 59, 60, 61, 600].map((s) => stSubjectMinutes(s))).toEqual([1, 1, 1, 1, 2, 10]);
  });

  it('writes dates in his own day, whatever the time zone', () => {
    const at = new Date(2026, 10, 18, 9, 5, 30).getTime();
    expect(stSubjectLocalDate(at)).toBe('2026-11-18');
    expect(stSubjectLocalDateTime(at)).toBe('2026-11-18T09:05');
  });

  it('is one row for a session: what was answered, what was right, and the units', () => {
    const items = [{ status: 'right', questionId: 1 }, { status: 'wrong', questionId: 2 }, { status: 'pending', questionId: 3 }, { status: 'answered', questionId: 4 }, { status: 'skipped', questionId: 5 }];
    const session = { name: 'Exam 7 · Mack', startedAt: new Date(2026, 10, 18, 9, 5).getTime(), seconds: 61 };
    expect(stSubjectLogValues(session, items, ['u1'])).toEqual({
      title: 'Exam 7 · Mack',
      values: { Date: '2026-11-18T09:05', Minutes: 2, Unit: ['u1'], Tool: 'Study', Kind: 'Questions', Items: 3, Right: 1, Confirmed: true, Origin: 'App' },
    });
    expect(stSubjectLogValues(session, [{ status: 'pending' }, { status: 'skipped' }], [])).toBeNull();
  });
});

describe('the databases a subject is made of', () => {
  it('has the request\'s columns, Study\'s own marked as kept, and no Status', () => {
    const c = stSubjectColumns('units-db');
    expect(c.units.map((x: { name: string }) => x.name)).toEqual(['Order', 'Weight', 'Questions', 'Answered', 'Right Last Time', 'Last Worked']);
    expect(c.units.filter((x: { config?: { computedBy?: boolean } }) => x.config?.computedBy).map((x: { name: string }) => x.name)).toEqual(['Questions', 'Answered', 'Right Last Time', 'Last Worked']);
    expect(c.questions.map((x: { name: string; type: string }) => `${x.name}:${x.type}`)).toEqual(['Answer:text', 'Unit:relation', 'Kind:select', 'Source:url', 'Attempts:number', 'Correct:number', 'Last Result:select', 'Last Answered:date']);
    expect(c.questions.find((x: { name: string }) => x.name === 'Unit').config).toEqual({ databaseId: 'units-db', synced: false });
    expect(c.log.map((x: { name: string; type: string }) => `${x.name}:${x.type}`)).toEqual(['Date:datetime', 'Minutes:number', 'Unit:relation', 'Tool:select', 'Kind:select', 'Items:number', 'Right:number', 'Confirmed:checkbox', 'Origin:select']);
    for (const list of [c.units, c.questions, c.log]) expect(list.some((x: { name: string; type: string }) => /status/i.test(x.name) || x.type === 'status')).toBe(false);
  });
});
