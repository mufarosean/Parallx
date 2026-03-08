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
      explanation: 'The agent needs to execute a workspace-scoped command to continue.',
      affectedTargets: ['package.json'],
      scope: 'single-action',
      reason: 'Shell execution requires approval.',
      createdAt: '2026-03-08T12:30:00.000Z',
    });

    expect(request.status).toBe('pending');
    expect(request.stepIds).toEqual(['step-1']);
    expect(request.explanation).toContain('workspace-scoped command');
    expect(request.affectedTargets).toEqual(['package.json']);
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

  it('bundles matching pending approval requests for the same task', async () => {
    const storage = new InMemoryStorage();
    const { service } = createService();
    await service.setStorage(storage);

    const first = await service.createApprovalRequest({
      id: 'approval-1',
      taskId: 'task-1',
      stepId: 'step-1',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit documentation files',
      explanation: 'The agent wants to update documentation files in one batch.',
      affectedTargets: ['docs/a.md'],
      bundleKey: 'docs-batch',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    });

    const second = await service.createApprovalRequest({
      id: 'approval-2',
      taskId: 'task-1',
      stepId: 'step-2',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit documentation files',
      explanation: 'The same documentation batch now includes another file.',
      affectedTargets: ['docs/b.md'],
      bundleKey: 'docs-batch',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    });

    expect(second.id).toBe(first.id);
    expect(second.stepIds).toEqual(['step-1', 'step-2']);
    expect(second.affectedTargets).toEqual(['docs/a.md', 'docs/b.md']);
    expect(second.requestCount).toBe(2);
    expect(service.listPendingApprovalRequests()).toHaveLength(1);
    expect(service.listPendingApprovalBundles()).toHaveLength(1);
  });
});