// sequencePredictor.ts — a cheap, non-LLM predictor of the next item in a stream
// (e.g. the next file the user will touch). This is what makes SURPRISE real and
// EXTERNAL (Build-2): the predictor forecasts, reality — the event bus — supplies
// the actual, and the Brier gap is a genuine, calibratable error signal, not an
// LLM grading its own homework.
//
// Deliberately cheap (idle stays free, Invariant 9): forecasting is recency-
// weighted frequency over a bounded history — no model call. A wrong forecast is
// the "impasse" (SOAR) that justifies spending an expensive LLM review; a right
// one costs nothing. Pure + deterministic, so calibration is unit-tested.

export interface ISequenceForecast {
  readonly label: string;
  /** 0..1; forecasts sum to (1 - noveltyMass), the remainder being "something
   *  not seen before" — so a brand-new item surprises, but not catastrophically. */
  readonly prob: number;
}

export interface ISequencePredictorOptions {
  /** How many recent observations to retain. Default 100. */
  readonly historyLimit?: number;
  /** How many options to forecast. Default 3. */
  readonly topK?: number;
  /** Recency half-life in observations: an item this many steps back counts half. Default 20. */
  readonly halfLifeCount?: number;
  /** Probability mass reserved for an unseen item. Default 0.15. */
  readonly noveltyMass?: number;
}

export class SequencePredictor {
  private readonly _history: string[] = [];
  private readonly _historyLimit: number;
  private readonly _topK: number;
  private readonly _halfLifeCount: number;
  private readonly _noveltyMass: number;

  constructor(opts: ISequencePredictorOptions = {}) {
    this._historyLimit = Math.max(1, opts.historyLimit ?? 100);
    this._topK = Math.max(1, opts.topK ?? 3);
    this._halfLifeCount = Math.max(1, opts.halfLifeCount ?? 20);
    this._noveltyMass = Math.min(0.9, Math.max(0, opts.noveltyMass ?? 0.15));
  }

  get size(): number {
    return this._history.length;
  }

  /** Record an observed item (most recent last). */
  observe(item: string): void {
    if (!item) return;
    this._history.push(item);
    if (this._history.length > this._historyLimit) {
      this._history.splice(0, this._history.length - this._historyLimit);
    }
  }

  /**
   * Forecast the next item: recency-weighted frequency over history, normalized
   * to (1 - noveltyMass), top-K. Empty when there is no history (the predictor
   * abstains rather than guess blind). Pure given the current history.
   */
  forecast(): ISequenceForecast[] {
    if (this._history.length === 0) return [];

    const weights = new Map<string, number>();
    let total = 0;
    const n = this._history.length;
    for (let i = 0; i < n; i++) {
      const age = n - 1 - i; // 0 = most recent
      const w = Math.pow(0.5, age / this._halfLifeCount);
      weights.set(this._history[i], (weights.get(this._history[i]) ?? 0) + w);
      total += w;
    }
    if (total === 0) return [];

    const scale = 1 - this._noveltyMass;
    return [...weights.entries()]
      .map(([label, w]) => ({ label, prob: (w / total) * scale }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, this._topK);
  }
}
