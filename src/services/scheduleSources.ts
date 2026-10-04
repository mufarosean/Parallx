// scheduleSources.ts — tools that keep the user's schedule, for the core to read
//
// The heartbeat (overdue follow-ups, the morning digest, sync alerts) and
// workflow facts read the user's schedule. They know no schedule tool: a
// tool that keeps events and tasks (the Planner) registers a source here
// while it runs, and they read whatever sources are registered. Turned off,
// the source goes and those facts with it: nothing is asked of a tool that
// is not running.
//
// Module-global hub (registrations survive activation order), fed by the
// tool's activation and disposed with its subscriptions.

import { Emitter, type Event } from '../platform/events.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';

/** An open task, lightweight. */
export interface ScheduleOpenTask {
  readonly title: string;
  readonly dueAt: number | null;
}

/** A task's facts, for the heartbeat's deterministic checks. */
export interface ScheduleTaskFact {
  readonly id: string;
  readonly title: string;
  /** 'reviewing' (captured, awaiting triage) or 'planned'. */
  readonly status: string;
  readonly dueAt: number | null;
  readonly createdAt: number;
}

/** Today's shape (local day). */
export interface ScheduleToday {
  readonly events: number;
  readonly tasksDue: number;
  /** Where to look for the full picture, in the source's own words. */
  readonly hint?: string;
}

/** Calendar sync health. */
export interface ScheduleSyncHealth {
  readonly failed: boolean;
  /** What failed, in the source's own words (may name the source). */
  readonly detail: string | null;
}

export interface ScheduleSource {
  /** Stable id (the registering tool's). */
  readonly id: string;
  /** The tool's name as the user knows it ("Planner"). */
  readonly name: string;
  /** Open tasks (not done or cancelled). */
  listOpenTasks(): Promise<readonly ScheduleOpenTask[]>;
  /** Open tasks with the facts the heartbeat's checks need. */
  listTaskFacts?(): Promise<readonly ScheduleTaskFact[]>;
  /** Today's events and tasks due (local day). */
  getToday?(): Promise<ScheduleToday | null>;
  /** Sync health; null when sync is not set up or never ran. */
  getSyncHealth?(): Promise<ScheduleSyncHealth | null>;
  /**
   * File a follow-up for the user to review. `sourceKey` identifies the
   * finding: when an open follow-up with the same key exists, nothing is
   * created and false is returned.
   */
  captureFollowUp?(input: { title: string; description?: string; sourceKey: string }): Promise<boolean>;
}

const _sources = new Map<string, ScheduleSource>();
const _onDidChange = new Emitter<void>();
export const onDidChangeScheduleSources: Event<void> = _onDidChange.event;

export function registerScheduleSource(source: ScheduleSource): IDisposable {
  _sources.set(source.id, source);
  _onDidChange.fire();
  return toDisposable(() => {
    if (_sources.get(source.id) === source) { _sources.delete(source.id); _onDidChange.fire(); }
  });
}

export function getScheduleSources(): readonly ScheduleSource[] {
  return [..._sources.values()];
}

// ── Readers: every registered source, combined; a failing source is skipped ──

async function settle<T>(p: Promise<T> | undefined, fallback: T): Promise<T> {
  if (!p) return fallback;
  try { return await p; } catch { return fallback; }
}

/** Every source's open tasks. */
export async function listScheduleOpenTasks(): Promise<ScheduleOpenTask[]> {
  const lists = await Promise.all(getScheduleSources().map((s) => settle(s.listOpenTasks(), [] as readonly ScheduleOpenTask[])));
  return lists.flat();
}

/** Every source's task facts. */
export async function listScheduleTaskFacts(): Promise<ScheduleTaskFact[]> {
  const lists = await Promise.all(getScheduleSources().map((s) => settle(s.listTaskFacts?.(), [] as readonly ScheduleTaskFact[])));
  return lists.flat();
}

/** Today across sources (summed); null when no source answers. */
export async function getScheduleToday(): Promise<ScheduleToday | null> {
  const days = (await Promise.all(getScheduleSources().map((s) => settle(s.getToday?.(), null))))
    .filter((d): d is ScheduleToday => d != null);
  if (days.length === 0) return null;
  const hint = days.length === 1 ? days[0].hint : undefined;
  return {
    events: days.reduce((n, d) => n + d.events, 0),
    tasksDue: days.reduce((n, d) => n + d.tasksDue, 0),
    ...(hint ? { hint } : {}),
  };
}

/** Sync health across sources; null when no source syncs. */
export async function getScheduleSyncHealth(): Promise<ScheduleSyncHealth | null> {
  const all = (await Promise.all(getScheduleSources().map((s) => settle(s.getSyncHealth?.(), null))))
    .filter((h): h is ScheduleSyncHealth => h != null);
  if (all.length === 0) return null;
  const failing = all.filter((h) => h.failed);
  if (failing.length === 0) return { failed: false, detail: null };
  const details = failing.map((h) => h.detail?.trim()).filter((d): d is string => !!d);
  return { failed: true, detail: details.length ? details.join('; ') : null };
}

/**
 * File a follow-up with the first source that takes them. Resolves to the
 * source that took it (and whether it was new), or undefined when none does.
 */
export async function captureScheduleFollowUp(
  input: { title: string; description?: string; sourceKey: string },
): Promise<{ created: boolean; source: ScheduleSource } | undefined> {
  const source = getScheduleSources().find((s) => typeof s.captureFollowUp === 'function');
  if (!source) return undefined;
  const created = await settle(source.captureFollowUp!(input), false);
  return { created, source };
}
