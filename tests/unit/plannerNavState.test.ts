// plannerNavState.test.ts — the handoffs between a command or the sidebar
// and a Planner pane that may still be building: one-shot, so a request is
// acted on once and never replayed on a later open.

import { describe, it, expect } from 'vitest';
import { setPendingPlannerNewTask, takePendingPlannerNewTask } from '../../src/built-in/planner/plannerNavState.js';

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
});
