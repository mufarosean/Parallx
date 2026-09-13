/**
 * platform/storedTime: the workspace database's timestamps. SQLite writes
 * 'YYYY-MM-DD HH:MM:SS' in UTC with no zone mark; read naively, JavaScript
 * takes that as local time (a page edited at 13:05 in Chicago showed 18:05).
 * Seen live: a page's Created (an ISO string from the AI's tools) and Updated
 * (SQLite's form) looked like different time zones and out of order.
 */

import { describe, it, expect } from 'vitest';
import { sqliteUtcNow, parseStoredTime, formatStoredTimeForModel } from '../../src/platform/storedTime';

describe('stored times', () => {
  it('writes the same text as SQLite datetime(\'now\'): UTC, space, seconds', () => {
    expect(sqliteUtcNow(new Date(Date.UTC(2026, 8, 11, 17, 47, 56, 668)))).toBe('2026-09-11 17:47:56');
    expect(sqliteUtcNow()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('reads SQLite\'s form as UTC, whatever the local zone', () => {
    expect(parseStoredTime('2026-09-11 18:05:02')).toBe(Date.UTC(2026, 8, 11, 18, 5, 2));
    expect(parseStoredTime('2026-09-11 18:05:02.250')).toBe(Date.UTC(2026, 8, 11, 18, 5, 2, 250));
  });

  it('reads an ISO string by its own zone, and a picked time as local', () => {
    expect(parseStoredTime('2026-09-11T17:47:56.668Z')).toBe(Date.UTC(2026, 8, 11, 17, 47, 56, 668));
    // The date picker's value: local, no zone, no seconds.
    expect(parseStoredTime('2026-09-11T13:05')).toBe(new Date(2026, 8, 11, 13, 5).getTime());
  });

  it('puts the live case in order: created 17:47 UTC (ISO) before updated 18:05 UTC (SQLite)', () => {
    expect(parseStoredTime('2026-09-11T17:47:56.668Z')).toBeLessThan(parseStoredTime('2026-09-11 18:05:02'));
  });

  it('has no time for nothing or garbage', () => {
    for (const v of [null, undefined, '', 'not a date']) expect(Number.isNaN(parseStoredTime(v))).toBe(true);
    expect(parseStoredTime(1234)).toBe(1234);
  });

  it('gives the AI local clock time with its UTC offset', () => {
    const ms = Date.UTC(2026, 8, 11, 18, 5, 2);
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    const zone = `UTC${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (${zone})`;
    expect(formatStoredTimeForModel('2026-09-11 18:05:02')).toBe(expected);
    expect(formatStoredTimeForModel(new Date(ms).toISOString())).toBe(expected);
    expect(formatStoredTimeForModel('garbage')).toBe('garbage');
  });
});
