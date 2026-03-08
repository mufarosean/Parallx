import { Disposable } from '../platform/lifecycle.js';
import { blockReasonFromPolicyDecision } from './agentBlockReason.js';
import type { AgentPlanStep, AgentRunResult } from '../agent/agentTypes.js';
import type {
  IAgentExecutionService,
  IAgentMemoryService,
  IAgentPolicyService,
  IAgentSessionService,
  IAgentTaskStore,
  IAgentTraceService,
} from './serviceTypes.js';

interface IAgentExecutionConfigProvider {
  getEffectiveConfig(): {
    agent?: {
      verbosity?: 'concise' | 'balanced' | 'detailed';
      executionStyle?: 'stepwise' | 'balanced' | 'batch';
      proactivity?: 'low' | 'balanced' | 'high';
    };
  };
}

export class AgentExecutionService extends Disposable implements IAgentExecutionService {
  constructor(
    private readonly _taskStore: IAgentTaskStore,
    private readonly _sessionService: IAgentSessionService,
    private readonly _policyService: IAgentPolicyService,
    private readonly _configProvider?: IAgentExecutionConfigProvider,
    private readonly _memoryService?: IAgentMemoryService,
    private readonly _traceService?: IAgentTraceService,
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
      task = this._sessionService.getTask(taskId) ?? task;
      const steps = this._taskStore.listPlanStepsForTask(taskId);
      const runnableStep = this._findRunnableStep(steps);

      if (!runnableStep) {
        if (steps.length > 0 && steps.every((step) => step.status === 'completed')) {
          task = await this._sessionService.transitionTask(taskId, 'completed', now, { currentStepId: undefined, blockerReason: undefined });
        }

        return { task: task ?? this._sessionService.getTask(taskId)!, executedStepIds };
      }

      const previousStatus = task.status;
      task = await this._sessionService.transitionTask(taskId, 'running', now, { currentStepId: runnableStep.id, blockerReason: undefined });
      await this._traceService?.record(taskId, {
        id: `trace-step-start-${runnableStep.id}-${now}`,
        phase: 'execution',
        event: 'step-started',
        message: `Started step: ${runnableStep.title}`,
        stepId: runnableStep.id,
        planIntent: runnableStep.title,
        selectedTool: runnableStep.proposedAction?.toolName,
        previousStatus,
        nextStatus: 'running',
      }, now);
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
        await this._traceService?.record(taskId, {
          id: `trace-step-complete-${runnableStep.id}-${now}`,
          phase: 'execution',
          event: 'step-completed',
          message: `Completed step: ${runnableStep.title}`,
          stepId: runnableStep.id,
          planIntent: runnableStep.title,
          outputSummary: 'Step completed without requiring an external action.',
        }, now);
        executedStepIds.push(runnableStep.id);
        task = this._sessionService.getTask(taskId) ?? task;
        if (this._shouldPauseAfterStep(task, executedStepIds.length)) {
          task = await this._pauseAtStepBoundary(taskId, now, task.stopAfterCurrentStep
            ? 'Paused after requested step boundary.'
            : this._cadencePauseReason(), task.stopAfterCurrentStep ? 'user-requested-pause' : 'execution-cadence');
          return { task, executedStepIds };
        }
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
          blockerCode: blockReasonFromPolicyDecision(decision),
        });
        await this._traceService?.record(taskId, {
          id: `trace-step-blocked-${runnableStep.id}-${now}`,
          phase: 'execution',
          event: 'step-blocked',
          message: `Blocked step: ${runnableStep.title}`,
          stepId: runnableStep.id,
          planIntent: runnableStep.title,
          selectedTool: proposedAction.toolName,
          outputSummary: decision.reason,
          previousStatus: 'running',
          nextStatus: 'blocked',
        }, now);
        return { task, executedStepIds, blockedStepId: runnableStep.id };
      }

      if (decision.policy === 'require-approval' && runnableStep.approvalState !== 'approved') {
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
      task = await this._recordArtifactsForStep(taskId, runnableStep, now);
      await this._traceService?.record(taskId, {
        id: `trace-step-complete-${runnableStep.id}-${now}`,
        phase: 'execution',
        event: 'step-completed',
        message: `Completed step: ${runnableStep.title}`,
        stepId: runnableStep.id,
        planIntent: runnableStep.title,
        selectedTool: proposedAction.toolName,
        outputSummary: decision.reason,
      }, now);
      executedStepIds.push(runnableStep.id);
      task = this._sessionService.getTask(taskId) ?? task;
      if (this._shouldPauseAfterStep(task, executedStepIds.length)) {
        task = await this._pauseAtStepBoundary(taskId, now, task.stopAfterCurrentStep
          ? 'Paused after requested step boundary.'
          : this._cadencePauseReason(), task.stopAfterCurrentStep ? 'user-requested-pause' : 'execution-cadence');
        return { task, executedStepIds };
      }
    }
  }

  private _shouldPauseAfterStep(task: AgentRunResult['task'], executedStepCount: number): boolean {
    if (task.stopAfterCurrentStep) {
      return true;
    }

    const executionStyle = this._configProvider?.getEffectiveConfig().agent?.executionStyle ?? 'balanced';
    const proactivity = this._configProvider?.getEffectiveConfig().agent?.proactivity ?? 'balanced';
    return executedStepCount > 0 && (executionStyle === 'stepwise' || proactivity === 'low');
  }

  private _cadencePauseReason(): string {
    const verbosity = this._configProvider?.getEffectiveConfig().agent?.verbosity ?? 'balanced';
    if (verbosity === 'concise') {
      return 'Paused for the next check-in.';
    }

    if (verbosity === 'detailed') {
      return 'Paused at a safe step boundary to honor the configured execution cadence before continuing further autonomous work.';
    }

    return 'Paused at a step boundary based on the configured execution cadence.';
  }

  private _pauseAtStepBoundary(
    taskId: string,
    now: string,
    blockerReason: string,
    blockerCode: 'user-requested-pause' | 'execution-cadence',
  ): Promise<AgentRunResult['task']> {
    return this._sessionService.transitionTask(taskId, 'paused', now, {
      currentStepId: undefined,
      blockerReason,
      blockerCode,
      stopAfterCurrentStep: false,
    });
  }

  private async _recordArtifactsForStep(
    taskId: string,
    step: AgentPlanStep,
    now: string,
  ): Promise<AgentRunResult['task']> {
    const artifactRefs = this._collectArtifactRefs(step);
    const currentTask = this._sessionService.getTask(taskId);
    if (!currentTask || artifactRefs.length === 0) {
      return currentTask ?? this._sessionService.getTask(taskId)!;
    }

    const updatedTask = await this._sessionService.recordTaskArtifacts(taskId, artifactRefs, now);
    if (this._memoryService) {
      await this._memoryService.remember(taskId, {
        id: `artifact-${step.id}-${now}`,
        category: 'artifact',
        content: this._buildArtifactMemoryContent(step, artifactRefs),
        source: 'agent',
        evidenceStepIds: [step.id],
        artifactRefs,
      }, now);
    }

    return updatedTask;
  }

  private _collectArtifactRefs(step: AgentPlanStep): readonly string[] {
    if (!step.proposedAction?.targetUris || !this._isArtifactProducingStep(step)) {
      return [];
    }

    const artifactRefs: string[] = [];
    for (const targetUri of step.proposedAction.targetUris) {
      const artifactRef = targetUri.fsPath?.trim();
      if (artifactRef && !artifactRefs.includes(artifactRef)) {
        artifactRefs.push(artifactRef);
      }
    }

    return artifactRefs;
  }

  private _isArtifactProducingStep(step: AgentPlanStep): boolean {
    return step.kind === 'write'
      || step.kind === 'edit'
      || step.kind === 'delete'
      || step.kind === 'command';
  }

  private _buildArtifactMemoryContent(step: AgentPlanStep, artifactRefs: readonly string[]): string {
    const prefix = step.kind === 'write'
      ? 'Created or updated'
      : step.kind === 'edit'
        ? 'Updated'
        : step.kind === 'delete'
          ? 'Removed'
          : 'Produced or modified';

    return `${prefix} artifact${artifactRefs.length === 1 ? '' : 's'}: ${artifactRefs.join(', ')}.`;
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