import { Emitter } from '../platform/events.js';
import { Disposable } from '../platform/lifecycle.js';
import { assertAgentTaskTransition, canTransitionAgentTaskStatus } from '../agent/agentLifecycle.js';
import { createAgentTaskRecord } from '../agent/agentTaskModels.js';
import type {
  AgentApprovalRequestInput,
  AgentApprovalResolution,
  AgentTaskRecord,
  AgentTaskStatus,
  DelegatedTaskInput,
} from '../agent/agentTypes.js';
import type {
  IAgentApprovalService,
  IAgentSessionService,
  IAgentTaskStore,
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
    this._onDidChangeTasksEmitter.fire(task);
    return task;
  }

  async transitionTask(
    taskId: string,
    nextStatus: AgentTaskStatus,
    now: string = new Date().toISOString(),
    options?: { blockerReason?: string; currentStepId?: string },
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
      resumeStatus: nextStatus === 'awaiting-approval' ? existing.resumeStatus : undefined,
    };

    await this._taskStore.upsertTask(updated);
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

    if (!canTransitionAgentTaskStatus(existing.status, 'awaiting-approval')) {
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
      blockerReason: `Awaiting approval: ${approvalRequest.summary}`,
      resumeStatus: existing.status,
    };

    await this._taskStore.upsertTask(task);
    this._onDidChangeTasksEmitter.fire(task);
    return { task, approvalRequest };
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

    switch (resolution) {
      case 'approve-once':
      case 'approve-for-task':
        nextStatus = existing.resumeStatus ?? 'planning';
        blockerReason = undefined;
        break;
      case 'deny':
        nextStatus = 'blocked';
        blockerReason = `Approval denied: ${approval.summary}`;
        break;
      case 'cancel-task':
        nextStatus = 'cancelled';
        blockerReason = 'Task cancelled during approval.';
        break;
      default:
        nextStatus = 'blocked';
        blockerReason = `Approval denied: ${approval.summary}`;
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
      resumeStatus: undefined,
    };

    await this._taskStore.upsertTask(updated);
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
}