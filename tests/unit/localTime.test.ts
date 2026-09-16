/**
 * services/localTime: the one clock everything the model reads is written in.
 * A configured IANA zone wins, anything else means this computer's zone, and
 * every stamp names its zone and never ends in Z.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  assistantTimeZone, formatLocalDate, formatLocalDateTime, formatLocalTime,
  isValidTimeZone, machineTimeZone, resolveTimeZone, setAssistantTimeZone,
} from '../../src/services/localTime';

// 2026-09-16T12:31:02Z: 07:31 in Chicago (CDT), 13:31 in London (BST), 21:31 in Tokyo.
const T = Date.UTC(2026, 8, 16, 12, 31, 2);

afterEach(() => setAssistantTimeZone(''));

describe('resolveTimeZone', () => {
  it('takes a valid IANA name as given and treats everything else as this computer', () => {
    expect(resolveTimeZone('America/Chicago')).toBe('America/Chicago');
    expect(resolveTimeZone(' Europe/London ')).toBe('Europe/London');
    for (const v of ['', '   ', 'system', 'local', 'Central', 'America/Nowhere', undefined, null]) {
      expect(resolveTimeZone(v as string)).toBe(machineTimeZone());
    }
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
  it('is what the assistant uses once set, and falls back when the setting is bad', () => {
    setAssistantTimeZone('Asia/Tokyo');
    expect(assistantTimeZone()).toBe('Asia/Tokyo');
    setAssistantTimeZone('not a zone');
    expect(assistantTimeZone()).toBe(machineTimeZone());
  });
});

describe('formatting', () => {
  it('writes the date, the time and the zone name, in the configured zone', () => {
    setAssistantTimeZone('America/Chicago');
    expect(formatLocalDateTime(T)).toBe('2026-09-16 07:31 CDT');
    expect(formatLocalDateTime(T, { seconds: true })).toBe('2026-09-16 07:31:02 CDT');
    expect(formatLocalDateTime(T, { bare: true })).toBe('2026-09-16 07:31');
    expect(formatLocalTime(T)).toBe('07:31');
    expect(formatLocalDate(T)).toBe('2026-09-16');
    expect(formatLocalDateTime(new Date(T))).toBe('2026-09-16 07:31 CDT');
  });
  it('crosses the day line with the zone, so the date is the user\'s date', () => {
    expect(formatLocalDate(T, { timeZone: 'Asia/Tokyo' })).toBe('2026-09-16');
    expect(formatLocalDate(Date.UTC(2026, 8, 16, 16, 0), { timeZone: 'Asia/Tokyo' })).toBe('2026-09-17');
    expect(formatLocalTime(Date.UTC(2026, 8, 16, 15, 0), { timeZone: 'Asia/Tokyo' })).toBe('00:00');
  });
  it('never produces an ISO-UTC stamp', () => {
    setAssistantTimeZone('Europe/London');
    const s = formatLocalDateTime(T, { seconds: true });
    expect(s).toBe('2026-09-16 13:31:02 GMT+1');
    expect(s).not.toMatch(/Z$|T\d\d:/);
  });
});
