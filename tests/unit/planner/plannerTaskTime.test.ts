/**
 * Task time-of-day preservation across Google sync.
 *
 * Google Tasks' API is date-only (it discards the time). The time-of-day lives
 * only in Parallx, so a synced task must not collapse to midnight — the local
 * time is carried onto whatever date Google returns. These assert that end to
 * end and are timezone-robust (everything is anchored to LOCAL calendar days).
 */
import { describe, it, expect } from 'vitest';
import { carryTimeOfDay } from '../../../src/built-in/planner/plannerDataService.js';
import {
  parseAllDayDate,
  parseGoogleTaskDue,
  mapPlannerTaskToGoogle,
} from '../../../src/built-in/planner/sync/googleCalendarSyncProvider.js';
import type { PlannerTask } from '../../../src/built-in/planner/plannerTypes.js';

function task(dueAt: number): PlannerTask {
  return {
    id: 't1', title: 'T', description: null, status: 'planned', dueAt, reminderAt: null,
    reminderFired: false, completedAt: null, tags: [], calendarId: 'cal-tasks', color: null,
    sourceUri: null, sourceProvider: 'google', sourceId: 'g1', createdAt: 0, updatedAt: 0,
  };
}

describe('carryTimeOfDay', () => {
  it('keeps the local time when the pulled date is unchanged (no midnight reset)', () => {
    const existingDue = new Date(2026, 6, 15, 14, 30, 0, 0).getTime(); // Jul 15 14:30 local
    const pulledDate = parseAllDayDate('2026-07-15');                  // Jul 15 00:00 local (from Google)
    expect(carryTimeOfDay(pulledDate, existingDue)).toBe(existingDue);
  });

  it('carries the local time onto a NEW date when the task is moved on Google', () => {
    const existingDue = new Date(2026, 6, 15, 14, 30, 0, 0).getTime(); // Jul 15 14:30 local
    const movedDate = parseAllDayDate('2026-07-20');                   // user moved it to Jul 20
    expect(carryTimeOfDay(movedDate, existingDue)).toBe(new Date(2026, 6, 20, 14, 30, 0, 0).getTime());
  });
});

describe('full task sync round-trip', () => {
  it('a timed task keeps its exact due after push → Google → pull → carry', () => {
    const localDue = new Date(2026, 6, 15, 14, 30, 0, 0).getTime();    // Jul 15 14:30 local
    const pushed = mapPlannerTaskToGoogle(task(localDue));             // date-only to Google
    const pulledDate = parseGoogleTaskDue(String(pushed.due));         // back to LOCAL midnight of the same day
    expect(carryTimeOfDay(pulledDate, localDue)).toBe(localDue);       // exact due preserved
  });
});
