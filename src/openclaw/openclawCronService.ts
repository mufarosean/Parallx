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
import { Emitter, type Event } from '../platform/events.js';
import { createServiceIdentifier } from '../platform/types.js';

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
  /**
   * Schedule anchor (upstream: schedule.anchorMs in cron/schedule.ts).
   * For `every: <duration>` schedules, the next fire is computed as the
   * next interval boundary from this anchor — NOT `now + interval`. This
   * is what makes upsert-on-restart idempotent: the bridge can re-register
   * the same job on every app start without resetting the firing window.
   * Set once at job creation; updated only when the schedule itself
   * changes. Unused for `at` and `cron` schedule kinds.
   *
   * Legacy jobs (created before this field existed) get backfilled from
   * `createdAt` on first load — see `loadFromPersistence`.
   */
  readonly anchorMs?: number;
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
// M60 Phase γ — controls layer types
// ---------------------------------------------------------------------------

/**
 * Per-firing autonomy event hand-off. The runner produces this on every
 * `_executeJob` invocation; the wiring in `src/built-in/chat/main.ts`
 * translates it into an `IAutonomyEventLog.emit({ trigger: { kind: 'cron' }, ... })` call.
 */
export interface ICronFireAutonomyInfo {
  readonly outcome: 'completed' | 'gated' | 'error' | 'cancelled';
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly scheduledAt: number;
  readonly durationMs: number;
  readonly note?: string;
}

/** Optional autonomy controls (M60 §3.8/§3.10). */
export interface ICronObservers {
  /** Returns `true` when the `autonomy.cron.enabled` flag is on. */
  readonly isFlagEnabled?: () => boolean;
  /** Called once per firing, including gated/cancelled/error outcomes. */
  readonly onAutonomyEvent?: (info: ICronFireAutonomyInfo) => void;
}

/** Snapshot persisted across reloads (M60 §3.6 / W4 plan). */
export interface ICronPersistedSnapshot {
  readonly jobs: readonly ICronJob[];
}

/** Persistence interface — implementations route to portable storage (`<workspace>/.parallx/cron.json` per M61 Phase 2). */
export interface ICronPersistence {
  load(): Promise<ICronPersistedSnapshot | null>;
  save(snapshot: ICronPersistedSnapshot): Promise<void>;
}

/**
 * Notification fired by `CronService.onDidChangeJobs` when the job set
 * mutates. `kind` distinguishes the mutation so listeners can pick the
 * cheapest update path:
 *   - `added` / `updated` / `removed`: single-job change; `jobId` is the
 *     internal `cron-N` id.
 *   - `ran`: post-firing update (lastRunAt/nextRunAt/runCount).
 *   - `bulk`: persistence load or other multi-job change; `jobId` is undefined.
 */
export interface ICronJobChangeEvent {
  readonly kind: 'added' | 'updated' | 'removed' | 'ran' | 'bulk';
  readonly jobId?: string;
}

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
  /** M60 §3.7 — idempotency keys for `(cronId, scheduledAt)` firings. */
  private readonly _idempotencyKeys = new Set<string>();
  /** M60 §3.7 — set by `suspendForShutdown()`; blocks all subsequent firings. */
  private _shuttingDown = false;
  /** M60 Phase γ — optional controls layer observers. */
  private _observers: ICronObservers = {};
  /** M60 Phase γ — optional persistence (load on `loadFromPersistence()`, save after every mutation). */
  private _persistence: ICronPersistence | undefined;

  /**
   * Fires whenever the job set changes — additions, updates (including
   * post-run timestamp/runCount mutation), and removals. The AI Hub
   * "Scheduled jobs" section subscribes to this so the visible list and
   * its next-run timestamps stay in lock-step with the live service
   * without polling. Bulk-load events (`loadFromPersistence`) emit a
   * single `bulk` kind so listeners can rerender once.
   */
  private readonly _onDidChangeJobs = new Emitter<ICronJobChangeEvent>();
  readonly onDidChangeJobs: Event<ICronJobChangeEvent> = this._onDidChangeJobs.event;

  constructor(
    private readonly _executor: CronTurnExecutor,
    private readonly _contextFetcher: ContextLineFetcher,
    private readonly _heartbeatWaker: HeartbeatWaker | null,
  ) {}

  /**
   * M60 Phase γ §3.8/§3.10 — install autonomy controls. Idempotent. Setter
   * pattern (not constructor arg) so existing tests / call sites don't change.
   */
  setObservers(observers: ICronObservers): void {
    this._observers = { ...observers };
  }

  /**
   * M60 Phase γ — install persistence. After install, callers should
   * `await loadFromPersistence()` before `start()` to restore jobs across
   * reload. Mutations (add/update/remove + run completion) auto-save.
   */
  setPersistence(persistence: ICronPersistence): void {
    this._persistence = persistence;
  }

  /**
   * M60 Phase γ — hydrate jobs from persistence. Idempotent. Errors are
   * swallowed (corrupt persistence → start with empty job set).
   */
  async loadFromPersistence(): Promise<void> {
    if (!this._persistence) return;
    try {
      const snapshot = await this._persistence.load();
      if (!snapshot || !Array.isArray(snapshot.jobs)) return;
      this._jobs.clear();
      let maxId = 0;
      const now = Date.now();
      for (const job of snapshot.jobs) {
        if (!job || typeof job.id !== 'string') continue;
        // Anchor backfill — jobs persisted before the anchorMs field existed
        // need one populated so future updateJob/computeNextRun calls have
        // a consistent firing grid. Default to `createdAt` (best
        // approximation of "when did the user pick this cadence"); fall
        // back to `now` if `createdAt` is also missing/corrupt.
        const anchorMs = (typeof job.anchorMs === 'number' && Number.isFinite(job.anchorMs))
          ? job.anchorMs
          : (typeof job.createdAt === 'number' && Number.isFinite(job.createdAt)
              ? job.createdAt
              : now);
        // Recompute nextRunAt at load time to coalesce sleep/wake firings:
        // multiple missed firings of the same job collapse into a single
        // catch-up at start() time (M60 §3.7).
        const restored: ICronJob = {
          ...job,
          anchorMs,
          nextRunAt: job.enabled
            ? (job.nextRunAt !== null && job.nextRunAt <= now
                ? now // single coalesced catch-up; ≤ now triggers on next tick
                : job.nextRunAt)
            : null,
        };
        this._jobs.set(restored.id, restored);
        const m = /^cron-(\d+)$/.exec(restored.id);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
      }
      this._nextJobId = maxId + 1;
      this._onDidChangeJobs.fire({ kind: 'bulk' });
    } catch {
      /* corrupt persistence — fall back to empty job set */
    }
  }

  /** M60 §3.7 — suspend cron for shutdown. Idempotent. Stops timer; rejects new firings. */
  suspendForShutdown(): void {
    if (this._shuttingDown) return;
    this._shuttingDown = true;
    this.stop();
  }

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

    // Anchor for `every` schedules — see ICronJob.anchorMs. Set at creation
    // and preserved across updateJob calls that don't change the schedule
    // (which is what makes upsert-on-restart idempotent). Unused for `at`
    // and `cron` schedule kinds but harmless to set.
    const anchorMs = now;

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
      nextRunAt: computeNextRun(params.schedule, now, anchorMs),
      runCount: 0,
      description: params.description,
      deleteAfterRun: params.deleteAfterRun,
      updatedAt: now,
      anchorMs,
    };

    this._jobs.set(id, job);
    void this._save();
    this._onDidChangeJobs.fire({ kind: 'added', jobId: id });
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

    // Determine whether the schedule actually changed. Extensions that
    // upsert the same job on every activation must NOT reset the firing
    // window — without this guard, every app restart pushes nextRunAt
    // forward by the full interval and a user who closes the app within
    // the interval never sees the job fire.
    const scheduleChanged = params.schedule !== undefined
      && !_schedulesEqual(params.schedule, existing.schedule);

    // Anchor handling (openclaw parity):
    //   - schedule unchanged → keep the original anchor → nextRunAt
    //     stays where it was (no reset)
    //   - schedule changed   → reset the anchor to now so the new
    //     cadence starts from this moment
    const now = Date.now();
    const anchorMs = scheduleChanged
      ? now
      : (existing.anchorMs ?? existing.createdAt);

    // nextRunAt recomputation:
    //   - schedule changed: recompute from the new anchor (now)
    //   - schedule unchanged but caller passed schedule anyway (the
    //     upsert-on-restart case): KEEP existing nextRunAt
    //   - schedule omitted entirely: keep existing nextRunAt
    const nextRunAt = scheduleChanged
      ? computeNextRun(params.schedule!, now, anchorMs)
      : existing.nextRunAt;

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
      nextRunAt,
      description: params.description !== undefined ? params.description : existing.description,
      deleteAfterRun: params.deleteAfterRun !== undefined ? params.deleteAfterRun : existing.deleteAfterRun,
      updatedAt: now,
      anchorMs,
    };

    this._jobs.set(id, updated);
    void this._save();
    this._onDidChangeJobs.fire({ kind: 'updated', jobId: id });
    return { ...updated };
  }

  /**
   * Remove a cron job.
   * Upstream: cron-tool.ts "remove" action.
   */
  removeJob(id: string): boolean {
    const removed = this._jobs.delete(id);
    if (removed) {
      void this._save();
      this._onDidChangeJobs.fire({ kind: 'removed', jobId: id });
    }
    return removed;
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
   *
   * M60 §3.7 note: manual runs bypass the `(jobId, scheduledAt)` idempotency
   * key dedup — the dedup applies to **automatic** firings from the timer
   * tick / missed-job catchup, not to explicit user-driven runs.
   */
  async runJob(id: string): Promise<ICronRunResult> {
    if (this._disposed) throw new Error('CronService is disposed');
    const job = this._jobs.get(id);
    if (!job) throw new Error(`Cron job not found: ${id}`);
    return this._executeJob(job, { trackIdempotency: false });
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
      await this._executeJob(job, { trackIdempotency: true });
    }
  }

  /**
   * Run missed jobs on startup.
   * Upstream: CronService.runMissedJobs — catches up on jobs
   * whose nextRunAt has passed while the service was stopped.
   *
   * M60 §3.7: collapse repeated missed firings into a SINGLE coalesced
   * catch-up per job. The idempotency-key set prevents re-running the
   * same `(jobId, scheduledAt)` if it was already executed pre-shutdown,
   * and the in-loop tracking ensures no second firing within the same
   * runMissedJobs pass.
   */
  private _runMissedJobs(): void {
    const now = Date.now();
    const fired = new Set<string>();
    for (const job of this._jobs.values()) {
      if (!job.enabled) continue;
      if (fired.has(job.id)) continue; // single-flight per job in catchup
      if (job.nextRunAt !== null && job.nextRunAt <= now) {
        fired.add(job.id);
        // Fire and forget — missed job catchup
        this._executeJob(job, { trackIdempotency: true }).catch(err => {
          console.error(`[CronService] Missed job catchup failed for ${job.name}:`, err);
        });
      }
    }
  }

  /**
   * Execute a single cron job.
   * Upstream: CronService executes via agent turn or system event.
   */
  private async _executeJob(
    job: ICronJob,
    opts: { trackIdempotency: boolean } = { trackIdempotency: false },
  ): Promise<ICronRunResult> {
    const now = Date.now();
    // M60 §3.7: idempotency key — `(cronId, scheduledAt)`. Re-firing the
    // same key is a no-op. `nextRunAt` is the canonical scheduled-at
    // timestamp; manual `runJob` falls back to `now`.
    const scheduledAt = job.nextRunAt ?? now;
    const idempotencyKey = `${job.id}@${scheduledAt}`;

    if (opts.trackIdempotency && this._idempotencyKeys.has(idempotencyKey)) {
      const result: ICronRunResult = {
        jobId: job.id,
        jobName: job.name,
        firedAt: now,
        wakeMode: job.wakeMode,
        success: true,
      };
      this._emitFireEvent({
        outcome: 'cancelled',
        jobId: job.id,
        idempotencyKey,
        scheduledAt,
        durationMs: 0,
        note: 'duplicate-idempotency-key',
      });
      return result;
    }
    if (opts.trackIdempotency) {
      this._idempotencyKeys.add(idempotencyKey);
      if (this._idempotencyKeys.size > 1000) {
        // Bound the cache — trim oldest by re-creating from a slice.
        const arr = Array.from(this._idempotencyKeys);
        this._idempotencyKeys.clear();
        for (const k of arr.slice(-500)) this._idempotencyKeys.add(k);
      }
    }

    // M60 §3.7: shutting-down gate.
    if (this._shuttingDown) {
      this._emitFireEvent({
        outcome: 'cancelled',
        jobId: job.id,
        idempotencyKey,
        scheduledAt,
        durationMs: 0,
        note: 'shutdown',
      });
      return {
        jobId: job.id,
        jobName: job.name,
        firedAt: now,
        wakeMode: job.wakeMode,
        success: false,
        error: 'shutdown',
      };
    }

    // M60 §3.8: autonomy.cron.enabled feature flag gate.
    if (this._observers.isFlagEnabled && !this._observers.isFlagEnabled()) {
      const result: ICronRunResult = {
        jobId: job.id,
        jobName: job.name,
        firedAt: now,
        wakeMode: job.wakeMode,
        success: false,
        error: 'gated:autonomy.cron.enabled=false',
      };
      // Bump nextRunAt so we don't loop on the same firing every check.
      const updated: ICronJob = {
        ...job,
        nextRunAt: computeNextRun(job.schedule, now, job.anchorMs),
      };
      this._jobs.set(job.id, updated);
      void this._save();
      this._onDidChangeJobs.fire({ kind: 'ran', jobId: job.id });
      this._runHistory.push(result);
      this._trimRunHistory();
      this._emitFireEvent({
        outcome: 'gated',
        jobId: job.id,
        idempotencyKey,
        scheduledAt,
        durationMs: 0,
        note: 'autonomy.cron.enabled=false',
      });
      return result;
    }

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
        nextRunAt: computeNextRun(job.schedule, now, job.anchorMs),
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
      const deleted = job.deleteAfterRun === true;
      if (deleted) {
        this._jobs.delete(job.id);
      }
      void this._save();
      this._onDidChangeJobs.fire({
        kind: deleted ? 'removed' : 'ran',
        jobId: job.id,
      });
      this._emitFireEvent({
        outcome: 'completed',
        jobId: job.id,
        idempotencyKey,
        scheduledAt,
        durationMs: Date.now() - now,
      });

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
      // A throw from the executor doesn't unwind the firing — the job DID
      // fire at `now`, even if the agent turn that followed errored out
      // (e.g., the LLM threw mid-stream AFTER the underlying tool already
      // ran and persisted data). lastRunAt/runCount track the firing, not
      // the agent turn outcome; otherwise a successful budget.sync that
      // fails to summarize in chat presents as "Never run" forever and
      // the user has no signal that cron is actually working.
      const updated: ICronJob = {
        ...job,
        lastRunAt: now,
        nextRunAt: computeNextRun(job.schedule, now, job.anchorMs),
        runCount: job.runCount + 1,
      };
      this._jobs.set(job.id, updated);
      void this._save();
      this._onDidChangeJobs.fire({ kind: 'ran', jobId: job.id });
      this._runHistory.push(result);
      this._trimRunHistory();
      this._emitFireEvent({
        outcome: 'error',
        jobId: job.id,
        idempotencyKey,
        scheduledAt,
        durationMs: Date.now() - now,
        note: result.error,
      });
      return result;
    }
  }

  /** M60 Phase γ — emit a per-firing autonomy event; never throws. */
  private _emitFireEvent(info: ICronFireAutonomyInfo): void {
    if (!this._observers.onAutonomyEvent) return;
    try {
      this._observers.onAutonomyEvent(info);
    } catch {
      /* observer errors are non-fatal */
    }
  }

  /** M60 Phase γ — persist the current job set; swallows errors. */
  private async _save(): Promise<void> {
    if (!this._persistence) return;
    try {
      await this._persistence.save({ jobs: Array.from(this._jobs.values()) });
    } catch {
      /* persistence failures don't affect in-memory truth */
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
    this._onDidChangeJobs.dispose();
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
/**
 * Structural equality on two schedules. Two schedules count as "equal"
 * iff they specify the same kind with the same literal value. Used by
 * `updateJob` to detect that an upsert is re-applying the same schedule
 * (so the anchor + nextRunAt should be preserved, not reset).
 */
function _schedulesEqual(a: ICronSchedule, b: ICronSchedule): boolean {
  return a.at === b.at && a.every === b.every && a.cron === b.cron;
}

/**
 * Compute the next fire time for a schedule.
 *
 * For `every: <duration>` schedules an optional `anchorMs` lets the
 * caller compute the next tick on the original anchor grid (upstream
 * parity with openclaw's `schedule.anchorMs` semantics). Without an
 * anchor, falls back to `fromMs + intervalMs` — same legacy behaviour
 * as before this change.
 *
 * For `at` (one-shot) and `cron` (5-field expression) schedules,
 * `anchorMs` is ignored — those kinds derive their next-run from
 * absolute time, not from an anchor offset.
 */
function computeNextRun(
  schedule: ICronSchedule,
  fromMs: number,
  anchorMs?: number,
): number | null {
  if (schedule.at) {
    const target = Date.parse(schedule.at);
    // One-shot: if already past, return null (will not fire again)
    return target > fromMs ? target : null;
  }

  if (schedule.every) {
    const intervalMs = parseDuration(schedule.every);
    // Anchor-relative: openclaw's `schedule.kind === 'every'` formula.
    // `steps` is at least 1, so a brand-new job (anchor === now) fires
    // at `now + intervalMs`, matching upstream's first-fire semantics.
    // An app restart that re-upserts the same job preserves the anchor
    // → the existing nextRunAt is unchanged, no reset, no missed
    // window. If the anchor is missing (legacy job, no anchor passed),
    // fall back to the old `fromMs + intervalMs` formula.
    if (anchorMs !== undefined && Number.isFinite(anchorMs)) {
      const anchor = Math.max(0, Math.floor(anchorMs));
      if (fromMs < anchor) return anchor;
      const elapsed = fromMs - anchor;
      const steps = Math.max(1, Math.floor((elapsed + intervalMs - 1) / intervalMs));
      return anchor + steps * intervalMs;
    }
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

// ---------------------------------------------------------------------------
// DI Service Identifier (M63 P0)
// ---------------------------------------------------------------------------

/**
 * DI identifier for the {@link CronService}.
 *
 * Registered after construction in built-in/chat/main.ts so extensions can
 * resolve it via parallx.services.get(ICronService) and so the api.cron
 * bridge can wire upsertJob through DI.
 */
export const ICronService = createServiceIdentifier<CronService>('ICronService');
