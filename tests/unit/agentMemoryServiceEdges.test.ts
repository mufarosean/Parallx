/**
 * Pin-the-invariant: AgentMemoryService — extended edges.
 *
 * Complements `agentMemoryService.test.ts` (basic happy-paths) with the
 * edges that aren't pinned there: whitespace-collapse on content, empty-
 * content rejection, cross-task isolation on getTaskMemoryEntry, the
 * not-found errors on correctTaskMemory, full per-category-cap pinning
 * for the goal=1 case (sharpest cap), and "no spurious supersededById"
 * when entries fit under the cap.
 */

import { describe, expect, it } from 'vitest';
import { AgentMemoryService } from '../../src/services/agentMemoryService';
import type {
  AgentApprovalRequest,
  AgentMemoryEntry,
  AgentMemoryEntryInput,
  AgentPlanStep,
  AgentTaskRecord,
  AgentTraceEntry,
} from '../../src/agent/agentTypes';
import type { IAgentTaskStore } from '../../src/services/serviceTypes';
import type { IStorage } from '../../src/platform/storage';

class StubTaskStore implements IAgentTaskStore {
  memory = new Map<string, AgentMemoryEntry>();
  async setStorage(_s: IStorage): Promise<void> { /* */ }
  async upsertTask(_t: AgentTaskRecord): Promise<void> { /* */ }
  getTask(): AgentTaskRecord | undefined { return undefined; }
  listTasksForWorkspace(): readonly AgentTaskRecord[] { return []; }
  async upsertPlanStep(_s: AgentPlanStep): Promise<void> { /* */ }
  getPlanStep(): AgentPlanStep | undefined { return undefined; }
  listPlanStepsForTask(): readonly AgentPlanStep[] { return []; }
  async upsertApprovalRequest(_r: AgentApprovalRequest): Promise<void> { /* */ }
  getApprovalRequest(): AgentApprovalRequest | undefined { return undefined; }
  listApprovalRequestsForTask(): readonly AgentApprovalRequest[] { return []; }
  listPendingApprovalRequests(): readonly AgentApprovalRequest[] { return []; }
  async upsertMemoryEntry(e: AgentMemoryEntry): Promise<void> { this.memory.set(e.id, e); }
  getMemoryEntry(id: string): AgentMemoryEntry | undefined { return this.memory.get(id); }
  listMemoryEntriesForTask(taskId: string): readonly AgentMemoryEntry[] {
    return [...this.memory.values()].filter((e) => e.taskId === taskId);
  }
  async upsertTraceEntry(_e: AgentTraceEntry): Promise<void> { /* */ }
  listTraceEntriesForTask(): readonly AgentTraceEntry[] { return []; }
  dispose(): void { /* */ }
}

function memIn(over: Partial<AgentMemoryEntryInput> = {}): AgentMemoryEntryInput {
  return { id: 'mem-1', category: 'goal', content: 'x', ...over };
}

describe('AgentMemoryService.remember — content normalization', () => {
  it('trims and collapses internal whitespace', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    const e = await svc.remember('t1', memIn({ content: '   hello\t  \n  world   ' }));
    expect(e.content).toBe('hello world');
  });

  it('rejects empty content', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await expect(svc.remember('t1', memIn({ content: '' }))).rejects.toThrow(/required/);
  });

  it('rejects whitespace-only content', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await expect(svc.remember('t1', memIn({ content: '   \t\n  ' }))).rejects.toThrow(/required/);
  });

  it('defaults source=agent, evidenceStepIds=[], artifactRefs=[], pinned=false', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    const e = await svc.remember('t1', memIn({ content: 'ok' }));
    expect(e.source).toBe('agent');
    expect(e.evidenceStepIds).toEqual([]);
    expect(e.artifactRefs).toEqual([]);
    expect(e.pinned).toBe(false);
  });

  it('uses caller-provided now for both createdAt and updatedAt', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    const e = await svc.remember('t1', memIn({ content: 'ok' }), '2026-05-25T00:00:00.000Z');
    expect(e.createdAt).toBe('2026-05-25T00:00:00.000Z');
    expect(e.updatedAt).toBe('2026-05-25T00:00:00.000Z');
  });
});

describe('AgentMemoryService.getTaskMemoryEntry — cross-task isolation', () => {
  it('returns undefined when entry exists but belongs to a different task', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'mem-1', content: 'a' }));
    expect(svc.getTaskMemoryEntry('t1', 'mem-1')?.id).toBe('mem-1');
    expect(svc.getTaskMemoryEntry('t2', 'mem-1')).toBeUndefined();
  });

  it('returns undefined for unknown id', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    expect(svc.getTaskMemoryEntry('t1', 'no-such-id')).toBeUndefined();
  });
});

describe('AgentMemoryService.correctTaskMemory — error paths', () => {
  it('throws when previous entry is unknown', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await expect(svc.correctTaskMemory('t1', 'missing', { id: 'b', content: 'x' })).rejects.toThrow(/not found/);
  });

  it('throws when previous belongs to a different task (cross-task safety)', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'a', content: 'a' }));
    await expect(svc.correctTaskMemory('t2', 'a', { id: 'b', content: 'x' })).rejects.toThrow(/not found/);
  });

  it('throws when corrected content is empty after trim', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'a', content: 'a' }));
    await expect(svc.correctTaskMemory('t1', 'a', { id: 'b', content: '   ' })).rejects.toThrow(/required/);
  });

  it('inherits category, evidenceStepIds, artifactRefs, pinned from previous when omitted', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({
      id: 'a',
      category: 'assumption',
      content: 'original',
      evidenceStepIds: ['s1', 's2'],
      artifactRefs: ['ref:1'],
      pinned: true,
    }));
    const { corrected } = await svc.correctTaskMemory('t1', 'a', { id: 'b', content: 'new' });
    expect(corrected.category).toBe('assumption');
    expect(corrected.evidenceStepIds).toEqual(['s1', 's2']);
    expect(corrected.artifactRefs).toEqual(['ref:1']);
    expect(corrected.pinned).toBe(true);
    expect(corrected.source).toBe('user'); // correction default
  });

  it('overrides inherited fields when caller provides them', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'a', category: 'goal', content: 'a', pinned: false }));
    const { corrected } = await svc.correctTaskMemory('t1', 'a', {
      id: 'b',
      content: 'b',
      category: 'plan',
      source: 'system',
      pinned: true,
      evidenceStepIds: ['x'],
    });
    expect(corrected.category).toBe('plan');
    expect(corrected.source).toBe('system');
    expect(corrected.pinned).toBe(true);
    expect(corrected.evidenceStepIds).toEqual(['x']);
  });
});

describe('AgentMemoryService.compactTaskMemory — sharper edges', () => {
  it('returns [] for a task with no entries', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    expect(await svc.compactTaskMemory('t1')).toEqual([]);
  });

  it('enforces goal cap of 1 — newest survives, older ones get supersededById pointing at newest', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'g1', category: 'goal', content: 'a' }), '2026-05-25T00:00:01.000Z');
    await svc.remember('t1', memIn({ id: 'g2', category: 'goal', content: 'b' }), '2026-05-25T00:00:02.000Z');
    await svc.remember('t1', memIn({ id: 'g3', category: 'goal', content: 'c' }), '2026-05-25T00:00:03.000Z');
    await svc.compactTaskMemory('t1', '2026-05-25T00:01:00.000Z');
    expect(svc.listTaskMemory('t1').map((e) => e.id)).toEqual(['g3']);
    const all = svc.listTaskMemory('t1', { includeSuperseded: true });
    expect(all.find((e) => e.id === 'g1')?.supersededById).toBe('g3');
    expect(all.find((e) => e.id === 'g2')?.supersededById).toBe('g3');
  });

  it('pinned entries always survive compaction even past the goal=1 cap', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'g_old', category: 'goal', content: 'old', pinned: true }),
      '2026-05-25T00:00:01.000Z');
    await svc.remember('t1', memIn({ id: 'g_new', category: 'goal', content: 'new' }),
      '2026-05-25T00:00:02.000Z');
    await svc.compactTaskMemory('t1', '2026-05-25T00:01:00.000Z');
    const live = svc.listTaskMemory('t1').map((e) => e.id).sort();
    expect(live).toEqual(['g_new', 'g_old']);
  });

  it('does not stamp supersededById on entries that fit under their per-category cap', async () => {
    const svc = new AgentMemoryService(new StubTaskStore());
    await svc.remember('t1', memIn({ id: 'p1', category: 'plan', content: 'a' }), '2026-05-25T00:00:01.000Z');
    await svc.remember('t1', memIn({ id: 'p2', category: 'plan', content: 'b' }), '2026-05-25T00:00:02.000Z');
    // plan cap is 2 → both survive.
    await svc.compactTaskMemory('t1', '2026-05-25T00:01:00.000Z');
    for (const e of svc.listTaskMemory('t1', { includeSuperseded: true })) {
      expect(e.supersededById).toBeUndefined();
    }
  });
});
