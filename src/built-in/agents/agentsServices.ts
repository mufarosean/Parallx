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
  IAutonomyTaskRailService,
} from '../../services/serviceTypes.js';
import type {
  IAgentApprovalService as IApprovals,
  IAgentExecutionService as IExecution,
  IAgentSessionService as ISessions,
} from '../../services/serviceTypes.js';
import type { IAutonomyTaskRailService as IRail, IRailRow } from '../../services/autonomyTaskRailService.js';
import { FLAG_PAUSED_GLOBAL, type AutonomyFeatureFlagsService } from '../../services/autonomyFeatureFlags.js';
import { ICronService, type CronService } from '../../openclaw/openclawCronService.js';
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
}

/** Subscribe to every source of change; returns one disposable. */
export function onAnyChange(listener: () => void): IDisposable {
  const subs: IDisposable[] = [];
  if (svc.sessions) subs.push(svc.sessions.onDidChangeTasks(() => listener()));
  if (svc.approvals) subs.push(svc.approvals.onDidChangeApprovalRequests(() => listener()));
  if (svc.flags) subs.push(svc.flags.onDidChange(() => listener()));
  if (svc.cron) subs.push(svc.cron.onDidChangeJobs(() => listener()));
  if (svc.rail) subs.push(svc.rail.onDidChange(() => listener()));
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

export function isPaused(): boolean {
  return svc.flags?.isEnabled(FLAG_PAUSED_GLOBAL) ?? false;
}

export async function setPaused(paused: boolean): Promise<void> {
  await svc.flags?.setEnabled(FLAG_PAUSED_GLOBAL, paused);
}

export async function readSnapshot(api: ParallxApi): Promise<IAgentsSnapshot> {
  resolveServices(api);
  const tasks = (svc.sessions?.listActiveWorkspaceTasks() ?? []).map((task) => ({
    task,
    steps: svc.sessions?.getPlanSteps(task.id) ?? [],
  }));
  let rows: readonly IRailRow[] = [];
  try { rows = (await svc.rail?.readRows({ sinceDays: 1, limit: 80 })) ?? []; } catch { /* history is optional */ }
  let heartbeat: IHeartbeatState | undefined;
  try { heartbeat = await api.commands.executeCommand<IHeartbeatState>('parallx.heartbeat.status'); } catch { /* no heartbeat */ }
  return buildAgentsSnapshot({
    paused: isPaused(),
    tasks,
    approvals: svc.approvals?.listPendingApprovalRequests() ?? [],
    jobs: svc.cron?.jobs ?? [],
    heartbeat: heartbeat && typeof heartbeat.nextDueMs === 'number' ? heartbeat : undefined,
    rows,
  });
}

