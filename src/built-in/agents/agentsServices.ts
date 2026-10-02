// agentsServices.ts — how the Agents built-in reaches the autonomy services.
//
// Shared by the view (main.ts) and the presence layer (agentsPresence.ts).
// The services can register after this built-in activates, so they are
// resolved again on every read; a found instance is never dropped.

import type { IDisposable } from '../../platform/lifecycle.js';
import {
  IAgentApprovalService,
  IAgentExecutionService,
  IAgentSessionService,
  IAutonomyFeatureFlagsService,
  IAutonomyLogService,
  IAutonomyPatternMemoryService,
  IAutonomyTaskRailService,
  IUnifiedAIConfigService,
} from '../../services/serviceTypes.js';
import type { AutonomyLogService } from '../../services/autonomyLogService.js';
import type { IAutonomyPatternMemoryService as IPatternMemory } from '../../services/autonomyPatternMemoryService.js';
import type { IUnifiedAIConfigService as IUnifiedConfig } from '../../aiSettings/unifiedConfigTypes.js';
import { IWorkflowService, type WorkflowService } from '../../services/workflows/workflowService.js';
import type {
  IAgentApprovalService as IApprovals,
  IAgentExecutionService as IExecution,
  IAgentSessionService as ISessions,
} from '../../services/serviceTypes.js';
import type { IAutonomyTaskRailService as IRail, IRailRow } from '../../services/autonomyTaskRailService.js';
import { FLAG_PAUSED_GLOBAL, type AutonomyFeatureFlagsService } from '../../services/autonomyFeatureFlags.js';
import { ICronService, type CronService, type ICronJob } from '../../openclaw/openclawCronService.js';
import type { IHeartbeatState } from '../../openclaw/openclawHeartbeatRunner.js';
import type { AgentApprovalResolution } from '../../agent/agentTypes.js';
import { buildAgentsSnapshot, type IAgentsSnapshot } from './agentsModel.js';

export interface ParallxApi {
  views: {
    registerViewProvider(
      viewId: string,
      provider: { createView(container: HTMLElement): IDisposable },
      options?: { name?: string; icon?: string },
    ): IDisposable;
    setBadge(containerId: string, badge: { count?: number; dot?: boolean } | undefined): void;
  };
  editors: {
    registerEditorProvider(
      typeId: string,
      provider: { createEditorPane(container: HTMLElement, input?: unknown): IDisposable },
    ): IDisposable;
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId: string }): Promise<unknown>;
  };
  commands: {
    registerCommand(commandId: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  services: {
    has(id: unknown): boolean;
    get<T>(id: unknown): T;
  };
  window: {
    showWarningMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
    createStatusBarItem(alignment?: number, priority?: number): {
      text: string;
      tooltip: string | undefined;
      command: string | undefined;
      name: string | undefined;
      htmlElement: HTMLElement | undefined;
      show(): void;
      hide(): void;
      dispose(): void;
    };
  };
}

export interface IAgentsServices {
  sessions?: ISessions;
  approvals?: IApprovals;
  execution?: IExecution;
  flags?: AutonomyFeatureFlagsService;
  cron?: CronService;
  rail?: IRail;
  log?: AutonomyLogService;
  workflows?: WorkflowService;
  patterns?: IPatternMemory;
  config?: IUnifiedConfig;
}

export const svc: IAgentsServices = {};

export function resolveServices(api: ParallxApi): void {
  const get = <T>(id: unknown): T | undefined => (api.services.has(id) ? api.services.get<T>(id) : undefined);
  svc.sessions ??= get<ISessions>(IAgentSessionService);
  svc.approvals ??= get<IApprovals>(IAgentApprovalService);
  svc.execution ??= get<IExecution>(IAgentExecutionService);
  svc.flags ??= get<AutonomyFeatureFlagsService>(IAutonomyFeatureFlagsService);
  svc.cron ??= get<CronService>(ICronService);
  svc.rail ??= get<IRail>(IAutonomyTaskRailService);
  svc.log ??= get<AutonomyLogService>(IAutonomyLogService);
  svc.workflows ??= get<WorkflowService>(IWorkflowService);
  svc.patterns ??= get<IPatternMemory>(IAutonomyPatternMemoryService);
  svc.config ??= get<IUnifiedConfig>(IUnifiedAIConfigService);
}

/** Subscribe to every source of change; returns one disposable. */
export function onAnyChange(listener: () => void): IDisposable {
  const subs: IDisposable[] = [];
  if (svc.sessions) subs.push(svc.sessions.onDidChangeTasks(() => listener()));
  if (svc.approvals) subs.push(svc.approvals.onDidChangeApprovalRequests(() => listener()));
  if (svc.flags) subs.push(svc.flags.onDidChange(() => listener()));
  if (svc.cron) subs.push(svc.cron.onDidChangeJobs(() => listener()));
  if (svc.rail) subs.push(svc.rail.onDidChange(() => listener()));
  if (svc.log) subs.push(svc.log.onDidChange(() => listener()));
  if (svc.workflows) subs.push(svc.workflows.onDidChangeWorkflows(() => listener()));
  if (svc.patterns) subs.push(svc.patterns.onDidChange(() => listener()));
  if (svc.config) subs.push(svc.config.onDidChangeConfig(() => listener()));
  return { dispose: () => { for (const d of subs) d.dispose(); } };
}

/** Answer an approval the way Chat's task cards do: resolve, then let the
 *  task run on when it was allowed (or went back to planning). */
export async function answerApproval(taskId: string, requestId: string, resolution: AgentApprovalResolution): Promise<void> {
  if (!svc.sessions) return;
  const task = await svc.sessions.resolveTaskApproval(taskId, requestId, resolution);
  if (resolution === 'approve-once' || resolution === 'approve-for-task' || task.status === 'planning') {
    await svc.execution?.runTask(taskId);
  }
}

/**
 * Whether a scheduled job is one the user made and a routine can express:
 * a recurring agent turn. Jobs extensions own (dotted ids such as
 * `flashcards.daily`), one-shots, self-deleting jobs and system events stay
 * on the internal scheduler. Test seam.
 */
export function isConvertibleJob(job: Pick<ICronJob, 'name' | 'schedule' | 'payload' | 'deleteAfterRun'>): boolean {
  if (!job.payload.agentTurn?.trim() || job.payload.systemEvent) return false;
  if (job.deleteAfterRun || job.schedule.at) return false;
  if (/^[\w-]+(\.[\w-]+)+$/.test(job.name)) return false;
  return true;
}

/**
 * One model for routines: a scheduled job the user made becomes a routine
 * (a workflow) and the job is removed in the same step, so it can never run
 * twice. Jobs already converted earlier (by Open As Workflow, which used to
 * leave the job running) lose their leftover job. Safe to call repeatedly.
 */
export function convertScheduledJobs(): number {
  const cron = svc.cron;
  const wf = svc.workflows;
  if (!cron || !wf) return 0;
  const converted = new Set(wf.workflows.map((w) => w.migratedFromCronId).filter((x): x is string => !!x));
  let n = 0;
  for (const job of [...cron.jobs]) {
    if (converted.has(job.id)) { cron.removeJob(job.id); n++; continue; }
    if (!isConvertibleJob(job)) continue;
    try {
      wf.migrateCronJob(job);
      cron.removeJob(job.id);
      n++;
    } catch (err) {
      console.warn('[Agents] could not convert a scheduled job:', job.name, err);
    }
  }
  return n;
}

export function isPaused(): boolean {
  return svc.flags?.isEnabled(FLAG_PAUSED_GLOBAL) ?? false;
}

export async function setPaused(paused: boolean): Promise<void> {
  await svc.flags?.setEnabled(FLAG_PAUSED_GLOBAL, paused);
}

/** Origin of a delivered result → the trigger kind History filters by. */
function originTrigger(origin: string): IRailRow['trigger'] {
  switch (origin) {
    case 'heartbeat': case 'cron': case 'subagent': case 'agent': case 'workflow': case 'followup':
      return origin as IRailRow['trigger'];
    default: return 'chat';
  }
}

/**
 * Background runs, newest first: the run records from the task rail when it
 * is running, and the delivered results straight from the log either way
 * (the rail is only built for a workspace with storage; the log is always
 * there). Dashboard refreshes count as routines.
 */
export async function readRunRows(opts: { sinceDays: number; limit: number; triggers?: readonly string[] }): Promise<readonly IRailRow[]> {
  const since = Date.now() - opts.sinceDays * 86_400_000;
  const live: IRailRow[] = (svc.log?.getEntries({ limit: opts.limit }) ?? [])
    .filter((e) => e.timestamp >= since)
    .map((e) => ({
      kind: 'live' as const,
      id: e.id,
      triggeredAt: new Date(e.timestamp).toISOString(),
      trigger: e.origin === 'dashboard' ? 'cron' : originTrigger(e.origin),
      content: e.content,
      requestText: e.requestText,
      read: e.read,
      liveEntry: e,
    }));
  let events: IRailRow[] = [];
  if (svc.rail) {
    try {
      events = (await svc.rail.readRows({ sinceDays: opts.sinceDays, limit: opts.limit })).filter((r) => r.kind === 'event') as IRailRow[];
    } catch { /* history files unreadable: results alone */ }
  }
  const all = [...live, ...events]
    .filter((r) => !opts.triggers || opts.triggers.includes(r.trigger))
    .sort((a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt));
  return all.slice(0, opts.limit);
}

export async function readSnapshot(api: ParallxApi): Promise<IAgentsSnapshot> {
  resolveServices(api);
  const tasks = (svc.sessions?.listActiveWorkspaceTasks() ?? []).map((task) => ({
    task,
    steps: svc.sessions?.getPlanSteps(task.id) ?? [],
  }));
  let rows: readonly IRailRow[] = [];
  try { rows = await readRunRows({ sinceDays: 1, limit: 80 }); } catch { /* history is optional */ }
  let heartbeat: IHeartbeatState | undefined;
  try { heartbeat = await api.commands.executeCommand<IHeartbeatState>('parallx.heartbeat.status'); } catch { /* no heartbeat */ }
  return buildAgentsSnapshot({
    paused: isPaused(),
    tasks,
    approvals: svc.approvals?.listPendingApprovalRequests() ?? [],
    jobs: svc.cron?.jobs ?? [],
    heartbeat: heartbeat && typeof heartbeat.nextDueMs === 'number' ? heartbeat : undefined,
    rows,
    workflows: (svc.workflows?.workflows ?? [])
      .filter((w) => w.enabled && w.source !== 'suggested')
      .map((w) => ({ id: w.id, name: w.name, nextRunAt: svc.workflows!.nextRunAt(w.id), what: w.description ?? '' })),
  });
}

