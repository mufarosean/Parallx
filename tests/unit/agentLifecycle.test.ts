import { describe, expect, it } from 'vitest';
import {
  assertAgentTaskTransition,
  canTransitionAgentTaskStatus,
  getAllowedAgentTaskTransitions,
  isTerminalAgentTaskStatus,
} from '../../src/agent/agentLifecycle';

describe('agentLifecycle', () => {
  it('allows valid forward transitions', () => {
    expect(canTransitionAgentTaskStatus('pending', 'planning')).toBe(true);
    expect(canTransitionAgentTaskStatus('planning', 'running')).toBe(true);
    expect(canTransitionAgentTaskStatus('running', 'completed')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionAgentTaskStatus('pending', 'completed')).toBe(false);
    expect(canTransitionAgentTaskStatus('completed', 'running')).toBe(false);
  });

  it('exposes terminal states', () => {
    expect(isTerminalAgentTaskStatus('completed')).toBe(true);
    expect(isTerminalAgentTaskStatus('failed')).toBe(true);
    expect(isTerminalAgentTaskStatus('cancelled')).toBe(true);
    expect(isTerminalAgentTaskStatus('running')).toBe(false);
  });

  it('throws on invalid asserted transitions', () => {
    expect(() => assertAgentTaskTransition('blocked', 'completed')).toThrow('Invalid agent task transition');
  });

  it('lists allowed next states', () => {
    expect(getAllowedAgentTaskTransitions('awaiting-approval')).toEqual(['running', 'blocked', 'cancelled']);
  });
});