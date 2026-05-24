/**
 * Pin-the-invariant: agentTaskModels normalization + agentLifecycle state machine.
 *
 * Two adjacent foundation modules with ZERO prior unit coverage:
 *  - normalizeDelegatedTaskInput: trims, dedupes, applies defaults, rejects empty goal.
 *  - createAgentTaskRecord: composes a fresh record (status 'pending', empty artifacts).
 *  - getAllowedAgentTaskTransitions / canTransitionAgentTaskStatus /
 *    isTerminalAgentTaskStatus / assertAgentTaskTransition: the autonomy state machine.
 *
 * These pin:
 *   - The four-level default autonomy ('allow-safe-actions') — changing it without
 *     review would silently shift every delegated task's privilege class.
 *   - The terminal states {completed, failed, cancelled} — anything else is reachable.
 *   - The illegal short-circuits: pending -> running (must go through planning),
 *     completed -> anything (terminal), running -> planning (must blocked/paused/await first).
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeDelegatedTaskInput,
  createAgentTaskRecord,
} from '../../src/agent/agentTaskModels';
import {
  canTransitionAgentTaskStatus,
  getAllowedAgentTaskTransitions,
  isTerminalAgentTaskStatus,
  assertAgentTaskTransition,
} from '../../src/agent/agentLifecycle';
import { AGENT_TASK_STATUSES, type AgentTaskStatus } from '../../src/agent/agentTypes';

describe('normalizeDelegatedTaskInput', () => {
  it('trims and collapses whitespace in goal', () => {
    const out = normalizeDelegatedTaskInput({ goal: '   plan   the   trip   ' });
    expect(out.goal).toBe('plan the trip');
  });

  it('rejects empty / whitespace-only goal', () => {
    expect(() => normalizeDelegatedTaskInput({ goal: '' })).toThrow();
    expect(() => normalizeDelegatedTaskInput({ goal: '   ' })).toThrow();
  });

  it('applies default autonomy = allow-safe-actions', () => {
    const out = normalizeDelegatedTaskInput({ goal: 'g' });
    expect(out.desiredAutonomy).toBe('allow-safe-actions');
  });

  it('applies default mode = operator', () => {
    const out = normalizeDelegatedTaskInput({ goal: 'g' });
    expect(out.mode).toBe('operator');
  });

  it('applies default allowedScope = workspace (no roots)', () => {
    const out = normalizeDelegatedTaskInput({ goal: 'g' });
    expect(out.allowedScope).toEqual({ kind: 'workspace' });
  });

  it('passes explicit autonomy through', () => {
    const out = normalizeDelegatedTaskInput({ goal: 'g', desiredAutonomy: 'manual' });
    expect(out.desiredAutonomy).toBe('manual');
  });

  it('dedupes + trims + drops empties in constraints list', () => {
    const out = normalizeDelegatedTaskInput({
      goal: 'g',
      constraints: ['  a  ', 'a', '', '  ', 'b  c', 'b c'],
    });
    expect(out.constraints).toEqual(['a', 'b c']);
  });

  it('dedupes + trims completion criteria list', () => {
    const out = normalizeDelegatedTaskInput({
      goal: 'g',
      completionCriteria: ['done', '  done  ', 'all green'],
    });
    expect(out.completionCriteria).toEqual(['done', 'all green']);
  });

  it('returns empty arrays for missing list fields (not undefined)', () => {
    const out = normalizeDelegatedTaskInput({ goal: 'g' });
    expect(out.constraints).toEqual([]);
    expect(out.completionCriteria).toEqual([]);
  });
});

describe('createAgentTaskRecord', () => {
  it('returns a record with status="pending" and the supplied ids', () => {
    const r = createAgentTaskRecord('task-1', 'ws-1', { goal: 'g' }, '2026-01-01T00:00:00.000Z');
    expect(r.id).toBe('task-1');
    expect(r.workspaceId).toBe('ws-1');
    expect(r.status).toBe('pending');
    expect(r.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(r.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(r.artifactRefs).toEqual([]);
    expect(r.currentStepId).toBeUndefined();
    expect(r.stopAfterCurrentStep).toBe(false);
  });

  it('rejects empty taskId', () => {
    expect(() => createAgentTaskRecord('', 'ws-1', { goal: 'g' })).toThrow();
    expect(() => createAgentTaskRecord('   ', 'ws-1', { goal: 'g' })).toThrow();
  });

  it('rejects empty workspaceId', () => {
    expect(() => createAgentTaskRecord('task-1', '', { goal: 'g' })).toThrow();
    expect(() => createAgentTaskRecord('task-1', '   ', { goal: 'g' })).toThrow();
  });

  it('propagates normalization (rejects empty goal)', () => {
    expect(() => createAgentTaskRecord('task-1', 'ws-1', { goal: '' })).toThrow();
  });

  it('uses now() default for createdAt/updatedAt when not provided', () => {
    const r = createAgentTaskRecord('t', 'w', { goal: 'g' });
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.updatedAt).toBe(r.createdAt);
  });
});

describe('agentLifecycle state machine — terminal states', () => {
  it('completed, failed, cancelled are terminal (no outgoing transitions)', () => {
    expect(isTerminalAgentTaskStatus('completed')).toBe(true);
    expect(isTerminalAgentTaskStatus('failed')).toBe(true);
    expect(isTerminalAgentTaskStatus('cancelled')).toBe(true);
  });

  it('non-terminal states all have at least one outgoing transition', () => {
    const nonTerminal: AgentTaskStatus[] = [
      'pending', 'planning', 'awaiting-approval', 'running', 'blocked', 'paused',
    ];
    for (const s of nonTerminal) {
      expect(isTerminalAgentTaskStatus(s)).toBe(false);
      expect(getAllowedAgentTaskTransitions(s).length).toBeGreaterThan(0);
    }
  });

  it('every status in AGENT_TASK_STATUSES is in the transition table', () => {
    for (const s of AGENT_TASK_STATUSES) {
      // calling getAllowedAgentTaskTransitions must not throw for any known status
      expect(() => getAllowedAgentTaskTransitions(s)).not.toThrow();
    }
  });
});

describe('agentLifecycle state machine — pinned transitions', () => {
  it('pending can only go to planning or cancelled', () => {
    expect(getAllowedAgentTaskTransitions('pending')).toEqual(['planning', 'cancelled']);
  });

  it('pending -> running is FORBIDDEN (must pass through planning)', () => {
    expect(canTransitionAgentTaskStatus('pending', 'running')).toBe(false);
  });

  it('planning -> awaiting-approval / running / blocked / completed / failed / cancelled all allowed', () => {
    const allowed = getAllowedAgentTaskTransitions('planning');
    expect(allowed).toEqual(['awaiting-approval', 'running', 'blocked', 'completed', 'failed', 'cancelled']);
  });

  it('running can pause, block, await approval, complete, fail, cancel', () => {
    const allowed = getAllowedAgentTaskTransitions('running');
    expect(allowed).toEqual(['awaiting-approval', 'blocked', 'paused', 'completed', 'failed', 'cancelled']);
  });

  it('running -> planning is FORBIDDEN (must re-plan via blocked/paused/awaiting)', () => {
    expect(canTransitionAgentTaskStatus('running', 'planning')).toBe(false);
  });

  it('completed cannot transition to anything', () => {
    expect(getAllowedAgentTaskTransitions('completed')).toEqual([]);
    for (const s of AGENT_TASK_STATUSES) {
      expect(canTransitionAgentTaskStatus('completed', s)).toBe(false);
    }
  });

  it('failed cannot transition to anything', () => {
    expect(getAllowedAgentTaskTransitions('failed')).toEqual([]);
    for (const s of AGENT_TASK_STATUSES) {
      expect(canTransitionAgentTaskStatus('failed', s)).toBe(false);
    }
  });

  it('cancelled cannot transition to anything', () => {
    expect(getAllowedAgentTaskTransitions('cancelled')).toEqual([]);
    for (const s of AGENT_TASK_STATUSES) {
      expect(canTransitionAgentTaskStatus('cancelled', s)).toBe(false);
    }
  });

  it('blocked can resume to planning / paused / failed / cancelled', () => {
    expect(getAllowedAgentTaskTransitions('blocked')).toEqual(['planning', 'paused', 'failed', 'cancelled']);
  });

  it('paused can only resume to planning, running, or cancel', () => {
    expect(getAllowedAgentTaskTransitions('paused')).toEqual(['planning', 'running', 'cancelled']);
  });

  it('awaiting-approval can return to planning / running / blocked / cancelled', () => {
    expect(getAllowedAgentTaskTransitions('awaiting-approval')).toEqual(['planning', 'running', 'blocked', 'cancelled']);
  });

  it('every status can be cancelled (except terminal)', () => {
    const nonTerminal: AgentTaskStatus[] = [
      'pending', 'planning', 'awaiting-approval', 'running', 'blocked', 'paused',
    ];
    for (const s of nonTerminal) {
      expect(canTransitionAgentTaskStatus(s, 'cancelled')).toBe(true);
    }
  });
});

describe('assertAgentTaskTransition', () => {
  it('throws on illegal transitions with both states in the error message', () => {
    expect(() => assertAgentTaskTransition('pending', 'running')).toThrow(/pending.*running/);
  });

  it('does not throw on legal transitions', () => {
    expect(() => assertAgentTaskTransition('pending', 'planning')).not.toThrow();
    expect(() => assertAgentTaskTransition('running', 'paused')).not.toThrow();
  });

  it('throws on any outbound transition from terminal states', () => {
    expect(() => assertAgentTaskTransition('completed', 'planning')).toThrow();
    expect(() => assertAgentTaskTransition('failed', 'pending')).toThrow();
    expect(() => assertAgentTaskTransition('cancelled', 'running')).toThrow();
  });
});
