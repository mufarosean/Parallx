import { $ } from '../../../ui/dom.js';
import type { AgentApprovalRequest, AgentApprovalResolution, AgentTaskDiagnostics, AgentTaskRecord } from '../../../agent/agentTypes.js';
import type { IChatAgentTaskViewModel } from '../chatTypes.js';

export interface AgentTaskActionEventDetail {
  readonly taskId: string;
  readonly action: 'continue' | 'stop-after-step' | 'toggle-details';
}

export interface AgentApprovalActionEventDetail {
  readonly taskId: string;
  readonly requestId: string;
  readonly resolution: AgentApprovalResolution;
}

export function renderAgentTaskRail(
  tasks: readonly IChatAgentTaskViewModel[],
  expandedTaskIds: ReadonlySet<string>,
): HTMLElement {
  const root = $('section.parallx-chat-agent-task-rail');
  root.setAttribute('aria-label', 'Agent tasks');

  const header = $('div.parallx-chat-agent-task-rail-header');
  const title = $('div.parallx-chat-agent-task-rail-title');
  title.textContent = tasks.length === 1 ? '1 agent task' : `${tasks.length} agent tasks`;
  const subtitle = $('div.parallx-chat-agent-task-rail-subtitle');
  subtitle.textContent = 'AI stays awake across modes. This rail shows action progress, approvals, and diagnostics when work becomes task-shaped.';
  header.append(title, subtitle);
  root.appendChild(header);

  const list = $('div.parallx-chat-agent-task-list');
  for (const task of tasks) {
    list.appendChild(renderAgentTaskCard(task, expandedTaskIds.has(task.task.id)));
  }
  root.appendChild(list);

  return root;
}

function renderAgentTaskCard(
  viewModel: IChatAgentTaskViewModel,
  expanded: boolean,
): HTMLElement {
  const { task, diagnostics, pendingApprovals } = viewModel;
  const artifactGroups = buildArtifactGroups(task, diagnostics);
  const root = $('article.parallx-chat-agent-task-card');
  root.classList.add(`parallx-chat-agent-task-card--${task.status}`);
  root.dataset.taskId = task.id;

  const header = $('div.parallx-chat-agent-task-card-header');
  const titleWrap = $('div.parallx-chat-agent-task-card-title-wrap');
  const eyebrow = $('div.parallx-chat-agent-task-card-eyebrow');
  eyebrow.textContent = 'Agent Task';
  const title = $('div.parallx-chat-agent-task-card-title');
  title.textContent = task.goal;
  titleWrap.append(eyebrow, title);

  const status = $('span.parallx-chat-agent-task-status');
  status.textContent = formatStatus(task.status);
  header.append(titleWrap, status);
  root.appendChild(header);

  const meta = $('div.parallx-chat-agent-task-card-meta');
  meta.appendChild(_metaPill(buildPlanSummary(diagnostics)));
  if (pendingApprovals.length > 0) {
    meta.appendChild(_metaPill(pendingApprovals.length === 1 ? '1 pending approval' : `${pendingApprovals.length} pending approvals`));
  }
  if (task.constraints.length > 0) {
    meta.appendChild(_metaPill(`${task.constraints.length} constraint${task.constraints.length === 1 ? '' : 's'}`));
  }
  root.appendChild(meta);

  const summary = $('div.parallx-chat-agent-task-summary');
  summary.textContent = buildTaskSummary(task, diagnostics, pendingApprovals);
  root.appendChild(summary);

  if (artifactGroups.length > 0) {
    root.appendChild(renderArtifactGroups(artifactGroups, false));
  }

  const nextStep = buildRecommendedNextStep(task, pendingApprovals, artifactGroups.length > 0);
  if (nextStep) {
    const nextStepEl = $('div.parallx-chat-agent-task-next-step');
    nextStepEl.textContent = `Next: ${nextStep}`;
    root.appendChild(nextStepEl);
  }

  if (pendingApprovals.length > 0) {
    const approvals = $('div.parallx-chat-agent-task-approvals');
    for (const request of pendingApprovals) {
      approvals.appendChild(renderApprovalRequest(task.id, request));
    }
    root.appendChild(approvals);
  }

  const actions = $('div.parallx-chat-agent-task-actions');
  if ((task.status === 'planning' || task.status === 'running') && !task.stopAfterCurrentStep) {
    actions.appendChild(_taskActionButton('Pause after step', task.id, 'stop-after-step'));
  }
  if (task.status === 'paused' || task.status === 'blocked') {
    actions.appendChild(_taskActionButton('Continue', task.id, 'continue'));
  }
  actions.appendChild(_taskActionButton(expanded ? 'Hide details' : 'Show details', task.id, 'toggle-details'));
  root.appendChild(actions);

  if (expanded) {
    root.appendChild(renderTaskDiagnostics(task, diagnostics, artifactGroups, nextStep));
  }

  return root;
}

function renderApprovalRequest(taskId: string, request: AgentApprovalRequest): HTMLElement {
  const root = $('section.parallx-chat-agent-approval-card');
  root.dataset.requestId = request.id;

  const title = $('div.parallx-chat-agent-approval-title');
  title.textContent = request.summary;
  root.appendChild(title);

  const detail = $('div.parallx-chat-agent-approval-detail');
  detail.textContent = [request.explanation, buildApprovalScopeHint(request)].filter(Boolean).join(' ');
  root.appendChild(detail);

  if (request.affectedTargets.length > 0) {
    const targets = $('div.parallx-chat-agent-approval-targets');
    targets.textContent = `Targets: ${request.affectedTargets.join(', ')}`;
    root.appendChild(targets);
  }

  const actions = $('div.parallx-chat-agent-approval-actions');
  actions.appendChild(_approvalButton('Approve once', taskId, request.id, 'approve-once'));
  actions.appendChild(_approvalButton('Approve task', taskId, request.id, 'approve-for-task'));
  actions.appendChild(_approvalButton('Deny', taskId, request.id, 'deny'));
  actions.appendChild(_approvalButton('Cancel task', taskId, request.id, 'cancel-task'));
  root.appendChild(actions);

  return root;
}

function renderTaskDiagnostics(
  task: AgentTaskRecord,
  diagnostics: AgentTaskDiagnostics | undefined,
  artifactGroups: readonly ArtifactGroup[],
  nextStep: string | undefined,
): HTMLElement {
  const root = $('section.parallx-chat-agent-task-details');
  if (!diagnostics) {
    const empty = $('div.parallx-chat-agent-task-details-empty');
    empty.textContent = 'Diagnostics are not available for this task yet.';
    root.appendChild(empty);
    return root;
  }

  const summary = $('div.parallx-chat-agent-task-details-summary');
  summary.appendChild(_metaPill(`Trace ${diagnostics.trace.length}`));
  summary.appendChild(_metaPill(`Memory ${diagnostics.memory.length}`));
  summary.appendChild(_metaPill(`Approvals ${diagnostics.approvals.length}`));
  summary.appendChild(_metaPill(`Artifacts ${diagnostics.task.artifactRefs.length}`));
  root.appendChild(summary);

  const diagnosticsIntro = $('div.parallx-chat-agent-task-details-empty');
  diagnosticsIntro.textContent = buildDiagnosticsIntro(task, diagnostics);
  root.appendChild(diagnosticsIntro);

  if (artifactGroups.length > 0) {
    root.appendChild(renderArtifactGroups(artifactGroups, true));
  } else if (task.status === 'completed') {
    const emptyArtifacts = $('div.parallx-chat-agent-task-details-empty');
    emptyArtifacts.textContent = 'No workspace artifacts were recorded for this completed task.';
    root.appendChild(emptyArtifacts);
  }

  if (nextStep) {
    const nextStepEl = $('div.parallx-chat-agent-task-next-step');
    nextStepEl.textContent = `Recommended next step: ${nextStep}`;
    root.appendChild(nextStepEl);
  }

  const traceList = $('ol.parallx-chat-agent-task-trace');
  for (const entry of diagnostics.trace.slice(-5)) {
    const item = $('li.parallx-chat-agent-task-trace-item');
    const message = $('div.parallx-chat-agent-task-trace-message');
    message.textContent = entry.message;
    const meta = $('div.parallx-chat-agent-task-trace-meta');
    meta.textContent = [entry.phase, entry.selectedTool, entry.outputSummary].filter(Boolean).join(' · ');
    item.append(message, meta);
    traceList.appendChild(item);
  }
  root.appendChild(traceList);

  return root;
}

interface ArtifactGroup {
  readonly label: string;
  readonly items: readonly string[];
}

function renderArtifactGroups(groups: readonly ArtifactGroup[], detailed: boolean): HTMLElement {
  const root = $('section.parallx-chat-agent-task-artifacts');
  const title = $('div.parallx-chat-agent-task-artifacts-title');
  title.textContent = detailed ? 'Artifact summary' : 'Artifacts';
  root.appendChild(title);

  if (detailed) {
    const detail = $('div.parallx-chat-agent-task-details-empty');
    detail.textContent = 'Artifacts show which workspace files the task changed or produced.';
    root.appendChild(detail);
  }

  for (const group of groups) {
    const groupEl = $('div.parallx-chat-agent-task-artifact-group');
    const label = $('div.parallx-chat-agent-task-artifact-label');
    label.textContent = group.label;
    groupEl.appendChild(label);

    const list = $('ul.parallx-chat-agent-task-artifact-list');
    for (const item of detailed ? group.items : group.items.slice(0, 3)) {
      const li = $('li.parallx-chat-agent-task-artifact-item');
      li.textContent = item;
      list.appendChild(li);
    }
    if (!detailed && group.items.length > 3) {
      const li = $('li.parallx-chat-agent-task-artifact-item');
      li.textContent = `+${group.items.length - 3} more`;
      list.appendChild(li);
    }

    groupEl.appendChild(list);
    root.appendChild(groupEl);
  }

  return root;
}

function _metaPill(label: string): HTMLElement {
  const pill = $('span.parallx-chat-agent-task-pill');
  pill.textContent = label;
  return pill;
}

function _taskActionButton(
  label: string,
  taskId: string,
  action: AgentTaskActionEventDetail['action'],
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'parallx-chat-agent-task-button';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    button.dispatchEvent(new CustomEvent<AgentTaskActionEventDetail>('parallx-agent-task-action', {
      bubbles: true,
      detail: { taskId, action },
    }));
  });
  return button;
}

function _approvalButton(
  label: string,
  taskId: string,
  requestId: string,
  resolution: AgentApprovalResolution,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'parallx-chat-agent-approval-button';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    button.dispatchEvent(new CustomEvent<AgentApprovalActionEventDetail>('parallx-agent-approval', {
      bubbles: true,
      detail: { taskId, requestId, resolution },
    }));
  });
  return button;
}

function buildPlanSummary(diagnostics: AgentTaskDiagnostics | undefined): string {
  if (!diagnostics || diagnostics.planSteps.length === 0) {
    return 'No plan steps yet';
  }

  const completed = diagnostics.planSteps.filter((step) => step.status === 'completed').length;
  return `${completed}/${diagnostics.planSteps.length} steps complete`;
}

function buildTaskSummary(
  task: AgentTaskRecord,
  diagnostics: AgentTaskDiagnostics | undefined,
  pendingApprovals: readonly AgentApprovalRequest[],
): string {
  if (pendingApprovals.length > 0) {
    const nextApproval = pendingApprovals[0];
    return `Waiting for approval before the next workspace action can run: ${nextApproval.summary}.`;
  }
  if (task.status === 'blocked') {
    return buildBlockedSummary(task);
  }
  if (task.status === 'paused' && task.blockerReason) {
    return task.blockerReason;
  }
  if (task.status === 'completed') {
    const completed = diagnostics?.planSteps.filter((step) => step.status === 'completed').length ?? 0;
    if (task.artifactRefs.length > 0) {
      return `Workspace update complete with ${completed} finished step${completed === 1 ? '' : 's'} and ${task.artifactRefs.length} recorded artifact${task.artifactRefs.length === 1 ? '' : 's'}.`;
    }
    return `Task complete with ${completed} finished step${completed === 1 ? '' : 's'} and no recorded workspace artifacts.`;
  }
  if (task.status === 'running') {
    return 'Executing the current plan inside the active workspace boundary.';
  }
  if (task.status === 'planning') {
    return 'Planning the next safe workspace action.';
  }
  return 'Tracking delegated workspace progress.';
}

function buildRecommendedNextStep(
  task: AgentTaskRecord,
  pendingApprovals: readonly AgentApprovalRequest[],
  hasArtifacts: boolean,
): string | undefined {
  if (pendingApprovals.length > 0) {
    const nextApproval = pendingApprovals[0];
    return nextApproval.scope === 'task'
      ? 'Review the pending approval below. Approve task to allow the remaining task actions, or deny it to keep the task blocked.'
      : 'Review the pending approval below. Approve once to allow only this action, or deny it to keep the task blocked.';
  }

  if (task.status === 'blocked') {
    if (task.blockerCode === 'approval-denied') {
      return 'Continue to retry the task, or redirect it with narrower instructions if you want to request a different action.';
    }
    if (task.blockerCode === 'outside-workspace-request') {
      return 'Keep the task inside the active workspace, then continue if you want the agent to retry with an allowed target.';
    }
    return 'Continue to retry the task, or redirect it with a narrower constraint before running again.';
  }

  if (task.status === 'paused') {
    return 'Continue when you want the next step to run, or redirect the task if the goal needs to change.';
  }

  if (task.status === 'completed') {
    return hasArtifacts
      ? 'Review the recorded artifacts in the workspace and decide whether a follow-up task is needed.'
      : 'Review the completed plan and launch a follow-up task if more workspace changes are needed.';
  }

  return undefined;
}

function buildDiagnosticsIntro(
  task: AgentTaskRecord,
  diagnostics: AgentTaskDiagnostics,
): string {
  if (task.status === 'completed') {
    return diagnostics.trace.length > 0
      ? 'Trace shows the recent planning, approval, and execution events that led to this result.'
      : 'Task details summarize the recorded outcome for this completed run.';
  }

  if (task.status === 'blocked') {
    return 'Trace shows where the task stopped and which condition blocked the next action.';
  }

  if (task.status === 'paused') {
    return 'Trace shows the most recent completed step so you can decide whether to continue or redirect the task.';
  }

  return 'Trace shows the most recent planning, approval, and execution events for this task.';
}

function buildApprovalScopeHint(request: AgentApprovalRequest): string {
  if (request.scope === 'task') {
    return 'Approve task allows the remaining approval-scoped actions in this task.';
  }

  return 'Approve once only allows this single action.';
}

function buildBlockedSummary(task: AgentTaskRecord): string {
  if (task.blockerCode === 'approval-denied') {
    return 'Task is blocked because an approval was denied. Review the requested action before retrying.';
  }

  if (task.blockerCode === 'outside-workspace-request') {
    return 'Task is blocked because the requested action targets a location outside the active workspace boundary.';
  }

  if (task.blockerReason) {
    return task.blockerReason;
  }

  return 'Task is blocked until its current constraint is resolved.';
}

function buildArtifactGroups(
  task: AgentTaskRecord,
  diagnostics: AgentTaskDiagnostics | undefined,
): readonly ArtifactGroup[] {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const step of diagnostics?.planSteps ?? []) {
    if (step.status !== 'completed' || !step.proposedAction?.targetUris) {
      continue;
    }

    const label = labelForArtifactStep(step.kind);
    if (!label) {
      continue;
    }

    const bucket = groups.get(label) ?? [];
    for (const targetUri of step.proposedAction.targetUris) {
      const artifactRef = targetUri.fsPath?.trim();
      if (!artifactRef || seen.has(`${label}:${artifactRef}`)) {
        continue;
      }
      bucket.push(artifactRef);
      seen.add(`${label}:${artifactRef}`);
    }
    if (bucket.length > 0) {
      groups.set(label, bucket);
    }
  }

  if (groups.size === 0 && task.artifactRefs.length > 0) {
    groups.set('Recorded', [...task.artifactRefs]);
  }

  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function labelForArtifactStep(kind: import('../../../agent/agentTypes.js').AgentPlanStep['kind']): string | undefined {
  switch (kind) {
    case 'write':
      return 'Created or updated';
    case 'edit':
      return 'Changed';
    case 'delete':
      return 'Removed';
    case 'command':
      return 'Generated or modified';
    default:
      return undefined;
  }
}

function formatStatus(status: AgentTaskRecord['status']): string {
  if (status === 'awaiting-approval') {
    return 'Awaiting approval';
  }
  return status.replace(/-/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}