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
