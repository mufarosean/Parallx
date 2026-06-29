import { describe, it, expect } from 'vitest';
import {
  toAllDayDateStr,
  parseAllDayDate,
  extractRrule,
  mapGoogleEventToSynced,
  mapPlannerEventToGoogle,
  mapGoogleTaskToSynced,
  mapPlannerTaskToGoogle,
} from '../../../src/built-in/planner/sync/googleCalendarSyncProvider.js';
import type { PlannerEvent, PlannerTask } from '../../../src/built-in/planner/plannerTypes.js';

function makeEvent(p: Partial<PlannerEvent>): PlannerEvent {
  return {
    id: 'e1', title: 'E', description: null, startAt: 0, endAt: 0, allDay: false,
    location: null, calendarId: 'cal', color: null, recurrence: null,
    sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0, ...p,
  };
}
function makeTask(p: Partial<PlannerTask>): PlannerTask {
  return {
    id: 't1', title: 'T', description: null, status: 'planned', dueAt: null, reminderAt: null,
    reminderFired: false, completedAt: null, tags: [], calendarId: 'cal-tasks', color: null,
    sourceUri: null, sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0, ...p,
  };
}

describe('all-day date helpers', () => {
  it('round-trips a floating date string through local midnight', () => {
    expect(toAllDayDateStr(parseAllDayDate('2026-07-01'))).toBe('2026-07-01');
  });
});

describe('extractRrule', () => {
  it('pulls the RRULE line and strips the prefix', () => {
    expect(extractRrule(['RRULE:FREQ=WEEKLY;BYDAY=MO'])).toBe('FREQ=WEEKLY;BYDAY=MO');
  });
  it('returns null when absent / only EXDATE', () => {
    expect(extractRrule(undefined)).toBeNull();
    expect(extractRrule(['EXDATE;TZID=UTC:20260701T000000'])).toBeNull();
  });
});

describe('mapGoogleEventToSynced', () => {
  it('maps a timed event', () => {
    const ev = mapGoogleEventToSynced(
      { id: 'g1', summary: 'Meet', start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T11:00:00Z' }, updated: '2026-06-30T00:00:00Z' },
      'cal-x',
    );
    expect(ev).not.toBeNull();
    expect(ev!.sourceId).toBe('g1');
    expect(ev!.allDay).toBe(false);
    expect(ev!.startAt).toBe(Date.parse('2026-07-01T10:00:00Z'));
    expect(ev!.calendarId).toBe('cal-x');
    expect(ev!.updatedAt).toBe(Date.parse('2026-06-30T00:00:00Z'));
  });

  it('maps an all-day event with exclusive end', () => {
    const ev = mapGoogleEventToSynced(
      { id: 'g2', summary: 'Trip', start: { date: '2026-07-01' }, end: { date: '2026-07-03' } },
      'cal-x',
    );
    expect(ev!.allDay).toBe(true);
    expect(ev!.startAt).toBe(parseAllDayDate('2026-07-01'));
    expect(ev!.endAt).toBe(parseAllDayDate('2026-07-03'));
  });

  it('skips per-instance exceptions and malformed items', () => {
    expect(mapGoogleEventToSynced({ id: 'g3', recurringEventId: 'g1', start: { dateTime: '2026-07-01T10:00:00Z' }, end: { dateTime: '2026-07-01T11:00:00Z' } }, 'c')).toBeNull();
    expect(mapGoogleEventToSynced({ summary: 'no id', start: { dateTime: 'x' }, end: { dateTime: 'y' } }, 'c')).toBeNull();
  });
});

describe('mapPlannerEventToGoogle', () => {
  it('emits dateTime for timed events', () => {
    const body = mapPlannerEventToGoogle(makeEvent({
      title: 'Meet', allDay: false,
      startAt: Date.parse('2026-07-01T10:00:00Z'), endAt: Date.parse('2026-07-01T11:00:00Z'),
    }));
    expect(body.start).toEqual({ dateTime: new Date(Date.parse('2026-07-01T10:00:00Z')).toISOString() });
    expect(body.summary).toBe('Meet');
  });

  it('emits floating dates for all-day events and prefixes RRULE', () => {
    const body = mapPlannerEventToGoogle(makeEvent({
      allDay: true, startAt: parseAllDayDate('2026-07-01'), endAt: parseAllDayDate('2026-07-03'),
      recurrence: 'FREQ=DAILY',
    }));
    expect(body.start).toEqual({ date: '2026-07-01' });
    expect(body.end).toEqual({ date: '2026-07-03' });
    expect(body.recurrence).toEqual(['RRULE:FREQ=DAILY']);
  });
});

describe('task mappers', () => {
  it('maps needsAction → planned and parses due', () => {
    const t = mapGoogleTaskToSynced({ id: 't1', title: 'Do', status: 'needsAction', due: '2026-07-01T00:00:00.000Z' }, 'cal-tasks');
    expect(t!.status).toBe('planned');
    expect(t!.dueAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'));
    expect(t!.calendarId).toBe('cal-tasks');
  });

  it('maps completed → done with completedAt', () => {
    const t = mapGoogleTaskToSynced({ id: 't2', title: 'Done', status: 'completed', completed: '2026-07-01T05:00:00Z' }, 'cal-tasks');
    expect(t!.status).toBe('done');
    expect(t!.completedAt).toBe(Date.parse('2026-07-01T05:00:00Z'));
  });

  it('emits status + a UTC-midnight due on push', () => {
    const body = mapPlannerTaskToGoogle(makeTask({ status: 'done', completedAt: 123, dueAt: Date.parse('2026-07-01T10:00:00Z') }));
    expect(body.status).toBe('completed');
    expect(body.completed).toBe(new Date(123).toISOString());
    expect(String(body.due)).toMatch(/T00:00:00\.000Z$/);
  });

  it('maps non-done → needsAction', () => {
    expect(mapPlannerTaskToGoogle(makeTask({ status: 'planned' })).status).toBe('needsAction');
  });
});
