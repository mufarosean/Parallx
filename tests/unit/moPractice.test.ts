/**
 * Practice engine math (M104), extracted verbatim from Media Organizer's
 * @mo-practice-pure region: sizing arithmetic, the picker, the neglected
 * order, the day key, the clock face and the summary.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPure(): Record<string, any> {
  const src = readFileSync(resolve(__dirname, '../../ext/media-organizer/main.js'), 'utf8');
  const a = src.indexOf('// @mo-practice-pure-begin');
  const b = src.indexOf('// @mo-practice-pure-end');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const names = ['moPracticeRng', 'moPracticeSizing', 'moPracticeFormatDuration', 'moPracticeSizingText', 'moPracticeClock',
    'moPracticeOrder', 'moPracticePick', 'moPracticeNeglected', 'moPracticeDayKey', 'moPracticeSummary'];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(src.slice(a, b) + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadPure();

describe('sizing', () => {
  it('pictures and time per picture gives the total', () => {
    expect(P.moPracticeSizing({ mode: 'count', count: 10, secondsPer: 120 })).toEqual({ mode: 'count', secondsPer: 120, count: 10, totalSeconds: 1200, spareSeconds: 0 });
  });
  it('total time and time per picture gives the count, rounded down, with the spare', () => {
    expect(P.moPracticeSizing({ mode: 'total', totalSeconds: 45 * 60, secondsPer: 120 })).toEqual({ mode: 'total', secondsPer: 120, count: 22, totalSeconds: 2640, spareSeconds: 60 });
  });
  it('guards zero and negative input', () => {
    expect(P.moPracticeSizing({ mode: 'count', count: -3, secondsPer: 0 }).count).toBe(0);
    expect(P.moPracticeSizing({ mode: 'total', totalSeconds: 30, secondsPer: 60 }).count).toBe(0);
  });
  it('reads back as the sentence in the spec', () => {
    expect(P.moPracticeSizingText({ mode: 'total', totalSeconds: 45 * 60, secondsPer: 120 })).toBe('45 min at 2 min each = 22 pictures, 1 min to spare');
    expect(P.moPracticeSizingText({ mode: 'count', count: 10, secondsPer: 120 })).toBe('10 pictures at 2 min each = 20 min');
    expect(P.moPracticeSizingText({ mode: 'count', count: 1, secondsPer: 30 })).toBe('1 picture at 30 s each = 30 s');
  });
});

describe('durations and the clock', () => {
  it('formats seconds, minutes and hours', () => {
    expect(P.moPracticeFormatDuration(45)).toBe('45 s');
    expect(P.moPracticeFormatDuration(120)).toBe('2 min');
    expect(P.moPracticeFormatDuration(150)).toBe('2 min 30 s');
    expect(P.moPracticeFormatDuration(5400)).toBe('1 h 30 min');
    expect(P.moPracticeFormatDuration(0)).toBe('0 s');
  });
  it('shows m:ss and never goes negative', () => {
    expect(P.moPracticeClock(125)).toBe('2:05');
    expect(P.moPracticeClock(0.4)).toBe('0:01');
    expect(P.moPracticeClock(-3)).toBe('0:00');
  });
});

describe('picker', () => {
  const day = 86400000;
  const pool = [
    { id: 1, lastDrawnAt: 10 * day },
    { id: 2, lastDrawnAt: null },
    { id: 3, lastDrawnAt: 1 * day },
    { id: 4, lastDrawnAt: null },
    { id: 5, lastDrawnAt: 5 * day },
  ];
  it('orders never-drawn first, then oldest', () => {
    const ids = P.moPracticeOrder(pool, P.moPracticeRng(1)).map((c: any) => c.id);
    expect(ids.slice(0, 2).sort()).toEqual([2, 4]);
    expect(ids.slice(2)).toEqual([3, 5, 1]);
  });
  it('picks the n least recently drawn with no repeats', () => {
    const picked = P.moPracticePick(pool, 3, P.moPracticeRng(7)).map((c: any) => c.id).sort();
    expect(picked).toEqual([2, 3, 4]);
    expect(new Set(picked).size).toBe(3);
  });
  it('returns fewer than asked when the pool is small', () => {
    expect(P.moPracticePick(pool, 20, P.moPracticeRng(3)).length).toBe(5);
    expect(P.moPracticePick([], 5, P.moPracticeRng(3))).toEqual([]);
  });
  it('is reproducible for a seed and breaks ties at random across seeds', () => {
    const a = P.moPracticePick(pool, 5, P.moPracticeRng(42)).map((c: any) => c.id);
    const b = P.moPracticePick(pool, 5, P.moPracticeRng(42)).map((c: any) => c.id);
    expect(a).toEqual(b);
    const equals = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, lastDrawnAt: null }));
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) firsts.add(P.moPracticeOrder(equals, P.moPracticeRng(seed))[0].id);
    expect(firsts.size).toBeGreaterThan(1);
  });
  it('the neglected list is the oldest first, in order', () => {
    const ids = P.moPracticeNeglected(pool, 3, P.moPracticeRng(1)).map((c: any) => c.id);
    expect(ids.slice(0, 2).sort()).toEqual([2, 4]);
    expect(ids[2]).toBe(3);
  });
});

describe('day key and summary', () => {
  it('keys on the local calendar day', () => {
    expect(P.moPracticeDayKey(new Date(2026, 8, 12, 23, 30))).toBe('2026-09-12');
    expect(P.moPracticeDayKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
  it('sums only pictures that were shown', () => {
    const sum = P.moPracticeSummary([
      { outcome: 'done', planned_seconds: 120, spent_seconds: 120 },
      { outcome: 'skipped', planned_seconds: 120, spent_seconds: 40 },
      { outcome: 'pending', planned_seconds: 120, spent_seconds: 0 },
    ]);
    expect(sum).toEqual({ shown: 2, done: 1, skipped: 1, plannedSeconds: 240, spentSeconds: 160 });
  });
});
