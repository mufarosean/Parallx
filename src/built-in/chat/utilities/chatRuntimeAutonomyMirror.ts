import { URI } from '../../../platform/uri.js';
import { ChatMode } from '../../../services/chatTypes.js';
import type {
  AgentActionClass,
  AgentPlanStep,
  AgentPlanStepApprovalState,
  AgentPlanStepKind,
  AgentProposedAction,
  AgentTaskStatus,
} from '../../../agent/agentTypes.js';
import type {
  IAgentApprovalService,
  IAgentPolicyService,
  IAgentSessionService,
  IAgentTaskStore,
  IAgentTraceService,
  IWorkspaceService,
} from '../../../services/serviceTypes.js';
import type {
  IChatRuntimeAutonomyMirror,
  IChatRuntimeToolInvocationObserver,
  IChatRuntimeToolMetadata,
} from '../chatTypes.js';
import type { IToolResult } from '../../../services/chatTypes.js';

interface IChatRuntimeAutonomyMirrorDeps {
  readonly workspaceService: IWorkspaceService;
  readonly agentTaskStore: IAgentTaskStore;
  readonly agentSessionService: IAgentSessionService;
  readonly agentApprovalService: IAgentApprovalService;
  readonly agentTraceService: IAgentTraceService;
  readonly agentPolicyService: IAgentPolicyService;
}

interface ICreateChatRuntimeAutonomyMirrorInput {
  readonly sessionId: string;
  readonly requestText: string;
  readonly mode: ChatMode;
  readonly runtime: 'claw' | 'openclaw';
}

const TARGET_ARG_KEYS = [
  'path',
  'filePath',
  'relativePath',
  'folderPath',
  'folder_path',
  'dirPath',
  'oldPath',
  'newPath',
  'old_path',
  'new_path',
];

const TARGET_ARRAY_ARG_KEYS = ['paths', 'filePaths', 'targetPaths', 'affectedTargets'];

function createMirrorTaskId(runtime: 'claw' | 'openclaw', sessionId: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${runtime}-task-${sessionId}-${suffix}`;
}

function toPlanStepKind(actionClass: AgentActionClass): AgentPlanStepKind {
  switch (actionClass) {
    case 'read':
      return 'read';
    case 'search':
      return 'search';
    case 'write':
      return 'write';
    case 'edit':
      return 'edit';
    case 'delete':
      return 'delete';
    case 'command':
      return 'command';
    default:
      return 'analysis';
  }
}

function summarizeToolAction(toolName: string, targetUris: readonly URI[]): string {
  if (targetUris.length === 0) {
    return `Run ${toolName}`;
  }

  const firstTarget = targetUris[0]?.fsPath ?? targetUris[0]?.path ?? '';
  if (targetUris.length === 1) {
    return `${toolName} on ${firstTarget}`;
  }

  return `${toolName} on ${firstTarget} (+${targetUris.length - 1} more target${targetUris.length === 2 ? '' : 's'})`;
}

function summarizeResult(result: IToolResult): string {
  const normalized = result.content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 160) {
    return normalized;
  }
  return `${normalized.slice(0, 157)}...`;
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/');
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function resolveWorkspaceRootPath(workspaceService: IWorkspaceService): string | undefined {
  const folder = workspaceService.folders[0];
  return folder?.uri.fsPath;
}

function collectTargetUris(
  args: Record<string, unknown>,
  workspaceRoot: string | undefined,
): readonly URI[] {
  const targets: URI[] = [];
  const seen = new Set<string>();

  const pushTarget = (rawValue: unknown): void => {
    if (typeof rawValue !== 'string') {
      return;
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return;
    }

    const normalized = normalizeWorkspacePath(trimmed);
    const fsPath = isAbsolutePath(trimmed)
      ? trimmed
      : workspaceRoot
        ? `${workspaceRoot.replace(/[\\/]$/, '')}/${normalized}`.replace(/\//g, '\\')
        : normalized;

    if (seen.has(fsPath)) {
      return;
    }
    seen.add(fsPath);
    targets.push(URI.file(fsPath));
  };

  for (const key of TARGET_ARG_KEYS) {
    pushTarget(args[key]);
  }
  for (const key of TARGET_ARRAY_ARG_KEYS) {
    const values = args[key];
    if (Array.isArray(values)) {
      for (const value of values) {
        pushTarget(value);
      }
    }
  }

  return targets;
}

class ChatRuntimeAutonomyMirror implements IChatRuntimeAutonomyMirror {
  readonly taskId: string;

  private readonly _workspaceRoot: string | undefined;
  private _started = false;
  private _finished = false;
  private _stepCounter = 0;
  private readonly _stepIdBySignature = new Map<string, string>();
  private readonly _approvalIdByStepId = new Map<string, string>();

  constructor(
    private readonly _deps: IChatRuntimeAutonomyMirrorDeps,
    private readonly _input: ICreateChatRuntimeAutonomyMirrorInput,
  ) {
    this.taskId = createMirrorTaskId(_input.runtime, _input.sessionId);
    this._workspaceRoot = resolveWorkspaceRootPath(_deps.workspaceService);
  }

  async begin(): Promise<void> {
    if (this._started) {
      return;
    }

    await this._deps.agentSessionService.createTask({
      goal: this._input.requestText,
      desiredAutonomy: this._input.mode === ChatMode.Edit ? 'allow-safe-actions' : 'allow-policy-actions',
      completionCriteria: ['Produce a final chat answer.'],
      allowedScope: { kind: 'workspace' },
      mode: 'operator',
      constraints: [`runtime=${this._input.runtime}`],
    }, this.taskId);
    await this._deps.agentSessionService.transitionTask(this.taskId, 'planning');
    await this._deps.agentSessionService.transitionTask(this.taskId, 'running');
    this._started = true;
  }

  createToolObserver(
    toolName: string,
    args: Record<string, unknown>,
    downstream?: IChatRuntimeToolInvocationObserver,
  ): IChatRuntimeToolInvocationObserver {
    const step = this._ensureStep(toolName, args);

    return {
      onValidated: (metadata) => {
        void this._handleValidated(step, metadata);
        downstream?.onValidated?.(metadata);
      },
      onApprovalRequested: (metadata) => {
        void this._handleApprovalRequested(step, metadata);
        downstream?.onApprovalRequested?.(metadata);
      },
      onApprovalResolved: (metadata, approved) => {
        void this._handleApprovalResolved(step, metadata, approved);
        downstream?.onApprovalResolved?.(metadata, approved);
      },
      onExecuted: (metadata, result) => {
        void this._handleExecuted(step, metadata, result);
        downstream?.onExecuted?.(metadata, result);
      },
    };
  }

  async complete(note?: string): Promise<void> {
    if (this._finished) {
      return;
    }
    this._finished = true;
    await this._transitionIfAllowed('completed', note);
  }

  async fail(note?: string): Promise<void> {
    if (this._finished) {
      return;
    }
    this._finished = true;
    await this._transitionIfAllowed('failed', note, 'tool-failure');
  }

  async abort(note?: string): Promise<void> {
    if (this._finished) {
      return;
    }
    this._finished = true;
    await this._transitionIfAllowed('cancelled', note);
  }

  private _ensureStep(toolName: string, args: Record<string, unknown>): AgentPlanStep {
    const signature = `${toolName}:${JSON.stringify(args, Object.keys(args).sort())}`;
    const existingId = this._stepIdBySignature.get(signature);
    const existing = existingId ? this._deps.agentTaskStore.getPlanStep(existingId) : undefined;
    if (existing) {
      return existing;
    }

    const action = this._buildProposedAction(toolName, args);
    const actionClass = this._deps.agentPolicyService.classifyAction(action);
    const stepId = `${this.taskId}-step-${++this._stepCounter}`;
    const step: AgentPlanStep = {
      id: stepId,
      taskId: this.taskId,
      title: summarizeToolAction(toolName, action.targetUris ?? []),
      description: summarizeToolAction(toolName, action.targetUris ?? []),
      kind: toPlanStepKind(actionClass),
      proposedAction: {
        ...action,
        actionClass,
      },
      status: 'pending',
      approvalState: 'not-required',
      dependsOn: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._stepIdBySignature.set(signature, stepId);
    void this._deps.agentTaskStore.upsertPlanStep(step);
    void this._deps.agentTraceService.record(this.taskId, {
      id: `trace-plan-step-${stepId}`,
      phase: 'planning',
      event: 'plan-step-recorded',
      message: `Planned runtime step: ${step.title}`,
      stepId,
      planIntent: step.title,
      selectedTool: toolName,
      outputSummary: step.description,
    });
    return step;
  }

  private _buildProposedAction(toolName: string, args: Record<string, unknown>): AgentProposedAction {
    const targetUris = collectTargetUris(args, this._workspaceRoot);
    return {
      toolName,
      summary: summarizeToolAction(toolName, targetUris),
      targetUris,
      interactionMode: 'operator',
    };
  }

  private async _handleValidated(
    stepSeed: AgentPlanStep,
    metadata: IChatRuntimeToolMetadata,
  ): Promise<void> {
    await this._transitionIfAllowed('running');
    const current = this._deps.agentTaskStore.getPlanStep(stepSeed.id) ?? stepSeed;
    await this._deps.agentTaskStore.upsertPlanStep({
      ...current,
      status: 'running',
      approvalState: metadata.requiresApproval ? 'pending' : metadata.autoApproved ? 'approved' : 'not-required',
      updatedAt: new Date().toISOString(),
      resultSummary: metadata.permissionLevel,
    });
    await this._deps.agentTraceService.record(this.taskId, {
      id: `trace-step-start-${stepSeed.id}-${Date.now()}`,
      phase: 'execution',
      event: 'step-started',
      message: `Runtime tool step started: ${stepSeed.title}`,
      stepId: stepSeed.id,
      planIntent: stepSeed.title,
      selectedTool: metadata.name,
      outputSummary: metadata.permissionLevel,
    });
  }

  private async _handleApprovalRequested(
    stepSeed: AgentPlanStep,
    metadata: IChatRuntimeToolMetadata,
  ): Promise<void> {
    const current = this._deps.agentTaskStore.getPlanStep(stepSeed.id) ?? stepSeed;
    const queued = await this._deps.agentSessionService.queueApprovalForTask(this.taskId, {
      id: `approval-${stepSeed.id}`,
      stepId: stepSeed.id,
      stepIds: [stepSeed.id],
      actionClass: current.proposedAction?.actionClass ?? 'unknown',
      toolName: metadata.name,
      summary: current.title,
      explanation: metadata.description ?? 'Runtime-controlled tool approval required.',
      affectedTargets: (current.proposedAction?.targetUris ?? []).map((uri) => uri.fsPath),
      bundleKey: `${current.proposedAction?.actionClass ?? 'unknown'}:${metadata.name}`,
      scope: 'single-action',
      reason: `Approval required for ${metadata.name}.`,
    });
    this._approvalIdByStepId.set(stepSeed.id, queued.approvalRequest.id);
    await this._deps.agentTaskStore.upsertPlanStep({
      ...current,
      status: 'pending',
      approvalState: 'pending',
      approvalRequestId: queued.approvalRequest.id,
      updatedAt: new Date().toISOString(),
    });
  }

  private async _handleApprovalResolved(
    stepSeed: AgentPlanStep,
    _metadata: IChatRuntimeToolMetadata,
    approved: boolean,
  ): Promise<void> {
    const approvalId = this._approvalIdByStepId.get(stepSeed.id);
    if (approvalId) {
      await this._deps.agentSessionService.resolveTaskApproval(
        this.taskId,
        approvalId,
        approved ? 'approve-once' : 'deny',
      );
    }

    const current = this._deps.agentTaskStore.getPlanStep(stepSeed.id) ?? stepSeed;
    const nextApprovalState: AgentPlanStepApprovalState = approved ? 'approved' : 'denied';
    await this._deps.agentTaskStore.upsertPlanStep({
      ...current,
      status: approved ? 'pending' : 'blocked',
      approvalState: nextApprovalState,
      updatedAt: new Date().toISOString(),
      lastError: approved ? undefined : 'Approval denied.',
    });

    if (approved) {
      await this._transitionIfAllowed('running');
    } else {
      this._finished = true;
    }
  }

  private async _handleExecuted(
    stepSeed: AgentPlanStep,
    metadata: IChatRuntimeToolMetadata,
    result: IToolResult,
  ): Promise<void> {
    const current = this._deps.agentTaskStore.getPlanStep(stepSeed.id) ?? stepSeed;
    await this._deps.agentTaskStore.upsertPlanStep({
      ...current,
      status: 'completed',
      approvalState: current.approvalState === 'pending'
        ? (metadata.requiresApproval ? 'approved' : current.approvalState)
        : current.approvalState,
      updatedAt: new Date().toISOString(),
      resultSummary: summarizeResult(result),
      lastError: result.isError ? summarizeResult(result) : undefined,
    });

    await this._deps.agentTraceService.record(this.taskId, {
      id: `trace-step-complete-${stepSeed.id}-${Date.now()}`,
      phase: 'execution',
      event: 'step-completed',
      message: `Runtime tool step completed: ${stepSeed.title}`,
      stepId: stepSeed.id,
      planIntent: stepSeed.title,
      selectedTool: metadata.name,
      outputSummary: summarizeResult(result),
    });

    const artifactRefs = (current.proposedAction?.targetUris ?? [])
      .map((uri) => uri.fsPath)
      .filter((value) => value.length > 0);
    if (!result.isError && artifactRefs.length > 0 && current.proposedAction?.actionClass && ['write', 'edit', 'delete', 'command'].includes(current.proposedAction.actionClass)) {
      await this._deps.agentSessionService.recordTaskArtifacts(this.taskId, artifactRefs);
    }
  }

  private async _transitionIfAllowed(
    nextStatus: AgentTaskStatus,
    blockerReason?: string,
    blockerCode?: import('../../../agent/agentTypes.js').AgentBlockReasonCode,
  ): Promise<void> {
    const task = this._deps.agentSessionService.getTask(this.taskId);
    if (!task || task.status === nextStatus || task.status === 'completed' || task.status === 'cancelled') {
      return;
    }

    await this._deps.agentSessionService.transitionTask(this.taskId, nextStatus, undefined, {
      blockerReason,
      blockerCode,
      currentStepId: task.currentStepId,
    });
  }
}

export function createChatRuntimeAutonomyMirror(
  deps: IChatRuntimeAutonomyMirrorDeps,
  input: ICreateChatRuntimeAutonomyMirrorInput,
): IChatRuntimeAutonomyMirror | undefined {
  // M41 Phase 9: Autonomy mirror for Ask + Agent (both have full tools).
  // Edit mode skips it (structured output, no autonomous actions).
  if (input.mode === ChatMode.Edit) {
    return undefined;
  }

  if (!deps.workspaceService.activeWorkspace) {
    return undefined;
  }

  return new ChatRuntimeAutonomyMirror(deps, input);
}