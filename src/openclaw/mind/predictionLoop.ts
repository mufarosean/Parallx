// predictionLoop.ts — the active-inference loop made real and cheap (Build-2b).
//
// Ties the cheap predictor to the MIND and to REALITY: on each observed item it
//   1. grades the prediction it made last time against what actually happened
//      (Brier, computed by the MIND from an external outcome — never self-graded),
//   2. when the gap is large enough, remembers the SURPRISE as continuity (so the
//      next review sees "I expected X but you did Y" and can reflect — the impasse
//      that drives attention), and
//   3. issues a fresh prediction for the next item.
//
// No model call anywhere here — forecasting and grading are arithmetic. Surprise
// is what later JUSTIFIES spending an LLM review, not the other way round.

import type { SequencePredictor } from './sequencePredictor.js';

/** Narrow MIND surface (structurally satisfied by MindService). */
export interface IPredictionMind {
  predict(
    subject: string,
    options: readonly { label: string; prob: number }[],
    horizonMs: number,
    provenance: readonly string[],
  ): Promise<{ id: string } | undefined>;
  resolve(predictionId: string, actual: string): Promise<number | undefined>;
  remember(kind: 'belief' | 'thread', content: string, confidence: number, provenance: readonly string[]): Promise<boolean>;
}

export interface IPredictionLoopOptions {
  /** What is being forecast, for the MIND record. Default "next file touched". */
  readonly subject?: string;
  /** Validity window of a prediction (ms). Default 10 min. */
  readonly horizonMs?: number;
  /** Brier at/above which an outcome counts as a surprise. Default 0.5. */
  readonly surpriseThreshold?: number;
  /** Don't predict until the predictor has this many observations. Default 3. */
  readonly minHistory?: number;
  /** Confidence stamped on a remembered surprise. Default 0.5. */
  readonly surpriseConfidence?: number;
}

export interface IObserveResult {
  /** Brier of the prediction that resolved against this observation, if any. */
  readonly brier?: number;
  /** True when the gap was large enough to count as a surprise. */
  readonly surprised: boolean;
}

export class PredictionLoop {
  private _pendingId?: string;
  private _pendingTop?: string;
  private _lastBrier = NaN;

  private readonly _subject: string;
  private readonly _horizonMs: number;
  private readonly _surpriseThreshold: number;
  private readonly _minHistory: number;
  private readonly _surpriseConfidence: number;

  constructor(
    private readonly _mind: IPredictionMind,
    private readonly _predictor: SequencePredictor,
    opts: IPredictionLoopOptions = {},
  ) {
    this._subject = opts.subject ?? 'next file touched';
    this._horizonMs = opts.horizonMs ?? 10 * 60 * 1000;
    this._surpriseThreshold = opts.surpriseThreshold ?? 0.5;
    this._minHistory = Math.max(1, opts.minHistory ?? 3);
    this._surpriseConfidence = opts.surpriseConfidence ?? 0.5;
  }

  /** Brier of the most recently resolved prediction (NaN if none). */
  get lastBrier(): number { return this._lastBrier; }

  /**
   * Process one observed item: grade the pending prediction against it, remember
   * any surprise, and issue the next prediction. Best-effort by contract of the
   * caller (wrap in try/catch at the live edge so the bus never breaks).
   */
  async observe(actual: string): Promise<IObserveResult> {
    if (!actual) return { surprised: false };

    let brier: number | undefined;
    let surprised = false;

    if (this._pendingId) {
      brier = await this._mind.resolve(this._pendingId, actual);
      this._pendingId = undefined;
      if (brier !== undefined) {
        this._lastBrier = brier;
        if (brier >= this._surpriseThreshold) {
          surprised = true;
          const expected = this._pendingTop ?? '(unsure)';
          await this._mind.remember(
            'thread',
            `Surprised: I expected "${expected}" next, but you touched "${actual}".`,
            this._surpriseConfidence,
            [`prediction:brier=${brier.toFixed(2)}`],
          );
        }
      }
      this._pendingTop = undefined;
    }

    this._predictor.observe(actual);

    if (this._predictor.size >= this._minHistory) {
      const options = this._predictor.forecast();
      if (options.length > 0) {
        const pred = await this._mind.predict(this._subject, options, this._horizonMs, [`observed:${actual}`]);
        this._pendingId = pred?.id;
        this._pendingTop = options[0]?.label;
      }
    }

    return { brier, surprised };
  }
}
