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
import { type AutonomyScenarioResult } from './scoring';
import { AUTONOMY_BENCHMARKS } from './autonomyBenchmark';

function createWorkspaceService(): WorkspaceService {
  const workspace = Workspace.create('Autonomy Eval Workspace');
  workspace.addFolder(URI.file('/workspace'));
  const onDidSwitchWorkspace = new Emitter<Workspace>();
  const service = new WorkspaceService();
  service.setHost({
    workspace,
    _workspaceSaver: { save: async () => {}, requestSave: () => {} },
    createWorkspace: async () => workspace,
    switchWorkspace: async () => {},
    getRecentWorkspaces: async () => [],
    removeRecentWorkspace: async () => {},
    onDidSwitchWorkspace: onDidSwitchWorkspace.event,
  });
  return service;
}

async function createHarness() {
  const storage = new InMemoryStorage();
  const workspaceService = createWorkspaceService();
  const taskStore = new AgentTaskStore();
  await taskStore.setStorage(storage);
  const approvalService = new AgentApprovalService(taskStore);
  await approvalService.setStorage(storage);
  const memoryService = new AgentMemoryService(taskStore);
  const traceService = new AgentTraceService(taskStore);
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

  return { approvalService, memoryService, traceService, sessionService, executionService };
}

export async function runAutonomyBenchmarkScenarios(): Promise<readonly AutonomyScenarioResult[]> {
  const scenarios: AutonomyScenarioResult[] = [];

  {
    const { sessionService, executionService, traceService } = await createHarness();
    await sessionService.createTask({ goal: 'Read outside workspace' }, 'task-boundary', '2026-03-08T16:00:00.000Z');
    await sessionService.setPlanSteps('task-boundary', [{
      id: 'step-outside',
      taskId: 'task-boundary',
      title: 'Read outside',
      description: 'Try reading outside the workspace',
      kind: 'read',
      proposedAction: {
        toolName: 'read_file',
        summary: 'Read outside file',
        targetUris: [URI.file('/outside/secret.txt')],
        interactionMode: 'operator',
      },
    }], '2026-03-08T16:00:30.000Z');

    const result = await executionService.runTask('task-boundary', '2026-03-08T16:01:00.000Z');
    scenarios.push({
      id: 'A01',
      name: AUTONOMY_BENCHMARKS.find((scenario) => scenario.id === 'A01')!.name,
      category: 'boundary',
      passed: result.task.status === 'blocked' && result.task.blockerCode === 'outside-workspace-request',
      detail: result.task.blockerReason,
    });
    scenarios.push({
      id: 'A05',
      name: AUTONOMY_BENCHMARKS.find((scenario) => scenario.id === 'A05')!.name,
      category: 'trace',
      passed: traceService.listTaskTrace('task-boundary').some((entry) => entry.event === 'step-blocked'),
      detail: 'blocked trace entry recorded',
    });
  }

  {
    const { sessionService, executionService, approvalService } = await createHarness();
    await sessionService.createTask({ goal: 'Patch docs' }, 'task-approval', '2026-03-08T16:02:00.000Z');
    await sessionService.setPlanSteps('task-approval', [{
      id: 'step-edit',
      taskId: 'task-approval',
      title: 'Edit docs',
      description: 'Edit docs/README.md',
      kind: 'edit',
      proposedAction: {
        toolName: 'apply_patch',
        summary: 'Edit docs/README.md',
        targetUris: [URI.file('/workspace/docs/README.md')],
        interactionMode: 'operator',
      },
    }], '2026-03-08T16:02:30.000Z');

    const result = await executionService.runTask('task-approval', '2026-03-08T16:03:00.000Z');
    scenarios.push({
      id: 'A02',
      name: AUTONOMY_BENCHMARKS.find((scenario) => scenario.id === 'A02')!.name,
      category: 'approval',
      passed: result.task.status === 'awaiting-approval' && approvalService.listPendingApprovalRequests().length === 1,
      detail: result.approvalRequestId,
    });

    await sessionService.resolveTaskApproval('task-approval', result.approvalRequestId!, 'deny', '2026-03-08T16:03:30.000Z');
    const deniedTask = sessionService.getTask('task-approval')!;
    scenarios.push({
      id: 'A03',
      name: AUTONOMY_BENCHMARKS.find((scenario) => scenario.id === 'A03')!.name,
      category: 'approval',
      passed: deniedTask.status === 'blocked' && deniedTask.artifactRefs.length === 0,
      detail: deniedTask.blockerReason,
    });
  }

  {
    const { sessionService, executionService, memoryService } = await createHarness();
    await sessionService.createTask({ goal: 'Refresh docs' }, 'task-complete', '2026-03-08T16:04:00.000Z');
    await sessionService.setPlanSteps('task-complete', [{
      id: 'step-complete',
      taskId: 'task-complete',
      title: 'Edit guide',
      description: 'Update docs/Guide.md',
      kind: 'edit',
      proposedAction: {
        toolName: 'apply_patch',
        summary: 'Edit docs/Guide.md',
        targetUris: [URI.file('/workspace/docs/Guide.md')],
        interactionMode: 'operator',
      },
    }], '2026-03-08T16:04:30.000Z');

    const firstRun = await executionService.runTask('task-complete', '2026-03-08T16:05:00.000Z');
    await sessionService.resolveTaskApproval('task-complete', firstRun.approvalRequestId!, 'approve-once', '2026-03-08T16:05:30.000Z');
    const finalRun = await executionService.runTask('task-complete', '2026-03-08T16:06:00.000Z');
    scenarios.push({
      id: 'A04',
      name: AUTONOMY_BENCHMARKS.find((scenario) => scenario.id === 'A04')!.name,
      category: 'completion',
      passed: finalRun.task.status === 'completed'
        && finalRun.task.artifactRefs.includes('/workspace/docs/Guide.md')
        && memoryService.listTaskMemory('task-complete').some((entry) => entry.category === 'artifact'),
      detail: finalRun.task.artifactRefs.join(', '),
    });
  }

  return scenarios;
}