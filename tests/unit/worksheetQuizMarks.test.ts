// Worksheets: Mark For Later. Next Marked walks the marked problems in quiz
// order, round to the start, and never lands on the current one first.
import { describe, it, expect } from 'vitest';
import { nextMarkedIndex } from '../../src/built-in/worksheet/practiceSession.js';

const ids = [10, 20, 30, 40, 50];

describe('nextMarkedIndex', () => {
  it('finds the next marked problem after the current one', () => {
    expect(nextMarkedIndex(ids, new Set([30, 50]), 0)).toBe(2);
    expect(nextMarkedIndex(ids, new Set([30, 50]), 2)).toBe(4);
  });
  it('goes round to the start', () => {
    expect(nextMarkedIndex(ids, new Set([20]), 4)).toBe(1);
    expect(nextMarkedIndex(ids, new Set([20]), 3)).toBe(1);
  });
  it('comes back to the current problem only when it is the one left', () => {
    expect(nextMarkedIndex(ids, new Set([30]), 2)).toBe(2);
    expect(nextMarkedIndex(ids, new Set([30, 40]), 2)).toBe(3);
  });
  it('starts at the first problem from the summary (-1) and from past the end', () => {
    expect(nextMarkedIndex(ids, new Set([10, 40]), -1)).toBe(0);
    expect(nextMarkedIndex(ids, new Set([10, 40]), ids.length)).toBe(0);
  });
  it('returns -1 with nothing marked or nothing in the quiz', () => {
    expect(nextMarkedIndex(ids, new Set(), 1)).toBe(-1);
    expect(nextMarkedIndex([], new Set([10]), 0)).toBe(-1);
    expect(nextMarkedIndex(ids, new Set([99]), 0)).toBe(-1);
  });
});
