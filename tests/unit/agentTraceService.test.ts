import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { createAgentTaskRecord } from '../../src/agent/agentTaskModels';
import { AgentTaskStore } from '../../src/services/agentTaskStore';
import { AgentTraceService } from '../../src/services/agentTraceService';

async function createTraceHarness(): Promise<{ traceService: AgentTraceService; taskStore: AgentTaskStore }> {
  const storage = new InMemoryStorage();
  const taskStore = new AgentTaskStore();
  await taskStore.setStorage(storage);
  const traceService = new AgentTraceService(taskStore);
  return { traceService, taskStore };
}

describe('AgentTraceService', () => {
  it('records readable trace entries for a task', async () => {
    const { traceService } = await createTraceHarness();
    const entry = await traceService.record('task-1', {
      id: 'trace-1',
      phase: 'planning',
      event: 'plan-step-recorded',
      message: 'Planned step: Inspect workspace',
      stepId: 'step-1',
      planIntent: 'Inspect workspace',
      selectedTool: 'read_file',
      outputSummary: 'Read README.md',
    }, '2026-03-08T15:31:00.000Z');

    expect(entry.taskId).toBe('task-1');
    expect(traceService.listTaskTrace('task-1')).toHaveLength(1);
  });

  it('builds diagnostics snapshots for a task', async () => {
    const { traceService, taskStore } = await createTraceHarness();
    await taskStore.upsertTask(createAgentTaskRecord(
      'task-1',
      'workspace-1',
      { goal: 'Inspect workspace drift' },
      '2026-03-08T15:32:00.000Z',
    ));
    await taskStore.upsertPlanStep({
      id: 'step-1',
      taskId: 'task-1',
      title: 'Inspect workspace',
      description: 'Read workspace files.',
      kind: 'read',
      status: 'completed',
      approvalState: 'not-required',
      dependsOn: [],
      createdAt: '2026-03-08T15:32:30.000Z',
      updatedAt: '2026-03-08T15:32:30.000Z',
    });
    await taskStore.upsertApprovalRequest({
      id: 'approval-1',
      taskId: 'task-1',
      stepId: 'step-1',
      stepIds: ['step-1'],
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit docs',
      explanation: 'Approval requested for docs edit.',
      affectedTargets: ['docs/README.md'],
      requestCount: 1,
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
      status: 'pending',
      createdAt: '2026-03-08T15:33:00.000Z',
    });
    await taskStore.upsertMemoryEntry({
      id: 'memory-1',
      taskId: 'task-1',
      category: 'goal',
      content: 'Inspect workspace drift',
      source: 'user',
      evidenceStepIds: [],
      artifactRefs: [],
      pinned: true,
      createdAt: '2026-03-08T15:33:15.000Z',
      updatedAt: '2026-03-08T15:33:15.000Z',
    });
    await traceService.record('task-1', {
      id: 'trace-1',
      phase: 'execution',
      event: 'step-completed',
      message: 'Completed step: Inspect workspace',
      stepId: 'step-1',
      outputSummary: 'Read workspace files.',
    }, '2026-03-08T15:33:30.000Z');

    const diagnostics = traceService.getTaskDiagnostics('task-1');
    expect(diagnostics?.task.goal).toBe('Inspect workspace drift');
    expect(diagnostics?.planSteps).toHaveLength(1);
    expect(diagnostics?.approvals).toHaveLength(1);
    expect(diagnostics?.memory).toHaveLength(1);
    expect(diagnostics?.trace).toHaveLength(1);
  });
});