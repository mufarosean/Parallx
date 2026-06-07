// surpriseAccumulator.ts — turns surprise into ATTENTION (Build-4).
//
// The prediction loop produces a Brier "surprise" per observation. A single
// early miss means little (a cold-start predictor is wrong a lot), but a strong
// or SUSTAINED run of surprises means reality has diverged from the agent's model
// — the impasse (SOAR) that justifies spending an expensive review. This
// accumulates surprise into a decaying "attention pressure"; when it crosses a
// threshold (and a cooldown has elapsed) it asks for a review, then resets.
//
// Cost-safe by construction: pressure decays, and the cooldown caps how often a
// surprise can trigger the model — so a jittery predictor can never spam reviews.
// Pure + deterministic (clock injected); unit-tested.

export interface ISurpriseAccumulatorOptions {
  /** Pressure at/above which a review is warranted. Default 1.5. */
  readonly threshold?: number;
  /** Pressure half-life (ms): surprise this old counts half. Default 10 min. */
  readonly halfLifeMs?: number;
  /** Minimum time between surprise-triggered reviews (ms). Default 5 min. */
  readonly cooldownMs?: number;
}

export class SurpriseAccumulator {
  private _pressure = 0;
  private _lastUpdateMs = 0;
  private _lastReviewMs = Number.NEGATIVE_INFINITY;

  private readonly _threshold: number;
  private readonly _halfLifeMs: number;
  private readonly _cooldownMs: number;

  constructor(opts: ISurpriseAccumulatorOptions = {}) {
    this._threshold = opts.threshold ?? 1.5;
    this._halfLifeMs = Math.max(1, opts.halfLifeMs ?? 10 * 60 * 1000);
    this._cooldownMs = Math.max(0, opts.cooldownMs ?? 5 * 60 * 1000);
  }

  /** Add a surprise (its Brier, ~0.5–2), decaying prior pressure to `nowMs` first. */
  add(brier: number, nowMs: number): void {
    if (!(brier > 0)) return;
    this._pressure = this._decayed(nowMs) + brier;
    this._lastUpdateMs = nowMs;
  }

  /** Current decayed pressure (does not mutate). */
  pressure(nowMs: number): number {
    return this._decayed(nowMs);
  }

  /** True when accumulated surprise warrants a review and the cooldown has passed. */
  shouldReview(nowMs: number): boolean {
    return this._decayed(nowMs) >= this._threshold && (nowMs - this._lastReviewMs) >= this._cooldownMs;
  }

  /** Call when a surprise-triggered review has been requested: reset + start cooldown. */
  markReviewed(nowMs: number): void {
    this._pressure = 0;
    this._lastUpdateMs = nowMs;
    this._lastReviewMs = nowMs;
  }

  private _decayed(nowMs: number): number {
    if (this._pressure <= 0) return 0;
    const age = Math.max(0, nowMs - this._lastUpdateMs);
    return this._pressure * Math.pow(0.5, age / this._halfLifeMs);
  }
}
