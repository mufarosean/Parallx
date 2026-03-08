import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { URI } from '../../src/platform/uri';
import { Workspace } from '../../src/workspace/workspace';
import { Emitter } from '../../src/platform/events';
import { AgentApprovalService } from '../../src/services/agentApprovalService';
import { AgentExecutionService } from '../../src/services/agentExecutionService';
import { AgentPolicyService } from '../../src/services/agentPolicyService';
import { AgentSessionService } from '../../src/services/agentSessionService';
import { AgentTaskStore } from '../../src/services/agentTaskStore';
import { WorkspaceBoundaryService } from '../../src/services/workspaceBoundaryService';
import { WorkspaceService } from '../../src/services/workspaceService';

function createWorkspaceService(): WorkspaceService {
  const workspace = Workspace.create('Test Workspace');
  workspace.addFolder(URI.file('/workspace'));
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

async function createExecutionHarness() {
  const storage = new InMemoryStorage();
  const workspaceService = createWorkspaceService();
  const taskStore = new AgentTaskStore();
  await taskStore.setStorage(storage);
  const approvalService = new AgentApprovalService(taskStore);
  await approvalService.setStorage(storage);
  const sessionService = new AgentSessionService(workspaceService, taskStore, approvalService);
  const boundaryService = new WorkspaceBoundaryService();
  boundaryService.setHost({ folders: workspaceService.folders });
  const policyService = new AgentPolicyService(boundaryService);
  const executionService = new AgentExecutionService(taskStore, sessionService, policyService);
  return { executionService, sessionService, taskStore, approvalService };
}

describe('AgentExecutionService', () => {
  it('auto-completes safe plan steps and completes the task', async () => {
    const { executionService, sessionService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Inspect and summarize workspace' }, 'task-1', '2026-03-08T14:10:00.000Z');
    await sessionService.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Inspect workspace',
        description: 'Read workspace files',
        kind: 'read',
        proposedAction: {
          toolName: 'read_file',
          summary: 'Read README.md',
          targetUris: [URI.file('/workspace/README.md')],
          interactionMode: 'operator',
        },
      },
      {
        id: 'step-2',
        taskId: 'task-1',
        title: 'Summarize findings',
        description: 'Prepare a summary',
        kind: 'analysis',
        dependsOn: ['step-1'],
      },
    ], '2026-03-08T14:10:30.000Z');

    const result = await executionService.runTask('task-1', '2026-03-08T14:11:00.000Z');
    expect(result.executedStepIds).toEqual(['step-1', 'step-2']);
    expect(result.task.status).toBe('completed');
    expect(sessionService.getPlanSteps('task-1').every((step) => step.status === 'completed')).toBe(true);
  });

  it('queues approval for guarded steps and yields', async () => {
    const { executionService, sessionService, approvalService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Patch documentation' }, 'task-1', '2026-03-08T14:12:00.000Z');
    await sessionService.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Patch docs',
        description: 'Edit docs/README.md',
        kind: 'edit',
        proposedAction: {
          toolName: 'apply_patch',
          summary: 'Edit docs/README.md',
          targetUris: [URI.file('/workspace/docs/README.md')],
          interactionMode: 'operator',
        },
      },
    ], '2026-03-08T14:12:30.000Z');

    const result = await executionService.runTask('task-1', '2026-03-08T14:13:00.000Z');
    expect(result.task.status).toBe('awaiting-approval');
    expect(result.approvalRequestId).toBeDefined();
    expect(approvalService.listPendingApprovalRequests()).toHaveLength(1);
    expect(sessionService.getPlanSteps('task-1')[0]?.approvalState).toBe('pending');
  });

  it('blocks the task when policy denies a step', async () => {
    const { executionService, sessionService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Read outside workspace' }, 'task-1', '2026-03-08T14:14:00.000Z');
    await sessionService.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Read secret file',
        description: 'Try reading outside workspace',
        kind: 'read',
        proposedAction: {
          toolName: 'read_file',
          summary: 'Read outside file',
          targetUris: [URI.file('/outside/secret.txt')],
          interactionMode: 'operator',
        },
      },
    ], '2026-03-08T14:14:30.000Z');

    const result = await executionService.runTask('task-1', '2026-03-08T14:15:00.000Z');
    expect(result.task.status).toBe('blocked');
    expect(result.blockedStepId).toBe('step-1');
    expect(sessionService.getPlanSteps('task-1')[0]?.status).toBe('blocked');
  });
});