import { describe, it, expect } from 'vitest';
import { workForQuiz } from '../../src/built-in/worksheet/quizSheet';

const a = (id: number, startedAt: number, updatedAt = startedAt) => ({ id, startedAt, updatedAt });

describe('a quiz opens problems clean', () => {
  it('earlier unfinished work is set aside and not shown', () => {
    const open = a(1, 100, 150);
    expect(workForQuiz(open, open, 500)).toEqual({ open: null, prior: null, setAside: open });
  });
  it('earlier finished work is not shown', () => {
    expect(workForQuiz(null, a(2, 100, 200), 500)).toEqual({ open: null, prior: null, setAside: null });
  });
  it('work begun in the quiz comes back on resume', () => {
    const open = a(3, 600, 700);
    expect(workForQuiz(open, open, 500)).toEqual({ open, prior: null, setAside: null });
    const rated = a(4, 550, 650);
    expect(workForQuiz(null, rated, 500)).toEqual({ open: null, prior: rated, setAside: null });
  });
});
