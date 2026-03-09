import { describe, expect, it, vi } from 'vitest';

import { buildChatAgentTaskWidgetServices } from '../../src/built-in/chat/utilities/chatAgentTaskWidgetAdapter';

describe('chat agent task widget adapter', () => {
  it('builds sorted task view models with diagnostics and only pending approvals', () => {
    const services = buildChatAgentTaskWidgetServices({
      agentSessionService: {
        listActiveWorkspaceTasks: vi.fn(() => [
          { id: 'task-1', updatedAt: '2026-03-08T13:00:00.000Z' },
          { id: 'task-2', updatedAt: '2026-03-08T14:00:00.000Z' },
        ]),
        onDidChangeTasks: vi.fn() as any,
      } as any,
      agentApprovalService: {
        listApprovalRequestsForTask: vi.fn((taskId: string) => taskId === 'task-2'
          ? [
              { id: 'a-1', status: 'pending' },
              { id: 'a-2', status: 'approved' },
            ]
          : []),
        onDidChangeApprovalRequests: vi.fn() as any,
      } as any,
      agentTraceService: {
        getTaskDiagnostics: vi.fn((taskId: string) => ({ taskId, ok: true })),
      } as any,
    });

    const tasks = services.getAgentTasks?.() ?? [];

    expect(tasks).toHaveLength(2);
    expect(tasks[0].task.id).toBe('task-2');
    expect(tasks[0].diagnostics).toEqual({ taskId: 'task-2', ok: true });
    expect(tasks[0].pendingApprovals).toEqual([{ id: 'a-1', status: 'pending' }]);
    expect(tasks[1].task.id).toBe('task-1');
  });

  it('resolves approvals and reruns only when the task should resume', async () => {
    const resolveTaskApproval = vi.fn()
      .mockResolvedValueOnce({ status: 'blocked' })
      .mockResolvedValueOnce({ status: 'planning' });
    const runTask = vi.fn().mockResolvedValue(undefined);

    const services = buildChatAgentTaskWidgetServices({
      agentSessionService: {
        resolveTaskApproval,
        continueTask: vi.fn().mockResolvedValue(undefined),
        requestStopAfterCurrentStep: vi.fn().mockResolvedValue(undefined),
        onDidChangeTasks: vi.fn() as any,
      } as any,
      agentApprovalService: {
        onDidChangeApprovalRequests: vi.fn() as any,
      } as any,
      agentExecutionService: {
        runTask,
      } as any,
    });

    await services.resolveAgentApproval?.('task-1', 'approval-1', 'deny' as any);
    await services.resolveAgentApproval?.('task-1', 'approval-2', 'approve-once' as any);

    expect(resolveTaskApproval).toHaveBeenCalledTimes(2);
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(runTask).toHaveBeenCalledWith('task-1');
  });

  it('continues and stop-after-step through the task services', async () => {
    const continueTask = vi.fn().mockResolvedValue(undefined);
    const requestStopAfterCurrentStep = vi.fn().mockResolvedValue(undefined);
    const runTask = vi.fn().mockResolvedValue(undefined);

    const services = buildChatAgentTaskWidgetServices({
      agentSessionService: {
        continueTask,
        requestStopAfterCurrentStep,
        onDidChangeTasks: vi.fn() as any,
      } as any,
      agentExecutionService: {
        runTask,
      } as any,
    });

    await services.continueAgentTask?.('task-9');
    await services.stopAgentTaskAfterStep?.('task-9');

    expect(continueTask).toHaveBeenCalledWith('task-9');
    expect(runTask).toHaveBeenCalledWith('task-9');
    expect(requestStopAfterCurrentStep).toHaveBeenCalledWith('task-9');
  });
});