// plannerNavState.test.ts — the handoff between a command and the Planner pane
// that draws the place it opens (which may still be building): one-shot, so a
// request is acted on once and never replayed on a later open.

import { describe, it, expect } from 'vitest';
import { carryPlannerOver, takePlannerOver } from '../../src/built-in/planner/plannerNavState.js';

describe('planner nav state', () => {
  it('a New Task request is taken once', () => {
    carryPlannerOver('tasks', { form: 'newTask' });
    expect(takePlannerOver('tasks')).toEqual({ form: 'newTask' });
    expect(takePlannerOver('tasks')).toBeNull();
  });

  it('a request withdrawn after a failed open is not taken', () => {
    carryPlannerOver('tasks', { form: 'newTask' });
    carryPlannerOver('tasks', null);
    expect(takePlannerOver('tasks')).toBeNull();
  });
});
