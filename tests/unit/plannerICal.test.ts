import { describe, it, expect } from 'vitest';
import {
  buildICalendar,
  escapeICalText,
  foldICalLine,
  formatICalUTC,
  formatICalDate,
} from '../../src/built-in/planner/plannerICal.js';
import type { PlannerEvent, PlannerTask } from '../../src/built-in/planner/plannerTypes.js';

function makeEvent(over: Partial<PlannerEvent> = {}): PlannerEvent {
  return {
    id: 'event-1',
    title: 'Standup',
    description: null,
    startAt: Date.UTC(2026, 0, 5, 9, 0, 0),
    endAt: Date.UTC(2026, 0, 5, 9, 30, 0),
    allDay: false,
    location: null,
    calendarId: 'cal-personal',
    color: null,
    recurrence: null,
    sourceProvider: null,
    sourceId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function makeTask(over: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: 'task-1',
    title: 'Pay rent',
    description: null,
    status: 'planned',
    dueAt: Date.UTC(2026, 0, 10, 17, 0, 0),
    reminderAt: null,
    reminderFired: false,
    completedAt: null,
    tags: [],
    calendarId: 'cal-tasks',
    color: null,
    sourceUri: null,
    sourceProvider: null,
    sourceId: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('plannerICal helpers', () => {
  it('escapes TEXT special characters', () => {
    expect(escapeICalText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeICalText('line1\nline2')).toBe('line1\\nline2');
  });

  it('formats UTC date-time and floating DATE', () => {
    expect(formatICalUTC(Date.UTC(2026, 0, 5, 9, 0, 0))).toBe('20260105T090000Z');
    expect(formatICalDate(new Date(2026, 0, 5).getTime())).toBe('20260105');
  });

  it('folds long lines to ≤75 octets with a leading-space continuation', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(200);
    const folded = foldICalLine(long);
    const segments = folded.split('\r\n');
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].length).toBe(75);
    expect(segments.slice(1).every(s => s.startsWith(' '))).toBe(true);
    expect(segments.every(s => s.length <= 75)).toBe(true);
  });
});

describe('buildICalendar', () => {
  it('wraps a valid VCALENDAR envelope with CRLF lines', () => {
    const ics = buildICalendar({ events: [makeEvent()], nowMs: 0 });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('PRODID:-//Parallx//Planner//EN');
    expect(ics).toContain('\r\n'); // CRLF terminated
  });

  it('emits a timed VEVENT with UTC DTSTART/DTEND and SUMMARY', () => {
    const ics = buildICalendar({ events: [makeEvent({ location: 'Room 2' })], nowMs: 0 });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:event-1@parallx.app');
    expect(ics).toContain('DTSTART:20260105T090000Z');
    expect(ics).toContain('DTEND:20260105T093000Z');
    expect(ics).toContain('SUMMARY:Standup');
    expect(ics).toContain('LOCATION:Room 2');
  });

  it('emits the stored RRULE verbatim for a recurring event', () => {
    const ics = buildICalendar({ events: [makeEvent({ recurrence: 'FREQ=WEEKLY;BYDAY=MO' })], nowMs: 0 });
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('uses VALUE=DATE with an exclusive DTEND for all-day events', () => {
    const ev = makeEvent({
      allDay: true,
      startAt: new Date(2026, 0, 5, 0, 0, 0).getTime(),
      endAt: new Date(2026, 0, 5, 23, 59, 59).getTime(),
    });
    const ics = buildICalendar({ events: [ev], nowMs: 0 });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260105');
    expect(ics).toContain('DTEND;VALUE=DATE:20260106'); // exclusive = next day
  });

  it('emits a VTODO for a task with DUE and NEEDS-ACTION status', () => {
    const ics = buildICalendar({ tasks: [makeTask({ tags: ['home', 'money'] })], nowMs: 0 });
    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('UID:task-1@parallx.app');
    expect(ics).toContain('DUE:20260110T170000Z');
    expect(ics).toContain('SUMMARY:Pay rent');
    expect(ics).toContain('STATUS:NEEDS-ACTION');
    expect(ics).toContain('CATEGORIES:home,money');
  });

  it('marks a completed task COMPLETED with PERCENT-COMPLETE', () => {
    const ics = buildICalendar({
      tasks: [makeTask({ status: 'done', completedAt: Date.UTC(2026, 0, 9, 8, 0, 0) })],
      nowMs: 0,
    });
    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('PERCENT-COMPLETE:100');
    expect(ics).toContain('COMPLETED:20260109T080000Z');
  });

  it('uses the base series id for the UID of a recurring instance', () => {
    const ics = buildICalendar({ events: [makeEvent({ id: 'event-1::123', seriesId: 'event-1' })], nowMs: 0 });
    expect(ics).toContain('UID:event-1@parallx.app');
    expect(ics).not.toContain('event-1::123');
  });

  it('escapes commas and newlines inside event fields', () => {
    const ics = buildICalendar({ events: [makeEvent({ title: 'Lunch, then walk', description: 'a\nb' })], nowMs: 0 });
    expect(ics).toContain('SUMMARY:Lunch\\, then walk');
    expect(ics).toContain('DESCRIPTION:a\\nb');
  });
});
