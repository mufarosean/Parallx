// plannerNavState.test.ts — the handoffs between a command or the sidebar
// and a Planner pane that may still be building: one-shot, so a request is
// acted on once and never replayed on a later open.

import { describe, it, expect } from 'vitest';
import { setPendingPlannerNewTask, setPendingPlannerTab, takePendingPlannerNewTask, takePendingPlannerTab } from '../../src/built-in/planner/plannerNavState.js';

describe('planner nav state', () => {
  it('a New Task request is taken once', () => {
    setPendingPlannerNewTask(true);
    expect(takePendingPlannerNewTask()).toBe(true);
    expect(takePendingPlannerNewTask()).toBe(false);
  });

  it('a request withdrawn after a failed open is not taken', () => {
    setPendingPlannerNewTask(true);
    setPendingPlannerNewTask(false);
    expect(takePendingPlannerNewTask()).toBe(false);
  });

  it('a requested tab is taken once', () => {
    setPendingPlannerTab('calendar');
    expect(takePendingPlannerTab()).toEqual({ tab: 'calendar', tasksFilter: null });
    expect(takePendingPlannerTab()).toBeNull();
  });

  it('Tasks can be asked for with its list (Show Overdue Tasks), taken once with it', () => {
    setPendingPlannerTab('tasks', 'overdue');
    expect(takePendingPlannerTab()).toEqual({ tab: 'tasks', tasksFilter: 'overdue' });
    setPendingPlannerTab('tasks');
    expect(takePendingPlannerTab()).toEqual({ tab: 'tasks', tasksFilter: null });
  });
});
