import { describe, it, expect } from 'vitest';
import {
  parseRRule,
  expandRecurrence,
  buildSimpleRRule,
  rruleToPreset,
  describeRRule,
  setRRuleUntil,
} from '../../src/built-in/planner/plannerRecurrence.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
// Mon Jan 5 2026 09:00 local. January avoids DST shifts in the test windows.
const base = new Date(2026, 0, 5, 9, 0, 0, 0).getTime();

describe('plannerRecurrence', () => {
  describe('parseRRule', () => {
    it('parses daily with default interval', () => {
      expect(parseRRule('FREQ=DAILY')).toMatchObject({ freq: 'DAILY', interval: 1 });
    });
    it('parses interval + count', () => {
      expect(parseRRule('FREQ=DAILY;INTERVAL=2;COUNT=5')).toMatchObject({ freq: 'DAILY', interval: 2, count: 5 });
    });
    it('parses weekly BYDAY into weekday numbers', () => {
      expect(parseRRule('FREQ=WEEKLY;BYDAY=MO,WE')).toMatchObject({ freq: 'WEEKLY', byDay: [1, 3] });
    });
    it('strips an RRULE: prefix', () => {
      expect(parseRRule('RRULE:FREQ=YEARLY')).toMatchObject({ freq: 'YEARLY' });
    });
    it('rejects malformed / empty rules', () => {
      expect(parseRRule('nonsense')).toBeNull();
      expect(parseRRule('')).toBeNull();
      expect(parseRRule('FREQ=HOURLY')).toBeNull();
    });
  });

  describe('expandRecurrence', () => {
    it('daily fills the window inclusively', () => {
      const occ = expandRecurrence(base, HOUR, 'FREQ=DAILY', base, base + 7 * DAY);
      expect(occ.length).toBe(8);
      expect(occ[0].startAt).toBe(base);
      expect(occ[1].startAt - occ[0].startAt).toBe(DAY);
    });
    it('respects COUNT', () => {
      const occ = expandRecurrence(base, HOUR, 'FREQ=DAILY;COUNT=3', base, base + 30 * DAY);
      expect(occ.length).toBe(3);
    });
    it('respects INTERVAL', () => {
      const occ = expandRecurrence(base, HOUR, 'FREQ=DAILY;INTERVAL=2', base, base + 6 * DAY);
      expect(occ.map(o => o.startAt)).toEqual([base, base + 2 * DAY, base + 4 * DAY, base + 6 * DAY]);
    });
    it('weekly BYDAY emits the requested weekdays (Mon/Wed)', () => {
      const occ = expandRecurrence(base, HOUR, 'FREQ=WEEKLY;BYDAY=MO,WE', base, base + 13 * DAY);
      expect(occ.map(o => new Date(o.startAt).getDay())).toEqual([1, 3, 1, 3]);
    });
    it('only returns occurrences intersecting the window', () => {
      const occ = expandRecurrence(base, HOUR, 'FREQ=DAILY', base + 3 * DAY, base + 5 * DAY);
      expect(occ.length).toBe(3);
      expect(occ.every(o => o.endAt >= base + 3 * DAY && o.startAt <= base + 5 * DAY)).toBe(true);
    });
    it('stops at UNTIL', () => {
      const occ = expandRecurrence(base, HOUR, 'FREQ=DAILY;UNTIL=20260108', base, base + 30 * DAY);
      // Jan 5,6,7,8 → 4 occurrences (UNTIL is end-of-day Jan 8).
      expect(occ.length).toBe(4);
    });
    it('returns [] for an unparseable rule', () => {
      expect(expandRecurrence(base, HOUR, 'junk', base, base + DAY)).toEqual([]);
    });
  });

  describe('preset round-trip', () => {
    it('build → preset survives', () => {
      expect(rruleToPreset(buildSimpleRRule('daily'))).toBe('daily');
      expect(rruleToPreset(buildSimpleRRule('weekly', 1))).toBe('weekly');
      expect(rruleToPreset(buildSimpleRRule('monthly'))).toBe('monthly');
      expect(rruleToPreset(buildSimpleRRule('yearly'))).toBe('yearly');
      expect(rruleToPreset(buildSimpleRRule('none'))).toBe('none');
    });
    it('non-preset rules read as custom', () => {
      expect(rruleToPreset('FREQ=DAILY;INTERVAL=3')).toBe('custom');
      expect(rruleToPreset('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('custom');
    });
    it('describeRRule is human-readable', () => {
      expect(describeRRule(null)).toBe('Does not repeat');
      expect(describeRRule('FREQ=WEEKLY;BYDAY=MO,WE')).toContain('Mon');
      expect(describeRRule('FREQ=MONTHLY')).toBe('Repeats monthly');
    });
  });

  describe('setRRuleUntil (series split / truncate)', () => {
    it('adds a UTC Z UNTIL and preserves other parts', () => {
      const capped = setRRuleUntil('FREQ=WEEKLY;BYDAY=MO', base);
      expect(capped).toContain('FREQ=WEEKLY');
      expect(capped).toContain('BYDAY=MO');
      expect(capped).toMatch(/UNTIL=\d{8}T\d{6}Z$/);
    });
    it('replaces any existing UNTIL/COUNT (RFC forbids both)', () => {
      const capped = setRRuleUntil('FREQ=DAILY;COUNT=10;UNTIL=20260101T000000Z', base);
      expect(capped).not.toContain('COUNT');
      expect((capped.match(/UNTIL=/g) ?? []).length).toBe(1);
    });
    it('round-trips through parseRRule to the capped instant', () => {
      const capped = setRRuleUntil('FREQ=DAILY', base - 1000);
      expect(parseRRule(capped)!.until).toBe(Math.floor((base - 1000) / 1000) * 1000);
    });
    it('capping a daily series before day 3 keeps days 0-2 and drops 3+', () => {
      // Split at the day-3 occurrence: cap the base 1s before it.
      const changePoint = base + 3 * DAY;
      const capped = setRRuleUntil('FREQ=DAILY', changePoint - 1000);
      const occ = expandRecurrence(base, HOUR, capped, base, base + 30 * DAY);
      expect(occ.map(o => o.startAt)).toEqual([base, base + DAY, base + 2 * DAY]);
    });
  });
});

// ─── Month-end / leap-year anchor semantics (RFC 5545 skip, no drift) ────────

describe('expandRecurrence — anchor-day integrity', () => {
  it('monthly on the 31st SKIPS short months and never drifts (Jan 31 → Mar 31, not Mar 3)', () => {
    const jan31 = new Date(2026, 0, 31, 10, 0, 0).getTime();
    const out = expandRecurrence(jan31, HOUR, 'FREQ=MONTHLY',
      new Date(2026, 0, 1).getTime(), new Date(2026, 11, 31, 23, 59).getTime());

    const days = out.map(o => {
      const d = new Date(o.startAt);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    // 31-day months of 2026 only — February/April/June/September/November skipped.
    expect(days).toEqual(['1/31', '3/31', '5/31', '7/31', '8/31', '10/31', '12/31']);
    // Every occurrence keeps the 10:00 wall-clock time.
    for (const o of out) expect(new Date(o.startAt).getHours()).toBe(10);
  });

  it('monthly on the 30th skips only February', () => {
    const jan30 = new Date(2026, 0, 30, 9, 0, 0).getTime();
    const out = expandRecurrence(jan30, HOUR, 'FREQ=MONTHLY',
      new Date(2026, 0, 1).getTime(), new Date(2026, 5, 30, 23, 59).getTime());
    const days = out.map(o => new Date(o.startAt).getDate());
    const months = out.map(o => new Date(o.startAt).getMonth() + 1);
    expect(days.every(d => d === 30)).toBe(true);
    expect(months).toEqual([1, 3, 4, 5, 6]); // no February
  });

  it('yearly on Feb 29 fires ONLY in leap years, never drifting to Mar 1', () => {
    const feb29 = new Date(2024, 1, 29, 12, 0, 0).getTime();
    const out = expandRecurrence(feb29, HOUR, 'FREQ=YEARLY',
      new Date(2024, 0, 1).getTime(), new Date(2032, 11, 31).getTime());
    const stamps = out.map(o => {
      const d = new Date(o.startAt);
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    });
    expect(stamps).toEqual(['2024-2-29', '2028-2-29', '2032-2-29']);
  });

  it('COUNT counts only REAL occurrences — skipped short months do not consume it', () => {
    const jan31 = new Date(2026, 0, 31, 10, 0, 0).getTime();
    const out = expandRecurrence(jan31, HOUR, 'FREQ=MONTHLY;COUNT=3',
      new Date(2026, 0, 1).getTime(), new Date(2026, 11, 31).getTime());
    const days = out.map(o => `${new Date(o.startAt).getMonth() + 1}/${new Date(o.startAt).getDate()}`);
    expect(days).toEqual(['1/31', '3/31', '5/31']);
  });
});

// ─── Long-lived series reach today's window (fast-forward) ───────────────────

describe('expandRecurrence — old series stay visible', () => {
  it('a daily series started 3+ years ago still appears in the current week', () => {
    const threeYearsAgo = new Date(2023, 3, 10, 8, 0, 0).getTime();
    const from = new Date(2026, 6, 13).getTime();
    const to = new Date(2026, 6, 20).getTime();
    const out = expandRecurrence(threeYearsAgo, 30 * 60_000, 'FREQ=DAILY', from, to);
    expect(out.length).toBeGreaterThanOrEqual(7);
    for (const o of out) expect(new Date(o.startAt).getHours()).toBe(8);
  });

  it('a weekly series started 5 years ago still appears', () => {
    const fiveYearsAgo = new Date(2021, 5, 7, 14, 0, 0).getTime(); // a Monday
    const from = new Date(2026, 6, 13).getTime(); // Monday
    const to = new Date(2026, 6, 20).getTime();
    const out = expandRecurrence(fiveYearsAgo, HOUR, 'FREQ=WEEKLY', from, to);
    expect(out.length).toBe(1);
    expect(new Date(out[0].startAt).getDay()).toBe(1); // still a Monday
    expect(new Date(out[0].startAt).getHours()).toBe(14);
  });

  it('an old monthly-31st series is correct AND visible years later', () => {
    const start = new Date(2022, 0, 31, 9, 0, 0).getTime();
    const from = new Date(2026, 6, 1).getTime();
    const to = new Date(2026, 8, 30).getTime();
    const out = expandRecurrence(start, HOUR, 'FREQ=MONTHLY', from, to);
    const days = out.map(o => `${new Date(o.startAt).getMonth() + 1}/${new Date(o.startAt).getDate()}`);
    expect(days).toEqual(['7/31', '8/31']); // September has no 31st
  });
});

// ─── Wall-clock stability across DST ─────────────────────────────────────────

describe('expandRecurrence — DST wall-clock stability', () => {
  it('a daily 9am series keeps 9am across the spring-forward boundary', () => {
    // US DST 2026: begins Mar 8. Window spans the transition.
    const start = new Date(2026, 2, 5, 9, 0, 0).getTime();
    const out = expandRecurrence(start, HOUR, 'FREQ=DAILY',
      new Date(2026, 2, 5).getTime(), new Date(2026, 2, 12).getTime());
    expect(out.length).toBeGreaterThanOrEqual(7);
    for (const o of out) expect(new Date(o.startAt).getHours()).toBe(9);
  });
});
