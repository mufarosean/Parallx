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
      explanation: 'The agent needs to update documentation content before continuing.',
      affectedTargets: ['docs/README.md'],
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    }, '2026-03-08T13:02:00.000Z');

    expect(created.status).toBe('pending');
    expect(queued.approvalRequest.status).toBe('pending');
    expect(queued.task.status).toBe('awaiting-approval');
    expect(queued.task.resumeStatus).toBe('planning');
    expect(queued.task.blockerReason).toContain('Awaiting approval');
    expect(queued.task.blockerReason).toContain('docs/README.md');
  });

  it('persists task plan steps', async () => {
    const service = await createSessionService();
    await service.createTask({ goal: 'Review the workspace' }, 'task-1', '2026-03-08T13:02:00.000Z');

    const steps = await service.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Inspect workspace',
        description: 'Read workspace files',
        kind: 'read',
      },
      {
        id: 'step-2',
        taskId: 'task-1',
        title: 'Summarize findings',
        description: 'Prepare a summary',
        kind: 'analysis',
        dependsOn: ['step-1'],
      },
    ], '2026-03-08T13:02:30.000Z');

    expect(steps).toHaveLength(2);
    expect(service.getPlanSteps('task-1').map((step) => step.id)).toEqual(['step-1', 'step-2']);
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
      explanation: 'The agent needs to update documentation content before continuing.',
      affectedTargets: ['docs/README.md'],
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
      explanation: 'The agent wants to remove an obsolete documentation file.',
      affectedTargets: ['docs/old.md'],
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
      explanation: 'The agent needs to run a workspace migration command.',
      affectedTargets: ['workspace'],
      scope: 'single-action',
      reason: 'Commands require approval.',
    }, '2026-03-08T13:08:00.000Z');

    const cancelled = await service.resolveTaskApproval('task-1', 'approval-1', 'cancel-task', '2026-03-08T13:08:30.000Z');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.blockerReason).toContain('cancelled');
  });

  it('bundles repeated approval requests while a task is already awaiting approval', async () => {
    const service = await createSessionService();
    await service.createTask({ goal: 'Patch documentation files' }, 'task-1', '2026-03-08T13:09:00.000Z');
    await service.transitionTask('task-1', 'planning', '2026-03-08T13:09:30.000Z');

    const first = await service.queueApprovalForTask('task-1', {
      id: 'approval-1',
      stepId: 'step-1',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit documentation batch',
      explanation: 'The agent needs to update two related documentation files.',
      affectedTargets: ['docs/a.md'],
      bundleKey: 'docs-batch',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    }, '2026-03-08T13:10:00.000Z');

    const second = await service.queueApprovalForTask('task-1', {
      id: 'approval-2',
      stepId: 'step-2',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit documentation batch',
      explanation: 'The same documentation batch includes another file.',
      affectedTargets: ['docs/b.md'],
      bundleKey: 'docs-batch',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
    }, '2026-03-08T13:10:30.000Z');

    expect(second.approvalRequest.id).toBe(first.approvalRequest.id);
    expect(second.approvalRequest.requestCount).toBe(2);
    expect(second.approvalRequest.affectedTargets).toEqual(['docs/a.md', 'docs/b.md']);
    expect(second.task.status).toBe('awaiting-approval');
    expect(second.task.blockerReason).toContain('Bundled actions: 2');
  });
});