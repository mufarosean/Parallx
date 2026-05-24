/**
 * Pin-the-invariant: AgentApprovalService — extended coverage.
 *
 * Complements the basic suite (`agentApprovalService.test.ts`) with the
 * edges that aren't pinned there: the full resolution→status mapping,
 * negative merge cases (different actionClass/toolName/scope/bundleKey/taskId),
 * stepId-already-present non-merge, affectedTargets/explanation defaults,
 * bundle sort order, and task-scoped list filtering.
 */

import { describe, expect, it } from 'vitest';
import { AgentApprovalService } from '../../src/services/agentApprovalService';
import type {
  AgentApprovalRequest,
  AgentApprovalRequestInput,
  AgentApprovalResolution,
  AgentMemoryEntry,
  AgentPlanStep,
  AgentTaskRecord,
  AgentTraceEntry,
} from '../../src/agent/agentTypes';
import type { IAgentTaskStore } from '../../src/services/serviceTypes';
import type { IStorage } from '../../src/platform/storage';

class StubTaskStore implements IAgentTaskStore {
  approvalRequests = new Map<string, AgentApprovalRequest>();
  async setStorage(_storage: IStorage): Promise<void> { /* no-op */ }
  async upsertTask(_t: AgentTaskRecord): Promise<void> { /* no-op */ }
  getTask(): AgentTaskRecord | undefined { return undefined; }
  listTasksForWorkspace(): readonly AgentTaskRecord[] { return []; }
  async upsertPlanStep(_s: AgentPlanStep): Promise<void> { /* no-op */ }
  getPlanStep(): AgentPlanStep | undefined { return undefined; }
  listPlanStepsForTask(): readonly AgentPlanStep[] { return []; }
  async upsertApprovalRequest(request: AgentApprovalRequest): Promise<void> {
    this.approvalRequests.set(request.id, request);
  }
  getApprovalRequest(id: string): AgentApprovalRequest | undefined { return this.approvalRequests.get(id); }
  listApprovalRequestsForTask(taskId: string): readonly AgentApprovalRequest[] {
    return [...this.approvalRequests.values()].filter((r) => r.taskId === taskId);
  }
  listPendingApprovalRequests(): readonly AgentApprovalRequest[] {
    return [...this.approvalRequests.values()].filter((r) => r.status === 'pending');
  }
  async upsertMemoryEntry(_e: AgentMemoryEntry): Promise<void> { /* no-op */ }
  getMemoryEntry(): AgentMemoryEntry | undefined { return undefined; }
  listMemoryEntriesForTask(): readonly AgentMemoryEntry[] { return []; }
  async upsertTraceEntry(_e: AgentTraceEntry): Promise<void> { /* no-op */ }
  listTraceEntriesForTask(): readonly AgentTraceEntry[] { return []; }
  dispose(): void { /* no-op */ }
}

function makeInput(over: Partial<AgentApprovalRequestInput> = {}): AgentApprovalRequestInput {
  return {
    id: 'req-1',
    taskId: 'task-1',
    stepId: 'step-1',
    actionClass: 'filesystem-write',
    toolName: 'write_file',
    summary: 'Write README.md',
    scope: 'single-action',
    reason: 'Document the change',
    ...over,
  };
}

describe('AgentApprovalService — resolution → status mapping (all 4 resolutions)', () => {
  const mapping: Array<[AgentApprovalResolution, AgentApprovalRequest['status']]> = [
    ['approve-once', 'approved-once'],
    ['approve-for-task', 'approved-for-task'],
    ['deny', 'denied'],
    ['cancel-task', 'cancelled'],
  ];

  for (const [resolution, expected] of mapping) {
    it(`maps resolution=${resolution} → status=${expected}`, async () => {
      const svc = new AgentApprovalService(new StubTaskStore());
      const r = await svc.createApprovalRequest(makeInput());
      const resolved = await svc.resolveApprovalRequest(r.id, resolution, '2026-05-25T01:00:00.000Z');
      expect(resolved.status).toBe(expected);
      expect(resolved.resolvedAt).toBe('2026-05-25T01:00:00.000Z');
    });
  }
});

describe('AgentApprovalService — createApprovalRequest defaults', () => {
  it('explanation defaults to reason when not provided', async () => {
    const svc = new AgentApprovalService(new StubTaskStore());
    const r = await svc.createApprovalRequest(makeInput({ reason: 'because' }));
    expect(r.explanation).toBe('because');
  });

  it('caller-provided explanation overrides the default', async () => {
    const svc = new AgentApprovalService(new StubTaskStore());
    const r = await svc.createApprovalRequest(makeInput({ explanation: 'detailed', reason: 'short' }));
    expect(r.explanation).toBe('detailed');
  });

  it('affectedTargets is deduped and empty strings are filtered out', async () => {
    const svc = new AgentApprovalService(new StubTaskStore());
    const r = await svc.createApprovalRequest(makeInput({
      affectedTargets: ['a.txt', '', 'a.txt', 'b.txt', ''],
    }));
    expect(r.affectedTargets).toEqual(['a.txt', 'b.txt']);
  });

  it('stepIds includes canonical stepId, deduped against caller-provided extras', async () => {
    const svc = new AgentApprovalService(new StubTaskStore());
    const r = await svc.createApprovalRequest(makeInput({ stepIds: ['s0', 'step-1'] }));
    expect(r.stepIds).toEqual(['s0', 'step-1']);
  });

  it('persists with status=pending and requestCount=1', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    const r = await svc.createApprovalRequest(makeInput());
    expect(r.status).toBe('pending');
    expect(r.requestCount).toBe(1);
    expect(store.approvalRequests.get(r.id)).toEqual(r);
  });
});

describe('AgentApprovalService — negative merge cases', () => {
  it('does NOT merge across different taskIds', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ taskId: 'task-1', stepId: 's1' }));
    const r2 = await svc.createApprovalRequest(makeInput({ id: 'req-2', taskId: 'task-2', stepId: 's2' }));
    expect(store.listPendingApprovalRequests().length).toBe(2);
    expect(r2.requestCount).toBe(1);
  });

  it('does NOT merge across different actionClass', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ stepId: 's1' }));
    await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2', actionClass: 'filesystem-delete' }));
    expect(store.listPendingApprovalRequests().length).toBe(2);
  });

  it('does NOT merge across different toolName', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ stepId: 's1' }));
    await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2', toolName: 'delete_file' }));
    expect(store.listPendingApprovalRequests().length).toBe(2);
  });

  it('does NOT merge across different scope', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ stepId: 's1', scope: 'single-action' }));
    await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2', scope: 'task' }));
    expect(store.listPendingApprovalRequests().length).toBe(2);
  });

  it('does NOT merge across different bundleKey', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ stepId: 's1', bundleKey: 'A' }));
    await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2', bundleKey: 'B' }));
    expect(store.listPendingApprovalRequests().length).toBe(2);
  });

  it('does NOT merge when bundleKey present vs undefined', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ stepId: 's1', bundleKey: 'A' }));
    await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2' /* no bundleKey */ }));
    expect(store.listPendingApprovalRequests().length).toBe(2);
  });

  it('MERGES when both bundleKeys are undefined', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    await svc.createApprovalRequest(makeInput({ stepId: 's1' }));
    const r2 = await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2' }));
    expect(store.listPendingApprovalRequests().length).toBe(1);
    expect(r2.requestCount).toBe(2);
  });

  it('does NOT merge when the new request stepId is already present (no new info)', async () => {
    // Source: mergeable filters `!stepIds.every(id => existing.stepIds.includes(id))`.
    // When the new stepId is already there, every() is true, negation false → no merge.
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    const a = await svc.createApprovalRequest(makeInput({ id: 'req-1', stepId: 'step-1' }));
    const b = await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 'step-1' }));
    expect(a.id).not.toBe(b.id);
    expect(store.listPendingApprovalRequests().length).toBe(2);
  });

  it('does NOT merge into a resolved (non-pending) request', async () => {
    const store = new StubTaskStore();
    const svc = new AgentApprovalService(store);
    const a = await svc.createApprovalRequest(makeInput({ stepId: 's1' }));
    await svc.resolveApprovalRequest(a.id, 'deny');
    const b = await svc.createApprovalRequest(makeInput({ id: 'req-2', stepId: 's2' }));
    expect(b.id).not.toBe(a.id);
    expect(b.requestCount).toBe(1);
  });
});

describe('AgentApprovalService — listing helpers', () => {
  it('listPendingApprovalBundles returns pending requests sorted by createdAt ascending', async () => {
    const svc = new AgentApprovalService(new StubTaskStore());
    const a = await svc.createApprovalRequest(makeInput({ id: 'r1', stepId: 's1', createdAt: '2026-05-25T03:00:00.000Z' }));
    const b = await svc.createApprovalRequest(makeInput({
      id: 'r2', stepId: 's2', actionClass: 'filesystem-delete', createdAt: '2026-05-25T01:00:00.000Z',
    }));
    const c = await svc.createApprovalRequest(makeInput({
      id: 'r3', stepId: 's3', toolName: 'shell', createdAt: '2026-05-25T02:00:00.000Z',
    }));
    const bundles = svc.listPendingApprovalBundles();
    expect(bundles.map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it('listApprovalRequestsForTask filters by taskId', async () => {
    const svc = new AgentApprovalService(new StubTaskStore());
    await svc.createApprovalRequest(makeInput({ id: 'r1', taskId: 'A', stepId: 's1' }));
    await svc.createApprovalRequest(makeInput({ id: 'r2', taskId: 'B', stepId: 's1' }));
    expect(svc.listApprovalRequestsForTask('A').length).toBe(1);
    expect(svc.listApprovalRequestsForTask('B').length).toBe(1);
    expect(svc.listApprovalRequestsForTask('C').length).toBe(0);
  });
});
