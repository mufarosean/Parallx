// Dashboard timer: the interval arithmetic behind the widget. Settings
// clamped and migrated, the focus/short/long cycle, the finish-time estimate
// for the open tasks, the streak and the day's totals.
import { describe, it, expect } from 'vitest';
import {
  readConfig, DEFAULT_TIMER_CONFIG, parseState, nextMode, minutesFor, finishEstimate,
  dayStreak, todaySummary, lastDays, fmtClock, fmtHours,
} from '../../src/built-in/dashboard/widgets/timerLogic.js';

const DAY = 86400000;
const NOW = Date.parse('2026-09-08T14:00:00');
const cfg = DEFAULT_TIMER_CONFIG;
const focus = (startedAt: number, minutes = 25) => ({ startedAt, minutes, label: 'Focus', mode: 'focus' as const });

describe('readConfig', () => {
  it('clamps, defaults, and still reads the old minutes field as the focus length', () => {
    expect(readConfig(undefined)).toEqual(cfg);
    expect(readConfig({ minutes: 50, label: '  Deep Work ' })).toMatchObject({ focusMinutes: 50, label: 'Deep Work' });
    expect(readConfig({ focusMinutes: 0, longBreakInterval: 99, alarmVolume: 250, alarm: 'kazoo', autoStartBreaks: 'true' }))
      .toMatchObject({ focusMinutes: 1, longBreakInterval: 12, alarmVolume: 100, alarm: 'bell', autoStartBreaks: true });
  });
});

describe('the cycle', () => {
  it('goes focus, short, focus, short, focus, short, focus, long', () => {
    let m: 'focus' | 'short' | 'long' = 'focus'; let c = 0;
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) { const nx = nextMode(m, c, 4); m = nx.mode; c = nx.cycle; seen.push(m); }
    expect(seen).toEqual(['short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus']);
    expect(c).toBe(0);
    expect(minutesFor('long', cfg)).toBe(15);
  });
  it('parses a saved state and drops what it cannot trust', () => {
    const s = parseState(JSON.stringify({ mode: 'short', cycle: 2, tasks: [{ id: 'a', title: 'Read', est: 3, act: 1 }, { bad: true }], activeTaskId: 'a', log: [focus(NOW)] }));
    expect(s.mode).toBe('short');
    expect(s.tasks).toHaveLength(1);
    expect(s.activeTaskId).toBe('a');
    expect(parseState('nonsense').mode).toBe('focus');
    expect(parseState(JSON.stringify({ activeTaskId: 'ghost', tasks: [] })).activeTaskId).toBeNull();
  });
});

describe('finishEstimate', () => {
  const tasks = [
    { id: 'a', title: 'A', est: 3, act: 1, done: false, createdAt: 0 },
    { id: 'b', title: 'B', est: 2, act: 0, done: false, createdAt: 0 },
    { id: 'c', title: 'C', est: 5, act: 0, done: true, createdAt: 0 },
  ];
  it('adds the intervals left with the breaks between them, counting the current one for what is left of it', () => {
    // 4 intervals left. Focus running with 10 minutes left, cycle 0:
    // 10 + short 5 + focus 25 + short 5 + focus 25 + short 5 + focus 25 = 100 minutes.
    const e = finishEstimate(tasks, cfg, 'focus', 0, 10 * 60_000, NOW)!;
    expect(e.intervals).toBe(4);
    expect(e.minutes).toBe(100);
    expect(e.at).toBe(NOW + 100 * 60_000);
  });
  it('earns the long break inside the run when the cycle reaches the interval', () => {
    // cycle 3: the running focus completes the cycle, so the first break is the long one.
    const e = finishEstimate(tasks, cfg, 'focus', 3, 25 * 60_000, NOW)!;
    expect(e.minutes).toBe(25 + 15 + 25 + 5 + 25 + 5 + 25);
  });
  it('starts from a break by adding the whole first focus', () => {
    const e = finishEstimate(tasks.slice(1, 2), cfg, 'short', 1, 2 * 60_000, NOW)!;
    expect(e.minutes).toBe(2 + 25 + 5 + 25);
  });
  it('is null with nothing estimated', () => {
    expect(finishEstimate([tasks[2]], cfg, 'focus', 0, 0, NOW)).toBeNull();
  });
});

describe('the report', () => {
  const log = [focus(NOW - 2 * DAY), focus(NOW - 1 * DAY), focus(NOW - 1 * DAY + 3600000, 50), focus(NOW - 3600000), { startedAt: NOW - 1800000, minutes: 5, label: 'Break', mode: 'short' as const }];
  it('counts a streak of days with focus, today included when it has one', () => {
    expect(dayStreak(log, NOW)).toBe(3);
    expect(dayStreak(log.slice(0, 3), NOW)).toBe(2);        // nothing today yet: ends yesterday
    expect(dayStreak([focus(NOW - 3 * DAY)], NOW)).toBe(0);
  });
  it('totals today and the last seven days, focus only', () => {
    expect(todaySummary(log, NOW)).toEqual({ sessions: 1, minutes: 25 });
    const week = lastDays(log, NOW, 7);
    expect(week).toHaveLength(7);
    expect(week[6].minutes).toBe(25);
    expect(week[5].minutes).toBe(75);
    expect(week[0].minutes).toBe(0);
  });
  it('formats', () => {
    expect(fmtClock(25 * 60_000)).toBe('25:00');
    expect(fmtClock(61_000)).toBe('1:01');
    expect(fmtHours(45)).toBe('45m');
    expect(fmtHours(126)).toBe('2.1h');
  });
});
