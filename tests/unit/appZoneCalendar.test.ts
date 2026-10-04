/**
 * One time zone for the user's calendar. The built-in tools read "today",
 * day/week boundaries, overdue and the dates they show in the app's Time
 * Zone setting (chat.timeZone), not in the computer's zone, so a computer
 * that reports the wrong zone is fixed once, in the setting, for everything.
 *
 * Every test pins the process to UTC (the "computer") and, where it matters,
 * sets the app to Pacific/Auckland: 13 hours ahead in October, so the two
 * disagree about the date for half of every day. With the setting empty
 * nothing moves: the helpers are the plain local Date methods.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addAppDays, appDateParts, appDateString, appDayKey, appTime, isSameAppDay,
  machineTimeZone, setAssistantTimeZone, startOfAppDay,
} from '../../src/services/localTime';
import { buildTodayModel, isOverdue, isUntimed, quickPlanOptions, startOfLocalDay } from '../../src/built-in/planner/plannerToday';
import { agendaWindow } from '../../src/built-in/planner/plannerAgendaBlock';
import { expandRecurrence } from '../../src/built-in/planner/plannerRecurrence';
import { dayKey } from '../../src/built-in/worksheet/progressInsights';
import { dayKeyLocal, dayStreak } from '../../src/built-in/dashboard/widgets/timerLogic';
import { computeNextRun } from '../../src/openclaw/openclawCronService';
import type { PlannerTask } from '../../src/built-in/planner/plannerTypes';

const HOUR = 3_600_000;
// Sun 2026-10-04 12:00 UTC = Mon 2026-10-05 01:00 in Auckland (NZDT, UTC+13).
const NOW = Date.UTC(2026, 9, 4, 12, 0);
// Auckland's midnight starting Mon Oct 5 = Sun Oct 4 11:00 UTC.
const AKL_MIDNIGHT = Date.UTC(2026, 9, 4, 11, 0);

const originalTz = process.env.TZ;
beforeEach(() => { process.env.TZ = 'UTC'; setAssistantTimeZone(''); });
afterEach(() => {
  setAssistantTimeZone('');
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
});

function task(id: string, dueAt: number | null, status: PlannerTask['status'] = 'planned'): PlannerTask {
  return {
    id, title: id, description: null, status, dueAt, reminderAt: null, reminderFired: false,
    completedAt: null, tags: [], calendarId: 'cal-tasks', color: null, sourceUri: null,
    sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0,
  };
}

describe('the calendar helpers', () => {
  it('read the day, the time and the weekday in the app zone', () => {
    expect(machineTimeZone()).toBe('UTC');
    setAssistantTimeZone('Pacific/Auckland');
    expect(appDayKey(NOW)).toBe('2026-10-05');
    expect(appDateParts(NOW)).toMatchObject({ year: 2026, month: 9, day: 5, hour: 1, minute: 0, weekday: 1 });
    expect(startOfAppDay(NOW)).toBe(AKL_MIDNIGHT);
    expect(appTime(2026, 9, 5)).toBe(AKL_MIDNIGHT);
    expect(isSameAppDay(NOW, AKL_MIDNIGHT)).toBe(true);
    expect(isSameAppDay(NOW, AKL_MIDNIGHT - 1)).toBe(false);
    expect(appDateString(NOW, { weekday: 'long', month: 'long', day: 'numeric' }, 'en-US')).toBe('Monday, October 5');
  });

  it('roll fields over like Date and keep wall-clock time across clock changes', () => {
    setAssistantTimeZone('Pacific/Auckland');
    // Day 0 is the last day of the previous month; month 12 is next January.
    expect(appDayKey(appTime(2026, 2, 0))).toBe('2026-02-28');
    expect(appDayKey(appTime(2026, 12, 1))).toBe('2027-01-01');
    // NZ clocks go forward on 2026-09-27 at 02:00: that day is 23 hours long,
    // and 02:30 does not exist (it lands after the jump, as Date does).
    const sat9 = appTime(2026, 8, 26, 9);
    expect(addAppDays(sat9, 1) - sat9).toBe(23 * HOUR);
    expect(appDateParts(addAppDays(sat9, 1)).hour).toBe(9);
    expect(appDateParts(appTime(2026, 8, 27, 2, 30))).toMatchObject({ day: 27, hour: 3, minute: 30 });
    // Clocks go back on 2026-04-05 at 03:00: 02:30 happens twice; the first is meant.
    expect(appTime(2026, 3, 5, 2, 30)).toBe(Date.UTC(2026, 3, 4, 13, 30));
  });

  it('are the computer\'s own clock when the setting is empty', () => {
    process.env.TZ = 'America/Chicago';
    const t = Date.UTC(2026, 10, 1, 7, 30); // the morning Chicago's clocks go back
    const d = new Date(t);
    expect(appDateParts(t)).toEqual({
      year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(),
      minute: d.getMinutes(), second: d.getSeconds(), millisecond: d.getMilliseconds(), weekday: d.getDay(),
    });
    const midnight = new Date(t); midnight.setHours(0, 0, 0, 0);
    expect(startOfAppDay(t)).toBe(midnight.getTime());
    const next = new Date(t); next.setDate(next.getDate() + 1);
    expect(addAppDays(t, 1)).toBe(next.getTime());
    expect(appTime(2026, 9, 31, 23, 59)).toBe(new Date(2026, 9, 31, 23, 59).getTime());
    expect(appDateString(t, { month: 'short', day: 'numeric' })).toBe(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  });
});

describe('Planner follows the setting', () => {
  // Due Sun Oct 4 at 22:00 in Auckland = 09:00 UTC on Oct 4.
  const sundayNight = Date.UTC(2026, 9, 4, 9, 0);

  it('today and overdue are Auckland\'s when the app is set to Auckland', () => {
    setAssistantTimeZone('Pacific/Auckland');
    expect(startOfLocalDay(NOW)).toBe(AKL_MIDNIGHT);
    // It is already Monday in Auckland: Sunday's task is overdue.
    expect(isOverdue(task('t', sundayNight), NOW)).toBe(true);
    // A task with no time of day is stored at Auckland midnight and reads as untimed.
    expect(isUntimed(AKL_MIDNIGHT)).toBe(true);
    expect(isUntimed(Date.UTC(2026, 9, 5, 0, 0))).toBe(false); // UTC midnight is 13:00 in Auckland

    const model = buildTodayModel({
      now: NOW, isVisible: () => true, events: [],
      tasks: [task('sunday', sundayNight), task('anytime', AKL_MIDNIGHT), task('later', AKL_MIDNIGHT + 9 * HOUR)],
    });
    expect(model.dayStart).toBe(AKL_MIDNIGHT);
    expect(model.overdue.map((t) => t.id)).toEqual(['sunday']);
    expect(model.anytime.map((t) => t.id)).toEqual(['anytime']);
    expect(model.schedule.map((i) => (i.kind === 'task' ? i.task.id : i.event.id))).toEqual(['later']);

    // Monday in Auckland: next Monday is a week away.
    const [today, tomorrow, nextWeek] = quickPlanOptions(NOW);
    expect(today.dueAt).toBe(AKL_MIDNIGHT);
    expect(appDayKey(tomorrow.dueAt)).toBe('2026-10-06');
    expect(appDayKey(nextWeek.dueAt)).toBe('2026-10-12');
    expect(agendaWindow('today', NOW)).toEqual({ from: AKL_MIDNIGHT, to: addAppDays(AKL_MIDNIGHT, 1) - 1, days: 1 });
  });

  it('with the setting empty, today is the computer\'s, as before', () => {
    const utcMidnight = Date.UTC(2026, 9, 4);
    expect(startOfLocalDay(NOW)).toBe(utcMidnight);
    // Still Sunday on this computer: the 09:00 task is today's, late but not overdue.
    expect(isOverdue(task('t', sundayNight), NOW)).toBe(false);
    const model = buildTodayModel({ now: NOW, isVisible: () => true, events: [], tasks: [task('sunday', sundayNight)] });
    expect(model.overdue).toEqual([]);
    expect(model.schedule.map((i) => (i.kind === 'task' ? i.task.id : i.event.id))).toEqual(['sunday']);
    expect(quickPlanOptions(NOW)[0].dueAt).toBe(utcMidnight);
  });

  it('repeats a series at the same Auckland wall-clock time across the clock change', () => {
    setAssistantTimeZone('Pacific/Auckland');
    const start = appTime(2026, 8, 25, 9); // Fri Sep 25, 09:00 NZST
    const occ = expandRecurrence(start, HOUR, 'FREQ=DAILY;COUNT=4', start, start + 10 * 24 * HOUR);
    expect(occ.map((o) => appDateParts(o.startAt).hour)).toEqual([9, 9, 9, 9]);
    expect(occ.map((o) => appDayKey(o.startAt))).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']);
    const weekly = expandRecurrence(start, HOUR, 'FREQ=WEEKLY;BYDAY=MO,FR;COUNT=3', start, start + 30 * 24 * HOUR);
    expect(weekly.map((o) => appDayKey(o.startAt))).toEqual(['2026-09-25', '2026-09-28', '2026-10-02']);
    expect(weekly.every((o) => appDateParts(o.startAt).hour === 9)).toBe(true);
  });
});

describe('Worksheets and the timer follow the setting', () => {
  it('the day key is Auckland\'s day when set, the computer\'s when empty', () => {
    expect(dayKey(NOW)).toBe('2026-10-04');
    expect(dayKeyLocal(NOW)).toBe('2026-10-04');
    setAssistantTimeZone('Pacific/Auckland');
    expect(dayKey(NOW)).toBe('2026-10-05');
    expect(dayKeyLocal(NOW)).toBe('2026-10-05');
  });

  it('a streak counts Auckland days', () => {
    // Both on Sunday Oct 4 in UTC; Sunday 22:00 and Monday 00:30 in Auckland.
    const log = [
      { mode: 'focus' as const, startedAt: Date.UTC(2026, 9, 4, 9, 0), minutes: 25 },
      { mode: 'focus' as const, startedAt: Date.UTC(2026, 9, 4, 11, 30), minutes: 25 },
    ];
    expect(dayStreak(log, NOW)).toBe(1);
    setAssistantTimeZone('Pacific/Auckland');
    expect(dayStreak(log, NOW)).toBe(2);
  });
});

describe('schedules run on the app zone\'s wall clock', () => {
  it('a daily 09:00 cron fires at 09:00 Auckland', () => {
    setAssistantTimeZone('Pacific/Auckland');
    const next = computeNextRun({ cron: '0 9 * * *' }, NOW);
    expect(next).toBe(appTime(2026, 9, 5, 9));
    expect(next).toBe(Date.UTC(2026, 9, 4, 20, 0));
    setAssistantTimeZone('');
    expect(computeNextRun({ cron: '0 9 * * *' }, NOW)).toBe(Date.UTC(2026, 9, 5, 9, 0));
  });
});
