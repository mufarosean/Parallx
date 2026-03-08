import { Disposable } from '../platform/lifecycle.js';
import type { AgentPlanStep, AgentRunResult } from '../agent/agentTypes.js';
import type {
  IAgentExecutionService,
  IAgentPolicyService,
  IAgentSessionService,
  IAgentTaskStore,
} from './serviceTypes.js';

export class AgentExecutionService extends Disposable implements IAgentExecutionService {
  constructor(
    private readonly _taskStore: IAgentTaskStore,
    private readonly _sessionService: IAgentSessionService,
    private readonly _policyService: IAgentPolicyService,
  ) {
    super();
  }

  async runTask(taskId: string, now: string = new Date().toISOString()): Promise<AgentRunResult> {
    let task = this._sessionService.getTask(taskId);
    if (!task) {
      throw new Error(`Agent task not found: ${taskId}`);
    }

    if (task.status === 'pending') {
      task = await this._sessionService.transitionTask(taskId, 'planning', now, {
        currentStepId: undefined,
        blockerReason: undefined,
      });
    }

    const executedStepIds: string[] = [];

    while (true) {
      const steps = this._taskStore.listPlanStepsForTask(taskId);
      const runnableStep = this._findRunnableStep(steps);

      if (!runnableStep) {
        if (steps.length > 0 && steps.every((step) => step.status === 'completed')) {
          task = await this._sessionService.transitionTask(taskId, 'completed', now, { currentStepId: undefined, blockerReason: undefined });
        }

        return { task: task ?? this._sessionService.getTask(taskId)!, executedStepIds };
      }

      task = await this._sessionService.transitionTask(taskId, 'running', now, { currentStepId: runnableStep.id, blockerReason: undefined });
      await this._taskStore.upsertPlanStep({
        ...runnableStep,
        status: 'running',
        updatedAt: now,
      });

      const proposedAction = runnableStep.proposedAction;
      if (!proposedAction) {
        await this._taskStore.upsertPlanStep({
          ...runnableStep,
          status: 'completed',
          updatedAt: now,
          resultSummary: 'Step completed without requiring an external action.',
        });
        executedStepIds.push(runnableStep.id);
        task = this._sessionService.getTask(taskId) ?? task;
        continue;
      }

      const decision = this._policyService.evaluateAction(proposedAction);
      if (decision.policy === 'deny') {
        await this._taskStore.upsertPlanStep({
          ...runnableStep,
          status: 'blocked',
          updatedAt: now,
          lastError: decision.reason,
          approvalState: 'denied',
        });
        task = await this._sessionService.transitionTask(taskId, 'blocked', now, {
          currentStepId: runnableStep.id,
          blockerReason: decision.reason,
        });
        return { task, executedStepIds, blockedStepId: runnableStep.id };
      }

      if (decision.policy === 'require-approval') {
        const queued = await this._sessionService.queueApprovalForTask(taskId, {
          id: `approval-${runnableStep.id}`,
          stepId: runnableStep.id,
          stepIds: [runnableStep.id],
          actionClass: decision.actionClass,
          toolName: proposedAction.toolName ?? 'unknown-tool',
          summary: proposedAction.summary ?? runnableStep.title,
          explanation: decision.reason,
          affectedTargets: (proposedAction.targetUris ?? []).map((uri) => uri.fsPath),
          bundleKey: `${decision.actionClass}:${proposedAction.toolName ?? 'unknown-tool'}`,
          scope: 'single-action',
          reason: decision.reason,
        }, now);

        await this._taskStore.upsertPlanStep({
          ...runnableStep,
          status: 'pending',
          updatedAt: now,
          approvalState: 'pending',
          approvalRequestId: queued.approvalRequest.id,
        });

        return {
          task: queued.task,
          executedStepIds,
          approvalRequestId: queued.approvalRequest.id,
        };
      }

      await this._taskStore.upsertPlanStep({
        ...runnableStep,
        status: 'completed',
        updatedAt: now,
        approvalState: runnableStep.approvalState === 'approved' ? 'approved' : 'not-required',
        resultSummary: decision.reason,
      });
      executedStepIds.push(runnableStep.id);
      task = this._sessionService.getTask(taskId) ?? task;
    }
  }

  private _findRunnableStep(steps: readonly AgentPlanStep[]): AgentPlanStep | undefined {
    const completed = new Set(steps.filter((step) => step.status === 'completed').map((step) => step.id));
    return steps.find((step) => {
      if (step.status !== 'pending') {
        return false;
      }

      if (step.approvalState === 'pending') {
        return false;
      }

      return step.dependsOn.every((dependencyId) => completed.has(dependencyId));
    });
  }
}