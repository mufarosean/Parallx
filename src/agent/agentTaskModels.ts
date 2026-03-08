import {
  type AgentTaskRecord,
  type DelegatedTaskInput,
  type NormalizedDelegatedTaskInput,
} from './agentTypes.js';

function sanitizeLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function sanitizeList(values: readonly string[] | undefined): readonly string[] {
  if (!values) {
    return [];
  }

  return values
    .map((value) => sanitizeLine(value))
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
}

export function normalizeDelegatedTaskInput(input: DelegatedTaskInput): NormalizedDelegatedTaskInput {
  const goal = sanitizeLine(input.goal);
  if (goal.length === 0) {
    throw new Error('Delegated task goal is required.');
  }

  return {
    goal,
    constraints: sanitizeList(input.constraints),
    desiredAutonomy: input.desiredAutonomy ?? 'allow-safe-actions',
    completionCriteria: sanitizeList(input.completionCriteria),
    allowedScope: input.allowedScope ?? { kind: 'workspace' },
    mode: input.mode ?? 'operator',
  };
}

export function createAgentTaskRecord(
  taskId: string,
  workspaceId: string,
  input: DelegatedTaskInput,
  now: string = new Date().toISOString(),
): AgentTaskRecord {
  if (taskId.trim().length === 0) {
    throw new Error('Agent task id is required.');
  }

  if (workspaceId.trim().length === 0) {
    throw new Error('Workspace id is required.');
  }

  const normalized = normalizeDelegatedTaskInput(input);
  return {
    id: taskId,
    workspaceId,
    ...normalized,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    artifactRefs: [],
    currentStepId: undefined,
    blockerReason: undefined,
    resumeStatus: undefined,
  };
}