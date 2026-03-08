import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { Workspace } from '../../src/workspace/workspace';
import { Emitter } from '../../src/platform/events';
import { AgentApprovalService } from '../../src/services/agentApprovalService';
import { AgentSessionService } from '../../src/services/agentSessionService';
import { AgentTaskStore } from '../../src/services/agentTaskStore';
import { WorkspaceService } from '../../src/services/workspaceService';

function createWorkspaceService(): WorkspaceService {
  const workspace = Workspace.create('Test Workspace');
  const onDidSwitchWorkspace = new Emitter<Workspace>();
  const service = new WorkspaceService();
  service.setHost({
    workspace,
    _workspaceSaver: {
      save: async () => {},
      requestSave: () => {},
    },
    createWorkspace: async () => workspace,
    switchWorkspace: async () => {},
    getRecentWorkspaces: async () => [],
    removeRecentWorkspace: async () => {},
    onDidSwitchWorkspace: onDidSwitchWorkspace.event,
  });
  return service;
}

async function createSessionService(): Promise<AgentSessionService> {
  const storage = new InMemoryStorage();
  const workspaceService = createWorkspaceService();
  const taskStore = new AgentTaskStore();
  await taskStore.setStorage(storage);
  const approvalService = new AgentApprovalService(taskStore);
  await approvalService.setStorage(storage);
  return new AgentSessionService(workspaceService, taskStore, approvalService);
}

describe('AgentSessionService', () => {
  it('creates tasks for the active workspace', async () => {
    const service = await createSessionService();
    const task = await service.createTask({ goal: 'Review the workspace' }, 'task-1', '2026-03-08T13:00:00.000Z');

    expect(task.id).toBe('task-1');
    expect(task.status).toBe('pending');
    expect(service.listActiveWorkspaceTasks()).toHaveLength(1);
  });

  it('queues approvals and moves task into awaiting-approval', async () => {
    const service = await createSessionService();
    const created = await service.createTask({ goal: 'Patch the docs' }, 'task-1', '2026-03-08T13:01:00.000Z');
    await service.transitionTask('task-1', 'planning', '2026-03-08T13:01:30.000Z');

    const queued = await service.queueApprovalForTask('task-1', {
      id: 'approval-1',
      stepId: 'step-1',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit docs/README.md',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    }, '2026-03-08T13:02:00.000Z');

    expect(created.status).toBe('pending');
    expect(queued.approvalRequest.status).toBe('pending');
    expect(queued.task.status).toBe('awaiting-approval');
    expect(queued.task.resumeStatus).toBe('planning');
    expect(queued.task.blockerReason).toContain('Awaiting approval');
  });

  it('resumes the prior task status after approval', async () => {
    const service = await createSessionService();
    await service.createTask({ goal: 'Patch the docs' }, 'task-1', '2026-03-08T13:03:00.000Z');
    await service.transitionTask('task-1', 'planning', '2026-03-08T13:03:15.000Z');
    await service.transitionTask('task-1', 'running', '2026-03-08T13:03:30.000Z');
    await service.queueApprovalForTask('task-1', {
      id: 'approval-1',
      stepId: 'step-1',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit docs/README.md',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    }, '2026-03-08T13:04:00.000Z');

    const resumed = await service.resolveTaskApproval('task-1', 'approval-1', 'approve-once', '2026-03-08T13:04:30.000Z');
    expect(resumed.status).toBe('running');
    expect(resumed.resumeStatus).toBeUndefined();
    expect(resumed.blockerReason).toBeUndefined();
  });

  it('blocks the task when approval is denied', async () => {
    const service = await createSessionService();
    await service.createTask({ goal: 'Delete an obsolete file' }, 'task-1', '2026-03-08T13:05:00.000Z');
    await service.transitionTask('task-1', 'planning', '2026-03-08T13:05:30.000Z');
    await service.queueApprovalForTask('task-1', {
      id: 'approval-1',
      stepId: 'step-1',
      actionClass: 'delete',
      toolName: 'delete_file',
      summary: 'Delete docs/old.md',
      scope: 'single-action',
      reason: 'Deletion requires approval.',
    }, '2026-03-08T13:06:00.000Z');

    const blocked = await service.resolveTaskApproval('task-1', 'approval-1', 'deny', '2026-03-08T13:06:30.000Z');
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockerReason).toContain('Approval denied');
  });

  it('cancels the task when approval is cancelled by the user', async () => {
    const service = await createSessionService();
    await service.createTask({ goal: 'Run a workspace command' }, 'task-1', '2026-03-08T13:07:00.000Z');
    await service.transitionTask('task-1', 'planning', '2026-03-08T13:07:30.000Z');
    await service.queueApprovalForTask('task-1', {
      id: 'approval-1',
      stepId: 'step-1',
      actionClass: 'command',
      toolName: 'run_in_terminal',
      summary: 'Run migration command',
      scope: 'single-action',
      reason: 'Commands require approval.',
    }, '2026-03-08T13:08:00.000Z');

    const cancelled = await service.resolveTaskApproval('task-1', 'approval-1', 'cancel-task', '2026-03-08T13:08:30.000Z');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.blockerReason).toContain('cancelled');
  });
});