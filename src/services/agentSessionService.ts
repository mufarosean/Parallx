import { Emitter } from '../platform/events.js';
import { Disposable } from '../platform/lifecycle.js';
import { assertAgentTaskTransition, canTransitionAgentTaskStatus } from '../agent/agentLifecycle.js';
import { createAgentTaskRecord } from '../agent/agentTaskModels.js';
import type {
  AgentApprovalRequestInput,
  AgentPlanStep,
  AgentPlanStepInput,
  AgentApprovalResolution,
  AgentBlockReasonCode,
  AgentTaskRecord,
  AgentTaskStatus,
  DelegatedTaskInput,
} from '../agent/agentTypes.js';
import type {
  IAgentApprovalService,
  IAgentSessionService,
  IAgentTaskStore,
  IAgentTraceService,
  IWorkspaceService,
} from './serviceTypes.js';

function createAgentTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `agent-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentSessionService extends Disposable implements IAgentSessionService {
  private readonly _onDidChangeTasksEmitter = this._register(new Emitter<AgentTaskRecord>());
  readonly onDidChangeTasks = this._onDidChangeTasksEmitter.event;

  constructor(
    private readonly _workspaceService: IWorkspaceService,
    private readonly _taskStore: IAgentTaskStore,
    private readonly _approvalService: IAgentApprovalService,
    private readonly _traceService?: IAgentTraceService,
  ) {
    super();
  }

  async createTask(input: DelegatedTaskInput, taskId: string = createAgentTaskId(), now: string = new Date().toISOString()): Promise<AgentTaskRecord> {
    const workspace = this._workspaceService.activeWorkspace;
    if (!workspace) {
      throw new Error('Cannot create an agent task without an active workspace.');
    }

    const task = createAgentTaskRecord(taskId, workspace.id, input, now);
    await this._taskStore.upsertTask(task);
    await this._traceService?.record(task.id, {
      id: `trace-task-created-${task.id}`,
      phase: 'state',
      event: 'task-created',
      message: `Task created: ${task.goal}`,
      nextStatus: task.status,
      outputSummary: task.goal,
    }, now);
    this._onDidChangeTasksEmitter.fire(task);
    return task;
  }

  async transitionTask(
    taskId: string,
    nextStatus: AgentTaskStatus,
    now: string = new Date().toISOString(),
    options?: { blockerReason?: string; blockerCode?: AgentBlockReasonCode; currentStepId?: string; stopAfterCurrentStep?: boolean },
  ): Promise<AgentTaskRecord> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    if (existing.status !== nextStatus) {
      assertAgentTaskTransition(existing.status, nextStatus);
    }

    const updated: AgentTaskRecord = {
      ...existing,
      status: nextStatus,
      updatedAt: now,
      currentStepId: options?.currentStepId ?? existing.currentStepId,
      blockerReason: options?.blockerReason,
      blockerCode: options?.blockerCode,
      resumeStatus: nextStatus === 'awaiting-approval' ? existing.resumeStatus : undefined,
      stopAfterCurrentStep: options?.stopAfterCurrentStep
        ?? (nextStatus === 'completed' || nextStatus === 'cancelled' ? false : existing.stopAfterCurrentStep),
    };

    await this._taskStore.upsertTask(updated);
    await this._traceService?.record(taskId, {
      id: `trace-task-transition-${taskId}-${now}-${nextStatus}`,
      phase: 'state',
      event: 'task-transitioned',
      message: `Task transitioned from ${existing.status} to ${nextStatus}.`,
      previousStatus: existing.status,
      nextStatus,
      stepId: updated.currentStepId,
      outputSummary: options?.blockerReason,
    }, now);
    this._onDidChangeTasksEmitter.fire(updated);
    return updated;
  }

  async queueApprovalForTask(
    taskId: string,
    request: Omit<AgentApprovalRequestInput, 'taskId'>,
    now: string = new Date().toISOString(),
  ): Promise<{ task: AgentTaskRecord; approvalRequest: import('../agent/agentTypes.js').AgentApprovalRequest }> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    if (existing.status !== 'awaiting-approval' && !canTransitionAgentTaskStatus(existing.status, 'awaiting-approval')) {
      throw new Error(`Task ${taskId} cannot queue approval from status ${existing.status}.`);
    }

    const approvalRequest = await this._approvalService.createApprovalRequest({
      ...request,
      taskId,
      createdAt: now,
    });

    const task: AgentTaskRecord = {
      ...existing,
      status: 'awaiting-approval',
      updatedAt: now,
      currentStepId: request.stepId,
      blockerReason: this._buildApprovalBlockerReason(approvalRequest),
      blockerCode: 'approval-pending',
      resumeStatus: existing.status === 'awaiting-approval'
        ? existing.resumeStatus
        : existing.status,
    };

    await this._taskStore.upsertTask(task);
    await this._traceService?.record(taskId, {
      id: `trace-approval-requested-${approvalRequest.id}`,
      phase: 'approval',
      event: 'approval-requested',
      message: `Approval requested for ${approvalRequest.toolName}.`,
      stepId: request.stepId,
      planIntent: approvalRequest.summary,
      selectedTool: approvalRequest.toolName,
      approvalResult: 'pending',
      outputSummary: approvalRequest.explanation,
      previousStatus: existing.status,
      nextStatus: 'awaiting-approval',
    }, now);
    this._onDidChangeTasksEmitter.fire(task);
    return { task, approvalRequest };
  }

  async setPlanSteps(
    taskId: string,
    steps: readonly AgentPlanStepInput[],
    now: string = new Date().toISOString(),
  ): Promise<readonly AgentPlanStep[]> {
    const task = this._taskStore.getTask(taskId);
    if (!task) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    const persisted: AgentPlanStep[] = [];
    for (const stepInput of steps) {
      const step: AgentPlanStep = {
        id: stepInput.id,
        taskId,
        title: stepInput.title,
        description: stepInput.description,
        kind: stepInput.kind,
        proposedAction: stepInput.proposedAction,
        status: 'pending',
        approvalState: 'not-required',
        dependsOn: stepInput.dependsOn ?? [],
        createdAt: stepInput.createdAt ?? now,
        updatedAt: stepInput.createdAt ?? now,
      };
      await this._taskStore.upsertPlanStep(step);
      await this._traceService?.record(taskId, {
        id: `trace-plan-step-${step.id}`,
        phase: 'planning',
        event: 'plan-step-recorded',
        message: `Planned step: ${step.title}`,
        stepId: step.id,
        planIntent: step.title,
        selectedTool: step.proposedAction?.toolName,
        outputSummary: step.description,
      }, now);
      persisted.push(step);
    }

    return persisted;
  }

  async recordTaskArtifacts(
    taskId: string,
    artifactRefs: readonly string[],
    now: string = new Date().toISOString(),
  ): Promise<AgentTaskRecord> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    const normalized = artifactRefs
      .map((artifactRef) => artifactRef.trim())
      .filter((artifactRef) => artifactRef.length > 0);
    if (normalized.length === 0) {
      return existing;
    }

    const merged = [...existing.artifactRefs];
    for (const artifactRef of normalized) {
      if (!merged.includes(artifactRef)) {
        merged.push(artifactRef);
      }
    }

    if (merged.length === existing.artifactRefs.length) {
      return existing;
    }

    const updated: AgentTaskRecord = {
      ...existing,
      artifactRefs: merged,
      updatedAt: now,
    };

    await this._taskStore.upsertTask(updated);
    this._onDidChangeTasksEmitter.fire(updated);
    return updated;
  }

  getPlanSteps(taskId: string): readonly AgentPlanStep[] {
    return this._taskStore.listPlanStepsForTask(taskId);
  }

  async requestStopAfterCurrentStep(taskId: string, now: string = new Date().toISOString()): Promise<AgentTaskRecord> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    const updated: AgentTaskRecord = {
      ...existing,
      updatedAt: now,
      stopAfterCurrentStep: true,
    };

    await this._taskStore.upsertTask(updated);
    this._onDidChangeTasksEmitter.fire(updated);
    return updated;
  }

  async continueTask(taskId: string, now: string = new Date().toISOString()): Promise<AgentTaskRecord> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    if (existing.status !== 'paused' && existing.status !== 'blocked') {
      throw new Error(`Task ${taskId} cannot continue from status ${existing.status}.`);
    }

    return this.transitionTask(taskId, 'planning', now, {
      currentStepId: undefined,
      blockerReason: undefined,
      blockerCode: undefined,
      stopAfterCurrentStep: false,
    });
  }

  async redirectTask(taskId: string, constraint: string, now: string = new Date().toISOString()): Promise<AgentTaskRecord> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    if (existing.status !== 'paused' && existing.status !== 'blocked') {
      throw new Error(`Task ${taskId} cannot be redirected from status ${existing.status}.`);
    }

    const normalizedConstraint = constraint.trim().replace(/\s+/g, ' ');
    if (normalizedConstraint.length === 0) {
      throw new Error('Redirect constraint is required.');
    }

    const updated: AgentTaskRecord = {
      ...existing,
      constraints: existing.constraints.includes(normalizedConstraint)
        ? existing.constraints
        : [...existing.constraints, normalizedConstraint],
      status: 'planning',
      updatedAt: now,
      currentStepId: undefined,
      blockerReason: undefined,
      blockerCode: undefined,
      resumeStatus: undefined,
      stopAfterCurrentStep: false,
    };

    await this._taskStore.upsertTask(updated);
    this._onDidChangeTasksEmitter.fire(updated);
    return updated;
  }

  async resolveTaskApproval(
    taskId: string,
    requestId: string,
    resolution: AgentApprovalResolution,
    now: string = new Date().toISOString(),
  ): Promise<AgentTaskRecord> {
    const existing = this._taskStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    const approval = await this._approvalService.resolveApprovalRequest(requestId, resolution, now);
    if (approval.taskId !== taskId) {
      throw new Error(`Approval request ${requestId} does not belong to task ${taskId}.`);
    }

    let nextStatus: AgentTaskStatus;
    let blockerReason: string | undefined;
    let blockerCode: AgentBlockReasonCode | undefined;

    switch (resolution) {
      case 'approve-once':
      case 'approve-for-task':
        nextStatus = existing.resumeStatus ?? 'planning';
        blockerReason = undefined;
        blockerCode = undefined;
        break;
      case 'deny':
        nextStatus = 'blocked';
        blockerReason = `Approval denied: ${approval.summary}`;
        blockerCode = 'approval-denied';
        break;
      case 'cancel-task':
        nextStatus = 'cancelled';
        blockerReason = 'Task cancelled during approval.';
        blockerCode = undefined;
        break;
      default:
        nextStatus = 'blocked';
        blockerReason = `Approval denied: ${approval.summary}`;
        blockerCode = 'approval-denied';
        break;
    }

    if (existing.status !== nextStatus) {
      assertAgentTaskTransition(existing.status, nextStatus);
    }

    const updated: AgentTaskRecord = {
      ...existing,
      status: nextStatus,
      updatedAt: now,
      blockerReason,
      blockerCode,
      resumeStatus: undefined,
      stopAfterCurrentStep: false,
    };

    await this._taskStore.upsertTask(updated);
    await this._updatePlanStepsForApproval(taskId, approval.id, resolution, now);
    await this._traceService?.record(taskId, {
      id: `trace-approval-resolved-${approval.id}`,
      phase: 'approval',
      event: 'approval-resolved',
      message: `Approval ${resolution} for ${approval.toolName}.`,
      stepId: approval.stepId,
      planIntent: approval.summary,
      selectedTool: approval.toolName,
      approvalResult: resolution,
      outputSummary: blockerReason,
      previousStatus: existing.status,
      nextStatus,
    }, now);
    this._onDidChangeTasksEmitter.fire(updated);
    return updated;
  }

  getTask(taskId: string): AgentTaskRecord | undefined {
    return this._taskStore.getTask(taskId);
  }

  listActiveWorkspaceTasks(): readonly AgentTaskRecord[] {
    const workspace = this._workspaceService.activeWorkspace;
    if (!workspace) {
      return [];
    }

    return this._taskStore.listTasksForWorkspace(workspace.id);
  }

  private _buildApprovalBlockerReason(request: import('../agent/agentTypes.js').AgentApprovalRequest): string {
    const targetSummary = request.affectedTargets.length > 0
      ? ` Targets: ${request.affectedTargets.join(', ')}.`
      : '';
    const bundleSummary = request.requestCount > 1
      ? ` Bundled actions: ${request.requestCount}.`
      : '';
    return `Awaiting approval: ${request.summary}.${targetSummary}${bundleSummary}`.trim();
  }

  private async _updatePlanStepsForApproval(
    taskId: string,
    approvalRequestId: string,
    resolution: AgentApprovalResolution,
    now: string,
  ): Promise<void> {
    const relatedSteps = this._taskStore
      .listPlanStepsForTask(taskId)
      .filter((step) => step.approvalRequestId === approvalRequestId);

    for (const step of relatedSteps) {
      const updated: AgentPlanStep = {
        ...step,
        updatedAt: now,
        approvalState: resolution === 'approve-once' || resolution === 'approve-for-task'
          ? 'approved'
          : 'denied',
        status: resolution === 'cancel-task'
          ? 'cancelled'
          : resolution === 'deny'
            ? 'blocked'
            : 'pending',
        lastError: resolution === 'deny'
          ? 'Approval denied.'
          : resolution === 'cancel-task'
            ? 'Task cancelled during approval.'
            : undefined,
      };
      await this._taskStore.upsertPlanStep(updated);
    }
  }
}