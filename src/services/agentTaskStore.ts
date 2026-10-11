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
      this._loadInto(TASKS_STORAGE_KEY, this._tasks, 'tasks'),
      this._loadInto(PLAN_STEPS_STORAGE_KEY, this._planSteps, 'plan steps'),
      this._loadInto(APPROVALS_STORAGE_KEY, this._approvalRequests, 'approval requests'),
      this._loadInto(MEMORY_STORAGE_KEY, this._memoryEntries, 'memory entries'),
      this._loadInto(TRACE_STORAGE_KEY, this._traceEntries, 'trace entries'),
    ]);
  }

  async upsertTask(task: AgentTaskRecord): Promise<void> {
    this._tasks.set(task.id, task);
    await this._persist(TASKS_STORAGE_KEY, this._tasks);
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
    await this._persist(PLAN_STEPS_STORAGE_KEY, this._planSteps);
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
    await this._persist(APPROVALS_STORAGE_KEY, this._approvalRequests);
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
    await this._persist(MEMORY_STORAGE_KEY, this._memoryEntries);
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
    await this._persist(TRACE_STORAGE_KEY, this._traceEntries);
  }

  listTraceEntriesForTask(taskId: string): readonly AgentTraceEntry[] {
    return [...this._traceEntries.values()]
      .filter((entry) => entry.taskId === taskId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  /** Read a JSON array of records from storage into `into`, skipping anything that is not a record with an id. */
  private async _loadInto<T extends { readonly id: string }>(key: string, into: Map<string, T>, what: string): Promise<void> {
    into.clear();
    if (!this._storage) return;
    const raw = await this._storage.get(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed as T[]) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
        into.set(item.id, item);
      }
    } catch {
      console.warn(`[AgentTaskStore] Failed to parse persisted ${what}, resetting to empty state.`);
    }
  }

  private async _persist(key: string, from: ReadonlyMap<string, unknown>): Promise<void> {
    if (!this._storage) return;
    await this._storage.set(key, JSON.stringify([...from.values()]));
  }

}