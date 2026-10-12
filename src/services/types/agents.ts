// agents.ts — service interfaces for agents and autonomy: policy, the task store, approvals, sessions, execution, memory, traces, the autonomy log, flags, the task rail, pattern memory.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';
import type { IAutonomyFeatureFlagsService as IAutonomyFeatureFlagsServiceType } from '../autonomyFeatureFlags.js';
import type { IAutonomyEventLog as IAutonomyEventLogType } from '../autonomyEventLog.js';
import type { IAutonomyTaskRailService as IAutonomyTaskRailServiceType } from '../autonomyTaskRailService.js';
import type { IAutonomyPatternMemoryService as IAutonomyPatternMemoryServiceType } from '../autonomyPatternMemoryService.js';
import type { AgentActionClass, AgentApprovalRequest, AgentApprovalRequestInput, AgentApprovalResolution, AgentMemoryCorrectionInput, AgentMemoryEntry, AgentMemoryEntryInput, AgentPlanStep, AgentPlanStepInput, AgentPolicyDecision, AgentProposedAction, AgentRunResult, AgentTaskDiagnostics, AgentTaskRecord, AgentTaskStatus, AgentTraceEntry, AgentTraceEntryInput } from '../../agent/agentTypes.js';
import type { IStorage } from '../../platform/storage.js';

// ─── IAgentPolicyService ────────────────────────────────────────────────────

/**
 * Resolves agent action classification and default policy decisions.
 */
export interface IAgentPolicyService extends IDisposable {
  /** Classify an agent action into a stable action class. */
  classifyAction(action: AgentProposedAction): AgentActionClass;

  /** Evaluate the default policy decision for an agent action. */
  evaluateAction(action: AgentProposedAction): AgentPolicyDecision;
}

export const IAgentPolicyService = createServiceIdentifier<IAgentPolicyService>('IAgentPolicyService');

// ─── IAgentTaskStore ────────────────────────────────────────────────────────

/**
 * Persists agent tasks and approval requests into durable local storage.
 */
export interface IAgentTaskStore extends IDisposable {
  /** Bind storage and hydrate any persisted state. */
  setStorage(storage: IStorage): Promise<void>;

  /** Insert or replace a task record. */
  upsertTask(task: AgentTaskRecord): Promise<void>;

  /** Get a task by id. */
  getTask(taskId: string): AgentTaskRecord | undefined;

  /** List tasks for a workspace. */
  listTasksForWorkspace(workspaceId: string): readonly AgentTaskRecord[];

  /** Insert or replace a plan step. */
  upsertPlanStep(step: AgentPlanStep): Promise<void>;

  /** Get a plan step by id. */
  getPlanStep(stepId: string): AgentPlanStep | undefined;

  /** List plan steps for a task. */
  listPlanStepsForTask(taskId: string): readonly AgentPlanStep[];

  /** Insert or replace an approval request. */
  upsertApprovalRequest(request: AgentApprovalRequest): Promise<void>;

  /** Get an approval request by id. */
  getApprovalRequest(requestId: string): AgentApprovalRequest | undefined;

  /** List approval requests for a task. */
  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[];

  /** List all pending approval requests. */
  listPendingApprovalRequests(): readonly AgentApprovalRequest[];

  /** Insert or replace a task memory entry. */
  upsertMemoryEntry(entry: AgentMemoryEntry): Promise<void>;

  /** Get a task memory entry by id. */
  getMemoryEntry(entryId: string): AgentMemoryEntry | undefined;

  /** List task memory entries for a task. */
  listMemoryEntriesForTask(taskId: string): readonly AgentMemoryEntry[];

  /** Insert or replace a trace entry. */
  upsertTraceEntry(entry: AgentTraceEntry): Promise<void>;

  /** List trace entries for a task. */
  listTraceEntriesForTask(taskId: string): readonly AgentTraceEntry[];
}

export const IAgentTaskStore = createServiceIdentifier<IAgentTaskStore>('IAgentTaskStore');

// ─── IAgentApprovalService ──────────────────────────────────────────────────

/**
 * Owns durable creation and resolution of agent approval requests.
 */
export interface IAgentApprovalService extends IDisposable {
  /** Bind storage and hydrate any persisted approval state. */
  setStorage(storage: IStorage): Promise<void>;

  /** Create and persist a new pending approval request, or merge into an existing bundle. */
  createApprovalRequest(input: AgentApprovalRequestInput): Promise<AgentApprovalRequest>;

  /** Resolve a persisted approval request. */
  resolveApprovalRequest(requestId: string, resolution: AgentApprovalResolution, resolvedAt?: string): Promise<AgentApprovalRequest>;

  /** Get a single approval request by id. */
  getApprovalRequest(requestId: string): AgentApprovalRequest | undefined;

  /** List approval requests for a task. */
  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[];

  /** List pending approval requests. */
  listPendingApprovalRequests(): readonly AgentApprovalRequest[];

  /** Group pending approval requests by task + bundle identity for rendering. */
  listPendingApprovalBundles(): readonly AgentApprovalRequest[];

  /** Fires when an approval request is created or resolved. */
  readonly onDidChangeApprovalRequests: Event<AgentApprovalRequest>;
}

export const IAgentApprovalService = createServiceIdentifier<IAgentApprovalService>('IAgentApprovalService');

// ─── IAgentSessionService ───────────────────────────────────────────────────

/**
 * Owns task lifecycle transitions and approval pause/resume semantics.
 */
export interface IAgentSessionService extends IDisposable {
  /** Create and persist a new task for the active workspace. */
  createTask(input: import('../../agent/agentTypes.js').DelegatedTaskInput, taskId?: string, now?: string): Promise<AgentTaskRecord>;

  /** Update a task status directly through validated lifecycle transitions. */
  transitionTask(taskId: string, nextStatus: AgentTaskStatus, now?: string, options?: { blockerReason?: string; blockerCode?: import('../../agent/agentTypes.js').AgentBlockReasonCode; currentStepId?: string; stopAfterCurrentStep?: boolean }): Promise<AgentTaskRecord>;

  /** Move a task into awaiting-approval and enqueue an approval request. */
  queueApprovalForTask(taskId: string, request: Omit<AgentApprovalRequestInput, 'taskId'>, now?: string): Promise<{ task: AgentTaskRecord; approvalRequest: AgentApprovalRequest }>;

  /** Persist plan steps for a task. */
  setPlanSteps(taskId: string, steps: readonly AgentPlanStepInput[], now?: string): Promise<readonly AgentPlanStep[]>;

  /** Merge newly recorded workspace artifact refs into the task. */
  recordTaskArtifacts(taskId: string, artifactRefs: readonly string[], now?: string): Promise<AgentTaskRecord>;

  /** List plan steps for a task. */
  getPlanSteps(taskId: string): readonly AgentPlanStep[];

  /** Request that the task pause after completing its current runnable step. */
  requestStopAfterCurrentStep(taskId: string, now?: string): Promise<AgentTaskRecord>;

  /** Continue a paused or blocked task. */
  continueTask(taskId: string, now?: string): Promise<AgentTaskRecord>;

  /** Redirect a paused or blocked task with an additional constraint and resume planning. */
  redirectTask(taskId: string, constraint: string, now?: string): Promise<AgentTaskRecord>;

  /** Resolve an approval request and resume or block the task accordingly. */
  resolveTaskApproval(taskId: string, requestId: string, resolution: AgentApprovalResolution, now?: string): Promise<AgentTaskRecord>;

  /** Get a single task. */
  getTask(taskId: string): AgentTaskRecord | undefined;

  /** List tasks for the active workspace. */
  listActiveWorkspaceTasks(): readonly AgentTaskRecord[];

  /** Fires when a task changes. */
  readonly onDidChangeTasks: Event<AgentTaskRecord>;
}

export const IAgentSessionService = createServiceIdentifier<IAgentSessionService>('IAgentSessionService');

// ─── IAgentExecutionService ────────────────────────────────────────────────

/**
 * Runs the minimal autonomous execution loop over persisted plan steps.
 */
export interface IAgentExecutionService extends IDisposable {
  /** Execute runnable plan steps until the task completes or yields. */
  runTask(taskId: string, now?: string): Promise<AgentRunResult>;
}

export const IAgentExecutionService = createServiceIdentifier<IAgentExecutionService>('IAgentExecutionService');

// ─── IAgentMemoryService ───────────────────────────────────────────────────

/**
 * Owns task-scoped working memory entries and compaction rules.
 */
export interface IAgentMemoryService extends IDisposable {
  /** Persist a task memory entry. */
  remember(taskId: string, input: AgentMemoryEntryInput, now?: string): Promise<AgentMemoryEntry>;

  /** List task memory entries in creation order. */
  listTaskMemory(taskId: string, options?: { includeSuperseded?: boolean }): readonly AgentMemoryEntry[];

  /** Get a specific task memory entry. */
  getTaskMemoryEntry(taskId: string, entryId: string): AgentMemoryEntry | undefined;

  /** Correct a prior memory entry by superseding it with a new canonical entry. */
  correctTaskMemory(taskId: string, entryId: string, correction: AgentMemoryCorrectionInput, now?: string): Promise<{ previous: AgentMemoryEntry; corrected: AgentMemoryEntry }>;

  /** Compact older non-pinned memory entries while preserving recent context. */
  compactTaskMemory(taskId: string, now?: string): Promise<readonly AgentMemoryEntry[]>;
}

export const IAgentMemoryService = createServiceIdentifier<IAgentMemoryService>('IAgentMemoryService');

// ─── IAgentTraceService ────────────────────────────────────────────────────

/**
 * Owns readable autonomous run trace entries.
 */
export interface IAgentTraceService extends IDisposable {
  /** Persist a trace entry for a task. */
  record(taskId: string, input: AgentTraceEntryInput, now?: string): Promise<AgentTraceEntry>;

  /** List trace entries for a task in creation order. */
  listTaskTrace(taskId: string): readonly AgentTraceEntry[];

  /** Build a reproducible diagnostics snapshot for a task. */
  getTaskDiagnostics(taskId: string): AgentTaskDiagnostics | undefined;
}

export const IAgentTraceService = createServiceIdentifier<IAgentTraceService>('IAgentTraceService');

// ── Autonomy Log Service ────────────────────
//
// Dedicated dedicated log for heartbeat / cron / subagent results so the
// chat transcript stays clean. Identifier only here — the concrete class
// lives in src/services/autonomyLogService.ts to avoid importing UI
// boilerplate into this type-surface file.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IAutonomyLogService = import('../autonomyLogService.js').AutonomyLogService;
export const IAutonomyLogService = createServiceIdentifier<IAutonomyLogService>('IAutonomyLogService');

// ─── IAutonomyFeatureFlagsService ────────────────────────────────
//
// Live-toggleable boolean flags that gate autonomy entry points, with the
// defaults the autonomy plan set. Followup runner + SurfaceRouter consult
// this service on every autonomous-trigger hot path.

export type IAutonomyFeatureFlagsService = IAutonomyFeatureFlagsServiceType;
export const IAutonomyFeatureFlagsService =
  createServiceIdentifier<IAutonomyFeatureFlagsServiceType>('IAutonomyFeatureFlagsService');

// ─── IAutonomyEventLog ──────────────────────────────────────────
//
// Structured ndjson event log for autonomous turns. One record per
// followup / cron firing / heartbeat tick / subagent spawn / surface route.
// Bodies, message contents, file contents — never logged. Hashes only.

export type IAutonomyEventLog = IAutonomyEventLogType;
export const IAutonomyEventLog =
  createServiceIdentifier<IAutonomyEventLogType>('IAutonomyEventLog');

// ─── IAutonomyTaskRailService ────────────────────────
//
// Read-only viewmodel that merges live in-memory autonomy log entries with
// persisted ndjson history into a single rail feed (filterable + paginated).

export type IAutonomyTaskRailService = IAutonomyTaskRailServiceType;
export const IAutonomyTaskRailService =
  createServiceIdentifier<IAutonomyTaskRailServiceType>('IAutonomyTaskRailService');

// ─── IAutonomyPatternMemoryService ───────────────────
//
// "Approve this pattern" memory for sub-agent spawn approvals. Patterns are
// reduced to (toolName, parentSessionPattern, argsShape) before storage —
// raw arg values never persisted.

export type IAutonomyPatternMemoryService = IAutonomyPatternMemoryServiceType;
export const IAutonomyPatternMemoryService =
  createServiceIdentifier<IAutonomyPatternMemoryServiceType>('IAutonomyPatternMemoryService');
