/**
 * A confirmed habit becomes a suggested workflow: disabled, source
 * 'suggested', stamped with the action so it is never proposed twice.
 */

import { describe, it, expect } from 'vitest';
import { habitToWorkflow, humanizeHabitAction, minutesToClock } from '../../src/services/workflows/workflowSuggestions';
import { validateWorkflow } from '../../src/services/workflows/workflowGraph';

describe('humanizeHabitAction', () => {
  it('turns journal actions into something a sentence can carry', () => {
    expect(humanizeHabitAction('focused view.planner view')).toBe('open the planner view');
    expect(humanizeHabitAction('opened planner')).toBe('open the planner');
    expect(humanizeHabitAction('opened "Meyers.pdf"')).toBe('open "Meyers.pdf"');
  });
});

describe('minutesToClock', () => {
  it('formats and clamps', () => {
    expect(minutesToClock(485)).toBe('08:05');
    expect(minutesToClock(0)).toBe('00:00');
    expect(minutesToClock(99_999)).toBe('23:59');
  });
});

describe('habitToWorkflow', () => {
  const habit = { action: 'focused view.planner view', typicalTime: '08:05', typicalMinuteOfDay: 485, daysObserved: 6 };

  it('is a disabled suggested document stamped with its habit', () => {
    const wf = habitToWorkflow(habit, 0);
    expect(wf.enabled).toBe(false);
    expect(wf.source).toBe('suggested');
    expect(wf.suggestedFrom).toBe(habit.action);
    expect(wf.name).toBe('Around 08:05: Open The Planner View');
    expect(wf.description).toContain('6 days');
  });

  it('schedules daily at the typical time, then facts, then one agent turn', () => {
    const wf = habitToWorkflow(habit, 0);
    const kinds = wf.nodes.map((n) => n.kind);
    expect(kinds).toEqual(['trigger.schedule', 'context.facts', 'action.agentTurn']);
    const trigger = wf.nodes[0] as { spec: { kind: string; time: string } };
    expect(trigger.spec).toEqual({ kind: 'daily', time: '08:05' });
    expect(wf.edges).toEqual([{ from: 't', to: 'c' }, { from: 'c', to: 'g' }]);
  });

  it('falls back to the minute-of-day clock when no label exists', () => {
    const wf = habitToWorkflow({ action: 'opened planner', typicalTime: null, typicalMinuteOfDay: 9 * 60 + 30 }, 0);
    expect(wf.name.startsWith('Around 09:30:')).toBe(true);
  });

  it('passes the graph validator the runner uses', () => {
    const wf = habitToWorkflow(habit, 0);
    const result = validateWorkflow({ ...wf, id: 'wf-test', createdAt: 0, updatedAt: 0 });
    expect(result.errors ?? []).toEqual([]);
  });
});
