import { describe, expect, it, vi } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { AgentApprovalService } from '../../src/services/agentApprovalService';
import { AgentTaskStore } from '../../src/services/agentTaskStore';

function createService() {
  const taskStore = new AgentTaskStore();
  const service = new AgentApprovalService(taskStore);
  return { taskStore, service };
}

describe('AgentApprovalService', () => {
  it('creates a pending approval request and emits a change event', async () => {
    const storage = new InMemoryStorage();
    const { service } = createService();
    await service.setStorage(storage);
    const listener = vi.fn();
    service.onDidChangeApprovalRequests(listener);

    const request = await service.createApprovalRequest({
      id: 'approval-1',
      taskId: 'task-1',
      stepId: 'step-1',
      actionClass: 'command',
      toolName: 'run_in_terminal',
      summary: 'Run a workspace migration command',
      scope: 'single-action',
      reason: 'Shell execution requires approval.',
      createdAt: '2026-03-08T12:30:00.000Z',
    });

    expect(request.status).toBe('pending');
    expect(service.listPendingApprovalRequests()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resolves an approval request for the task scope', async () => {
    const storage = new InMemoryStorage();
    const { service } = createService();
    await service.setStorage(storage);

    await service.createApprovalRequest({
      id: 'approval-1',
      taskId: 'task-1',
      stepId: 'step-1',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Patch the docs',
      scope: 'task',
      reason: 'Workspace edits require approval.',
    });

    const resolved = await service.resolveApprovalRequest('approval-1', 'approve-for-task', '2026-03-08T12:31:00.000Z');
    expect(resolved.status).toBe('approved-for-task');
    expect(resolved.resolvedAt).toBe('2026-03-08T12:31:00.000Z');
    expect(service.listPendingApprovalRequests()).toHaveLength(0);
  });

  it('throws when resolving an unknown approval request', async () => {
    const storage = new InMemoryStorage();
    const { service } = createService();
    await service.setStorage(storage);

    await expect(service.resolveApprovalRequest('missing', 'deny')).rejects.toThrow('Agent approval request not found');
  });

  it('returns the existing request when resolving an already-final approval request', async () => {
    const storage = new InMemoryStorage();
    const { service } = createService();
    await service.setStorage(storage);

    await service.createApprovalRequest({
      id: 'approval-1',
      taskId: 'task-1',
      stepId: 'step-1',
      actionClass: 'delete',
      toolName: 'delete_file',
      summary: 'Delete an obsolete file',
      scope: 'single-action',
      reason: 'Deletion requires approval.',
    });

    await service.resolveApprovalRequest('approval-1', 'deny', '2026-03-08T12:40:00.000Z');
    const resolvedAgain = await service.resolveApprovalRequest('approval-1', 'approve-once', '2026-03-08T12:41:00.000Z');
    expect(resolvedAgain.status).toBe('denied');
    expect(resolvedAgain.resolvedAt).toBe('2026-03-08T12:40:00.000Z');
  });
});