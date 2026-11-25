// studyHome.test.ts — the pure parts of Study's Home, through the generated
// ext/study/main.js: what to work on today (the weakest first, the kinds
// taking turns), hours in words, and a month stepped across a year's end.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables as T } from '../../ext/study/main.js';

const { stHomeBlocks, stHomeAddMonths, stHomeHours } = T;

// counts are [good, middling, poor, rest]
const kind = (id: string, name: string, counts: number[], extra: Record<string, unknown> = {}) => ({ id, kind: name, words: {}, counts, canOpen: true, groups: [{ group: `${id}-g` }], ...extra });
const progress = {
  rows: [
    { name: 'Mack', rowId: 'm', kinds: [kind('questions', 'Questions', [2, 1, 3, 0], { words: { poor: 'Wrong', middling: 'Partly', rest: 'Not yet' } }), kind('ws', 'Problems', [0, 0, 1, 4], { words: { poor: 'Hard' } })] },
    { name: 'Clark', rowId: 'c', kinds: [kind('questions', 'Questions', [0, 0, 5, 2], { words: { poor: 'Wrong' } }), kind('fc', 'Cards', [1, 2, 0, 0])] },
    { name: 'Venter', rowId: 'v', kinds: [kind('questions', 'Questions', [4, 0, 0, 0])] },
  ],
};

describe('stHomeBlocks', () => {
  it('puts what is wrong first; within a state the kinds take turns, the kind with the largest block leading', () => {
    const blocks = stHomeBlocks(progress, 5);
    expect(blocks.map((b: any) => [b.unit, b.kind, b.state, b.n])).toEqual([
      ['Clark', 'Questions', 'poor', 5],
      ['Mack', 'Problems', 'poor', 1],
      ['Mack', 'Questions', 'poor', 3],
      ['Clark', 'Cards', 'middling', 2],
      ['Mack', 'Questions', 'middling', 1],
    ]);
  });
  it('says a state in the tool\'s own word, lower case, and a plain one where the tool gives none', () => {
    const blocks = stHomeBlocks(progress, 9);
    expect(blocks.find((b: any) => b.kind === 'Problems' && b.state === 'poor').word).toBe('hard');
    expect(blocks.find((b: any) => b.kind === 'Cards').word).toBe('middling');
    expect(blocks.find((b: any) => b.unit === 'Clark' && b.state === 'rest').word).toBe('not yet');
  });
  it('names what opens each block: the tool\'s groups, and the unit', () => {
    const b = stHomeBlocks(progress, 5)[1];
    expect(b).toMatchObject({ kindId: 'ws', groups: ['ws-g'], rowId: 'm', canOpen: true });
  });
  it('has nothing for a subject with nothing wrong, half known or waiting, and for no progress', () => {
    expect(stHomeBlocks({ rows: [progress.rows[2]] })).toEqual([]);
    expect(stHomeBlocks(null)).toEqual([]);
  });
  it('stops at the number asked for', () => {
    expect(stHomeBlocks(progress, 2)).toHaveLength(2);
  });
});

describe('Home\'s words and months', () => {
  it('says hours with one decimal, and under a tenth of an hour in minutes', () => {
    expect(stHomeHours(2.5)).toBe('2.5 h');
    expect(stHomeHours(0)).toBe('0 h');
    expect(stHomeHours(0.05)).toBe('3 min');
  });
  it('steps a month across the end of a year, both ways', () => {
    expect(stHomeAddMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(stHomeAddMonths('2027-01-01', -1)).toBe('2026-12-01');
    expect(stHomeAddMonths('2026-11-01', 14)).toBe('2028-01-01');
  });
});

describe('his measured pace', () => {
  const { stPlanPace, stPlanPaceWords, stPlanRules, stPlanDays, stPlanPhases } = T;
  const log = (Kind: string, Minutes: unknown, Items: unknown) => ({ pageId: 'r', title: '', values: { Kind, Minutes, Items } });

  it('is minutes per item by kind and over all, from the rows that hold both', () => {
    const p = stPlanPace([log('Problems', 60, 6), log('Problems', 30, 4), log('Cards', 10, 20), log('Reading', 45, null), log('Questions', 0, 5)]);
    expect(p.kinds.problems).toEqual({ per: 9, items: 10, minutes: 90 });
    expect(p.kinds.cards).toEqual({ per: 0.5, items: 20, minutes: 10 });
    expect(p.kinds.reading).toBeUndefined();
    expect(p.kinds.questions).toBeUndefined();
    expect(p.all).toEqual({ per: 3.33, items: 30, minutes: 100 });
  });
  it('gives no pace from fewer than five items: that is one sitting, not a pace', () => {
    const p = stPlanPace([log('Problems', 40, 4)]);
    expect(p.all).toBeNull();
    expect(p.kinds).toEqual({});
    expect(stPlanPace(null)).toEqual({ all: null, kinds: {} });
  });
  it('is set beside the minutes per item he gave a phase, and stands in for them when he gave none', () => {
    let n = 0;
    const row = (title: string, values: Record<string, unknown>) => ({ pageId: `p-${++n}`, title, values });
    const rules = (minutes: unknown) => stPlanRules({
      plan: { 'Exam Date': '2027-02-01', 'Start Date': '2027-01-04', 'Hours Goal': 0, Following: 'Standard' },
      week: [row('Every day', { Days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], Account: 'Personal', Floor: 1, Standard: 2, Stretch: 3 })],
      phases: [row('Problems', { Kind: 'Study', Start: '2027-01-04', End: '2027-01-31', Items: 600, 'Minutes per Item': minutes })],
    });
    const pace = stPlanPace([log('Problems', 900, 100)]);          // 9 min an item
    const given = rules(5);
    const [a] = stPlanPhases(given, stPlanDays(given), pace);      // 28 days at 2 h is 56 h
    expect(a.fit).toMatchObject({ needs: 50, short: ['Floor'], given: true, measured: { per: 9, items: 100, needs: 90, short: ['Floor', 'Standard', 'Stretch'] } });
    const none = rules(null);
    const [b] = stPlanPhases(none, stPlanDays(none), pace);
    expect(b.fit).toMatchObject({ needs: 90, given: false });
    const [c] = stPlanPhases(none, stPlanDays(none));
    expect(c.fit).toBeNull();
  });
  it('is said with what it rests on', () => {
    expect(stPlanPaceWords({ per: 9, items: 100, needs: 90 }, 56)).toBe('At your pace (9 min an item, over 100 items) it needs 90 h, has 56 h.');
    expect(stPlanPaceWords({ per: 4, items: 30, needs: 40 }, 56)).toBe('At your pace (4 min an item, over 30 items) it fits: 40 h of work in 56 h.');
    expect(stPlanPaceWords(null, 56)).toBe('');
  });
});

describe('the weekly look back', () => {
  const { stHomeLookBack } = T;
  // Wednesday 2027-01-13; last week is Mon 4 to Sun 10, this week Mon 11 to Sun 17.
  const day = (date: string, planned: number, type = planned > 0 ? 'Study' : 'Rest') => ({ date, planned, type });
  const days = [
    day('2027-01-04', 2), day('2027-01-05', 2), day('2027-01-06', 2), day('2027-01-07', 2), day('2027-01-08', 2), day('2027-01-09', 4), day('2027-01-10', 0),
    day('2027-01-11', 2), day('2027-01-12', 2), day('2027-01-13', 2), day('2027-01-14', 2), day('2027-01-15', 0, 'Holiday'), day('2027-01-16', 4), day('2027-01-17', 0),
    day('2027-01-18', 2),
  ];
  it('says what last week planned, what was done and what slipped', () => {
    const done = new Map([['2027-01-04', 2], ['2027-01-06', 1.5], ['2027-01-09', 3], ['2027-01-12', 9]]);
    expect(stHomeLookBack(days, done, '2027-01-13')).toMatchObject({ monday: '2027-01-04', planned: 14, done: 6.5, slipped: 7.5 });
  });
  it('offers this week\'s study days still to come, today among them, and the next free day that is no holiday', () => {
    const look = stHomeLookBack(days, new Map(), '2027-01-13');
    expect(look.spread).toEqual(['2027-01-13', '2027-01-14', '2027-01-16']);
    expect(look.free).toBe('2027-01-17');
  });
  it('has nothing slipped when more was done than planned, and nothing at all in a plan\'s first week', () => {
    expect(stHomeLookBack(days, new Map([['2027-01-05', 20]]), '2027-01-13').slipped).toBe(0);
    expect(stHomeLookBack(days, new Map(), '2027-01-06')).toBeNull();
  });
});
