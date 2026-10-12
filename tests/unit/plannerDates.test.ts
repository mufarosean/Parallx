// plannerDates.test.ts — the Planner's pure helpers, out of its 3,000-line pane.
//
// Dates read and write in the app's Time Zone, so the expectations use
// appTime and hold on any machine; links come out of notes deduplicated,
// web ones normalised and shortened, parallx:// ones kept as the app's own.

import { describe, it, expect } from 'vitest';
import { appTime } from '../../src/services/localTime';
import { formatHour, fromDateTimeInputs, toDateInputValue, toTimeInputValue, addDays, startOfDay, endOfDay, sameDay } from '../../src/built-in/planner/plannerDates';
import { extractLinks, normalizeWebLink } from '../../src/built-in/planner/plannerLinks';

describe('plannerDates', () => {
  it('writes form fields in the app zone and reads them back to the same instant', () => {
    const at = appTime(2026, 2, 5, 9, 30);
    expect(toDateInputValue(at)).toBe('2026-03-05');
    expect(toTimeInputValue(at)).toBe('09:30');
    expect(fromDateTimeInputs('2026-03-05', '09:30')).toBe(at);
    expect(fromDateTimeInputs('2026-03-05', '')).toBe(appTime(2026, 2, 5, 0, 0));
    expect(fromDateTimeInputs('', '09:30')).toBeNull();
    expect(fromDateTimeInputs('not-a-date', '')).toBeNull();
  });

  it('names hours the way a calendar does', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(17)).toBe('5 PM');
  });

  it('starts and ends the day in the app zone, and steps by days', () => {
    const noon = new Date(appTime(2026, 2, 5, 12));
    expect(startOfDay(noon).getTime()).toBe(appTime(2026, 2, 5));
    expect(endOfDay(noon).getTime()).toBe(appTime(2026, 2, 6) - 1);
    expect(sameDay(startOfDay(noon), endOfDay(noon))).toBe(true);
    expect(addDays(noon, 2).getTime()).toBe(appTime(2026, 2, 7, 12));
  });
});

describe('plannerLinks', () => {
  it('normalises web links and refuses other schemes', () => {
    expect(normalizeWebLink('example.com/a')).toBe('https://example.com/a');
    expect(normalizeWebLink('http://example.com')).toBe('http://example.com/');
    expect(normalizeWebLink('javascript:alert(1)')).toBeNull();
    expect(normalizeWebLink('   ')).toBeNull();
  });

  it('pulls web and app links out of notes once each, with short labels', () => {
    const links = extractLinks('See www.example.com/docs/guide, again https://www.example.com/docs/guide. And parallx://canvas/page/abc, parallx://canvas/page/abc.');
    expect(links).toEqual([
      { label: 'example.com/docs/guide', href: 'https://www.example.com/docs/guide', kind: 'web' },
      { label: 'parallx://canvas/page/abc', href: 'parallx://canvas/page/abc', kind: 'internal' },
    ]);
    const long = extractLinks('https://example.com/' + 'a'.repeat(60))[0];
    expect(long.label.length).toBe(42);
    expect(long.label.endsWith('…')).toBe(true);
    expect(extractLinks('')).toEqual([]);
  });
});
