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
    const request: AgentApprovalRequest = {
      ...input,
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
}