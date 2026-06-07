// nagGovernor.ts — the nag governor with an EXTERNAL sensor (Build-8).
//
// The nag-spiral is the #2 day-one product-killer: proactivity without restraint
// → annoyance → distrust → the user disables the agent → it goes blind. The
// design's fix is a balancing loop whose sensor is OUTSIDE the agent: the
// interruption budget shrinks as the user's measured DISMISS-ratio rises — the
// user's own clicks (Do it / Tell me more = acted; Dismiss = dismissed), never
// the agent's self-assessment of whether it's being annoying.
//
// Implemented as a token bucket: each surfaced interruption costs a token; tokens
// refill over time, but the REFILL RATE is scaled down by the dismiss-ratio. Act
// on its suggestions and it stays chatty; dismiss them and it goes quiet. Pure +
// deterministic (clock injected); persisted by MindService so a restart doesn't
// reset the throttle (the app rebuilds on every launch).

export type NagOutcome = 'act' | 'dismiss';

export interface INagGovernorOptions {
  /** Recent feedbacks considered for the dismiss-ratio. Default 20. */
  readonly windowSize?: number;
  /** Max interruption tokens (burst). Default 3. */
  readonly burstCapacity?: number;
  /** Tokens/hour refill at a 0% dismiss-ratio. Default 4. */
  readonly baseRefillPerHour?: number;
  /** Tokens/hour refill at a 100% dismiss-ratio. Default 0.5. */
  readonly minRefillPerHour?: number;
}

export interface INagReading {
  readonly dismissRatio: number | null;
  readonly tokens: number;
  /** True when the dismiss-ratio is pulling the refill below half its base. */
  readonly throttled: boolean;
}

export interface INagState {
  readonly outcomes: NagOutcome[];
  readonly tokens: number;
  readonly lastRefillMs: number;
}

export class NagGovernor {
  private _outcomes: NagOutcome[] = [];
  private _tokens: number;
  private _lastRefillMs = Number.NEGATIVE_INFINITY;

  private readonly _windowSize: number;
  private readonly _burstCapacity: number;
  private readonly _baseRefillPerHour: number;
  private readonly _minRefillPerHour: number;

  constructor(opts: INagGovernorOptions = {}) {
    this._windowSize = Math.max(1, opts.windowSize ?? 20);
    this._burstCapacity = Math.max(1, opts.burstCapacity ?? 3);
    this._baseRefillPerHour = Math.max(0, opts.baseRefillPerHour ?? 4);
    this._minRefillPerHour = Math.max(0, opts.minRefillPerHour ?? 0.5);
    this._tokens = this._burstCapacity;
  }

  /** Record the user's response to a surfaced suggestion (the external sensor). */
  recordOutcome(outcome: NagOutcome, _nowMs?: number): void {
    this._outcomes.push(outcome);
    if (this._outcomes.length > this._windowSize) {
      this._outcomes = this._outcomes.slice(-this._windowSize);
    }
  }

  /** Dismiss-ratio over the recent window, or null if no feedback yet. */
  dismissRatio(): number | null {
    if (this._outcomes.length === 0) return null;
    const dismisses = this._outcomes.filter(o => o === 'dismiss').length;
    return dismisses / this._outcomes.length;
  }

  /**
   * May the agent interrupt now? Refills the bucket (at a dismiss-scaled rate),
   * then spends a token if one is available. Returns false to SUPPRESS — the
   * suggestion is throttled, not lost (the caller still ledgers it).
   */
  allowInterruption(nowMs: number): boolean {
    this._refill(nowMs);
    if (this._tokens >= 1) {
      this._tokens -= 1;
      return true;
    }
    return false;
  }

  reading(nowMs: number): INagReading {
    this._refill(nowMs);
    return {
      dismissRatio: this.dismissRatio(),
      tokens: this._tokens,
      throttled: this._refillPerHour() < this._baseRefillPerHour / 2,
    };
  }

  toState(): INagState {
    return {
      outcomes: this._outcomes,
      tokens: this._tokens,
      lastRefillMs: Number.isFinite(this._lastRefillMs) ? this._lastRefillMs : 0,
    };
  }

  restore(state: INagState | undefined): void {
    if (!state) return;
    if (Array.isArray(state.outcomes)) this._outcomes = state.outcomes.filter(o => o === 'act' || o === 'dismiss').slice(-this._windowSize);
    if (typeof state.tokens === 'number') this._tokens = Math.max(0, Math.min(this._burstCapacity, state.tokens));
    if (typeof state.lastRefillMs === 'number') this._lastRefillMs = state.lastRefillMs;
  }

  private _refillPerHour(): number {
    const d = this.dismissRatio() ?? 0;
    return this._baseRefillPerHour - (this._baseRefillPerHour - this._minRefillPerHour) * Math.min(1, Math.max(0, d));
  }

  private _refill(nowMs: number): void {
    if (!Number.isFinite(this._lastRefillMs)) { this._lastRefillMs = nowMs; return; }
    const hours = Math.max(0, (nowMs - this._lastRefillMs) / (60 * 60 * 1000));
    this._tokens = Math.min(this._burstCapacity, this._tokens + hours * this._refillPerHour());
    this._lastRefillMs = nowMs;
  }
}
