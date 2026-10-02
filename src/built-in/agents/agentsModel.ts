// agentsModel.ts — what the Agents view shows, from the autonomy services.
//
// Pure: takes plain snapshots of tasks, approvals, scheduled jobs, the
// heartbeat and the run history, and returns the four sections the view
// draws (Needs you, Running now, Coming up, Done today). Kept apart from the
// DOM so the wording and ordering are testable.

import type { AgentApprovalRequest, AgentPlanStep, AgentTaskRecord, AgentTaskStatus } from '../../agent/agentTypes.js';
import type { ICronJob } from '../../openclaw/openclawCronService.js';
import type { IRailRow } from '../../services/autonomyTaskRailService.js';

export interface IAgentsInputs {
  readonly paused: boolean;
  readonly tasks: readonly { readonly task: AgentTaskRecord; readonly steps: readonly AgentPlanStep[] }[];
  readonly approvals: readonly AgentApprovalRequest[];
  readonly jobs: readonly ICronJob[];
  readonly heartbeat?: { readonly enabled: boolean; readonly nextDueMs: number; readonly intervalMs: number };
  readonly rows: readonly IRailRow[];
  /** Enabled workflows and their next run (Routines that are not cron jobs). */
  readonly workflows?: readonly { readonly id: string; readonly name: string; readonly nextRunAt: number | null; readonly what: string }[];
}

export interface INeedsYouItem {
  readonly taskId: string;
  readonly requestId: string;
  readonly who: string;
  readonly what: string;
  readonly detail: string;
}

export interface IRunningItem {
  readonly taskId: string;
  readonly name: string;
  readonly step: string;
  readonly done: number;
  readonly total: number;
  readonly state: 'working' | 'waiting' | 'paused';
  /** What the one action button does. */
  readonly action: 'pause' | 'continue' | null;
}

export interface IUpcomingItem {
  readonly at: number;
  readonly when: string;
  readonly name: string;
  readonly what: string;
}

export interface IDoneItem {
  readonly at: number;
  readonly when: string;
  readonly name: string;
  readonly what: string;
  readonly result: 'ok' | 'failed' | 'stopped';
}

export interface IAgentsSnapshot {
  readonly paused: boolean;
  readonly needsYou: readonly INeedsYouItem[];
  readonly running: readonly IRunningItem[];
  readonly upcoming: readonly IUpcomingItem[];
  readonly done: readonly IDoneItem[];
}

const ACTIVE: ReadonlySet<AgentTaskStatus> = new Set(['pending', 'planning', 'awaiting-approval', 'running', 'blocked', 'paused']);

export function shorten(text: string, max = 64): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** First sentence-ish line of a goal or prompt, as a name. */
export function nameFrom(text: string, fallback: string): string {
  const first = text.split(/\n|(?<=[.!?])\s/)[0] ?? '';
  const s = shorten(first, 48).replace(/[.!?;:,]+$/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : fallback;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a); const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "in 5 min", "18:00", "Tomorrow 07:30", "Mon 09:00". */
export function formatWhen(at: number, now: number): string {
  const diff = at - now;
  if (diff < 60_000) return 'Now';
  if (diff < 60 * 60_000) return `in ${Math.round(diff / 60_000)} min`;
  if (sameDay(at, now)) return hhmm(at);
  if (sameDay(at, now + 86_400_000)) return `Tomorrow ${hhmm(at)}`;
  return `${new Date(at).toLocaleDateString(undefined, { weekday: 'short' })} ${hhmm(at)}`;
}

function every(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `every ${min} min`;
  const h = Math.round(min / 60);
  return h === 1 ? 'every hour' : `every ${h} hours`;
}

export function buildAgentsSnapshot(input: IAgentsInputs, now: number = Date.now()): IAgentsSnapshot {
  const taskById = new Map(input.tasks.map((t) => [t.task.id, t.task]));

  const needsYou: INeedsYouItem[] = input.approvals
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((a) => {
      const targets = a.affectedTargets;
      const detail = targets.length === 0 ? ''
        : targets.length <= 2 ? targets.join(', ')
          : `${targets.slice(0, 2).join(', ')} and ${targets.length - 2} more`;
      return {
        taskId: a.taskId,
        requestId: a.id,
        who: nameFrom(taskById.get(a.taskId)?.goal ?? '', 'An agent'),
        what: shorten(a.summary || a.explanation || a.toolName, 120),
        detail,
      };
    });

  const running: IRunningItem[] = input.tasks
    .filter(({ task }) => ACTIVE.has(task.status))
    .sort((a, b) => b.task.updatedAt.localeCompare(a.task.updatedAt))
    .map(({ task, steps }) => {
      const current = steps.find((s) => s.id === task.currentStepId)
        ?? steps.find((s) => s.status === 'running')
        ?? steps.find((s) => s.status === 'pending');
      const done = steps.filter((s) => s.status === 'completed').length;
      const paused = task.status === 'paused' || task.status === 'blocked';
      const waiting = task.status === 'awaiting-approval';
      const step = paused
        ? (task.blockerReason ? shorten(task.blockerReason, 90) : 'Paused')
        : waiting ? 'Waiting for your OK'
          : task.status === 'planning' || task.status === 'pending' ? 'Planning'
            : current ? shorten(current.title, 90) : 'Working';
      return {
        taskId: task.id,
        name: nameFrom(task.goal, 'Task'),
        step: task.stopAfterCurrentStep && !paused ? `${step} (pausing after this step)` : step,
        done,
        total: steps.length,
        state: paused ? 'paused' : waiting ? 'waiting' : 'working',
        action: paused ? 'continue' : waiting || task.stopAfterCurrentStep ? null : 'pause',
      };
    });

  const upcoming: IUpcomingItem[] = [];
  for (const job of input.jobs) {
    if (!job.enabled || job.nextRunAt === null || job.nextRunAt < now - 60_000) continue;
    upcoming.push({
      at: job.nextRunAt,
      when: formatWhen(job.nextRunAt, now),
      name: job.name,
      what: shorten(job.description || job.payload.agentTurn || '', 80),
    });
  }
  if (input.heartbeat?.enabled && input.heartbeat.nextDueMs > 0) {
    upcoming.push({
      at: input.heartbeat.nextDueMs,
      when: formatWhen(input.heartbeat.nextDueMs, now),
      name: 'Heartbeat',
      what: `Looks over what changed, ${every(input.heartbeat.intervalMs)}`,
    });
  }
  for (const wf of input.workflows ?? []) {
    if (wf.nextRunAt === null || wf.nextRunAt < now - 60_000) continue;
    upcoming.push({ at: wf.nextRunAt, when: formatWhen(wf.nextRunAt, now), name: wf.name, what: shorten(wf.what, 80) });
  }
  upcoming.sort((a, b) => a.at - b.at);

  // Done today: one row per run. The history keeps both the delivered result
  // (live) and the structured event for many runs; the live row wins.
  const jobName = new Map<string, string>([
    ...input.jobs.map((j) => [j.id, j.name] as [string, string]),
    ...(input.workflows ?? []).map((w) => [w.id, w.name] as [string, string]),
  ]);
  const done: IDoneItem[] = [];
  const liveAt: { at: number; trigger: string }[] = [];
  for (const row of input.rows) {
    const at = Date.parse(row.triggeredAt);
    if (!Number.isFinite(at) || !sameDay(at, now)) continue;
    if (row.kind === 'live') {
      liveAt.push({ at, trigger: row.trigger });
      const metaName = row.liveEntry.metadata?.['jobName'];
      done.push({
        at,
        when: hhmm(at),
        name: typeof metaName === 'string' && metaName ? metaName : labelForTrigger(row.trigger),
        what: (() => {
          const w = shorten(row.requestText || row.content, 70);
          const n = typeof metaName === 'string' && metaName ? metaName : labelForTrigger(row.trigger);
          return w === n ? shorten(row.content, 70) : w;
        })(),
        result: row.liveEntry.metadata?.['error'] === true || row.outcome === 'error' ? 'failed'
          : row.outcome === 'cancelled' || row.outcome === 'budget' || row.outcome === 'gated' ? 'stopped' : 'ok',
      });
    }
  }
  for (const row of input.rows) {
    if (row.kind !== 'event') continue;
    const at = Date.parse(row.triggeredAt);
    if (!Number.isFinite(at) || !sameDay(at, now)) continue;
    if (row.trigger === 'chat') continue; // ordinary chat turns are not agent work
    if (liveAt.some((l) => l.trigger === row.trigger && Math.abs(l.at - at) < 120_000)) continue;
    const ref = row.record.trigger.ref;
    done.push({
      at,
      when: hhmm(at),
      name: (ref && jobName.get(ref)) || labelForTrigger(row.trigger),
      what: row.outcome === 'completed' ? 'Finished'
        : row.outcome === 'error' ? 'Ran into an error'
          : row.outcome === 'budget' ? 'Stopped at its budget'
            : row.outcome === 'gated' ? 'Held back by a setting' : 'Stopped',
      result: row.outcome === 'completed' ? 'ok' : row.outcome === 'error' ? 'failed' : 'stopped',
    });
  }
  done.sort((a, b) => b.at - a.at);

  return { paused: input.paused, needsYou, running, upcoming: upcoming.slice(0, 6), done: done.slice(0, 8) };
}

export function labelForTrigger(trigger: string): string {
  switch (trigger) {
    case 'cron': return 'Routine';
    case 'heartbeat': return 'Heartbeat';
    case 'subagent': return 'Helper agent';
    case 'followup': return 'Follow-up';
    case 'file-change': return 'File watch';
    case 'workflow': return 'Workflow';
    case 'replay': return 'Replay';
    default: return 'Agent';
  }
}
