import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../../src/platform/storage';
import { createAgentTaskRecord } from '../../src/agent/agentTaskModels';
import { AgentTaskStore } from '../../src/services/agentTaskStore';

describe('AgentTaskStore', () => {
  it('persists tasks across store instances', async () => {
    const storage = new InMemoryStorage();
    const first = new AgentTaskStore();
    await first.setStorage(storage);

    await first.upsertTask(createAgentTaskRecord(
      'task-1',
      'workspace-1',
      { goal: 'Inspect workspace drift' },
      '2026-03-08T12:00:00.000Z',
    ));

    const second = new AgentTaskStore();
    await second.setStorage(storage);

    expect(second.getTask('task-1')?.goal).toBe('Inspect workspace drift');
    expect(second.listTasksForWorkspace('workspace-1')).toHaveLength(1);
  });

  it('persists approval requests across store instances', async () => {
    const storage = new InMemoryStorage();
    const first = new AgentTaskStore();
    await first.setStorage(storage);

    await first.upsertApprovalRequest({
      id: 'approval-1',
      taskId: 'task-1',
      stepId: 'step-1',
      actionClass: 'edit',
      toolName: 'apply_patch',
      summary: 'Edit the migration guide',
      scope: 'single-action',
      reason: 'Workspace edits require approval.',
      status: 'pending',
      createdAt: '2026-03-08T12:00:00.000Z',
    });

    const second = new AgentTaskStore();
    await second.setStorage(storage);

    expect(second.listPendingApprovalRequests()).toHaveLength(1);
    expect(second.getApprovalRequest('approval-1')?.toolName).toBe('apply_patch');
  });

  it('persists plan steps across store instances', async () => {
    const storage = new InMemoryStorage();
    const first = new AgentTaskStore();
    await first.setStorage(storage);

    await first.upsertPlanStep({
      id: 'step-1',
      taskId: 'task-1',
      title: 'Inspect workspace',
      description: 'Read the workspace files.',
      kind: 'read',
      status: 'pending',
      approvalState: 'not-required',
      dependsOn: [],
      createdAt: '2026-03-08T14:00:00.000Z',
      updatedAt: '2026-03-08T14:00:00.000Z',
    });

    const second = new AgentTaskStore();
    await second.setStorage(storage);

    expect(second.listPlanStepsForTask('task-1')).toHaveLength(1);
    expect(second.getPlanStep('step-1')?.title).toBe('Inspect workspace');
  });
});