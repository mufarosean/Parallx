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
