/**
 * ui/relativeTime — the one clock behind "Edited 14 hours ago" (canvas) and
 * "14h ago" (chat sessions). Both styles share thresholds and the word
 * "yesterday" means yesterday by the calendar, not "24 to 48 hours ago".
 */

import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../../src/ui/relativeTime';

const NOW = new Date(2026, 8, 3, 15, 30).getTime(); // Sep 3 2026 15:30 local
const ago = (ms: number) => NOW - ms;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('formatRelativeTime — long', () => {
  it('just now, minutes, hours', () => {
    expect(formatRelativeTime(ago(20_000), 'long', NOW)).toBe('just now');
    expect(formatRelativeTime(ago(1 * MIN), 'long', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * MIN), 'long', NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(14 * HOUR), 'long', NOW)).toBe('14 hours ago');
  });

  it('yesterday is a calendar day, not 24-48 hours', () => {
    // 16:00 yesterday is 23.5 h ago: still "yesterday", never "23 hours ago"
    // once the day boundary is crossed? No: under a day stays in hours.
    expect(formatRelativeTime(ago(23 * HOUR), 'long', NOW)).toBe('23 hours ago');
    // 26 h ago lands on yesterday's calendar date.
    expect(formatRelativeTime(ago(26 * HOUR), 'long', NOW)).toBe('yesterday');
    // 47 h ago is also yesterday by the calendar (Sep 1 16:30 vs Sep 3): no,
    // that is two days back.
    expect(formatRelativeTime(ago(47 * HOUR), 'long', NOW)).toBe('2 days ago');
  });

  it('days, weeks, then a calendar date', () => {
    expect(formatRelativeTime(ago(3 * DAY), 'long', NOW)).toBe('3 days ago');
    expect(formatRelativeTime(ago(8 * DAY), 'long', NOW)).toBe('1 week ago');
    expect(formatRelativeTime(ago(20 * DAY), 'long', NOW)).toBe('2 weeks ago');
    const date = formatRelativeTime(ago(45 * DAY), 'long', NOW);
    expect(date).toMatch(/Jul/);
    expect(date).not.toMatch(/2026/); // same year: no year
    expect(formatRelativeTime(ago(400 * DAY), 'long', NOW)).toMatch(/2025/);
  });

  it('accepts ISO strings and Dates, and tolerates garbage', () => {
    expect(formatRelativeTime(new Date(ago(2 * HOUR)).toISOString(), 'long', NOW)).toBe('2 hours ago');
    expect(formatRelativeTime(new Date(ago(2 * HOUR)), 'long', NOW)).toBe('2 hours ago');
    expect(formatRelativeTime('not a date', 'long', NOW)).toBe('');
    expect(formatRelativeTime(NOW + 5 * MIN, 'long', NOW)).toBe('just now'); // clock skew
  });
});

describe('formatRelativeTime — short', () => {
  it('compact units for narrow rows', () => {
    expect(formatRelativeTime(ago(20_000), 'short', NOW)).toBe('now');
    expect(formatRelativeTime(ago(5 * MIN), 'short', NOW)).toBe('5m ago');
    expect(formatRelativeTime(ago(14 * HOUR), 'short', NOW)).toBe('14h ago');
    expect(formatRelativeTime(ago(26 * HOUR), 'short', NOW)).toBe('yesterday');
    expect(formatRelativeTime(ago(3 * DAY), 'short', NOW)).toBe('3d ago');
    expect(formatRelativeTime(ago(8 * DAY), 'short', NOW)).toBe('1w ago');
  });
});
