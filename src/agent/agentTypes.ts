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
  readonly currentStepId?: string;
  readonly blockerReason?: string;
  readonly resumeStatus?: AgentTaskStatus;
}

export type AgentPlanStepStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled';
export type AgentPlanStepKind = 'analysis' | 'read' | 'search' | 'write' | 'edit' | 'delete' | 'command' | 'approval';
export type AgentPlanStepApprovalState = 'not-required' | 'pending' | 'approved' | 'denied';

export interface AgentPlanStep {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly status: AgentPlanStepStatus;
  readonly kind: AgentPlanStepKind;
  readonly proposedAction?: AgentProposedAction;
  readonly approvalState: AgentPlanStepApprovalState;
  readonly dependsOn: readonly string[];
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

export const AGENT_APPROVAL_STATUSES = ['pending', 'approved-once', 'approved-for-task', 'denied', 'cancelled'] as const;
export type AgentApprovalStatus = typeof AGENT_APPROVAL_STATUSES[number];

export const AGENT_APPROVAL_RESOLUTIONS = ['approve-once', 'approve-for-task', 'deny', 'cancel-task'] as const;
export type AgentApprovalResolution = typeof AGENT_APPROVAL_RESOLUTIONS[number];

export type AgentApprovalScope = 'single-action' | 'task';

export interface AgentApprovalRequest {
  readonly id: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly stepIds: readonly string[];
  readonly actionClass: AgentActionClass;
  readonly toolName: string;
  readonly summary: string;
  readonly explanation: string;
  readonly affectedTargets: readonly string[];
  readonly bundleKey?: string;
  readonly requestCount: number;
  readonly scope: AgentApprovalScope;
  readonly reason: string;
  readonly status: AgentApprovalStatus;
  readonly createdAt: string;
  readonly resolvedAt?: string;
}

export interface AgentApprovalRequestInput {
  readonly id: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly stepIds?: readonly string[];
  readonly actionClass: AgentActionClass;
  readonly toolName: string;
  readonly summary: string;
  readonly explanation?: string;
  readonly affectedTargets?: readonly string[];
  readonly bundleKey?: string;
  readonly scope: AgentApprovalScope;
  readonly reason: string;
  readonly createdAt?: string;
}