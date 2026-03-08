// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('chat autonomy UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders task cards with approval controls and diagnostics', async () => {
    const { renderAgentTaskRail } = await import('../../src/built-in/chat/rendering/chatTaskCards');

    const rail = renderAgentTaskRail([
      {
        task: {
          id: 'task-1',
          workspaceId: 'ws-1',
          goal: 'Update the claims guide',
          constraints: ['Stay inside docs'],
          desiredAutonomy: 'allow-safe-actions',
          completionCriteria: ['Guide updated'],
          allowedScope: { kind: 'workspace' },
          mode: 'operator',
          status: 'awaiting-approval',
          createdAt: '2026-03-08T00:00:00.000Z',
          updatedAt: '2026-03-08T00:00:00.000Z',
          artifactRefs: [],
          currentStepId: 'step-2',
          blockerReason: 'Awaiting approval.',
          blockerCode: 'approval-pending',
          resumeStatus: 'planning',
          stopAfterCurrentStep: false,
        },
        pendingApprovals: [
          {
            id: 'approval-1',
            taskId: 'task-1',
            stepId: 'step-2',
            stepIds: ['step-2'],
            actionClass: 'write',
            toolName: 'write_file',
            summary: 'Write the updated guide',
            explanation: 'This will modify a workspace document.',
            affectedTargets: ['docs/Claims Guide.md'],
            requestCount: 1,
            scope: 'single-action',
            reason: 'approval required',
            status: 'pending',
            createdAt: '2026-03-08T00:00:00.000Z',
          },
        ],
        diagnostics: {
          task: {
            id: 'task-1',
            workspaceId: 'ws-1',
            goal: 'Update the claims guide',
            constraints: ['Stay inside docs'],
            desiredAutonomy: 'allow-safe-actions',
            completionCriteria: ['Guide updated'],
            allowedScope: { kind: 'workspace' },
            mode: 'operator',
            status: 'awaiting-approval',
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z',
            artifactRefs: [],
            currentStepId: 'step-2',
            blockerReason: 'Awaiting approval.',
            blockerCode: 'approval-pending',
            resumeStatus: 'planning',
            stopAfterCurrentStep: false,
          },
          planSteps: [
            {
              id: 'step-1',
              taskId: 'task-1',
              title: 'Read current guide',
              description: 'Inspect the existing document',
              status: 'completed',
              kind: 'read',
              approvalState: 'not-required',
              dependsOn: [],
              createdAt: '2026-03-08T00:00:00.000Z',
              updatedAt: '2026-03-08T00:00:00.000Z',
            },
          ],
          approvals: [],
          memory: [],
          trace: [
            {
              id: 'trace-1',
              taskId: 'task-1',
              phase: 'approval',
              event: 'approval-requested',
              message: 'Approval requested for write_file.',
              createdAt: '2026-03-08T00:00:00.000Z',
            },
          ],
        },
      },
    ], new Set(['task-1']));

    document.body.appendChild(rail);

    expect(rail.textContent).toContain('Update the claims guide');
    expect(rail.textContent).toContain('Approve once');
    expect(rail.textContent).toContain('Review the pending approval decision below so the task can continue.');
    expect(rail.textContent).toContain('Approval requested for write_file.');
    expect(rail.querySelector('.parallx-chat-agent-task-details')).toBeTruthy();
  });

  it('renders artifact summaries and recommended next steps for completed tasks', async () => {
    const { renderAgentTaskRail } = await import('../../src/built-in/chat/rendering/chatTaskCards');

    const rail = renderAgentTaskRail([
      {
        task: {
          id: 'task-3',
          workspaceId: 'ws-1',
          goal: 'Refresh the claims docs',
          constraints: [],
          desiredAutonomy: 'allow-safe-actions',
          completionCriteria: ['Docs updated'],
          allowedScope: { kind: 'workspace' },
          mode: 'operator',
          status: 'completed',
          createdAt: '2026-03-08T00:00:00.000Z',
          updatedAt: '2026-03-08T00:00:00.000Z',
          artifactRefs: ['/workspace/docs/Claims Guide.md', '/workspace/docs/FAQ.md'],
          stopAfterCurrentStep: false,
        },
        pendingApprovals: [],
        diagnostics: {
          task: {
            id: 'task-3',
            workspaceId: 'ws-1',
            goal: 'Refresh the claims docs',
            constraints: [],
            desiredAutonomy: 'allow-safe-actions',
            completionCriteria: ['Docs updated'],
            allowedScope: { kind: 'workspace' },
            mode: 'operator',
            status: 'completed',
            createdAt: '2026-03-08T00:00:00.000Z',
            updatedAt: '2026-03-08T00:00:00.000Z',
            artifactRefs: ['/workspace/docs/Claims Guide.md', '/workspace/docs/FAQ.md'],
            stopAfterCurrentStep: false,
          },
          planSteps: [
            {
              id: 'step-1',
              taskId: 'task-3',
              title: 'Edit claims guide',
              description: 'Update the claims guide',
              status: 'completed',
              kind: 'edit',
              proposedAction: {
                toolName: 'apply_patch',
                targetUris: [
                  { fsPath: '/workspace/docs/Claims Guide.md' },
                  { fsPath: '/workspace/docs/FAQ.md' },
                ],
              },
              approvalState: 'approved',
              dependsOn: [],
              createdAt: '2026-03-08T00:00:00.000Z',
              updatedAt: '2026-03-08T00:00:00.000Z',
            },
          ],
          approvals: [],
          memory: [],
          trace: [],
        },
      },
    ], new Set(['task-3']));

    document.body.appendChild(rail);

    expect(rail.textContent).toContain('Changed');
    expect(rail.textContent).toContain('/workspace/docs/Claims Guide.md');
    expect(rail.textContent).toContain('Recommended next step: Review the recorded artifacts in the workspace and decide whether a follow-up task is needed.');
  });

  it('dispatches task and approval events from task rail buttons', async () => {
    const { renderAgentTaskRail } = await import('../../src/built-in/chat/rendering/chatTaskCards');

    const rail = renderAgentTaskRail([
      {
        task: {
          id: 'task-2',
          workspaceId: 'ws-1',
          goal: 'Review notes',
          constraints: [],
          desiredAutonomy: 'allow-safe-actions',
          completionCriteria: [],
          allowedScope: { kind: 'workspace' },
          mode: 'operator',
          status: 'blocked',
          createdAt: '2026-03-08T00:00:00.000Z',
          updatedAt: '2026-03-08T00:00:00.000Z',
          artifactRefs: [],
          blockerReason: 'Approval denied.',
          blockerCode: 'approval-denied',
          stopAfterCurrentStep: false,
        },
        pendingApprovals: [
          {
            id: 'approval-2',
            taskId: 'task-2',
            stepId: 'step-3',
            stepIds: ['step-3'],
            actionClass: 'write',
            toolName: 'edit_file',
            summary: 'Edit the note',
            explanation: 'This changes a file.',
            affectedTargets: [],
            requestCount: 1,
            scope: 'single-action',
            reason: 'approval required',
            status: 'pending',
            createdAt: '2026-03-08T00:00:00.000Z',
          },
        ],
      },
    ], new Set());

    document.body.appendChild(rail);

    const taskSpy = vi.fn();
    const approvalSpy = vi.fn();
    rail.addEventListener('parallx-agent-task-action', taskSpy as EventListener);
    rail.addEventListener('parallx-agent-approval', approvalSpy as EventListener);

    (rail.querySelector('.parallx-chat-agent-task-button') as HTMLButtonElement).click();
    (rail.querySelector('.parallx-chat-agent-approval-button') as HTMLButtonElement).click();

    expect(taskSpy).toHaveBeenCalledOnce();
    expect(approvalSpy).toHaveBeenCalledOnce();
  });
});