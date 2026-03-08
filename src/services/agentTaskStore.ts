import { Disposable } from '../platform/lifecycle.js';
import type { IStorage } from '../platform/storage.js';
import type { AgentApprovalRequest, AgentMemoryEntry, AgentPlanStep, AgentTaskRecord, AgentTraceEntry } from '../agent/agentTypes.js';
import type { IAgentTaskStore } from './serviceTypes.js';

const TASKS_STORAGE_KEY = 'agent.tasks.v1';
const PLAN_STEPS_STORAGE_KEY = 'agent.planSteps.v1';
const APPROVALS_STORAGE_KEY = 'agent.approvals.v1';
const MEMORY_STORAGE_KEY = 'agent.memory.v1';
const TRACE_STORAGE_KEY = 'agent.trace.v1';

export class AgentTaskStore extends Disposable implements IAgentTaskStore {
  private _storage: IStorage | undefined;
  private readonly _tasks = new Map<string, AgentTaskRecord>();
  private readonly _planSteps = new Map<string, AgentPlanStep>();
  private readonly _approvalRequests = new Map<string, AgentApprovalRequest>();
  private readonly _memoryEntries = new Map<string, AgentMemoryEntry>();
  private readonly _traceEntries = new Map<string, AgentTraceEntry>();

  async setStorage(storage: IStorage): Promise<void> {
    this._storage = storage;
    await Promise.all([
      this._loadTasks(),
      this._loadPlanSteps(),
      this._loadApprovalRequests(),
      this._loadMemoryEntries(),
      this._loadTraceEntries(),
    ]);
  }

  async upsertTask(task: AgentTaskRecord): Promise<void> {
    this._tasks.set(task.id, task);
    await this._persistTasks();
  }

  getTask(taskId: string): AgentTaskRecord | undefined {
    return this._tasks.get(taskId);
  }

  listTasksForWorkspace(workspaceId: string): readonly AgentTaskRecord[] {
    return [...this._tasks.values()]
      .filter((task) => task.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async upsertPlanStep(step: AgentPlanStep): Promise<void> {
    this._planSteps.set(step.id, step);
    await this._persistPlanSteps();
  }

  getPlanStep(stepId: string): AgentPlanStep | undefined {
    return this._planSteps.get(stepId);
  }

  listPlanStepsForTask(taskId: string): readonly AgentPlanStep[] {
    return [...this._planSteps.values()]
      .filter((step) => step.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async upsertApprovalRequest(request: AgentApprovalRequest): Promise<void> {
    this._approvalRequests.set(request.id, request);
    await this._persistApprovalRequests();
  }

  getApprovalRequest(requestId: string): AgentApprovalRequest | undefined {
    return this._approvalRequests.get(requestId);
  }

  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[] {
    return [...this._approvalRequests.values()]
      .filter((request) => request.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listPendingApprovalRequests(): readonly AgentApprovalRequest[] {
    return [...this._approvalRequests.values()]
      .filter((request) => request.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async upsertMemoryEntry(entry: AgentMemoryEntry): Promise<void> {
    this._memoryEntries.set(entry.id, entry);
    await this._persistMemoryEntries();
  }

  getMemoryEntry(entryId: string): AgentMemoryEntry | undefined {
    return this._memoryEntries.get(entryId);
  }

  listMemoryEntriesForTask(taskId: string): readonly AgentMemoryEntry[] {
    return [...this._memoryEntries.values()]
      .filter((entry) => entry.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async upsertTraceEntry(entry: AgentTraceEntry): Promise<void> {
    this._traceEntries.set(entry.id, entry);
    await this._persistTraceEntries();
  }

  listTraceEntriesForTask(taskId: string): readonly AgentTraceEntry[] {
    return [...this._traceEntries.values()]
      .filter((entry) => entry.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async _loadTasks(): Promise<void> {
    this._tasks.clear();
    if (!this._storage) {
      return;
    }

    const raw = await this._storage.get(TASKS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AgentTaskRecord[];
      if (!Array.isArray(parsed)) {
        return;
      }

      for (const task of parsed) {
        if (!task || typeof task !== 'object' || typeof task.id !== 'string') {
          continue;
        }
        this._tasks.set(task.id, task);
      }
    } catch {
      console.warn('[AgentTaskStore] Failed to parse persisted tasks, resetting to empty state.');
    }
  }

  private async _loadApprovalRequests(): Promise<void> {
    this._approvalRequests.clear();
    if (!this._storage) {
      return;
    }

    const raw = await this._storage.get(APPROVALS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AgentApprovalRequest[];
      if (!Array.isArray(parsed)) {
        return;
      }

      for (const request of parsed) {
        if (!request || typeof request !== 'object' || typeof request.id !== 'string') {
          continue;
        }
        this._approvalRequests.set(request.id, request);
      }
    } catch {
      console.warn('[AgentTaskStore] Failed to parse persisted approval requests, resetting to empty state.');
    }
  }

  private async _loadPlanSteps(): Promise<void> {
    this._planSteps.clear();
    if (!this._storage) {
      return;
    }

    const raw = await this._storage.get(PLAN_STEPS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AgentPlanStep[];
      if (!Array.isArray(parsed)) {
        return;
      }

      for (const step of parsed) {
        if (!step || typeof step !== 'object' || typeof step.id !== 'string') {
          continue;
        }
        this._planSteps.set(step.id, step);
      }
    } catch {
      console.warn('[AgentTaskStore] Failed to parse persisted plan steps, resetting to empty state.');
    }
  }

  private async _loadMemoryEntries(): Promise<void> {
    this._memoryEntries.clear();
    if (!this._storage) {
      return;
    }

    const raw = await this._storage.get(MEMORY_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AgentMemoryEntry[];
      if (!Array.isArray(parsed)) {
        return;
      }

      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
          continue;
        }
        this._memoryEntries.set(entry.id, entry);
      }
    } catch {
      console.warn('[AgentTaskStore] Failed to parse persisted memory entries, resetting to empty state.');
    }
  }

  private async _loadTraceEntries(): Promise<void> {
    this._traceEntries.clear();
    if (!this._storage) {
      return;
    }

    const raw = await this._storage.get(TRACE_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AgentTraceEntry[];
      if (!Array.isArray(parsed)) {
        return;
      }

      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
          continue;
        }
        this._traceEntries.set(entry.id, entry);
      }
    } catch {
      console.warn('[AgentTaskStore] Failed to parse persisted trace entries, resetting to empty state.');
    }
  }

  private async _persistTasks(): Promise<void> {
    if (!this._storage) {
      return;
    }

    await this._storage.set(TASKS_STORAGE_KEY, JSON.stringify([...this._tasks.values()]));
  }

  private async _persistApprovalRequests(): Promise<void> {
    if (!this._storage) {
      return;
    }

    await this._storage.set(APPROVALS_STORAGE_KEY, JSON.stringify([...this._approvalRequests.values()]));
  }

  private async _persistPlanSteps(): Promise<void> {
    if (!this._storage) {
      return;
    }

    await this._storage.set(PLAN_STEPS_STORAGE_KEY, JSON.stringify([...this._planSteps.values()]));
  }

  private async _persistMemoryEntries(): Promise<void> {
    if (!this._storage) {
      return;
    }

    await this._storage.set(MEMORY_STORAGE_KEY, JSON.stringify([...this._memoryEntries.values()]));
  }

  private async _persistTraceEntries(): Promise<void> {
    if (!this._storage) {
      return;
    }

    await this._storage.set(TRACE_STORAGE_KEY, JSON.stringify([...this._traceEntries.values()]));
  }
}