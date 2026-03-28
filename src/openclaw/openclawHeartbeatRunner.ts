/**
 * Heartbeat Runner — D2: Proactive Check-In mechanism.
 *
 * Upstream evidence:
 *   - heartbeat-runner.ts:1-1200 — startHeartbeatRunner, runHeartbeatOnce
 *   - HeartbeatAgentState: intervalMs, lastRunMs, nextDueMs, enabled
 *   - Reason flags: exec-event, cron, wake, hook — bypass file gates
 *   - Transcript pruning, duplicate suppression, isolated sessions
 *
 * Parallx adaptation:
 *   - Single agent — no per-agent scheduling
 *   - Timer checks for: pending system events (file changes, index completions)
 *   - Heartbeat turns are isolated (don't pollute active chat history)
 *   - Configurable interval via AI config
 *   - Wake handler allows external triggering (from cron, file watcher, etc.)
 *   - Duplicate suppression: same event within a suppression window is ignored
 */

import type { IDisposable } from '../platform/lifecycle.js';

// ---------------------------------------------------------------------------
// Constants (from upstream heartbeat-runner.ts)
// ---------------------------------------------------------------------------

/**
 * Default heartbeat interval in milliseconds (5 minutes).
 *
 * @deviation D2.11 — Upstream default is 30 minutes (DEFAULT_HEARTBEAT_EVERY
 * in heartbeat.ts) to account for API token cost and rate limits. Parallx
 * uses 5 minutes because: (1) local Ollama has no per-token cost, (2) desktop
 * latency is low, (3) proactive check-ins benefit from faster response to
 * workspace changes. Configurable via AI settings.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Minimum heartbeat interval — prevents runaway timers.
 *
 * @deviation D2.11 — Upstream has no min/max bounds (relies on config
 * validation via Zod schema). Parallx adds runtime clamping as a desktop
 * guardrail since users can edit settings directly.
 */
export const MIN_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** Maximum heartbeat interval — 1 hour. @deviation D2.11 — see MIN above. */
export const MAX_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Duplicate suppression window — same event within 60s is ignored.
 *
 * @deviation D2.6 — Upstream uses output-level dedup (24h window on model
 * response text via isDuplicateMain, heartbeat-runner.ts L798-833). Parallx
 * uses input-level dedup (60s window on event type+payload). This is a
 * complementary mechanism: upstream prevents repeated model output, Parallx
 * prevents redundant event processing. Desktop-appropriate because heartbeat
 * turns are internal (not user-visible), so output-level nagging is not a
 * concern. If heartbeat turns become user-visible, add output-level dedup.
 */
export const DUPLICATE_SUPPRESSION_WINDOW_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Reason flags for why a heartbeat was triggered.
 * Upstream: exec-event, cron, wake, hook — bypass file gates.
 */
export type HeartbeatReason =
  | 'interval'       // regular timer tick
  | 'system-event'   // pending system event (file change, index completion)
  | 'cron'           // cron job triggered heartbeat (wakeMode: "next-heartbeat")
  | 'wake'           // external wake request
  | 'hook';          // lifecycle hook triggered heartbeat

/**
 * Heartbeat state — mirrors upstream HeartbeatAgentState.
 */
export interface IHeartbeatState {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly lastRunMs: number;
  readonly nextDueMs: number;
  readonly consecutiveRuns: number;
}

/**
 * A pending system event that the heartbeat should process.
 * Upstream: system_events queue monitored by heartbeat-runner.ts.
 */
export interface IHeartbeatSystemEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: number;
}

/**
 * Result of a single heartbeat execution.
 */
export interface IHeartbeatRunResult {
  readonly executed: boolean;
  readonly reason: HeartbeatReason | 'skipped-disabled' | 'skipped-duplicate' | 'skipped-no-events';
  readonly eventsProcessed: number;
  readonly timestamp: number;
}

/**
 * Delegate that actually runs a heartbeat turn.
 * This is called by the heartbeat runner when it decides a heartbeat should execute.
 */
export type HeartbeatTurnExecutor = (
  events: readonly IHeartbeatSystemEvent[],
  reason: HeartbeatReason,
) => Promise<void>;

/**
 * Configuration for the heartbeat runner.
 */
export interface IHeartbeatConfig {
  readonly enabled: boolean;
  readonly intervalMs: number;
}

// ---------------------------------------------------------------------------
// Heartbeat runner
// ---------------------------------------------------------------------------

/**
 * Manages the heartbeat lifecycle — periodic timer + event-driven wake.
 *
 * Upstream: startHeartbeatRunner() creates a timer-based runner that:
 *   1. Checks for pending system events
 *   2. Evaluates preflight gates (enabled, active hours, queue size)
 *   3. Runs a heartbeat turn if conditions are met
 *   4. Prunes heartbeat turns from transcript to prevent context pollution
 *
 * Parallx adaptation:
 *   - No active hours check (desktop app — always available)
 *   - No per-agent scheduling (single agent)
 *   - System events come from file watcher, indexer, and workspace services
 *   - The executor delegate handles actually running the turn
 */
export class HeartbeatRunner implements IDisposable {
  private _state: IHeartbeatState;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _pendingEvents: IHeartbeatSystemEvent[] = [];
  private _recentPayloads = new Map<string, number>(); // payload hash → timestamp
  private _disposed = false;

  constructor(
    private readonly _executor: HeartbeatTurnExecutor,
    private readonly _getConfig: () => IHeartbeatConfig,
  ) {
    const config = this._getConfig();
    this._state = {
      enabled: config.enabled,
      intervalMs: clampInterval(config.intervalMs),
      lastRunMs: 0,
      nextDueMs: Date.now() + clampInterval(config.intervalMs),
      consecutiveRuns: 0,
    };
  }

  /** Current heartbeat state (read-only snapshot). */
  get state(): IHeartbeatState {
    return { ...this._state };
  }

  /** Number of pending system events. */
  get pendingEventCount(): number {
    return this._pendingEvents.length;
  }

  /**
   * Start the heartbeat timer.
   * Upstream: startHeartbeatRunner() — creates interval timer.
   */
  start(): void {
    if (this._disposed || this._timer) return;

    const config = this._getConfig();
    const interval = clampInterval(config.intervalMs);

    this._state = {
      ...this._state,
      enabled: config.enabled,
      intervalMs: interval,
    };

    if (!this._state.enabled) return;

    this._scheduleNext();
  }

  /**
   * Schedule the next heartbeat tick using setTimeout chaining.
   * Upstream: scheduleNext() — one-shot timer re-armed after each tick.
   * This prevents overlapping heartbeats and allows dynamic interval changes.
   */
  private _scheduleNext(): void {
    if (this._disposed || !this._state.enabled) return;
    this._timer = setTimeout(async () => {
      await this._tick('interval');
      this._timer = null;
      this._scheduleNext();
    }, this._state.intervalMs);
  }

  /**
   * Stop the heartbeat timer.
   */
  stop(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Enqueue a system event for the next heartbeat.
   * Upstream: system_events queue — heartbeat monitors for pending events.
   *
   * If events are pending and the timer hasn't fired yet, this can trigger
   * an immediate heartbeat (like upstream's isHeartbeat bypass on exec-events).
   */
  pushEvent(event: IHeartbeatSystemEvent): void {
    if (this._disposed) return;

    // Input-level duplicate suppression — @deviation D2.6
    // Upstream deduplicates at the output level (isDuplicateMain, 24h window).
    // Parallx deduplicates at the input level (same event type+payload, 60s window).
    const payloadKey = `${event.type}:${JSON.stringify(event.payload)}`;
    const lastSeen = this._recentPayloads.get(payloadKey);
    if (lastSeen && (Date.now() - lastSeen) < DUPLICATE_SUPPRESSION_WINDOW_MS) {
      return;
    }
    this._recentPayloads.set(payloadKey, Date.now());

    this._pendingEvents.push(event);

    // Immediate wake for system events — upstream: pending events trigger
    // heartbeat even if interval hasn't elapsed
    if (this._state.enabled && this._pendingEvents.length === 1) {
      this._tick('system-event');
    }
  }

  /**
   * External wake request — forces a heartbeat check regardless of timer.
   * Upstream: setHeartbeatWakeHandler allows external triggering.
   */
  wake(reason: HeartbeatReason = 'wake'): void {
    if (this._disposed) return;
    this._tick(reason);
  }

  /**
   * Run a single heartbeat check.
   * Upstream: runHeartbeatOnce() — single heartbeat execution.
   */
  private async _tick(reason: HeartbeatReason): Promise<IHeartbeatRunResult> {
    const config = this._getConfig();

    // Gate: disabled
    if (!config.enabled) {
      return { executed: false, reason: 'skipped-disabled', eventsProcessed: 0, timestamp: Date.now() };
    }

    // Gate: no events for interval-based ticks (avoid noise)
    // Upstream: heartbeat checks HEARTBEAT.md and queue size as preflight
    if (reason === 'interval' && this._pendingEvents.length === 0) {
      return { executed: false, reason: 'skipped-no-events', eventsProcessed: 0, timestamp: Date.now() };
    }

    // Drain events for this tick
    const events = [...this._pendingEvents];
    this._pendingEvents = [];

    // Execute heartbeat turn
    const now = Date.now();
    try {
      await this._executor(events, reason);
      this._state = {
        ...this._state,
        lastRunMs: now,
        nextDueMs: now + this._state.intervalMs,
        consecutiveRuns: this._state.consecutiveRuns + 1,
      };
      return { executed: true, reason, eventsProcessed: events.length, timestamp: now };
    } catch (err) {
      console.error('[HeartbeatRunner] Heartbeat execution failed:', err);
      // Re-queue events that weren't processed
      this._pendingEvents.unshift(...events);
      return { executed: false, reason, eventsProcessed: 0, timestamp: now };
    }
  }

  /**
   * Clean up duplicate suppression cache — remove entries older than window.
   * Called periodically to prevent unbounded memory growth.
   */
  pruneSuppressionCache(): void {
    const cutoff = Date.now() - DUPLICATE_SUPPRESSION_WINDOW_MS;
    for (const [key, timestamp] of this._recentPayloads) {
      if (timestamp < cutoff) {
        this._recentPayloads.delete(key);
      }
    }
  }

  dispose(): void {
    this._disposed = true;
    this.stop();
    this._pendingEvents = [];
    this._recentPayloads.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInterval(ms: number): number {
  return Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.min(MAX_HEARTBEAT_INTERVAL_MS, ms));
}
