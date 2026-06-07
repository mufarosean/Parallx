// reflectionScheduler.ts — the slow loop (Build-10).
//
// THE_LIVING_SYSTEM §4: real cognition runs nested loops — reflex (seconds),
// reflection (daily), planning (weekly), the long arc (years). The heartbeat's
// 30-minute tick is the reflex (react to what's happening now). This is the
// daily REFLECTION cadence: once a day the agent steps back from reacting and
// instead consolidates — reviews its own model, its prediction accuracy, and the
// conscience, records durable higher-level insight, and lets stale beliefs be
// pruned. A different timescale doing a different job.
//
// Pure + deterministic (clock injected); persisted by MindService so a restart
// doesn't make it reflect on every launch.

export interface IReflectionSchedulerOptions {
  /** How often a reflection is due. Default 24h. */
  readonly intervalMs?: number;
}

export interface IReflectionState {
  readonly lastMs: number;
}

export class ReflectionScheduler {
  private _lastMs = Number.NEGATIVE_INFINITY;
  private readonly _intervalMs: number;

  constructor(opts: IReflectionSchedulerOptions = {}) {
    this._intervalMs = Math.max(1, opts.intervalMs ?? 24 * 60 * 60 * 1000);
  }

  /** True when a reflection is due (interval elapsed since the last one). */
  isDue(nowMs: number): boolean {
    return nowMs - this._lastMs >= this._intervalMs;
  }

  /** When the next reflection is due (absolute ms), or 0 if one is due now. */
  nextDueMs(): number {
    if (!Number.isFinite(this._lastMs)) return 0;
    return Math.max(0, this._lastMs + this._intervalMs);
  }

  markReflected(nowMs: number): void {
    this._lastMs = nowMs;
  }

  toState(): IReflectionState {
    return { lastMs: Number.isFinite(this._lastMs) ? this._lastMs : 0 };
  }

  restore(state: IReflectionState | undefined): void {
    if (state && typeof state.lastMs === 'number') this._lastMs = state.lastMs;
  }
}
