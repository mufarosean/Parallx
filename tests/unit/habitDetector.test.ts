import { describe, expect, it } from 'vitest';

import { HabitDetector } from '../../src/openclaw/mind/habitDetector';

const DAY = 24 * 60 * 60 * 1000;
const HM = (day: number, hour: number, min = 0) => day * DAY + (hour * 60 + min) * 60000;

describe('HabitDetector — "you do this every morning"', () => {
  it('detects a daily ~8am habit after enough mornings', () => {
    const h = new HabitDetector({ minDays: 3, toleranceMin: 75 });
    h.observe('refresh:AI News', HM(0, 8, 2));
    h.observe('refresh:AI News', HM(1, 8, 10));
    h.observe('refresh:AI News', HM(2, 7, 55));
    h.observe('refresh:AI News', HM(3, 8, 5));
    const r = h.reading('refresh:AI News', HM(3, 12));
    expect(r.isDailyHabit).toBe(true);
    expect(r.typicalTime).toMatch(/^0[78]:/); // ~8am
    expect(r.daysObserved).toBe(4);
    expect(r.confidence).toBeGreaterThan(0.4);
  });

  it('does NOT call it a habit when the times are scattered through the day', () => {
    const h = new HabitDetector({ minDays: 3, toleranceMin: 75 });
    h.observe('thing', HM(0, 3));
    h.observe('thing', HM(1, 13));
    h.observe('thing', HM(2, 21));
    h.observe('thing', HM(3, 9));
    expect(h.reading('thing', HM(3, 22)).isDailyHabit).toBe(false);
  });

  it('needs enough distinct days (two occurrences on one day is not a habit)', () => {
    const h = new HabitDetector({ minDays: 3 });
    h.observe('x', HM(0, 8));
    h.observe('x', HM(0, 8, 30));
    expect(h.reading('x', HM(0, 9)).isDailyHabit).toBe(false);
  });

  it('handles the midnight wraparound (23:55 and 00:05 are close, not 23h apart)', () => {
    const h = new HabitDetector({ minDays: 3, toleranceMin: 60 });
    h.observe('night', HM(0, 23, 55));
    h.observe('night', HM(1, 0, 5));
    h.observe('night', HM(2, 23, 50));
    h.observe('night', HM(3, 0, 10));
    const r = h.reading('night', HM(3, 12));
    expect(r.isDailyHabit).toBe(true); // not fooled by the day boundary
  });

  it('habits() lists confirmed daily habits, strongest first', () => {
    const h = new HabitDetector({ minDays: 3, toleranceMin: 75 });
    for (let d = 0; d < 5; d++) h.observe('refresh:AI News', HM(d, 8, (d % 3)));
    h.observe('rare', HM(0, 14));
    const habits = h.habits(HM(4, 12));
    expect(habits.map(x => x.action)).toContain('refresh:AI News');
    expect(habits.map(x => x.action)).not.toContain('rare');
  });

  it('forgets occurrences outside the window', () => {
    const h = new HabitDetector({ windowDays: 5, minDays: 3 });
    h.observe('x', HM(0, 8));
    h.observe('x', HM(1, 8));
    h.observe('x', HM(2, 8));
    expect(h.reading('x', HM(30, 8)).daysObserved).toBe(0); // all outside the 5-day window
  });

  it('round-trips through serialize/restore', () => {
    const h = new HabitDetector({ minDays: 3 });
    for (let d = 0; d < 4; d++) h.observe('x', HM(d, 8));
    const state = JSON.parse(JSON.stringify(h.toState()));
    const h2 = new HabitDetector({ minDays: 3 });
    h2.restore(state);
    expect(h2.reading('x', HM(3, 12)).isDailyHabit).toBe(true);
  });
});
