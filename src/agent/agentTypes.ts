import type { URI } from '../platform/uri.js';

export const AGENT_INTERACTION_MODES = ['advisor', 'researcher', 'executor', 'reviewer', 'operator'] as const;
export type AgentInteractionMode = typeof AGENT_INTERACTION_MODES[number];

export const AGENT_AUTONOMY_LEVELS = ['manual', 'allow-readonly', 'allow-safe-actions', 'allow-policy-actions'] as const;
export type AgentAutonomyLevel = typeof AGENT_AUTONOMY_LEVELS[number];

export const AGENT_TASK_STATUSES = [
  'pending',
  'planning',
  'awaiting-approval',
  'running',
  'blocked',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type AgentTaskStatus = typeof AGENT_TASK_STATUSES[number];

export const AGENT_ACTION_CLASSES = [
  'read',
  'search',
  'write',
  'edit',
  'delete',
  'command',
  'task-state',
  'approval-sensitive',
  'unknown',
] as const;
export type AgentActionClass = typeof AGENT_ACTION_CLASSES[number];

export const AGENT_ACTION_POLICIES = ['allow', 'allow-with-notification', 'require-approval', 'deny'] as const;
export type AgentActionPolicy = typeof AGENT_ACTION_POLICIES[number];

export type AgentBoundaryViolationType = 'no-workspace' | 'outside-workspace' | 'non-file-uri';

export interface AgentAllowedScope {
  readonly kind: 'workspace';
  readonly roots?: readonly string[];
}

export interface DelegatedTaskInput {
  readonly goal: string;
  readonly constraints?: readonly string[];
  readonly desiredAutonomy?: AgentAutonomyLevel;
  readonly completionCriteria?: readonly string[];
  readonly allowedScope?: AgentAllowedScope;
  readonly mode?: AgentInteractionMode;
}

export interface NormalizedDelegatedTaskInput {
  readonly goal: string;
  readonly constraints: readonly string[];
  readonly desiredAutonomy: AgentAutonomyLevel;
  readonly completionCriteria: readonly string[];
  readonly allowedScope: AgentAllowedScope;
  readonly mode: AgentInteractionMode;
}

export interface AgentTaskRecord extends NormalizedDelegatedTaskInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: AgentTaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly artifactRefs: readonly string[];
}

export interface AgentBoundaryDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly normalizedPath?: string;
  readonly workspaceRoot?: string;
  readonly violationType?: AgentBoundaryViolationType;
}

export interface AgentProposedAction {
  readonly toolName?: string;
  readonly actionClass?: AgentActionClass;
  readonly summary?: string;
  readonly targetUris?: readonly URI[];
  readonly interactionMode?: AgentInteractionMode;
}

export interface AgentPolicyDecision {
  readonly actionClass: AgentActionClass;
  readonly policy: AgentActionPolicy;
  readonly reason: string;
  readonly boundaryDecisions: readonly AgentBoundaryDecision[];
}