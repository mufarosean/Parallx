import type { AgentTaskStatus } from './agentTypes.js';

const AGENT_TASK_TRANSITIONS: Record<AgentTaskStatus, readonly AgentTaskStatus[]> = {
  pending: ['planning', 'cancelled'],
  planning: ['awaiting-approval', 'running', 'blocked', 'failed', 'cancelled'],
  'awaiting-approval': ['running', 'blocked', 'cancelled'],
  running: ['awaiting-approval', 'blocked', 'paused', 'completed', 'failed', 'cancelled'],
  blocked: ['planning', 'paused', 'failed', 'cancelled'],
  paused: ['planning', 'running', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function getAllowedAgentTaskTransitions(status: AgentTaskStatus): readonly AgentTaskStatus[] {
  return AGENT_TASK_TRANSITIONS[status];
}

export function canTransitionAgentTaskStatus(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return AGENT_TASK_TRANSITIONS[from].includes(to);
}

export function isTerminalAgentTaskStatus(status: AgentTaskStatus): boolean {
  return AGENT_TASK_TRANSITIONS[status].length === 0;
}

export function assertAgentTaskTransition(from: AgentTaskStatus, to: AgentTaskStatus): void {
  if (!canTransitionAgentTaskStatus(from, to)) {
    throw new Error(`Invalid agent task transition: ${from} -> ${to}`);
  }
}