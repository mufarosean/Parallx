/**
 * Today tab model: what lands on the timeline, in "Anytime today", in the
 * Review Queue and in Overdue, where the current-time line goes, and the
 * one-click plan days. Anchored to LOCAL days so it holds in any timezone.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTodayModel,
  isLate,
  isOverdue,
  isUntimed,
  quickPlanOptions,
  todaySummary,
} from '../../../src/built-in/planner/plannerToday.js';
import type { PlannerEvent, PlannerTask, TaskStatus } from '../../../src/built-in/planner/plannerTypes.js';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m, 0, 0).getTime(); // Oct 2026, local
const NOW = at(1, 10, 45); // Thu Oct 1, 10:45

function task(id: string, status: TaskStatus, dueAt: number | null, extra: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id, title: id, description: null, status, dueAt, reminderAt: null, reminderFired: false,
    completedAt: null, tags: [], calendarId: 'cal-tasks', color: null, sourceUri: null,
    sourceProvider: null, sourceId: null, createdAt: 0, updatedAt: 0, ...extra,
  };
}

function event(id: string, startAt: number, endAt: number, extra: Partial<PlannerEvent> = {}): PlannerEvent {
  return {
    id, title: id, description: null, startAt, endAt, allDay: false, location: null,
    calendarId: 'cal-personal', color: null, recurrence: null, sourceProvider: null,
    sourceId: null, createdAt: 0, updatedAt: 0, ...extra,
  };
}

const visible = () => true;

describe('buildTodayModel', () => {
  it('merges timed events and timed tasks in start order, with the now line after past items', () => {
    const model = buildTodayModel({
      now: NOW,
      isVisible: visible,
      events: [event('review', at(1, 11, 30), at(1, 12, 30)), event('standup', at(1, 9), at(1, 9, 30))],
      tasks: [task('invoice', 'done', at(1, 10)), task('pharmacy', 'planned', at(1, 13))],
    });
    expect(model.schedule.map((i) => (i.kind === 'event' ? i.event.id : i.task.id))).toEqual(['standup', 'invoice', 'review', 'pharmacy']);
    expect(model.nowIndex).toBe(2);
    expect(model.schedule[0].past).toBe(true);
    expect(model.schedule[2].past).toBe(false);
  });

  it('puts midnight-due tasks in Anytime, earlier open tasks in Overdue, reviewing tasks in Review', () => {
    const model = buildTodayModel({
      now: NOW,
      isVisible: visible,
      events: [],
      tasks: [
        task('plants', 'planned', at(1, 0)),
        task('bill', 'planned', new Date(2026, 8, 29, 9).getTime()), // Tue Sep 29
        task('old-done', 'done', at(0, 9)),
        task('flights', 'reviewing', null),
        task('dropped', 'cancelled', at(1, 15)),
      ],
    });
    expect(model.anytime.map((t) => t.id)).toEqual(['plants']);
    expect(model.overdue.map((t) => t.id)).toEqual(['bill']);
    expect(model.review.map((t) => t.id)).toEqual(['flights']);
    expect(model.schedule).toHaveLength(0);
  });

  it('keeps all-day and multi-day events off the timeline, and drops hidden calendars', () => {
    const model = buildTodayModel({
      now: NOW,
      isVisible: (id) => id !== 'cal-hidden',
      events: [
        event('birthday', at(1, 0), at(2, 0), { allDay: true }),
        event('offsite', at(0, 9), at(2, 17)),
        event('secret', at(1, 14), at(1, 15), { calendarId: 'cal-hidden' }),
      ],
      tasks: [],
    });
    expect(model.allDay.map((e) => e.id)).toEqual(['offsite', 'birthday']);
    expect(model.schedule).toHaveLength(0);
  });
});

describe('quickPlanOptions', () => {
  it('offers today, tomorrow and next Monday, all at local midnight', () => {
    const opts = quickPlanOptions(NOW);
    expect(opts.map((o) => o.label)).toEqual(['Today', 'Tomorrow', 'Next Week']);
    expect(opts.map((o) => new Date(o.dueAt).getDate())).toEqual([1, 2, 5]);
    expect(opts.every((o) => isUntimed(o.dueAt))).toBe(true);
  });

  it('on a Monday, Next Week is the following Monday', () => {
    expect(new Date(quickPlanOptions(at(5, 9)).at(-1)!.dueAt).getDate()).toBe(12);
  });
});

describe('todaySummary', () => {
  it('counts events, open tasks due and the review queue, leaving out zeros', () => {
    const model = buildTodayModel({
      now: NOW,
      isVisible: visible,
      events: [event('a', at(1, 9), at(1, 10))],
      tasks: [task('x', 'done', at(1, 10)), task('y', 'planned', at(1, 0)), task('r', 'reviewing', null)],
    });
    expect(todaySummary(model)).toBe('1 event, 1 task due, 1 to review');
    expect(todaySummary(buildTodayModel({ now: NOW, isVisible: visible, events: [], tasks: [] }))).toBe('Nothing planned yet');
  });
});

describe('isOverdue / isLate', () => {
  it('a task due before today is overdue; one due earlier today is late but not overdue', () => {
    expect(isOverdue(task('a', 'planned', at(0, 9)), NOW)).toBe(true);
    expect(isOverdue(task('b', 'planned', at(1, 9)), NOW)).toBe(false);
    expect(isLate(task('b', 'planned', at(1, 9)), NOW)).toBe(true);
  });

  it('an untimed task is neither on its own day, and done tasks never are', () => {
    expect(isOverdue(task('c', 'planned', at(1, 0)), NOW)).toBe(false);
    expect(isLate(task('c', 'planned', at(1, 0)), NOW)).toBe(false);
    expect(isOverdue(task('d', 'done', at(0, 9)), NOW)).toBe(false);
  });
});
