import { Disposable } from '../platform/lifecycle.js';
import type { AgentTaskDiagnostics, AgentTraceEntry, AgentTraceEntryInput } from '../agent/agentTypes.js';
import type { IAgentTaskStore, IAgentTraceService } from './serviceTypes.js';

export class AgentTraceService extends Disposable implements IAgentTraceService {
  constructor(
    private readonly _taskStore: IAgentTaskStore,
  ) {
    super();
  }

  async record(taskId: string, input: AgentTraceEntryInput, now: string = new Date().toISOString()): Promise<AgentTraceEntry> {
    const entry: AgentTraceEntry = {
      ...input,
      taskId,
      createdAt: now,
    };
    await this._taskStore.upsertTraceEntry(entry);
    return entry;
  }

  listTaskTrace(taskId: string): readonly AgentTraceEntry[] {
    return this._taskStore.listTraceEntriesForTask(taskId);
  }

  getTaskDiagnostics(taskId: string): AgentTaskDiagnostics | undefined {
    const task = this._taskStore.getTask(taskId);
    if (!task) {
      return undefined;
    }

    return {
      task,
      planSteps: this._taskStore.listPlanStepsForTask(taskId),
      approvals: this._taskStore.listApprovalRequestsForTask(taskId),
      memory: this._taskStore.listMemoryEntriesForTask(taskId),
      trace: this._taskStore.listTraceEntriesForTask(taskId),
    };
  }
}