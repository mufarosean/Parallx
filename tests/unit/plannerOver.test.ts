// plannerOver.test.ts — what a Planner command sends to open over a place (a
// form, an item in detail) is read once, by the drawing of that place only.

import { describe, it, expect } from 'vitest';
import { carryPlannerOver, takePlannerOver, plannerDayString } from '../../src/built-in/planner/plannerNavState.js';

describe('planner: a popover over a place rides along once', () => {
  it('is taken by the place it was sent to, once', () => {
    carryPlannerOver('tasks', { form: 'newTask' });
    expect(takePlannerOver('tasks')).toEqual({ form: 'newTask' });
    expect(takePlannerOver('tasks')).toBeNull();
  });

  it('is not taken by another place (a drawing of Today does not open the task form)', () => {
    carryPlannerOver('tasks', { form: 'task', id: 't1' });
    expect(takePlannerOver('today')).toBeNull();
    expect(takePlannerOver('tasks')).toEqual({ form: 'task', id: 't1' });
  });

  it('a request withdrawn after a failed open is not taken', () => {
    carryPlannerOver('calendar', { form: 'newEvent' });
    carryPlannerOver('calendar', null);
    expect(takePlannerOver('calendar')).toBeNull();
  });

  it('names a moment\'s local day as the calendar address does', () => {
    expect(plannerDayString(new Date(2026, 10, 3, 23, 30).getTime())).toBe('2026-11-03');
    expect(plannerDayString(new Date(2026, 0, 1, 0, 0).getTime())).toBe('2026-01-01');
  });
});
