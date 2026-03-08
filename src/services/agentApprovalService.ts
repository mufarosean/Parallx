import { Emitter } from '../platform/events.js';
import { Disposable } from '../platform/lifecycle.js';
import type { IStorage } from '../platform/storage.js';
import type {
  AgentApprovalRequest,
  AgentApprovalRequestInput,
  AgentApprovalResolution,
  AgentApprovalStatus,
} from '../agent/agentTypes.js';
import type { IAgentApprovalService, IAgentTaskStore } from './serviceTypes.js';

export class AgentApprovalService extends Disposable implements IAgentApprovalService {
  private readonly _onDidChangeApprovalRequestsEmitter = this._register(new Emitter<AgentApprovalRequest>());
  readonly onDidChangeApprovalRequests = this._onDidChangeApprovalRequestsEmitter.event;

  constructor(
    private readonly _taskStore: IAgentTaskStore,
  ) {
    super();
  }

  async setStorage(storage: IStorage): Promise<void> {
    await this._taskStore.setStorage(storage);
  }

  async createApprovalRequest(input: AgentApprovalRequestInput): Promise<AgentApprovalRequest> {
    const mergeable = this._findMergeablePendingRequest(input);
    if (mergeable) {
      const merged = this._mergeApprovalRequest(mergeable, input);
      await this._taskStore.upsertApprovalRequest(merged);
      this._onDidChangeApprovalRequestsEmitter.fire(merged);
      return merged;
    }

    const request: AgentApprovalRequest = {
      ...input,
      stepIds: this._normalizeStepIds(input),
      explanation: input.explanation ?? input.reason,
      affectedTargets: this._dedupe(input.affectedTargets ?? []),
      requestCount: 1,
      status: 'pending',
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    await this._taskStore.upsertApprovalRequest(request);
    this._onDidChangeApprovalRequestsEmitter.fire(request);
    return request;
  }

  async resolveApprovalRequest(
    requestId: string,
    resolution: AgentApprovalResolution,
    resolvedAt: string = new Date().toISOString(),
  ): Promise<AgentApprovalRequest> {
    const existing = this._taskStore.getApprovalRequest(requestId);
    if (!existing) {
      throw new Error(`Agent approval request not found: ${requestId}`);
    }

    if (existing.status !== 'pending') {
      return existing;
    }

    const updated: AgentApprovalRequest = {
      ...existing,
      status: this._mapResolutionToStatus(resolution),
      resolvedAt,
    };

    await this._taskStore.upsertApprovalRequest(updated);
    this._onDidChangeApprovalRequestsEmitter.fire(updated);
    return updated;
  }

  getApprovalRequest(requestId: string): AgentApprovalRequest | undefined {
    return this._taskStore.getApprovalRequest(requestId);
  }

  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[] {
    return this._taskStore.listApprovalRequestsForTask(taskId);
  }

  listPendingApprovalRequests(): readonly AgentApprovalRequest[] {
    return this._taskStore.listPendingApprovalRequests();
  }

  listPendingApprovalBundles(): readonly AgentApprovalRequest[] {
    return [...this._taskStore.listPendingApprovalRequests()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private _mapResolutionToStatus(resolution: AgentApprovalResolution): AgentApprovalStatus {
    switch (resolution) {
      case 'approve-once':
        return 'approved-once';
      case 'approve-for-task':
        return 'approved-for-task';
      case 'deny':
        return 'denied';
      case 'cancel-task':
        return 'cancelled';
      default:
        return 'denied';
    }
  }

  private _findMergeablePendingRequest(input: AgentApprovalRequestInput): AgentApprovalRequest | undefined {
    const stepIds = this._normalizeStepIds(input);
    return this._taskStore.listPendingApprovalRequests().find((request) => {
      if (request.taskId !== input.taskId) {
        return false;
      }

      if (request.status !== 'pending') {
        return false;
      }

      if (request.actionClass !== input.actionClass || request.toolName !== input.toolName || request.scope !== input.scope) {
        return false;
      }

      if ((request.bundleKey ?? '') !== (input.bundleKey ?? '')) {
        return false;
      }

      return !stepIds.every((stepId) => request.stepIds.includes(stepId));
    });
  }

  private _mergeApprovalRequest(existing: AgentApprovalRequest, input: AgentApprovalRequestInput): AgentApprovalRequest {
    const mergedStepIds = this._dedupe([...existing.stepIds, ...this._normalizeStepIds(input)]);
    const mergedTargets = this._dedupe([...existing.affectedTargets, ...(input.affectedTargets ?? [])]);
    const mergedSummary = mergedTargets.length > 1
      ? `${existing.summary} (+${mergedTargets.length - 1} more target${mergedTargets.length > 2 ? 's' : ''})`
      : existing.summary;

    return {
      ...existing,
      stepIds: mergedStepIds,
      explanation: input.explanation ?? existing.explanation,
      affectedTargets: mergedTargets,
      summary: mergedSummary,
      requestCount: existing.requestCount + 1,
    };
  }

  private _normalizeStepIds(input: AgentApprovalRequestInput): readonly string[] {
    return this._dedupe([...(input.stepIds ?? []), input.stepId]);
  }

  private _dedupe(values: readonly string[]): readonly string[] {
    return values.filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  }
}