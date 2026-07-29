import { describe, expect, it } from 'vitest';

import { HabitDetector, cronForMinuteOfDay, habitActionForActivity } from '../../src/openclaw/mind/habitDetector';

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

  it('cronForMinuteOfDay builds a daily cron at the time', () => {
    expect(cronForMinuteOfDay(8 * 60 + 5)).toBe('5 8 * * *');
    expect(cronForMinuteOfDay(0)).toBe('0 0 * * *');
    expect(cronForMinuteOfDay(13 * 60 + 30)).toBe('30 13 * * *');
  });

  it('tracks proposed habits (propose once) across serialize/restore', () => {
    const h = new HabitDetector();
    expect(h.wasProposed('x')).toBe(false);
    h.markProposed('x');
    expect(h.wasProposed('x')).toBe(true);
    const h2 = new HabitDetector();
    h2.restore(JSON.parse(JSON.stringify(h.toState())));
    expect(h2.wasProposed('x')).toBe(true);
  });

  it('caps distinct actions by evicting the least recently seen key', () => {
    const h = new HabitDetector({ maxActions: 8 });
    // 8 keys, oldest first; 'a0' was last seen earliest.
    for (let i = 0; i < 8; i++) h.observe(`a${i}`, HM(0, 8, i));
    h.observe('a-new', HM(0, 9)); // 9th key → 'a0' evicted
    const state = h.toState();
    const keys = state.events.map(e => e[0]);
    expect(keys).toHaveLength(8);
    expect(keys).not.toContain('a0');
    expect(keys).toContain('a-new');
    expect(keys).toContain('a7');
  });

  it('the propose-once marker SURVIVES eviction (a dismissed routine must not re-nag if it re-forms)', () => {
    const h = new HabitDetector({ maxActions: 8 });
    for (let i = 0; i < 8; i++) h.observe(`a${i}`, HM(0, 8, i));
    h.markProposed('a0');
    h.observe('a-new', HM(0, 9)); // evicts a0's events...
    expect(h.toState().events.map(e => e[0])).not.toContain('a0');
    expect(h.wasProposed('a0')).toBe(true); // ...but never the marker
  });

  it('restore() enforces the cap immediately on an oversized legacy blob (newest keys kept)', () => {
    const big = new HabitDetector({ maxActions: 1000 });
    for (let i = 0; i < 20; i++) big.observe(`k${i}`, HM(0, 8, i)); // k19 newest
    const small = new HabitDetector({ maxActions: 8 });
    small.restore(JSON.parse(JSON.stringify(big.toState())));
    const keys = small.toState().events.map(e => e[0]);
    expect(keys).toHaveLength(8);
    expect(keys).toContain('k19');
    expect(keys).not.toContain('k0');
  });
});

// ── The activity-journal lane (M93: MIND ← journal) ──────────────────────────
//
// habitActionForActivity decides which journal events count as habit
// observations. Deliberate gestures only; the signal:* sources are excluded
// because they already feed observeAction through their own lane.

describe('habitActionForActivity — journal events as habit observations', () => {
  const ev = (over: Partial<{ actor: string; source: string; verb: string; object: string; count: number }>) => ({
    actor: 'user', source: 'editor', verb: 'opened', object: 'pdf "exam7.pdf"', count: 1, ...over,
  });

  it('maps editor opens and view focus to readable keys', () => {
    expect(habitActionForActivity(ev({}))).toBe('opened pdf "exam7.pdf"');
    expect(habitActionForActivity(ev({ source: 'focus', verb: 'focused', object: 'planner view' })))
      .toBe('focused planner view');
  });

  it('ignores command runs — the command tap cannot tell the user from plumbing or the AI', () => {
    // A scheduled dispatch journaled as `user ran "..."` would train a
    // perfectly time-clustered fake habit (the self-echo loop).
    expect(habitActionForActivity(ev({ source: 'command', verb: 'ran', object: '"View: Toggle Zen Mode"' })))
      .toBeUndefined();
    expect(habitActionForActivity(ev({ source: 'command', verb: 'ran', object: '"parallx.autonomy.signal"' })))
      .toBeUndefined();
  });

  it('ignores non-user actors (assistant/system work is not a user habit)', () => {
    expect(habitActionForActivity(ev({ actor: 'ai' }))).toBeUndefined();
    expect(habitActionForActivity(ev({ actor: 'system' }))).toBeUndefined();
    expect(habitActionForActivity(ev({ actor: 'ext:budget' }))).toBeUndefined();
  });

  it('ignores coalesced re-fires — one burst is one occurrence', () => {
    expect(habitActionForActivity(ev({ count: 2 }))).toBeUndefined();
  });

  it('ignores signal:* sources (they feed observeAction via their own lane)', () => {
    expect(habitActionForActivity(ev({ source: 'signal:canvas', verb: 'signal', object: 'Created page' })))
      .toBeUndefined();
  });

  it('ignores non-gesture verbs (viewing/closed switches are navigation noise)', () => {
    expect(habitActionForActivity(ev({ verb: 'viewing' }))).toBeUndefined();
    expect(habitActionForActivity(ev({ verb: 'closed' }))).toBeUndefined();
    expect(habitActionForActivity(ev({ source: 'window', verb: 'left', object: 'the app window' })))
      .toBeUndefined();
  });
});
