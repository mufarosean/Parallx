/**
 * Cron & Scheduling Service — D4: Time-Triggered Autonomy.
 *
 * Upstream evidence:
 *   - cron-tool.ts:1-541 — tool actions: status, list, add, update, remove, run, runs, wake
 *   - cron/service.ts — CronService: job persistence, timer scheduling, missed-job catchup
 *   - Job schema: name, schedule (at/every/cron), payload, delivery, sessionTarget, contextMessages
 *   - Wake modes: "now" (immediate), "next-heartbeat" (piggyback on heartbeat runner)
 *   - buildReminderContextLines() — fetches chat history for context injection
 *   - Startup catchup: runMissedJobs
 *
 * Parallx adaptation:
 *   - Single session target: current chat session (no multi-session routing)
 *   - Jobs stored in memory (SQLite integration deferred to integration phase)
 *   - Timer service checks job schedule, fires agent turns
 *   - Agent can create/manage its own reminders via cron tool
 *   - No webhook/announce delivery — all output goes to chat
 *   - Context injection: pull last N messages from session history
 *   - Wake mode "next-heartbeat" delegates to HeartbeatRunner.wake()
 */

import type { IDisposable } from '../platform/lifecycle.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of context messages a cron job can inject. */
export const MAX_CONTEXT_MESSAGES = 10;

/** Maximum number of concurrent cron jobs. */
export const MAX_CRON_JOBS = 50;

/** Default check interval for the cron timer (60 seconds). */
export const CRON_CHECK_INTERVAL_MS = 60 * 1000;

/** Minimum "every" interval to prevent runaway timers (1 minute). */
export const MIN_EVERY_INTERVAL_MS = 60 * 1000;

/** Maximum number of run-history entries (oldest trimmed when exceeded). */
export const MAX_RUN_HISTORY = 200;

// ---------------------------------------------------------------------------
// Types (from upstream cron-tool.ts job schema)
// ---------------------------------------------------------------------------

/**
 * Schedule specification for a cron job.
 * Upstream: schedule: { at?: string; every?: string; cron?: string }
 *
 * Exactly one of `at`, `every`, or `cron` must be set.
 */
export interface ICronSchedule {
  /** ISO-8601 datetime for a one-shot job. */
  readonly at?: string;
  /** Duration string for repeating jobs (e.g. "5m", "1h", "30s"). */
  readonly every?: string;
  /** Standard cron expression (5-field). */
  readonly cron?: string;
}

/**
 * Payload that the cron job delivers when it fires.
 * Upstream: payload: { systemEvent?: object; agentTurn?: string }
 */
export interface ICronPayload {
  /** System event to push to the heartbeat runner. */
  readonly systemEvent?: Record<string, unknown>;
  /** Message to inject as an agent turn. */
  readonly agentTurn?: string;
}

/**
 * Wake mode for cron job execution.
 * Upstream: "now" (immediate) | "next-heartbeat" (piggyback).
 */
export type CronWakeMode = 'now' | 'next-heartbeat';

/**
 * A cron job definition.
 * Upstream: cron-tool.ts job schema.
 */
export interface ICronJob {
  readonly id: string;
  readonly name: string;
  readonly schedule: ICronSchedule;
  readonly payload: ICronPayload;
  readonly wakeMode: CronWakeMode;
  /** Number of recent chat messages to inject as context (0-10). */
  readonly contextMessages: number;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly lastRunAt: number | null;
  readonly nextRunAt: number | null;
  readonly runCount: number;
  /** Human-readable job description. Upstream: CronJobBase.description */
  readonly description?: string;
  /** Auto-remove after successful execution. Upstream: CronJobBase.deleteAfterRun */
  readonly deleteAfterRun?: boolean;
  /** Timestamp of last update. Upstream: CronJobBase.updatedAtMs */
  readonly updatedAt?: number;
}

/**
 * Parameters for creating a cron job.
 */
export interface ICronJobCreateParams {
  readonly name: string;
  readonly schedule: ICronSchedule;
  readonly payload: ICronPayload;
  readonly wakeMode?: CronWakeMode;
  readonly contextMessages?: number;
  readonly enabled?: boolean;
  readonly description?: string;
  readonly deleteAfterRun?: boolean;
}

/**
 * Parameters for updating a cron job.
 */
export interface ICronJobUpdateParams {
  readonly name?: string;
  readonly schedule?: ICronSchedule;
  readonly payload?: ICronPayload;
  readonly wakeMode?: CronWakeMode;
  readonly contextMessages?: number;
  readonly enabled?: boolean;
  readonly description?: string;
  readonly deleteAfterRun?: boolean;
}

/**
 * Result of a cron job execution.
 */
export interface ICronRunResult {
  readonly jobId: string;
  readonly jobName: string;
  readonly firedAt: number;
  readonly wakeMode: CronWakeMode;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Delegate that executes a cron-triggered agent turn.
 */
export type CronTurnExecutor = (
  job: ICronJob,
  contextLines: readonly string[],
) => Promise<void>;

/**
 * Delegate that fetches recent chat messages for context injection.
 * Upstream: buildReminderContextLines().
 */
export type ContextLineFetcher = (count: number) => Promise<readonly string[]>;

/**
 * Delegate to wake the heartbeat runner (for "next-heartbeat" mode).
 */
export type HeartbeatWaker = (reason: 'cron') => void;

// ---------------------------------------------------------------------------
// Cron Service
// ---------------------------------------------------------------------------

/**
 * Manages cron jobs — scheduling, execution, and lifecycle.
 *
 * Upstream: CronService + cron-tool.ts actions.
 * Actions: add, update, remove, list, run, runs, wake, status.
 *
 * Parallx adaptation:
 *   - In-memory job store (SQLite persistence deferred)
 *   - Single timer checks all jobs each interval
 *   - "next-heartbeat" mode delegates to HeartbeatRunner.wake('cron')
 *   - "now" mode directly executes the turn via CronTurnExecutor
 */
export class CronService implements IDisposable {
  private readonly _jobs = new Map<string, ICronJob>();
  private readonly _runHistory: ICronRunResult[] = [];
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _disposed = false;
  private _nextJobId = 1;

  constructor(
    private readonly _executor: CronTurnExecutor,
    private readonly _contextFetcher: ContextLineFetcher,
    private readonly _heartbeatWaker: HeartbeatWaker | null,
  ) {}

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** All registered jobs (snapshots). */
  get jobs(): readonly ICronJob[] {
    return [...this._jobs.values()];
  }

  /** Number of registered jobs. */
  get jobCount(): number {
    return this._jobs.size;
  }

  /** Recent run history. */
  get runHistory(): readonly ICronRunResult[] {
    return [...this._runHistory];
  }

  /** Whether the cron timer is running. */
  get isRunning(): boolean {
    return this._timer !== null;
  }

  /**
   * Run history filtered to a single job.
   * Upstream: cron-tool.ts "runs" action returns per-job history.
   */
  getJobRuns(jobId: string): readonly ICronRunResult[] {
    return this._runHistory.filter(r => r.jobId === jobId);
  }

  /**
   * Service status summary.
   * Upstream: cron-tool.ts "status" action.
   */
  status(): { jobCount: number; runningJobs: number; timerActive: boolean; totalRuns: number } {
    let runningJobs = 0;
    for (const job of this._jobs.values()) {
      if (job.enabled && job.nextRunAt !== null) runningJobs++;
    }
    return {
      jobCount: this._jobs.size,
      runningJobs,
      timerActive: this._timer !== null,
      totalRuns: this._runHistory.length,
    };
  }

  // -----------------------------------------------------------------------
  // Job CRUD — upstream: cron-tool.ts actions add/update/remove/list
  // -----------------------------------------------------------------------

  /**
   * Add a new cron job.
   * Upstream: cron-tool.ts "add" action.
   */
  addJob(params: ICronJobCreateParams): ICronJob {
    if (this._disposed) throw new Error('CronService is disposed');
    if (this._jobs.size >= MAX_CRON_JOBS) {
      throw new Error(`Maximum cron job limit reached (${MAX_CRON_JOBS})`);
    }
    validateSchedule(params.schedule);

    const id = `cron-${this._nextJobId++}`;
    const now = Date.now();
    const contextMessages = clampContextMessages(params.contextMessages ?? 0);

    const job: ICronJob = {
      id,
      name: params.name,
      schedule: { ...params.schedule },
      payload: { ...params.payload },
      wakeMode: params.wakeMode ?? 'now',
      contextMessages,
      enabled: params.enabled ?? true,
      createdAt: now,
      lastRunAt: null,
      nextRunAt: computeNextRun(params.schedule, now),
      runCount: 0,
      description: params.description,
      deleteAfterRun: params.deleteAfterRun,
      updatedAt: now,
    };

    this._jobs.set(id, job);
    return { ...job };
  }

  /**
   * Update an existing cron job.
   * Upstream: cron-tool.ts "update" action.
   */
  updateJob(id: string, params: ICronJobUpdateParams): ICronJob {
    if (this._disposed) throw new Error('CronService is disposed');
    const existing = this._jobs.get(id);
    if (!existing) throw new Error(`Cron job not found: ${id}`);

    if (params.schedule) validateSchedule(params.schedule);

    const updated: ICronJob = {
      ...existing,
      name: params.name ?? existing.name,
      schedule: params.schedule ? { ...params.schedule } : existing.schedule,
      payload: params.payload ? { ...params.payload } : existing.payload,
      wakeMode: params.wakeMode ?? existing.wakeMode,
      contextMessages: params.contextMessages !== undefined
        ? clampContextMessages(params.contextMessages)
        : existing.contextMessages,
      enabled: params.enabled ?? existing.enabled,
      nextRunAt: params.schedule
        ? computeNextRun(params.schedule, Date.now())
        : existing.nextRunAt,
      description: params.description !== undefined ? params.description : existing.description,
      deleteAfterRun: params.deleteAfterRun !== undefined ? params.deleteAfterRun : existing.deleteAfterRun,
      updatedAt: Date.now(),
    };

    this._jobs.set(id, updated);
    return { ...updated };
  }

  /**
   * Remove a cron job.
   * Upstream: cron-tool.ts "remove" action.
   */
  removeJob(id: string): boolean {
    return this._jobs.delete(id);
  }

  /**
   * Get a cron job by ID.
   */
  getJob(id: string): ICronJob | undefined {
    const job = this._jobs.get(id);
    return job ? { ...job } : undefined;
  }

  // -----------------------------------------------------------------------
  // Execution — upstream: cron-tool.ts "run" action + CronService timer
  // -----------------------------------------------------------------------

  /**
   * Start the cron check timer.
   * Upstream: CronService starts timer on initialization.
   */
  start(): void {
    if (this._disposed || this._timer) return;

    // Run missed jobs on startup — upstream: runMissedJobs
    this._runMissedJobs();

    this._timer = setInterval(() => {
      this._checkDueJobs();
    }, CRON_CHECK_INTERVAL_MS);
  }

  /**
   * Stop the cron check timer.
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Manually run a specific job.
   * Upstream: cron-tool.ts "run" action.
   */
  async runJob(id: string): Promise<ICronRunResult> {
    if (this._disposed) throw new Error('CronService is disposed');
    const job = this._jobs.get(id);
    if (!job) throw new Error(`Cron job not found: ${id}`);
    return this._executeJob(job);
  }

  /**
   * Wake — trigger immediate check for due jobs.
   * Upstream: cron-tool.ts "wake" action.
   */
  async wake(): Promise<void> {
    if (this._disposed) return;
    await this._checkDueJobs();
  }

  // -----------------------------------------------------------------------
  // Internal — timer-driven job checking
  // -----------------------------------------------------------------------

  /**
   * Check all jobs and run those that are due.
   * Called by the timer interval and by wake().
   */
  private async _checkDueJobs(): Promise<void> {
    const now = Date.now();
    const dueJobs: ICronJob[] = [];

    for (const job of this._jobs.values()) {
      if (!job.enabled) continue;
      if (job.nextRunAt !== null && job.nextRunAt <= now) {
        dueJobs.push(job);
      }
    }

    for (const job of dueJobs) {
      await this._executeJob(job);
    }
  }

  /**
   * Run missed jobs on startup.
   * Upstream: CronService.runMissedJobs — catches up on jobs
   * whose nextRunAt has passed while the service was stopped.
   */
  private _runMissedJobs(): void {
    const now = Date.now();
    for (const job of this._jobs.values()) {
      if (!job.enabled) continue;
      if (job.nextRunAt !== null && job.nextRunAt <= now) {
        // Fire and forget — missed job catchup
        this._executeJob(job).catch(err => {
          console.error(`[CronService] Missed job catchup failed for ${job.name}:`, err);
        });
      }
    }
  }

  /**
   * Execute a single cron job.
   * Upstream: CronService executes via agent turn or system event.
   */
  private async _executeJob(job: ICronJob): Promise<ICronRunResult> {
    const now = Date.now();

    try {
      // Handle wake mode
      if (job.wakeMode === 'next-heartbeat' && this._heartbeatWaker) {
        // Upstream: "next-heartbeat" piggybacks on next heartbeat
        this._heartbeatWaker('cron');
      }

      // Fetch context lines — upstream: buildReminderContextLines()
      const contextLines = job.contextMessages > 0
        ? await this._contextFetcher(job.contextMessages)
        : [];

      // Execute the turn
      await this._executor(job, contextLines);

      // Update job state
      const updated: ICronJob = {
        ...job,
        lastRunAt: now,
        nextRunAt: computeNextRun(job.schedule, now),
        runCount: job.runCount + 1,
      };
      this._jobs.set(job.id, updated);

      const result: ICronRunResult = {
        jobId: job.id,
        jobName: job.name,
        firedAt: now,
        wakeMode: job.wakeMode,
        success: true,
      };
      this._runHistory.push(result);
      this._trimRunHistory();

      // Upstream: deleteAfterRun — auto-remove after successful one-shot
      if (job.deleteAfterRun) {
        this._jobs.delete(job.id);
      }

      return result;

    } catch (err) {
      const result: ICronRunResult = {
        jobId: job.id,
        jobName: job.name,
        firedAt: now,
        wakeMode: job.wakeMode,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this._runHistory.push(result);
      this._trimRunHistory();
      return result;
    }
  }

  /**
   * Trim run history to MAX_RUN_HISTORY, dropping oldest entries.
   */
  private _trimRunHistory(): void {
    if (this._runHistory.length > MAX_RUN_HISTORY) {
      this._runHistory.splice(0, this._runHistory.length - MAX_RUN_HISTORY);
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    this._disposed = true;
    this.stop();
    this._jobs.clear();
    this._runHistory.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a schedule has exactly one of at/every/cron.
 * Upstream: cron-tool.ts validates schedule on add/update.
 */
function validateSchedule(schedule: ICronSchedule): void {
  const fields = [schedule.at, schedule.every, schedule.cron].filter(Boolean);
  if (fields.length !== 1) {
    throw new Error('Schedule must specify exactly one of: at, every, cron');
  }

  if (schedule.every) {
    const ms = parseDuration(schedule.every);
    if (ms < MIN_EVERY_INTERVAL_MS) {
      throw new Error(`"every" interval must be at least ${MIN_EVERY_INTERVAL_MS}ms (got ${ms}ms)`);
    }
  }

  if (schedule.at) {
    const ts = Date.parse(schedule.at);
    if (isNaN(ts)) {
      throw new Error(`Invalid "at" datetime: ${schedule.at}`);
    }
  }

  if (schedule.cron) {
    // Validate by attempting to parse all 5 fields
    const parts = schedule.cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression (expected 5 fields): ${schedule.cron}`);
    }
    const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
    for (let i = 0; i < 5; i++) {
      try {
        parseCronField(parts[i], ranges[i][0], ranges[i][1]);
      } catch {
        throw new Error(`Invalid cron expression: ${schedule.cron}`);
      }
    }
  }
}

/**
 * Compute the next run time for a schedule.
 */
function computeNextRun(schedule: ICronSchedule, fromMs: number): number | null {
  if (schedule.at) {
    const target = Date.parse(schedule.at);
    // One-shot: if already past, return null (will not fire again)
    return target > fromMs ? target : null;
  }

  if (schedule.every) {
    const intervalMs = parseDuration(schedule.every);
    return fromMs + intervalMs;
  }

  if (schedule.cron) {
    return computeNextCronRun(schedule.cron, fromMs);
  }

  return null;
}

/**
 * Parse a duration string like "5m", "1h", "30s" to milliseconds.
 * Upstream: cron-tool.ts accepts duration strings in "every" field.
 */
export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(`Invalid duration: "${input}". Expected format: "5m", "1h", "30s", "500ms", "1d"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1_000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    case 'd': return value * 86_400_000;
    default: throw new Error(`Unknown duration unit: "${unit}"`);
  }
}

function clampContextMessages(n: number): number {
  return Math.max(0, Math.min(MAX_CONTEXT_MESSAGES, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// Minimal 5-field cron parser
// Upstream ref: src/cron/schedule.ts — computeNextRunAtMs()
// Supports: numbers, *, ranges (1-5), steps (*/5), lists (1,3,5)
// ---------------------------------------------------------------------------

/**
 * Parse a single cron field into an array of matching values.
 * Handles: *, N, N-M, star/N, N-M/S, and comma-separated lists.
 */
export function parseCronField(field: string, min: number, max: number): number[] {
  const result = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`Empty cron field segment`);

    // Check for step: "*/5" or "1-10/2"
    const slashIdx = trimmed.indexOf('/');
    let rangePart = trimmed;
    let step = 1;

    if (slashIdx !== -1) {
      rangePart = trimmed.slice(0, slashIdx);
      step = parseInt(trimmed.slice(slashIdx + 1), 10);
      if (isNaN(step) || step < 1) throw new Error(`Invalid step: ${trimmed}`);
    }

    let rangeStart: number;
    let rangeEnd: number;

    if (rangePart === '*') {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes('-')) {
      const [lo, hi] = rangePart.split('-').map(s => parseInt(s, 10));
      if (isNaN(lo) || isNaN(hi)) throw new Error(`Invalid range: ${rangePart}`);
      if (lo < min || hi > max || lo > hi) throw new Error(`Range out of bounds: ${rangePart}`);
      rangeStart = lo;
      rangeEnd = hi;
    } else {
      const val = parseInt(rangePart, 10);
      if (isNaN(val) || val < min || val > max) throw new Error(`Value out of range: ${rangePart}`);
      if (slashIdx === -1) {
        result.add(val);
        continue;
      }
      rangeStart = val;
      rangeEnd = max;
    }

    for (let v = rangeStart; v <= rangeEnd; v += step) {
      result.add(v);
    }
  }

  if (result.size === 0) throw new Error(`Cron field produced no values: ${field}`);
  return [...result].sort((a, b) => a - b);
}

/**
 * Compute next run time for a 5-field cron expression.
 * Fields: minute hour day-of-month month day-of-week
 * Iterates forward from fromMs + 1 minute, up to 366 days.
 * Returns null if no match found.
 *
 * Upstream ref: src/cron/schedule.ts — computeNextRunAtMs()
 */
function computeNextCronRun(expr: string, fromMs: number): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const daysOfMonth = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const daysOfWeek = parseCronField(parts[4], 0, 6);

  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const domSet = new Set(daysOfMonth);
  const monthSet = new Set(months);
  const dowSet = new Set(daysOfWeek);

  // Start from the next whole minute after fromMs
  const start = new Date(fromMs);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const limit = fromMs + 366 * 86_400_000; // 366 days max lookahead

  const cursor = start;
  while (cursor.getTime() <= limit) {
    const month = cursor.getUTCMonth() + 1; // 1-12
    if (!monthSet.has(month)) {
      // Skip to first day of next month
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const dom = cursor.getUTCDate();
    const dow = cursor.getUTCDay(); // 0=Sun
    if (!domSet.has(dom) || !dowSet.has(dow)) {
      // Skip to next day
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const hour = cursor.getUTCHours();
    if (!hourSet.has(hour)) {
      // Skip to next hour
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    const minute = cursor.getUTCMinutes();
    if (!minuteSet.has(minute)) {
      // Skip to next minute
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
      continue;
    }

    return cursor.getTime();
  }

  return null;
}
