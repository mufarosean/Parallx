// skillProbe.ts — the active half of the conscience (Build-7).
//
// The assistance-fade meter (capabilityMeter) watches the agent's SHARE of work.
// This watches the other thing the design demands: the human's UNAIDED ability,
// measured independently — the "held-out skills probe." For a recurring task the
// agent could help with, it occasionally designates the next occurrence as
// HELD-OUT (the agent should withhold proactive help), then measures whether the
// human completes it and how their latency trends. Fluency improving = capability
// growing; degrading = the human is losing the skill (deskilling).
//
// Honest status: until the agent has real "do-it" capability there is little to
// withhold from, so today this mostly measures the human's unaided fluency trend
// on their recurring work — which is exactly the signal we want, and the hold-out
// gate is ready for when do-it capability grows. Pure + deterministic; tested.

export interface ISkillProbeOptions {
  /** Recurrences before a skill is eligible to be probed. Default 3. */
  readonly minObservations?: number;
  /** Minimum time between issuing probes. Default 1 day. */
  readonly cooldownMs?: number;
  /** A probe expires if not completed within this window. Default 3 days. */
  readonly resolveWindowMs?: number;
  /** Resolved-latency samples kept for the trend. Default 8. */
  readonly trendSamples?: number;
}

interface ISkillStat { count: number; lastMs: number; }
interface IOpenProbe { skill: string; issuedMs: number; }
interface IResolved { skill: string; latencyMs: number; resolvedMs: number }

export type FluencyTrend = 'insufficient' | 'improving' | 'flat' | 'degrading';

export interface ISkillProbeReading {
  readonly issued: number;
  readonly completed: number;
  /** Fraction of issued probes the human completed unaided (null if none issued). */
  readonly completionRate: number | null;
  readonly trend: FluencyTrend;
  /** Median unaided latency over recent resolved probes (ms), or null. */
  readonly medianLatencyMs: number | null;
}

/** Serializable state for persistence. */
export interface ISkillProbeState {
  readonly skills: [string, ISkillStat][];
  readonly open?: IOpenProbe;
  readonly resolved: IResolved[];
  readonly issued: number;
  readonly lastProbeMs: number;
}

export class SkillProbe {
  private _skills = new Map<string, ISkillStat>();
  private _open: IOpenProbe | undefined;
  private _resolved: IResolved[] = [];
  private _issued = 0;
  private _lastProbeMs = Number.NEGATIVE_INFINITY;

  private readonly _minObservations: number;
  private readonly _cooldownMs: number;
  private readonly _resolveWindowMs: number;
  private readonly _trendSamples: number;

  constructor(opts: ISkillProbeOptions = {}) {
    this._minObservations = Math.max(1, opts.minObservations ?? 3);
    this._cooldownMs = Math.max(0, opts.cooldownMs ?? 24 * 60 * 60 * 1000);
    this._resolveWindowMs = Math.max(1, opts.resolveWindowMs ?? 3 * 24 * 60 * 60 * 1000);
    this._trendSamples = Math.max(2, opts.trendSamples ?? 8);
  }

  /** True while a held-out probe is open (so callers can withhold help). */
  get heldOutSkill(): string | undefined { return this._open?.skill; }

  /**
   * Record that the human performed `skill`. Resolves an open probe if this is
   * its completion (within the window), and updates recurrence stats. Returns the
   * resolved probe, if any.
   */
  observe(skill: string, nowMs: number): { resolved?: IResolved } {
    if (!skill) return {};

    let resolved: IResolved | undefined;
    if (this._open) {
      if (nowMs - this._open.issuedMs > this._resolveWindowMs) {
        this._open = undefined; // expired unresolved (human didn't return to it)
      } else if (this._open.skill === skill) {
        resolved = { skill, latencyMs: nowMs - this._open.issuedMs, resolvedMs: nowMs };
        this._resolved.push(resolved);
        if (this._resolved.length > this._trendSamples * 2) {
          this._resolved = this._resolved.slice(-this._trendSamples * 2);
        }
        this._open = undefined;
      }
    }

    const s = this._skills.get(skill) ?? { count: 0, lastMs: 0 };
    s.count += 1;
    s.lastMs = nowMs;
    this._skills.set(skill, s);

    return { resolved };
  }

  /**
   * Maybe issue a held-out probe: pick the most-recurring eligible skill, mark
   * the next occurrence held-out, and return it (the caller withholds help).
   * Returns undefined if a probe is open, in cooldown, or no skill is eligible.
   */
  maybeIssue(nowMs: number): string | undefined {
    if (this._open) return undefined;
    if (nowMs - this._lastProbeMs < this._cooldownMs) return undefined;

    let best: string | undefined;
    let bestCount = 0;
    for (const [skill, s] of this._skills) {
      if (s.count >= this._minObservations && s.count > bestCount) { best = skill; bestCount = s.count; }
    }
    if (!best) return undefined;

    this._open = { skill: best, issuedMs: nowMs };
    this._lastProbeMs = nowMs;
    this._issued += 1;
    return best;
  }

  /** The conscience reading: completion rate + unaided-fluency trend. */
  reading(): ISkillProbeReading {
    const completed = this._resolved.length;
    const completionRate = this._issued === 0 ? null : completed / this._issued;

    let trend: FluencyTrend = 'insufficient';
    let medianLatencyMs: number | null = null;
    if (completed >= 1) medianLatencyMs = median(this._resolved.map(r => r.latencyMs));
    if (completed >= 4) {
      const mid = Math.floor(completed / 2);
      const earlier = median(this._resolved.slice(0, mid).map(r => r.latencyMs));
      const later = median(this._resolved.slice(mid).map(r => r.latencyMs));
      // Faster (lower latency) later = improving fluency.
      const margin = 0.15 * earlier;
      if (later < earlier - margin) trend = 'improving';
      else if (later > earlier + margin) trend = 'degrading';
      else trend = 'flat';
    }

    return { issued: this._issued, completed, completionRate, trend, medianLatencyMs };
  }

  toState(): ISkillProbeState {
    return {
      skills: [...this._skills.entries()],
      open: this._open,
      resolved: this._resolved,
      issued: this._issued,
      lastProbeMs: Number.isFinite(this._lastProbeMs) ? this._lastProbeMs : 0,
    };
  }

  restore(state: ISkillProbeState | undefined): void {
    if (!state) return;
    try {
      this._skills = new Map(Array.isArray(state.skills) ? state.skills : []);
      this._open = state.open;
      this._resolved = Array.isArray(state.resolved) ? state.resolved : [];
      this._issued = typeof state.issued === 'number' ? state.issued : 0;
      this._lastProbeMs = typeof state.lastProbeMs === 'number' ? state.lastProbeMs : Number.NEGATIVE_INFINITY;
    } catch { /* keep fresh state */ }
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
