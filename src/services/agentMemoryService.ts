import { Disposable } from '../platform/lifecycle.js';
import type { AgentMemoryCategory, AgentMemoryCorrectionInput, AgentMemoryEntry, AgentMemoryEntryInput } from '../agent/agentTypes.js';
import type { IAgentMemoryService, IAgentTaskStore } from './serviceTypes.js';

const DEFAULT_CATEGORY_LIMITS: Record<AgentMemoryCategory, number> = {
  goal: 1,
  assumption: 3,
  plan: 2,
  evidence: 4,
  attempt: 4,
  artifact: 4,
};

export class AgentMemoryService extends Disposable implements IAgentMemoryService {
  constructor(
    private readonly _taskStore: IAgentTaskStore,
  ) {
    super();
  }

  async remember(taskId: string, input: AgentMemoryEntryInput, now: string = new Date().toISOString()): Promise<AgentMemoryEntry> {
    const content = input.content.trim().replace(/\s+/g, ' ');
    if (content.length === 0) {
      throw new Error('Task memory content is required.');
    }

    const entry: AgentMemoryEntry = {
      ...input,
      taskId,
      content,
      source: input.source ?? 'agent',
      evidenceStepIds: input.evidenceStepIds ?? [],
      artifactRefs: input.artifactRefs ?? [],
      pinned: input.pinned ?? false,
      createdAt: now,
      updatedAt: now,
    };

    await this._taskStore.upsertMemoryEntry(entry);
    return entry;
  }

  listTaskMemory(taskId: string, options?: { includeSuperseded?: boolean }): readonly AgentMemoryEntry[] {
    const includeSuperseded = options?.includeSuperseded ?? false;
    return this._taskStore
      .listMemoryEntriesForTask(taskId)
      .filter((entry) => includeSuperseded || !entry.supersededById);
  }

  getTaskMemoryEntry(taskId: string, entryId: string): AgentMemoryEntry | undefined {
    const entry = this._taskStore.getMemoryEntry(entryId);
    if (!entry || entry.taskId !== taskId) {
      return undefined;
    }

    return entry;
  }

  async correctTaskMemory(
    taskId: string,
    entryId: string,
    correction: AgentMemoryCorrectionInput,
    now: string = new Date().toISOString(),
  ): Promise<{ previous: AgentMemoryEntry; corrected: AgentMemoryEntry }> {
    const previous = this.getTaskMemoryEntry(taskId, entryId);
    if (!previous) {
      throw new Error(`Task memory entry not found: ${entryId}`);
    }

    const content = correction.content.trim().replace(/\s+/g, ' ');
    if (content.length === 0) {
      throw new Error('Corrected task memory content is required.');
    }

    const corrected: AgentMemoryEntry = {
      id: correction.id,
      taskId,
      category: correction.category ?? previous.category,
      content,
      source: correction.source ?? 'user',
      evidenceStepIds: correction.evidenceStepIds ?? previous.evidenceStepIds,
      artifactRefs: correction.artifactRefs ?? previous.artifactRefs,
      pinned: correction.pinned ?? previous.pinned,
      createdAt: now,
      updatedAt: now,
    };

    const updatedPrevious: AgentMemoryEntry = {
      ...previous,
      updatedAt: now,
      supersededById: corrected.id,
    };

    await this._taskStore.upsertMemoryEntry(updatedPrevious);
    await this._taskStore.upsertMemoryEntry(corrected);
    return { previous: updatedPrevious, corrected };
  }

  async compactTaskMemory(taskId: string, now: string = new Date().toISOString()): Promise<readonly AgentMemoryEntry[]> {
    const entries = this._taskStore.listMemoryEntriesForTask(taskId);
    if (entries.length === 0) {
      return [];
    }

    const grouped = new Map<AgentMemoryCategory, AgentMemoryEntry[]>();
    for (const entry of entries) {
      if (!grouped.has(entry.category)) {
        grouped.set(entry.category, []);
      }
      grouped.get(entry.category)!.push(entry);
    }

    const survivors = new Map<string, AgentMemoryEntry>();
    for (const entry of entries) {
      if (entry.pinned) {
        survivors.set(entry.id, entry);
      }
    }

    for (const [category, categoryEntries] of grouped.entries()) {
      const limit = DEFAULT_CATEGORY_LIMITS[category];
      const recentEntries = [...categoryEntries]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
      for (const entry of recentEntries) {
        survivors.set(entry.id, entry);
      }
    }

    const persisted: AgentMemoryEntry[] = [];
    for (const entry of entries) {
      const keep = survivors.has(entry.id);
      const updated: AgentMemoryEntry = keep
        ? entry
        : {
            ...entry,
            updatedAt: now,
            supersededById: this._findNewestSurvivorId(grouped.get(entry.category) ?? [], survivors),
          };
      await this._taskStore.upsertMemoryEntry(updated);
      persisted.push(updated);
    }

    return persisted;
  }

  private _findNewestSurvivorId(entries: readonly AgentMemoryEntry[], survivors: ReadonlyMap<string, AgentMemoryEntry>): string | undefined {
    return [...entries]
      .filter((entry) => survivors.has(entry.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id;
  }
}