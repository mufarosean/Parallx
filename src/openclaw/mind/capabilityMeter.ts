// capabilityMeter.ts — the conscience (Build-6).
//
// The whole point of the system (purpose #2) is to make the HUMAN more capable,
// not to quietly replace them. The most dangerous failure isn't error — it's
// DESKILLING (Shifting-the-Burden): the agent gets useful, the human offloads
// more and more, and two years on they're helpless without it, with the
// dashboard still green. THE_LIVING_SYSTEM calls this "the meter that is the
// conscience," and insists it be measured INDEPENDENTLY of the agent before any
// more "do-it" capability ships.
//
// This is the assistance-fade signal: the agent's SHARE of activity over time.
// Human actions are counted from the human's own behaviour (their edits); agent
// actions from the tamper-evident ledger — never self-reported. A share that
// rises over time means the agent is taking over (deskilling); a stable or
// falling share means the human is staying in the driver's seat. Pure +
// deterministic (clock injected); unit-tested.

export interface ICapabilityMeterOptions {
  /** Bucket size (ms). Default 1 day. */
  readonly bucketMs?: number;
  /** How many buckets to retain. Default 14. */
  readonly windowBuckets?: number;
  /** Agent share at/above which a RISING trend counts as deskilling risk. Default 0.6. */
  readonly riskShare?: number;
  /** Minimum rise (later-half share − earlier-half share) to call the trend rising. Default 0.1. */
  readonly riseMargin?: number;
}

interface IBucket { key: number; human: number; agent: number; }

export type CapabilityTrend = 'insufficient' | 'rising' | 'stable' | 'falling';

export interface ICapabilityReading {
  /** Agent's share of all activity over the window, 0..1 (null if no activity). */
  readonly assistanceShare: number | null;
  readonly trend: CapabilityTrend;
  /** True when the agent's share is high AND rising — the deskilling alarm. */
  readonly deskillingRisk: boolean;
  readonly humanActions: number;
  readonly agentActions: number;
}

export class CapabilityMeter {
  private _buckets: IBucket[] = [];
  private readonly _bucketMs: number;
  private readonly _windowBuckets: number;
  private readonly _riskShare: number;
  private readonly _riseMargin: number;

  constructor(opts: ICapabilityMeterOptions = {}) {
    this._bucketMs = Math.max(1, opts.bucketMs ?? 24 * 60 * 60 * 1000);
    this._windowBuckets = Math.max(2, opts.windowBuckets ?? 14);
    this._riskShare = opts.riskShare ?? 0.6;
    this._riseMargin = opts.riseMargin ?? 0.1;
  }

  recordHuman(nowMs: number): void { this._bucket(nowMs).human += 1; }
  recordAgent(nowMs: number): void { this._bucket(nowMs).agent += 1; }

  private _bucket(nowMs: number): IBucket {
    const key = Math.floor(nowMs / this._bucketMs);
    let b = this._buckets.find(x => x.key === key);
    if (!b) {
      b = { key, human: 0, agent: 0 };
      this._buckets.push(b);
      this._buckets.sort((a, c) => a.key - c.key);
      if (this._buckets.length > this._windowBuckets) {
        this._buckets = this._buckets.slice(this._buckets.length - this._windowBuckets);
      }
    }
    return b;
  }

  /** A reading over the retained window. Pure given current state. */
  read(): ICapabilityReading {
    const human = this._buckets.reduce((s, b) => s + b.human, 0);
    const agent = this._buckets.reduce((s, b) => s + b.agent, 0);
    const total = human + agent;
    const assistanceShare = total === 0 ? null : agent / total;

    const { trend, laterShare } = this._trendDetail();
    // Deskilling = the agent's share is high RIGHT NOW (the recent half) AND
    // rising over the window. The window average can look balanced even as the
    // human goes silent at the end, so the "high" check uses the recent share.
    const deskillingRisk =
      laterShare !== null &&
      laterShare >= this._riskShare &&
      trend === 'rising';

    return { assistanceShare, trend, deskillingRisk, humanActions: human, agentActions: agent };
  }

  /** Compare the earlier half of the active window to the later half. */
  private _trendDetail(): { trend: CapabilityTrend; laterShare: number | null } {
    const active = this._buckets.filter(b => b.human + b.agent > 0);
    if (active.length < 2) return { trend: 'insufficient', laterShare: null };
    const mid = Math.floor(active.length / 2);
    const share = (bs: IBucket[]): number | null => {
      const h = bs.reduce((s, b) => s + b.human, 0);
      const a = bs.reduce((s, b) => s + b.agent, 0);
      return h + a === 0 ? null : a / (h + a);
    };
    const e = share(active.slice(0, mid));
    const l = share(active.slice(mid));
    if (e === null || l === null) return { trend: 'insufficient', laterShare: l };
    if (l > e + this._riseMargin) return { trend: 'rising', laterShare: l };
    if (l < e - this._riseMargin) return { trend: 'falling', laterShare: l };
    return { trend: 'stable', laterShare: l };
  }
}
