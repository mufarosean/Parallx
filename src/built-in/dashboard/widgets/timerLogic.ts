// timerLogic.ts — the interval timer's arithmetic, pure.
//
// Unit-tested in tests/unit/timerWidgetLogic.test.ts. The widget owns the
// DOM and the clock; this owns what the widget decides: which interval comes
// next, what the settings mean, when the tasks will be done, the streak, the
// day's totals. Domain-blind: a pomodoro is the 25/5/15 preset, nothing here
// knows about studying.

export type TimerMode = 'focus' | 'short' | 'long';
export type TimerAlarm = 'none' | 'bell' | 'digital';

export interface TimerConfig {
  readonly focusMinutes: number;
  readonly shortBreakMinutes: number;
  readonly longBreakMinutes: number;
  /** Long break after this many focus intervals. */
  readonly longBreakInterval: number;
  readonly autoStartBreaks: boolean;
  readonly autoStartFocus: boolean;
  readonly alarm: TimerAlarm;
  readonly alarmRepeat: number;
  /** 0..100 */
  readonly alarmVolume: number;
  readonly ticking: boolean;
  readonly label: string;
  readonly showTasks: boolean;
  /** Pull today's planner tasks and events into the task list. */
  readonly plannerSync: boolean;
  /** The report row: today's minutes, the streak, seven small bars. */
  readonly showReport: boolean;
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakInterval: 4,
  autoStartBreaks: false, autoStartFocus: false,
  alarm: 'bell', alarmRepeat: 1, alarmVolume: 50, ticking: false,
  label: 'Focus', showTasks: true, plannerSync: true, showReport: true,
};

function num(v: unknown, fallback: number, min: number, max: number, integer = true): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = Math.max(min, Math.min(max, n));
  return integer ? Math.round(c) : c;
}
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

/** Settings as saved, clamped; the old `minutes` field still means the focus length. */
export function readConfig(raw: unknown): TimerConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TIMER_CONFIG;
  const alarm = r.alarm === 'none' || r.alarm === 'digital' || r.alarm === 'bell' ? r.alarm : d.alarm;
  return {
    focusMinutes: num(r.focusMinutes ?? r.minutes, d.focusMinutes, 1, 240),
    shortBreakMinutes: num(r.shortBreakMinutes, d.shortBreakMinutes, 1, 120),
    longBreakMinutes: num(r.longBreakMinutes, d.longBreakMinutes, 1, 240),
    longBreakInterval: num(r.longBreakInterval, d.longBreakInterval, 1, 12),
    autoStartBreaks: bool(r.autoStartBreaks, d.autoStartBreaks),
    autoStartFocus: bool(r.autoStartFocus, d.autoStartFocus),
    alarm,
    alarmRepeat: num(r.alarmRepeat, d.alarmRepeat, 1, 10),
    alarmVolume: num(r.alarmVolume, d.alarmVolume, 0, 100),
    ticking: bool(r.ticking, d.ticking),
    label: (typeof r.label === 'string' && r.label.trim()) || d.label,
    showTasks: bool(r.showTasks, d.showTasks),
    plannerSync: bool(r.plannerSync, d.plannerSync),
    showReport: bool(r.showReport, d.showReport),
  };
}

export interface TimerTask {
  readonly id: string;
  title: string;
  /** Estimated intervals. */
  est: number;
  /** Intervals finished while this task was the active one. */
  act: number;
  done: boolean;
  readonly createdAt: number;
  /** Set when the task came from the planner: its id there, and what it was. */
  readonly sourceId?: string;
  readonly sourceKind?: 'task' | 'event';
  /** The user changed the estimate by hand; a sync leaves it alone. */
  estEdited?: boolean;
}
export interface TimerSession {
  readonly startedAt: number;
  readonly minutes: number;
  readonly label: string;
  readonly mode: TimerMode;
  readonly taskId?: string;
}
export interface TimerState {
  /** Completed intervals, newest last. Capped. */
  log: TimerSession[];
  mode: TimerMode;
  /** Absolute epoch-ms the running interval ends at; null when idle or paused. */
  endsAt: number | null;
  /** Remaining ms when paused; null when idle or running. */
  pausedRemaining: number | null;
  /** Focus intervals finished since the last long break. */
  cycle: number;
  tasks: TimerTask[];
  activeTaskId: string | null;
  /** Planner items removed from the list today; a sync does not bring them back. */
  ignoredSourceIds: string[];
  /** The day (yyyy-mm-dd) the ignore list and the last automatic sync belong to. */
  syncDay: string | null;
}

export const MAX_LOG = 500;
export const MAX_TASKS = 50;

export function parseState(cached: string | null): TimerState {
  const fresh: TimerState = { log: [], mode: 'focus', endsAt: null, pausedRemaining: null, cycle: 0, tasks: [], activeTaskId: null, ignoredSourceIds: [], syncDay: null };
  if (!cached) return fresh;
  try {
    const p = JSON.parse(cached) as Partial<TimerState>;
    const log = Array.isArray(p.log)
      ? p.log.filter((s) => s && typeof s.startedAt === 'number' && typeof s.minutes === 'number')
        .map((s) => ({ startedAt: s.startedAt, minutes: s.minutes, label: String(s.label ?? ''), mode: (s.mode === 'short' || s.mode === 'long' ? s.mode : 'focus') as TimerMode, taskId: typeof s.taskId === 'string' ? s.taskId : undefined }))
        .slice(-MAX_LOG)
      : [];
    const tasks = Array.isArray(p.tasks)
      ? p.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string')
        .map((t) => ({
          id: t.id, title: t.title, est: num(t.est, 1, 0, 99), act: num(t.act, 0, 0, 999), done: !!t.done, createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
          ...(typeof t.sourceId === 'string' ? { sourceId: t.sourceId, sourceKind: (t.sourceKind === 'event' ? 'event' : 'task') as 'task' | 'event' } : {}),
          ...(t.estEdited ? { estEdited: true } : {}),
        }))
        .slice(0, MAX_TASKS)
      : [];
    return {
      log,
      mode: p.mode === 'short' || p.mode === 'long' ? p.mode : 'focus',
      endsAt: typeof p.endsAt === 'number' ? p.endsAt : null,
      pausedRemaining: typeof p.pausedRemaining === 'number' ? p.pausedRemaining : null,
      cycle: num(p.cycle, 0, 0, 99),
      tasks,
      activeTaskId: typeof p.activeTaskId === 'string' && tasks.some((t) => t.id === p.activeTaskId) ? p.activeTaskId : null,
      ignoredSourceIds: Array.isArray(p.ignoredSourceIds) ? p.ignoredSourceIds.filter((s): s is string => typeof s === 'string').slice(0, 200) : [],
      syncDay: typeof p.syncDay === 'string' ? p.syncDay : null,
    };
  } catch { return fresh; }
}

// ── Planner link ──────────────────────────────────────────────────────────

export interface PlannerLinkItem {
  readonly id: string;
  readonly title: string;
  /** Planned length in minutes; null when the planner item has none (a task with a due date). */
  readonly minutes: number | null;
  readonly kind: 'task' | 'event';
}

/** A planned five-hour block at 25 minutes a round is twelve rounds; an unsized task is one. */
export function estFromMinutes(minutes: number | null, focusMinutes: number): number {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return 1;
  return Math.max(1, Math.min(99, Math.ceil(minutes / Math.max(1, focusMinutes))));
}

/**
 * Today's planner items folded into the task list. Linked tasks keep their
 * progress and take the planner's title; their estimate follows the planned
 * length unless the user edited it. New items are appended unless they were
 * removed from the list today. A linked planner task that is absent from
 * today's items is finished here only when `openTaskIds` (every task the
 * planner still lists as open, any day) says the planner no longer has it
 * open; one that merely fell outside today's window (overdue, rescheduled)
 * is left alone, and so is everything when the planner gave no answer
 * (null). Hand-made tasks are never touched.
 */
export function mergePlannerItems(tasks: readonly TimerTask[], items: readonly PlannerLinkItem[], focusMinutes: number, ignored: readonly string[], now: number, openTaskIds: ReadonlySet<string> | null = null): TimerTask[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: TimerTask[] = tasks.map((t) => {
    if (!t.sourceId) return t;
    const item = byId.get(t.sourceId);
    if (!item) {
      const finishedInPlanner = t.sourceKind === 'task' && !t.done && openTaskIds !== null && !openTaskIds.has(t.sourceId);
      return finishedInPlanner ? { ...t, done: true } : t;
    }
    return { ...t, title: item.title, est: t.estEdited ? t.est : estFromMinutes(item.minutes, focusMinutes) };
  });
  const have = new Set(tasks.map((t) => t.sourceId).filter((s): s is string => !!s));
  const skip = new Set(ignored);
  for (const item of items) {
    if (have.has(item.id) || skip.has(item.id)) continue;
    if (out.length >= MAX_TASKS) break;
    out.push({ id: `p-${item.id}`, title: item.title, est: estFromMinutes(item.minutes, focusMinutes), act: 0, done: false, createdAt: now, sourceId: item.id, sourceKind: item.kind });
  }
  return out;
}

export function minutesFor(mode: TimerMode, cfg: TimerConfig): number {
  return mode === 'focus' ? cfg.focusMinutes : mode === 'short' ? cfg.shortBreakMinutes : cfg.longBreakMinutes;
}

/**
 * What follows a finished interval. After a focus the cycle advances and
 * every `interval`th one earns the long break; after any break, focus.
 */
export function nextMode(mode: TimerMode, cycle: number, interval: number): { mode: TimerMode; cycle: number } {
  if (mode !== 'focus') return { mode: 'focus', cycle };
  const n = cycle + 1;
  return n >= Math.max(1, interval) ? { mode: 'long', cycle: 0 } : { mode: 'short', cycle: n };
}

export interface FinishEstimate { readonly at: number; readonly minutes: number; readonly intervals: number }

/**
 * When the open tasks will be done: the intervals still estimated, with the
 * breaks between them, from now. The current interval counts for what is
 * left of it. Null when nothing is estimated.
 */
export function finishEstimate(tasks: readonly TimerTask[], cfg: TimerConfig, mode: TimerMode, cycle: number, remainingCurrentMs: number, now: number): FinishEstimate | null {
  const intervals = tasks.filter((t) => !t.done).reduce((sum, t) => sum + Math.max(0, t.est - t.act), 0);
  if (intervals <= 0) return null;
  let total = Math.max(0, remainingCurrentMs);
  let c = cycle;
  let left = intervals;
  if (mode === 'focus') left -= 1; // the running (or waiting) focus is the first of them
  let m: TimerMode = mode;
  while (left > 0) {
    const nx = nextMode(m, c, cfg.longBreakInterval);
    m = nx.mode; c = nx.cycle;
    total += minutesFor(m, cfg) * 60_000;
    if (m === 'focus') left -= 1;
  }
  return { at: now + total, minutes: Math.round(total / 60_000), intervals };
}

export function dayKeyLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKeyLocal(new Date(y, m - 1, d + n).getTime());
}

/** Consecutive days with at least one focus interval, ending today or yesterday. */
export function dayStreak(log: readonly TimerSession[], now: number): number {
  const days = new Set(log.filter((s) => s.mode === 'focus').map((s) => dayKeyLocal(s.startedAt)));
  const today = dayKeyLocal(now);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (days.has(cursor)) { n++; cursor = shiftDay(cursor, -1); }
  return n;
}

export function todaySummary(log: readonly TimerSession[], now: number): { sessions: number; minutes: number } {
  const today = dayKeyLocal(now);
  let sessions = 0; let minutes = 0;
  for (const s of log) if (s.mode === 'focus' && dayKeyLocal(s.startedAt) === today) { sessions++; minutes += s.minutes; }
  return { sessions, minutes };
}

/** Focus minutes per day for the last `n` days, oldest first, today last. */
export function lastDays(log: readonly TimerSession[], now: number, n: number): { day: string; minutes: number }[] {
  const today = dayKeyLocal(now);
  const out: { day: string; minutes: number }[] = [];
  for (let i = n - 1; i >= 0; i--) out.push({ day: shiftDay(today, -i), minutes: 0 });
  const index = new Map(out.map((o, i) => [o.day, i]));
  for (const s of log) {
    if (s.mode !== 'focus') continue;
    const i = index.get(dayKeyLocal(s.startedAt));
    if (i !== undefined) out[i] = { day: out[i].day, minutes: out[i].minutes + s.minutes };
  }
  return out;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtTimeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = minutes / 60;
  return `${h.toFixed(h >= 10 ? 0 : 1)}h`;
}
