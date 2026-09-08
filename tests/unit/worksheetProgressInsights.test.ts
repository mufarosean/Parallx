// Worksheets: the dashboard's arithmetic. The workbook's numbers (attempted
// %, the Easy 1 / Medium 0.5 / Hard 0 score) and what it could not say: what
// is due again, what keeps going wrong, where to start, and a timeline from
// every rating with the workbook's own snapshots ahead of it.
import { describe, it, expect } from 'vitest';
import { computeInsights, buildTimeline, dayKey, DUE_DAYS } from '../../src/built-in/worksheet/progressInsights.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00');
const item = (id: number, paper: string, attemptState: string, opts: Partial<{ attemptCount: number; seconds: number; lastAttemptAt: number; quadrant: number }> = {}) => ({
  id, title: `P${id}`, paper, source: 'rf', kind: 'quant', quadrant: opts.quadrant ?? 0,
  attemptState, attemptCount: opts.attemptCount ?? (attemptState && attemptState !== 'open' ? 1 : 0), seconds: opts.seconds ?? 0, lastAttemptAt: opts.lastAttemptAt ?? 0,
});
const attempt = (itemId: number, selfGrade: string, at: number, imported = false) => ({ itemId, selfGrade, at, seconds: 60, imported });

const bank = [
  item(1, 'brosius', 'easy', { lastAttemptAt: NOW - 1 * DAY, seconds: 300 }),
  item(2, 'brosius', 'hard', { lastAttemptAt: NOW - 4 * DAY, attemptCount: 3 }),
  item(3, 'brosius', 'medium', { lastAttemptAt: NOW - 8 * DAY }),
  item(4, 'brosius', '', { quadrant: 1 }),
  item(5, 'clark', 'nailed', { lastAttemptAt: NOW - 2 * DAY }),   // legacy word
  item(6, 'clark', '', { quadrant: 1 }),
  item(7, 'clark', 'open'),
  item(8, '', 'easy'),                                              // generated: not a workbook problem
];
const attempts = [
  attempt(1, 'easy', NOW - 1 * DAY),
  attempt(2, 'hard', NOW - 20 * DAY), attempt(2, 'hard', NOW - 10 * DAY), attempt(2, 'hard', NOW - 4 * DAY),
  attempt(3, 'medium', NOW - 8 * DAY),
  attempt(5, 'nailed', NOW - 2 * DAY),
  attempt(8, 'easy', NOW - 1 * DAY),
];

describe('computeInsights', () => {
  const ins = computeInsights(bank, attempts, [], NOW);
  it('keeps the workbook arithmetic over workbook problems only', () => {
    expect(ins.totalProblems).toBe(7);
    expect(ins.rated).toBe(4);
    expect(ins.attempted).toBeCloseTo(4 / 7);
    expect(ins.score).toBeCloseTo((1 + 0 + 0.5 + 1) / 4);
    expect(ins.seconds).toBe(300);
  });
  it('rolls up per paper with the three bands', () => {
    const brosius = ins.byPaper.find((p) => p.paper === 'brosius')!;
    expect(brosius).toMatchObject({ total: 4, easy: 1, medium: 1, hard: 1, rated: 3 });
    expect(brosius.score).toBeCloseTo(0.5);
    const clark = ins.byPaper.find((p) => p.paper === 'clark')!;
    expect(clark).toMatchObject({ total: 3, easy: 1, rated: 1 });
  });
  it('brings Hard back after three days and Medium after seven, oldest first', () => {
    expect(DUE_DAYS).toEqual({ hard: 3, medium: 7 });
    expect(ins.due.map((d) => [d.item.id, d.rating, d.daysAgo])).toEqual([[3, 'medium', 8], [2, 'hard', 4]]);
  });
  it('flags what keeps going wrong and what is a quick win', () => {
    expect(ins.struggling.map((s) => [s.item.id, s.hardCount, s.attempts])).toEqual([[2, 3, 3]]);
    expect(ins.quickWins.map((q) => q.id)).toEqual([4, 6]);
  });
  it('orders the weakest papers by score once three are rated, else by coverage', () => {
    expect(ins.weakestPapers.map((p) => p.paper)).toEqual(['brosius', 'clark']);
  });
  it('counts this week\'s own ratings, not imported ones', () => {
    const withImport = computeInsights(bank, [...attempts, attempt(4, 'easy', NOW - DAY, true)], [], NOW);
    expect(withImport.ratedThisWeek).toBe(ins.ratedThisWeek);
    expect(ins.ratedThisWeek).toBe(4); // items 1, 2 (4 days ago), 5, 8 within the week; 3 is 8 days old
  });
});

describe('buildTimeline', () => {
  it('walks day by day with the latest rating per problem, workbook snapshots ahead', () => {
    const problems = bank.filter((b) => b.paper);
    const snaps = [{ day: '2026-07-14', attempted: 0.05, score: 0.7 }, { day: dayKey(NOW), attempted: 0.9, score: 0.9 }];
    const tl = buildTimeline(problems, attempts, snaps);
    expect(tl[0]).toEqual({ day: '2026-07-14', attempted: 0.05, score: 0.7, source: 'workbook' });
    const last = tl[tl.length - 1];
    expect(last.day).toBe(dayKey(NOW - DAY));
    expect(last.attempted).toBeCloseTo(4 / 7);
    expect(last.score).toBeCloseTo(0.625);
    // The day item 2 was first rated Hard: one rated, score 0.
    const first = tl.find((p) => p.day === dayKey(NOW - 20 * DAY))!;
    expect(first.attempted).toBeCloseTo(1 / 7);
    expect(first.score).toBe(0);
    // A workbook snapshot dated after the first rating is not used.
    expect(tl.some((p) => p.source === 'workbook' && p.day === dayKey(NOW))).toBe(false);
  });
});
