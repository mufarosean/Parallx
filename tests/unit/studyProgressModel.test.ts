// studyProgressModel.test.ts — Study's Progress, the pure part (ext/study/src/14-progress-model.js).
//
// Matching a tool's groups to units by name (case, spaces, punctuation and
// accents aside; Also Called; what matches nothing), a question's state from
// its Last Result, a unit's counts, the rows and totals of the view, weakest
// first, the names a screen reader speaks, and the questions of one result.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables as T } from '../../ext/study/main.js';

const {
  ST_PROGRESS_STATES, ST_PROGRESS_WORDS, ST_PROGRESS_ALSO,
  stProgressFold, stProgressAliases, stProgressMatch, stProgressCountsOf, stProgressQuestionState, stProgressQuestions,
  stProgressBuild, stProgressWeakestFirst, stProgressBarName, stProgressPartName, stProgressCountText, stProgressUnmatchedText,
  stProgressFilterByResult, stSubjectColumns,
} = T;

const group = (label: string, total: number, good = 0, middling = 0, poor = 0, key = label.toLowerCase()) => ({ group: key, label, total, good, middling, poor });
const unit = (name: string, also = '', rowId = `row-${name}`) => ({ name, also, rowId });

describe('the four states', () => {
  it('are good, middling, poor and the rest, in Study\'s words Right, Partly, Wrong, Not yet', () => {
    expect(ST_PROGRESS_STATES).toEqual(['good', 'middling', 'poor', 'rest']);
    expect(ST_PROGRESS_WORDS).toEqual({ good: 'Right', middling: 'Partly', poor: 'Wrong', rest: 'Not yet' });
  });
});

describe('stProgressFold: a name as matching reads it', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(stProgressFold('Mack (1994)')).toBe('mack1994');
    expect(stProgressFold('  mack-1994 ')).toBe('mack1994');
    expect(stProgressFold('MACK_1994.')).toBe('mack1994');
    expect(stProgressFold('fried-land')).toBe(stProgressFold('Friedland'));
    expect(stProgressFold('Teng & Perkins')).toBe('tengperkins');
  });
  it('ignores accents, and keeps letters of any script', () => {
    expect(stProgressFold('Hürlimann')).toBe('hurlimann');
    expect(stProgressFold('Élève')).toBe('eleve');
    expect(stProgressFold('数学 1')).toBe('数学1');
  });
  it('is empty for nothing and for punctuation alone', () => {
    expect([null, undefined, '', ' - ', '()'].map(stProgressFold)).toEqual(['', '', '', '', '']);
  });
});

describe('stProgressAliases: the names in Also Called', () => {
  it('are separated by commas, trimmed, with empty ones dropped', () => {
    expect(stProgressAliases('Mack 1994, Chain Ladder')).toEqual(['Mack 1994', 'Chain Ladder']);
    expect(stProgressAliases(' a ,, b ,')).toEqual(['a', 'b']);
    expect(stProgressAliases('one name')).toEqual(['one name']);
  });
  it('takes a new line or a semicolon as a comma, and anything that is not text as nothing', () => {
    expect(stProgressAliases('a; b\nc')).toEqual(['a', 'b', 'c']);
    expect([null, undefined, '', 7, ['a']].map(stProgressAliases)).toEqual([[], [], [], ['7'], ['a']]);
  });
});

describe('stProgressMatch: which unit a group belongs to', () => {
  const units = [unit('Mack', 'Mack 1994, Chain Ladder'), unit('Clark'), unit('Friedland'), unit('Venter')];
  it('matches a group to the unit whose name its label equals, case, spaces and punctuation aside', () => {
    const groups = [group('clark', 3), group('fried-land', 3), group('VENTER', 4), group('Brosius', 6)];
    const m = stProgressMatch(units, groups);
    expect(m.matched.map((list: { label: string }[]) => list.map((g) => g.label))).toEqual([[], ['clark'], ['fried-land'], ['VENTER']]);
    expect(m.unmatched.map((g: { label: string }) => g.label)).toEqual(['Brosius']);
  });
  it('matches the names in Also Called too, several groups to one unit', () => {
    const groups = [group('mack', 5), group('Mack (1994)', 7, 4, 1, 1, 'mack1994'), group('chain-ladder', 2)];
    const m = stProgressMatch(units, groups);
    expect(m.matched[0].map((g: { label: string }) => g.label)).toEqual(['mack', 'Mack (1994)', 'chain-ladder']);
    expect(m.unmatched).toEqual([]);
  });
  it('reads the label a person sees, not the tool\'s own key', () => {
    const m = stProgressMatch([unit('Deck 1'), unit('Venter')], [group('VENTER', 4, 0, 0, 0, 'deck:1')]);
    expect(m.matched.map((l: unknown[]) => l.length)).toEqual([0, 1]);
  });
  it('gives a unit\'s own name before another unit\'s Also Called, and the first unit when two share a name', () => {
    const m = stProgressMatch([unit('Clark', 'Mack'), unit('Mack'), unit('mack')], [group('Mack', 2)]);
    expect(m.matched.map((l: unknown[]) => l.length)).toEqual([0, 1, 0]);
  });
  it('matches nothing to a unit with no name, and lists a group with no name as unmatched', () => {
    const m = stProgressMatch([unit(''), unit('()', ' , ')], [group('', 1), group('--', 2)]);
    expect(m.matched.map((l: unknown[]) => l.length)).toEqual([0, 0]);
    expect(m.unmatched).toHaveLength(2);
  });
  it('has nothing to say with no groups', () => {
    expect(stProgressMatch(units, [])).toEqual({ matched: [[], [], [], []], unmatched: [] });
    expect(stProgressMatch([], null)).toEqual({ matched: [], unmatched: [] });
  });
});

describe('stProgressCountsOf', () => {
  it('is good, middling, poor and the rest, never more than the total', () => {
    expect(stProgressCountsOf(group('x', 10, 3, 1, 2))).toEqual([3, 1, 2, 4]);
    expect(stProgressCountsOf(group('x', 4, 3, 3, 3))).toEqual([3, 1, 0, 0]);
    expect(stProgressCountsOf({ total: 'x', good: -1 })).toEqual([0, 0, 0, 0]);
    expect(stProgressCountsOf(null)).toEqual([0, 0, 0, 0]);
  });
});

describe('stProgressQuestionState: a question\'s state from its Last Result', () => {
  it('reads Right, Partly and Wrong, in his own words too', () => {
    expect(['Right', 'right', 'Correct', 'Got it'].map((v) => stProgressQuestionState(v, true))).toEqual(['good', 'good', 'good', 'good']);
    expect(['Partly', 'partial', 'Almost'].map((v) => stProgressQuestionState(v, true))).toEqual(['middling', 'middling', 'middling']);
    expect(['Wrong', 'incorrect', 'Missed'].map((v) => stProgressQuestionState(v, true))).toEqual(['poor', 'poor', 'poor']);
  });
  it('is the rest with no result, whatever the attempts say, and with a word it does not know', () => {
    expect([null, undefined, '', '  '].map((v) => stProgressQuestionState(v, true))).toEqual(['rest', 'rest', 'rest', 'rest']);
    expect(stProgressQuestionState('Someday', true)).toBe('rest');
    expect(stProgressQuestionState('Right', false)).toBe('good');
  });
  it('reads "Not yet" and "Unknown" in his own select as wrong only once answered, like an unchecked box', () => {
    expect(['Not yet', 'not yet', 'Unknown'].map((v) => stProgressQuestionState(v, false))).toEqual(['rest', 'rest', 'rest']);
    expect(['Not yet', 'Unknown'].map((v) => stProgressQuestionState(v, true))).toEqual(['poor', 'poor']);
    // A word that only ever means wrong is wrong whatever the attempts say.
    expect(['Wrong', 'Missed', 'No'].map((v) => stProgressQuestionState(v, false))).toEqual(['poor', 'poor', 'poor']);
    const rows = [{ values: { Unit: 'Mack', 'Last Result': 'Not yet' } }, { values: { Unit: 'Mack', 'Last Result': 'Not yet', Attempts: 2 } }];
    expect(stProgressQuestions(rows, { unit: 'Unit', lastResult: 'Last Result', attempts: 'Attempts' }, null, false).units).toEqual([{ name: 'Mack', counts: [0, 0, 1, 1] }]);
  });
  it('reads a checkbox or a number by the attempts: unchecked is wrong only once answered', () => {
    expect([stProgressQuestionState(true, true), stProgressQuestionState(false, true), stProgressQuestionState(false, false)]).toEqual(['good', 'poor', 'rest']);
    expect([stProgressQuestionState(1, true), stProgressQuestionState(0, true), stProgressQuestionState(0, false)]).toEqual(['good', 'poor', 'rest']);
  });
});

describe('stProgressQuestions: a subject\'s questions by unit and state', () => {
  const mapping = { unit: 'Paper', attempts: 'Times Attempted', lastResult: 'Last Result' };
  const row = (paper: unknown, result: unknown, attempts = result ? 1 : 0) => ({ pageId: `q${Math.random()}`, title: 'q', values: { Paper: paper, 'Last Result': result, 'Times Attempted': attempts } });
  const rows = [
    row('Mack', 'Right'), row('Mack', 'Right'), row('Mack', 'Partly'), row('Mack', 'Wrong'), row('Mack', ''),
    row('clark', 'Wrong'), row('Clark', null),
    row('', 'Right'), row(null, ''),
  ];
  const got = stProgressQuestions(rows, mapping, null, false);
  it('counts each unit as [right, partly, wrong, not yet], units named alike together', () => {
    expect(got.units).toEqual([{ name: 'Mack', counts: [2, 1, 1, 1] }, { name: 'clark', counts: [0, 0, 1, 1] }]);
  });
  it('counts every question in the total, and says how many name no unit', () => {
    expect(got.total).toEqual([3, 1, 2, 3]);
    expect(got.noUnit).toBe(2);
  });
  it('counts a question of two units in each, once in the total', () => {
    const two = stProgressQuestions([row(['Mack', 'Clark'], 'Right')], mapping, null, false);
    expect(two.units).toEqual([{ name: 'Mack', counts: [1, 0, 0, 0] }, { name: 'Clark', counts: [1, 0, 0, 0] }]);
    expect(two.total).toEqual([1, 0, 0, 0]);
  });
  it('follows a relation to the Units rows', () => {
    const titles = new Map([['u1', 'Mack']]);
    const rel = stProgressQuestions([{ pageId: 'a', title: 'q', values: { Paper: ['u1'], 'Last Result': 'Wrong', 'Times Attempted': 1 } }, { pageId: 'b', title: 'q', values: { Paper: ['gone'], 'Last Result': 'Right' } }], mapping, titles, true);
    expect(rel.units).toEqual([{ name: 'Mack', counts: [0, 0, 1, 0] }]);
    expect(rel.noUnit).toBe(1);
  });
  it('is empty for no rows', () => {
    expect(stProgressQuestions([], mapping, null, false)).toEqual({ units: [], total: [0, 0, 0, 0], noUnit: 0 });
  });
});

describe('stProgressBuild: the rows, the totals and what matched nothing', () => {
  const units = [unit('Mack'), unit('Clark'), unit('Friedland'), unit('Siewert'), unit('Empty')];
  const questions = { units: [{ name: 'Mack', counts: [3, 1, 2, 2] }, { name: 'clark', counts: [1, 2, 0, 3] }, { name: 'Friedland', counts: [0, 0, 0, 4] }], total: [4, 3, 2, 10], noUnit: 1 };
  const problems = { id: 'worksheets.problems', kind: 'Problems', words: { good: 'Easy', middling: 'Medium', poor: 'Hard', rest: 'Not rated' }, canOpen: true,
    groups: [group('Clark', 10, 3, 1, 2), group('Friedland', 5), group('Siewert', 4, 1, 0, 1), group('Brosius', 6, 2, 2, 1)] };
  const cards = { id: 'flashcards.cards', kind: 'Cards', words: { good: 'Good or Easy', middling: 'Hard', poor: 'Again', rest: 'Not reviewed' }, canOpen: false,
    groups: [group('mack', 5, 2, 1, 1, 'tag:mack'), group('chain-ladder', 2, 1, 0, 0, 'tag:chain-ladder')] };
  const empty = { id: 'x.none', kind: 'Drills', words: {}, canOpen: false, groups: [] };
  const view = stProgressBuild({ units, questions, providers: [problems, cards, empty] });

  it('has a row for every unit, in the order given', () => {
    expect(view.rows.map((r: { name: string }) => r.name)).toEqual(['Mack', 'Clark', 'Friedland', 'Siewert', 'Empty']);
  });
  it('gives a unit one bar per kind it has something in, and none for a kind with nothing', () => {
    const kinds = (name: string) => view.rows.find((r: { name: string }) => r.name === name).kinds.map((k: { kind: string; counts: number[] }) => [k.kind, k.counts]);
    expect(kinds('Mack')).toEqual([['Questions', [3, 1, 2, 2]], ['Cards', [2, 1, 1, 1]]]);
    expect(kinds('Clark')).toEqual([['Questions', [1, 2, 0, 3]], ['Problems', [3, 1, 2, 4]]]);
    expect(kinds('Friedland')).toEqual([['Questions', [0, 0, 0, 4]], ['Problems', [0, 0, 0, 5]]]);
    expect(kinds('Siewert')).toEqual([['Problems', [1, 0, 1, 2]]]);
    expect(kinds('Empty')).toEqual([]);
  });
  it('adds every kind of a unit together', () => {
    expect(view.rows.map((r: { all: number[] }) => r.all)).toEqual([[5, 2, 3, 3], [4, 3, 2, 7], [0, 0, 0, 9], [1, 0, 1, 2], [0, 0, 0, 0]]);
  });
  it('carries each bar\'s words, whether it opens, and the groups it stands for', () => {
    const clark = view.rows[1].kinds[1];
    expect(clark).toMatchObject({ id: 'worksheets.problems', words: problems.words, canOpen: true, groups: [{ group: 'clark', counts: [3, 1, 2, 4] }] });
    expect(view.rows[0].kinds[0]).toMatchObject({ id: 'questions', words: ST_PROGRESS_WORDS, canOpen: true });
    expect(view.rows[0].kinds[1].canOpen).toBe(false);
  });
  it('totals the questions over the whole subject and a tool\'s kind over its units\' bars', () => {
    expect(view.totals.map((t: { kind: string; counts: number[] }) => [t.kind, t.counts])).toEqual([['Questions', [4, 3, 2, 10]], ['Problems', [4, 1, 3, 11]], ['Cards', [2, 1, 1, 1]]]);
    expect(view.kinds.map((k: { id: string }) => k.id)).toEqual(['questions', 'worksheets.problems', 'flashcards.cards']);
  });
  it('lists what matched no unit, per tool, and the questions that name none', () => {
    expect(view.unmatched).toEqual([
      { id: 'worksheets.problems', kind: 'Problems', groups: [{ label: 'Brosius', counts: [2, 2, 1, 1] }] },
      { id: 'flashcards.cards', kind: 'Cards', groups: [{ label: 'chain-ladder', counts: [1, 0, 0, 1] }] },
    ]);
    expect(view.noUnit).toBe(1);
  });
  it('matches by Also Called, and what is matched is no longer listed', () => {
    const v = stProgressBuild({ units: [unit('Mack', 'Chain Ladder, brosius')], questions: { units: [], total: [0, 0, 0, 0], noUnit: 0 }, providers: [problems, cards] });
    expect(v.rows[0].kinds.map((k: { kind: string; counts: number[] }) => [k.kind, k.counts])).toEqual([['Problems', [2, 2, 1, 1]], ['Cards', [3, 1, 1, 2]]]);
    expect(v.unmatched.map((u: { kind: string; groups: { label: string }[] }) => [u.kind, u.groups.map((g) => g.label)])).toEqual([['Problems', ['Clark', 'Friedland', 'Siewert']]]);
    expect(v.kinds.map((k: { id: string }) => k.id)).toEqual(['worksheets.problems', 'flashcards.cards']);
  });
  it('with no providers and no questions has rows and nothing else', () => {
    const v = stProgressBuild({ units: [unit('Mack')], questions: { units: [], total: [0, 0, 0, 0], noUnit: 0 }, providers: [] });
    expect(v).toMatchObject({ kinds: [], totals: [], unmatched: [], noUnit: 0 });
    expect(v.rows[0]).toMatchObject({ name: 'Mack', kinds: [], all: [0, 0, 0, 0] });
  });
});

describe('stProgressBuild: a tool whose groups share items', () => {
  // Five cards, all in the deck Mack, one of them tagged mack and chain ladder too: each group counts it, and it is one card.
  const groups = [group('mack', 1, 0, 0, 1, 'tag:mack'), group('chain ladder', 1, 0, 0, 1, 'tag:chain ladder'), group('Mack', 5, 2, 0, 1, 'deck:1'), group('clark', 3, 1, 0, 0, 'tag:clark')];
  const units = [unit('Mack', 'Chain Ladder'), unit('Clark')];
  const once: Record<string, object> = {
    'deck:1|tag:chain ladder|tag:mack': { total: 5, good: 2, middling: 0, poor: 1 },
    'deck:1|tag:chain ladder|tag:clark|tag:mack': { total: 7, good: 3, middling: 0, poor: 1 },
  };
  const cards = (counted?: (set: string[]) => unknown) => ({ id: 'flashcards.cards', kind: 'Cards', words: {}, canOpen: false, groups, ...(counted ? { counted } : {}) });
  const asked: string[] = [];
  const view = stProgressBuild({ units, questions: null, providers: [cards((set) => { const key = [...set].sort().join('|'); asked.push(key); return once[key]; })] });

  it('asks the tool for a unit\'s groups together, so a card in three of them is one card', () => {
    expect(view.rows[0].kinds.map((k: { counts: number[] }) => k.counts)).toEqual([[2, 0, 1, 2]]);
    expect(view.rows[0].all).toEqual([2, 0, 1, 2]);
    expect(view.rows[0].kinds[0].groups.map((g: { group: string }) => g.group)).toEqual(['tag:mack', 'tag:chain ladder', 'deck:1']);
  });
  it('does not ask for a unit with one group, and asks for the tool\'s total over every matched group', () => {
    expect(view.rows[1].kinds.map((k: { counts: number[] }) => k.counts)).toEqual([[1, 0, 0, 2]]);
    expect(asked.sort()).toEqual(['deck:1|tag:chain ladder|tag:clark|tag:mack', 'deck:1|tag:chain ladder|tag:mack']);
    expect(view.totals).toEqual([{ id: 'flashcards.cards', kind: 'Cards', words: {}, counts: [3, 0, 1, 3] }]);
  });
  it('adds the groups of a tool that offers no such count, as their items are in one group each', () => {
    const added = stProgressBuild({ units, questions: null, providers: [cards()] });
    expect(added.rows[0].kinds[0].counts).toEqual([2, 0, 3, 2]);
    expect(added.totals[0].counts).toEqual([3, 0, 3, 4]);
  });
  it('draws none of the tool\'s bars while a count is still being asked for, and adds when the tool could not say', () => {
    const waiting = stProgressBuild({ units, questions: null, providers: [cards(() => null)] });
    expect(waiting.rows.map((r: { kinds: unknown[] }) => r.kinds)).toEqual([[], []]);
    expect([waiting.kinds, waiting.totals]).toEqual([[], []]);
    const failed = stProgressBuild({ units, questions: null, providers: [cards(() => false)] });
    expect(failed.rows[0].kinds[0].counts).toEqual([2, 0, 3, 2]);
  });
});

describe('stProgressWeakestFirst', () => {
  const rows = [{ name: 'A', all: [5, 0, 0, 5] }, { name: 'B', all: [0, 0, 0, 9] }, { name: 'C', all: [1, 2, 2, 5] }, { name: 'D', all: [0, 0, 3, 0] }, { name: 'E', all: [1, 0, 0, 9] }, { name: 'F', all: [0, 0, 0, 0] }];
  it('puts the lowest share of green over all items first, and a unit with nothing attempted last', () => {
    expect(stProgressWeakestFirst(rows).map((r: { name: string }) => r.name)).toEqual(['D', 'C', 'E', 'A', 'B', 'F']);
  });
  it('keeps the given order between equals, and does not change what it was given', () => {
    const same = [{ name: 'X', all: [1, 0, 1, 0] }, { name: 'Y', all: [2, 2, 0, 0] }];
    expect(stProgressWeakestFirst(same).map((r: { name: string }) => r.name)).toEqual(['X', 'Y']);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('what a screen reader speaks, and the words on the page', () => {
  it('names a bar in full, the words in lower case and always in one order', () => {
    expect(stProgressBarName('Mack', 'Questions', [12, 3, 2, 5], ST_PROGRESS_WORDS)).toBe('Mack, Questions: 12 right, 3 partly, 2 wrong, 5 not yet');
    expect(stProgressBarName('Clark', 'Problems', [3, 1, 2, 4], { good: 'Easy', middling: 'Medium', poor: 'Hard', rest: 'Not rated' })).toBe('Clark, Problems: 3 easy, 1 medium, 2 hard, 4 not rated');
    expect(stProgressBarName('Mack', '', [1, 0, 0, 2], ST_PROGRESS_WORDS)).toBe('Mack: 1 right, 0 partly, 0 wrong, 2 not yet');
  });
  it('falls back to plain words when a tool gives none, and keeps a comma out of a word', () => {
    expect(stProgressBarName('U', 'Drills', [1, 1, 1, 1], {})).toBe('U, Drills: 1 good, 1 middling, 1 poor, 1 not yet');
    expect(stProgressBarName('U', 'Drills', [1, 0, 0, 0], { good: 'Good, or Easy' })).toBe('U, Drills: 1 good or easy, 0 middling, 0 poor, 0 not yet');
  });
  it('names a part with its count and what pressing it does', () => {
    expect(stProgressPartName('Mack', 'Questions', 'Wrong', 2, 'Study these')).toBe('Mack, Questions, wrong: 2. Study these');
    expect(stProgressPartName('Mack', 'Cards', 'Again', 1)).toBe('Mack, Cards, again: 1');
  });
  it('writes N of M: the three states together over all', () => {
    expect(stProgressCountText([12, 3, 2, 5])).toBe('17 of 22');
    expect(stProgressCountText([0, 0, 0, 0])).toBe('0 of 0');
  });
  it('writes the line of what matched no unit, each group with its count', () => {
    expect(stProgressUnmatchedText('Problems', [{ label: 'Brosius', counts: [2, 2, 1, 1] }, { label: 'Hürlimann', counts: [0, 0, 3, 0] }])).toBe('Problems not matched to a unit: Brosius 6, Hürlimann 3');
  });
});

describe('stProgressFilterByResult: the questions of one result', () => {
  const names = { lastResult: 'Last Result', attempts: 'Attempts' };
  const rows = new Map([
    ['r1', { values: { 'Last Result': 'Right', Attempts: 2 } }], ['r2', { values: { 'Last Result': 'Partly', Attempts: 1 } }],
    ['r3', { values: { 'Last Result': 'Wrong', Attempts: 1 } }], ['r4', { values: {} }],
  ]);
  const questions = ['r1', 'r2', 'r3', 'r4', 'gone'].map((ref, i) => ({ id: i + 1, providerRef: JSON.stringify({ ref, paper: 'Mack' }) }));
  const ids = (state: string) => stProgressFilterByResult(questions, rows, names, state).map((q: { id: number }) => q.id);
  it('keeps the questions whose row is in that state', () => {
    expect(ids('good')).toEqual([1]);
    expect(ids('middling')).toEqual([2]);
    expect(ids('poor')).toEqual([3]);
    expect(ids('rest')).toEqual([4]);
  });
  it('keeps none for a state that is not one, or with no rows to read', () => {
    expect(ids('sideways')).toEqual([]);
    expect(stProgressFilterByResult(questions, null, names, 'good')).toEqual([]);
  });
});

describe('Units', () => {
  it('has a plain text column Also Called that Study does not keep', () => {
    const also = stSubjectColumns('u').units.find((c: { name: string }) => c.name === ST_PROGRESS_ALSO);
    expect(ST_PROGRESS_ALSO).toBe('Also Called');
    expect(also).toEqual({ name: 'Also Called', type: 'text' });
    expect(T.ST_SUBJECT_KEPT).not.toContain('Also Called');
  });
});
