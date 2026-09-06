// habitDetector.ts — the missing brain for "you do this every morning" (Build-12).
//
// The sequence predictor (Build-2) learns "after A you touch B" — order, not
// CLOCK. It cannot represent "you refresh AI News around 8am every day." This
// detects exactly that: per action (a stable label like "refresh:AI News"), it
// finds whether the action recurs on most days AT A CONSISTENT TIME OF DAY — a
// daily habit. That is the signal that becomes a suggested workflow the user
// approves in the Workflows panel (workflowSuggestions.ts).
//
// A day has SESSIONS. Someone who works at 5am and again at 8pm opens the
// planner twice a day at two consistent times; measured as one spread that
// looks like scatter and never confirms. So occurrences are first grouped by
// time of day, and each group is judged on its own. One action can carry two
// habits, each with its own key ("opened planner@05:10"), proposal and dismissal.
//
// Deliberately cheap and explainable (no ML): bucket occurrences by day, measure
// the spread of time-of-day within a session. A tight spread over enough days =
// a habit. Pure + deterministic (clock injected); persisted by MindService. The
// output is a suggestion for the human, never an automatic action.

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
  /** Cap of distinct actions tracked (evicts least-recently-seen). Default 300. */
  readonly maxActions?: number;
  /**
   * Minute of day for a timestamp. Default UTC (pure, deterministic for tests).
   * Production passes `localMinuteOfDay`: the suggested schedule ("Daily At
   * 05:14") is read by the cron grid in LOCAL time, so the habit's time must
   * be measured in local time too, or a 5am habit is filed as 10:14.
   */
  readonly minuteOfDay?: (ms: number) => number;
}

/** Minute of day in the machine's local time zone (what the cron grid uses). */
export function localMinuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Map an activity-journal event to a habit-detector action key, or undefined
 * when the event isn't habit material. Only deliberate, recurrence-worthy user
 * gestures qualify: opening an editor, focusing a view. EXCLUDED on purpose:
 * - `signal:*` sources — they already feed observeAction through their own
 *   lane (chat/main.ts); double-observing fakes tighter daily clustering.
 * - `command` source — the command tap labels EVERY executeCommand fire as
 *   the user, including programmatic plumbing and the AI's app__run_command,
 *   so a scheduled dispatch would train a perfectly-clustered fake "user
 *   habit" (the self-echo loop). Off the table until command execution
 *   carries an initiator.
 */
export function habitActionForActivity(ev: {
  readonly actor: string;
  readonly source: string;
  readonly verb: string;
  readonly object: string;
  readonly count: number;
}): string | undefined {
  if (ev.actor !== 'user') return undefined;
  // Coalesced re-fires mutate the same line (count grows); only the first
  // fire of a burst is one occurrence of the gesture.
  if (ev.count > 1) return undefined;
  const ok =
    (ev.source === 'editor' && ev.verb === 'opened')
    || (ev.source === 'focus' && ev.verb === 'focused');
  if (!ok) return undefined;
  return `${ev.verb} ${ev.object}`;
}

export interface IHabitReading {
  /** Dedupe key: the action plus the session's typical time ("opened planner@08:05"),
   *  or the bare action when no session qualified. */
  readonly key: string;
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
  /** Propose-once markers: bare actions (from before sessions existed) or
   *  "action@HH:MM" keys, one per session of the day. */
  readonly proposed?: string[];
}

/** A 5-field cron expression that fires daily at the given minute-of-day. */
export function cronForMinuteOfDay(minute: number): string {
  const m = ((Math.round(minute) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${m % 60} ${Math.floor(m / 60)} * * *`;
}

/** The key a habit is proposed, suggested and dismissed under: the action
 *  plus the session's typical time. Two sessions of one action are two keys. */
export function habitKey(action: string, minuteOfDay: number): string {
  return `${action}@${formatTime(minuteOfDay)}`;
}

/** Split a key back into its action and minute. A bare action has no minute. */
export function parseHabitKey(key: string): { action: string; minuteOfDay: number | null } {
  const m = /^(.*)@(\d{2}):(\d{2})$/.exec(key);
  if (!m) return { action: key, minuteOfDay: null };
  return { action: m[1], minuteOfDay: parseInt(m[2], 10) * 60 + parseInt(m[3], 10) };
}

/**
 * Does a stored key cover this habit? A bare action covers every session of
 * that action. A timed key covers the session within `mergeMin` minutes of it
 * around the clock, so a habit drifting from 08:05 to 08:40 stays one habit.
 */
export function isSameHabitKey(stored: string, action: string, minuteOfDay: number | null, mergeMin = 150): boolean {
  const parsed = parseHabitKey(stored);
  if (parsed.action !== action) return false;
  if (parsed.minuteOfDay === null || minuteOfDay === null) return true;
  const raw = Math.abs(parsed.minuteOfDay - minuteOfDay) % MIN_PER_DAY;
  return Math.min(raw, MIN_PER_DAY - raw) <= mergeMin;
}
export class HabitDetector {
  private _events = new Map<string, number[]>();
  private _proposed = new Set<string>();
  private readonly _windowDays: number;
  private readonly _minDays: number;
  private readonly _toleranceMin: number;
  private readonly _maxPerAction: number;
  private readonly _maxActions: number;
  private readonly _minuteOfDay: (ms: number) => number;

  constructor(opts: IHabitDetectorOptions = {}) {
    this._minuteOfDay = opts.minuteOfDay ?? utcMinuteOfDay;
    this._windowDays = Math.max(2, opts.windowDays ?? 14);
    this._minDays = Math.max(2, opts.minDays ?? 3);
    this._toleranceMin = Math.max(1, opts.toleranceMin ?? 75);
    this._maxPerAction = Math.max(4, opts.maxPerAction ?? 60);
    this._maxActions = Math.max(8, opts.maxActions ?? 300);
  }

  /** Record an occurrence of `action` at `nowMs`. */
  observe(action: string, nowMs: number): void {
    if (!action) return;
    const arr = this._events.get(action) ?? [];
    arr.push(nowMs);
    if (arr.length > this._maxPerAction) arr.splice(0, arr.length - this._maxPerAction);
    this._events.set(action, arr);
    // Key cap: the activity-journal lane feeds far more distinct actions than
    // the signal lane ever did (every pdf name, every view). Evict the action
    // least recently SEEN so one-off gestures age out and the state blob in
    // workspace storage stays bounded. The _proposed marker deliberately
    // SURVIVES eviction: it only ever holds confirmed-habit keys (tiny), and
    // erasing it would re-arm the "Automate it?" nag if a dismissed routine
    // ever re-forms after its events aged out.
    this._evictToCap(action);
  }

  /** Evict least-recently-seen keys until the map fits the cap (never the just-observed key). */
  private _evictToCap(keep?: string): void {
    while (this._events.size > this._maxActions) {
      let coldest: string | undefined;
      let coldestTs = Infinity;
      for (const [key, ts] of this._events) {
        if (key === keep) continue;
        const last = ts.length > 0 ? ts[ts.length - 1] : 0;
        if (last < coldestTs) { coldestTs = last; coldest = key; }
      }
      if (coldest === undefined) return; // only the protected key remains
      this._events.delete(coldest);
    }
  }

  /** Habit reading for one action. Pure given current state. */
  /**
   * One reading per SESSION of the day. The occurrences inside the window are
   * grouped by time of day (a gap wider than twice the tolerance starts a new
   * group, and midnight is no gap at all), and each group is judged on its
   * own: enough distinct days, and a tight enough spread. A person who opens
   * the planner at 5am and again at 8pm has two habits, not a scattered one,
   * and each gets its own key, its own proposal, and its own dismissal.
   */
  readings(action: string, nowMs: number): IHabitReading[] {
    const cutoff = nowMs - this._windowDays * DAY_MS;
    const ts = (this._events.get(action) ?? []).filter(t => t >= cutoff);
    if (ts.length === 0) return [];
    return clusterByTimeOfDay(ts, this._toleranceMin * 2, this._minuteOfDay).map(group => this._judge(action, group));
  }

  /** The strongest session for an action. When no session qualifies, the
   *  reading is "not a habit" over every day the action was seen. */
  reading(action: string, nowMs: number): IHabitReading {
    const best = this.readings(action, nowMs)
      .filter(r => r.isDailyHabit)
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (best) return best;
    const cutoff = nowMs - this._windowDays * DAY_MS;
    const ts = (this._events.get(action) ?? []).filter(t => t >= cutoff);
    const daysObserved = new Set(ts.map(t => Math.floor(t / DAY_MS))).size;
    return { key: action, action, isDailyHabit: false, typicalMinuteOfDay: null, typicalTime: null, daysObserved, confidence: 0 };
  }

  private _judge(action: string, ts: readonly number[]): IHabitReading {
    const days = new Set(ts.map(t => Math.floor(t / DAY_MS)));
    const daysObserved = days.size;

    if (ts.length < this._minDays || daysObserved < this._minDays) {
      return { key: action, action, isDailyHabit: false, typicalMinuteOfDay: null, typicalTime: null, daysObserved, confidence: 0 };
    }

    const { mean, std } = circularStats(ts.map(t => this._minuteOfDay(t)));
    const consistent = std <= this._toleranceMin;
    const isDailyHabit = consistent && daysObserved >= this._minDays;

    const dayScore = Math.min(1, daysObserved / this._windowDays);
    const tightScore = Math.max(0, 1 - std / this._toleranceMin);
    const confidence = isDailyHabit ? Math.min(1, 0.5 * dayScore + 0.5 * tightScore) : 0;
    const minute = Math.round(mean);

    return {
      key: habitKey(action, minute),
      action,
      isDailyHabit,
      typicalMinuteOfDay: minute,
      typicalTime: formatTime(mean),
      daysObserved,
      confidence,
    };
  }

  /** Every confirmed habit across every action and every session, strongest first. */
  habits(nowMs: number, minConfidence = 0.4): IHabitReading[] {
    return [...this._events.keys()]
      .flatMap(a => this.readings(a, nowMs))
      .filter(r => r.isDailyHabit && r.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Propose-once, per session of the day. A marker made before sessions
   * existed is a bare action and covers every session of that action. A timed
   * marker covers the session it names, with drift tolerance, so a habit that
   * slides from 08:05 to 08:40 is still the same proposal.
   */
  wasProposed(action: string, minuteOfDay?: number | null): boolean {
    if (this._proposed.has(action)) return true;
    if (minuteOfDay === undefined || minuteOfDay === null) return false;
    for (const p of this._proposed) {
      if (isSameHabitKey(p, action, minuteOfDay, this._toleranceMin * 2)) return true;
    }
    return false;
  }
  markProposed(action: string, minuteOfDay?: number | null): void {
    this._proposed.add(minuteOfDay === undefined || minuteOfDay === null ? action : habitKey(action, minuteOfDay));
  }

  toState(): IHabitState { return { events: [...this._events.entries()], proposed: [...this._proposed] }; }
  restore(state: IHabitState | undefined): void {
    if (state && Array.isArray(state.events)) {
      this._events = new Map(state.events.filter(e => Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1])));
      this._evictToCap();
    }
    if (state && Array.isArray(state.proposed)) this._proposed = new Set(state.proposed.filter(x => typeof x === 'string'));
  }
}

/**
 * Group timestamps into sessions of the day. Sorted by minute of day, the
 * widest gap around the clock is where the day "starts" (so 23:55 and 00:05
 * sit together), and any further gap wider than `gapMin` opens a new group.
 */
function clusterByTimeOfDay(ts: readonly number[], gapMin: number, minuteOfDay: (ms: number) => number): number[][] {
  const pts = ts.map(t => ({ t, m: minuteOfDay(t) })).sort((a, b) => a.m - b.m);
  const n = pts.length;
  if (n === 1) return [[pts[0].t]];
  let start = 0;
  let widest = -1;
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n].m + (i === n - 1 ? MIN_PER_DAY : 0);
    const gap = next - pts[i].m;
    if (gap > widest) { widest = gap; start = (i + 1) % n; }
  }
  const groups: number[][] = [];
  let cur: number[] = [];
  let prev = -1;
  let wrapped = false;
  for (let k = 0; k < n; k++) {
    const idx = (start + k) % n;
    // The walk crosses midnight exactly when it wraps from the last sorted
    // point back to the first; from then on minutes count past the day.
    if (k > 0 && idx === 0) wrapped = true;
    const m = pts[idx].m + (wrapped ? MIN_PER_DAY : 0);
    if (cur.length > 0 && m - prev > gapMin) { groups.push(cur); cur = []; }
    cur.push(pts[idx].t);
    prev = m;
  }
  groups.push(cur);
  return groups;
}

function utcMinuteOfDay(ms: number): number {
  return Math.floor((ms % DAY_MS) / 60000);
}

function formatTime(minute: number): string {
  const m = ((Math.round(minute) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function circularStats(minutes: number[]): { mean: number; std: number } {
  if (minutes.length === 0) return { mean: 0, std: 0 };
  let sx = 0, sy = 0;
  for (const m of minutes) {
    const a = (m / MIN_PER_DAY) * 2 * Math.PI;
    sx += Math.cos(a); sy += Math.sin(a);
  }
  const meanAngle = Math.atan2(sy / minutes.length, sx / minutes.length);
  const meanMin = ((meanAngle / (2 * Math.PI)) * MIN_PER_DAY + MIN_PER_DAY) % MIN_PER_DAY;
  const R = Math.sqrt((sx / minutes.length) ** 2 + (sy / minutes.length) ** 2);
  const circStdRad = Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-9, R))));
  const std = (circStdRad / (2 * Math.PI)) * MIN_PER_DAY;
  return { mean: meanMin, std };
}
