import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { URI } from '../../src/platform/uri';
import { Workspace } from '../../src/workspace/workspace';
import { Emitter } from '../../src/platform/events';
import { AgentApprovalService } from '../../src/services/agentApprovalService';
import { AgentExecutionService } from '../../src/services/agentExecutionService';
import { AgentMemoryService } from '../../src/services/agentMemoryService';
import { AgentPolicyService } from '../../src/services/agentPolicyService';
import { AgentSessionService } from '../../src/services/agentSessionService';
import { AgentTaskStore } from '../../src/services/agentTaskStore';
import { AgentTraceService } from '../../src/services/agentTraceService';
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
  const traceService = new AgentTraceService(taskStore);
  const memoryService = new AgentMemoryService(taskStore);
  const sessionService = new AgentSessionService(workspaceService, taskStore, approvalService, traceService);
  const boundaryService = new WorkspaceBoundaryService();
  boundaryService.setHost({ folders: workspaceService.folders });
  const configProvider = {
    getEffectiveConfig: () => ({
      agent: {
        verbosity: 'balanced' as const,
        approvalStrictness: 'balanced' as const,
        executionStyle: 'balanced' as const,
        proactivity: 'balanced' as const,
      },
    }),
  };
  const policyService = new AgentPolicyService(boundaryService, configProvider);
  const executionService = new AgentExecutionService(taskStore, sessionService, policyService, configProvider, memoryService, traceService);
  return { executionService, sessionService, taskStore, approvalService, traceService, memoryService };
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

  it('records task artifact refs and artifact memory for completed mutation steps', async () => {
    const { executionService, sessionService, memoryService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Update docs' }, 'task-1', '2026-03-08T14:11:15.000Z');
    await sessionService.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Edit docs',
        description: 'Update docs/README.md',
        kind: 'edit',
        proposedAction: {
          toolName: 'apply_patch',
          summary: 'Edit docs/README.md',
          targetUris: [URI.file('/workspace/docs/README.md')],
          interactionMode: 'operator',
        },
      },
    ], '2026-03-08T14:11:30.000Z');

    const firstRun = await executionService.runTask('task-1', '2026-03-08T14:11:45.000Z');
    expect(firstRun.task.status).toBe('awaiting-approval');
    expect(firstRun.approvalRequestId).toBe('approval-step-1');
    await sessionService.resolveTaskApproval('task-1', 'approval-step-1', 'approve-once', '2026-03-08T14:12:00.000Z');

    const result = await executionService.runTask('task-1', '2026-03-08T14:12:15.000Z');
    expect(result.task.artifactRefs).toEqual(['/workspace/docs/README.md']);
    expect(memoryService.listTaskMemory('task-1').some((entry) => entry.category === 'artifact' && entry.artifactRefs.includes('/workspace/docs/README.md'))).toBe(true);
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
    expect(result.task.blockerCode).toBe('outside-workspace-request');
    expect(result.blockedStepId).toBe('step-1');
    expect(sessionService.getPlanSteps('task-1')[0]?.status).toBe('blocked');
  });

  it('pauses after the current step when stop-after-step is requested and can continue later', async () => {
    const { executionService, sessionService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Inspect and summarize workspace' }, 'task-1', '2026-03-08T14:16:00.000Z');
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
    ], '2026-03-08T14:16:30.000Z');
    await sessionService.requestStopAfterCurrentStep('task-1', '2026-03-08T14:16:45.000Z');

    const firstRun = await executionService.runTask('task-1', '2026-03-08T14:17:00.000Z');
    expect(firstRun.task.status).toBe('paused');
    expect(firstRun.task.blockerCode).toBe('user-requested-pause');
    expect(firstRun.executedStepIds).toEqual(['step-1']);
    expect(sessionService.getPlanSteps('task-1')[1]?.status).toBe('pending');

    await sessionService.continueTask('task-1', '2026-03-08T14:17:30.000Z');
    const secondRun = await executionService.runTask('task-1', '2026-03-08T14:18:00.000Z');
    expect(secondRun.task.status).toBe('completed');
    expect(secondRun.executedStepIds).toEqual(['step-2']);
  });

  it('allows blocked tasks to be redirected with a new constraint', async () => {
    const { executionService, sessionService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Read outside workspace' }, 'task-1', '2026-03-08T14:19:00.000Z');
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
    ], '2026-03-08T14:19:30.000Z');

    await executionService.runTask('task-1', '2026-03-08T14:20:00.000Z');
    const redirected = await sessionService.redirectTask('task-1', 'stay inside /workspace only', '2026-03-08T14:20:30.000Z');
    expect(redirected.status).toBe('planning');
    expect(redirected.constraints).toContain('stay inside /workspace only');
  });

  it('pauses after one step when execution style is stepwise', async () => {
    const storage = new InMemoryStorage();
    const workspaceService = createWorkspaceService();
    const taskStore = new AgentTaskStore();
    await taskStore.setStorage(storage);
    const approvalService = new AgentApprovalService(taskStore);
    await approvalService.setStorage(storage);
    const traceService = new AgentTraceService(taskStore);
    const sessionService = new AgentSessionService(workspaceService, taskStore, approvalService, traceService);
    const boundaryService = new WorkspaceBoundaryService();
    boundaryService.setHost({ folders: workspaceService.folders });
    const configProvider = {
      getEffectiveConfig: () => ({
        agent: {
          verbosity: 'detailed' as const,
          approvalStrictness: 'balanced' as const,
          executionStyle: 'stepwise' as const,
          proactivity: 'balanced' as const,
        },
      }),
    };
    const policyService = new AgentPolicyService(boundaryService, configProvider);
    const memoryService = new AgentMemoryService(taskStore);
    const executionService = new AgentExecutionService(taskStore, sessionService, policyService, configProvider, memoryService, traceService);

    await sessionService.createTask({ goal: 'Inspect and summarize workspace' }, 'task-1', '2026-03-08T14:21:00.000Z');
    await sessionService.setPlanSteps('task-1', [
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
    ], '2026-03-08T14:21:30.000Z');

    const result = await executionService.runTask('task-1', '2026-03-08T14:22:00.000Z');
    expect(result.task.status).toBe('paused');
    expect(result.task.blockerCode).toBe('execution-cadence');
    expect(result.task.blockerReason).toContain('execution cadence');
    expect(result.executedStepIds).toEqual(['step-1']);
  });

  it('completes after continuing a stepwise-paused task with no remaining steps', async () => {
    const storage = new InMemoryStorage();
    const workspaceService = createWorkspaceService();
    const taskStore = new AgentTaskStore();
    await taskStore.setStorage(storage);
    const approvalService = new AgentApprovalService(taskStore);
    await approvalService.setStorage(storage);
    const traceService = new AgentTraceService(taskStore);
    const sessionService = new AgentSessionService(workspaceService, taskStore, approvalService, traceService);
    const boundaryService = new WorkspaceBoundaryService();
    boundaryService.setHost({ folders: workspaceService.folders });
    const configProvider = {
      getEffectiveConfig: () => ({
        agent: {
          verbosity: 'balanced' as const,
          approvalStrictness: 'balanced' as const,
          executionStyle: 'stepwise' as const,
          proactivity: 'balanced' as const,
        },
      }),
    };
    const policyService = new AgentPolicyService(boundaryService, configProvider);
    const memoryService = new AgentMemoryService(taskStore);
    const executionService = new AgentExecutionService(taskStore, sessionService, policyService, configProvider, memoryService, traceService);

    await sessionService.createTask({ goal: 'Inspect workspace readme' }, 'task-1', '2026-03-08T14:25:00.000Z');
    await sessionService.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Inspect workspace',
        description: 'Read workspace files',
        kind: 'read',
      },
    ], '2026-03-08T14:25:30.000Z');

    const firstRun = await executionService.runTask('task-1', '2026-03-08T14:26:00.000Z');
    expect(firstRun.task.status).toBe('paused');

    await sessionService.continueTask('task-1', '2026-03-08T14:26:30.000Z');
    const secondRun = await executionService.runTask('task-1', '2026-03-08T14:27:00.000Z');
    expect(secondRun.task.status).toBe('completed');
    expect(secondRun.executedStepIds).toEqual([]);
  });

  it('records execution trace entries for started and completed steps', async () => {
    const { executionService, sessionService, traceService } = await createExecutionHarness();
    await sessionService.createTask({ goal: 'Inspect and summarize workspace' }, 'task-1', '2026-03-08T14:23:00.000Z');
    await sessionService.setPlanSteps('task-1', [
      {
        id: 'step-1',
        taskId: 'task-1',
        title: 'Inspect workspace',
        description: 'Read workspace files',
        kind: 'analysis',
      },
    ], '2026-03-08T14:23:30.000Z');

    await executionService.runTask('task-1', '2026-03-08T14:24:00.000Z');
    expect(traceService.listTaskTrace('task-1').some((entry) => entry.event === 'step-started')).toBe(true);
    expect(traceService.listTaskTrace('task-1').some((entry) => entry.event === 'step-completed')).toBe(true);
  });
});