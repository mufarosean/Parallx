// habitDetector.ts — the missing brain for "you do this every morning" (Build-12).
//
// The sequence predictor (Build-2) learns "after A you touch B" — order, not
// CLOCK. It cannot represent "you refresh AI News around 8am every day." This
// detects exactly that: per action (a stable label like "refresh:AI News"), it
// finds whether the action recurs on most days AT A CONSISTENT TIME OF DAY — a
// daily habit. That's the signal that lets the agent offer: "you do this every
// morning — want me to automate it?" (which it can fulfil with cron_create).
//
// Deliberately cheap and explainable (no ML): bucket occurrences by day, measure
// the spread of time-of-day. A tight spread over enough days = a habit. Pure +
// deterministic (clock injected); persisted by MindService. The output is a
// suggestion for the human, never an automatic action.

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PER_DAY = 24 * 60;

export interface IHabitDetectorOptions {
  /** Look-back window in days. Default 14. */
  readonly windowDays?: number;
  /** Distinct days the action must appear on to confirm a habit. Default 3. */
  readonly minDays?: number;
  /** Max spread (std-dev, minutes) of time-of-day to count as "consistent". Default 75. */
  readonly toleranceMin?: number;
  /** Cap of timestamps kept per action. Default 60. */
  readonly maxPerAction?: number;
}

export interface IHabitReading {
  readonly action: string;
  readonly isDailyHabit: boolean;
  /** Typical time of day (minutes since midnight), or null. */
  readonly typicalMinuteOfDay: number | null;
  /** "08:05"-style label for the typical time, or null. */
  readonly typicalTime: string | null;
  readonly daysObserved: number;
  /** 0..1 — how confident this is a stable daily habit. */
  readonly confidence: number;
}

export interface IHabitState {
  readonly events: [string, number[]][];
  readonly proposed?: string[];
}

/** A 5-field cron expression that fires daily at the given minute-of-day. */
export function cronForMinuteOfDay(minute: number): string {
  const m = ((Math.round(minute) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${m % 60} ${Math.floor(m / 60)} * * *`;
}

export class HabitDetector {
  private _events = new Map<string, number[]>();
  private _proposed = new Set<string>();
  private readonly _windowDays: number;
  private readonly _minDays: number;
  private readonly _toleranceMin: number;
  private readonly _maxPerAction: number;

  constructor(opts: IHabitDetectorOptions = {}) {
    this._windowDays = Math.max(2, opts.windowDays ?? 14);
    this._minDays = Math.max(2, opts.minDays ?? 3);
    this._toleranceMin = Math.max(1, opts.toleranceMin ?? 75);
    this._maxPerAction = Math.max(4, opts.maxPerAction ?? 60);
  }

  /** Record an occurrence of `action` at `nowMs`. */
  observe(action: string, nowMs: number): void {
    if (!action) return;
    const arr = this._events.get(action) ?? [];
    arr.push(nowMs);
    if (arr.length > this._maxPerAction) arr.splice(0, arr.length - this._maxPerAction);
    this._events.set(action, arr);
  }

  /** Habit reading for one action. Pure given current state. */
  reading(action: string, nowMs: number): IHabitReading {
    const cutoff = nowMs - this._windowDays * DAY_MS;
    const ts = (this._events.get(action) ?? []).filter(t => t >= cutoff);
    const days = new Set(ts.map(t => Math.floor(t / DAY_MS)));
    const daysObserved = days.size;

    if (ts.length < this._minDays || daysObserved < this._minDays) {
      return { action, isDailyHabit: false, typicalMinuteOfDay: null, typicalTime: null, daysObserved, confidence: 0 };
    }

    const minutes = ts.map(t => minuteOfDay(t));
    const { mean, std } = circularStats(minutes);
    const consistent = std <= this._toleranceMin;
    const isDailyHabit = consistent && daysObserved >= this._minDays;

    // Confidence: more days + tighter clustering = higher.
    const dayScore = Math.min(1, daysObserved / this._windowDays);
    const tightScore = Math.max(0, 1 - std / this._toleranceMin);
    const confidence = isDailyHabit ? Math.min(1, 0.5 * dayScore + 0.5 * tightScore) : 0;

    return {
      action,
      isDailyHabit,
      typicalMinuteOfDay: Math.round(mean),
      typicalTime: formatTime(mean),
      daysObserved,
      confidence,
    };
  }

  /** All actions that are currently confident daily habits, strongest first. */
  habits(nowMs: number, minConfidence = 0.4): IHabitReading[] {
    return [...this._events.keys()]
      .map(a => this.reading(a, nowMs))
      .filter(r => r.isDailyHabit && r.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Whether this habit has already been proposed for automation (propose once). */
  wasProposed(action: string): boolean { return this._proposed.has(action); }
  markProposed(action: string): void { this._proposed.add(action); }

  toState(): IHabitState { return { events: [...this._events.entries()], proposed: [...this._proposed] }; }
  restore(state: IHabitState | undefined): void {
    if (state && Array.isArray(state.events)) {
      this._events = new Map(state.events.filter(e => Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1])));
    }
    if (state && Array.isArray(state.proposed)) this._proposed = new Set(state.proposed.filter(x => typeof x === 'string'));
  }
}

function minuteOfDay(ms: number): number {
  return Math.floor((ms % DAY_MS) / 60000);
}

function formatTime(minute: number): string {
  const m = ((Math.round(minute) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Mean + std-dev of times-of-day on a 24h CIRCLE (so 23:50 and 00:10 are close,
 * not 23h40m apart). Uses the mean-of-angles trick.
 */
function circularStats(minutes: number[]): { mean: number; std: number } {
  if (minutes.length === 0) return { mean: 0, std: 0 };
  let sx = 0, sy = 0;
  for (const m of minutes) {
    const a = (m / MIN_PER_DAY) * 2 * Math.PI;
    sx += Math.cos(a); sy += Math.sin(a);
  }
  const meanAngle = Math.atan2(sy / minutes.length, sx / minutes.length);
  const meanMin = ((meanAngle / (2 * Math.PI)) * MIN_PER_DAY + MIN_PER_DAY) % MIN_PER_DAY;
  // Circular std-dev via R (mean resultant length).
  const R = Math.sqrt((sx / minutes.length) ** 2 + (sy / minutes.length) ** 2);
  const circStdRad = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-9, R))));
  const std = (circStdRad / (2 * Math.PI)) * MIN_PER_DAY;
  return { mean: meanMin, std };
}
