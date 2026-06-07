// mindService.ts — the integration seam (Build-1d).
//
// Composes the three pure organs — the governed MIND model, the durable store,
// and the tamper-evident ledger — into the small vocabulary the cognitive cycle
// actually calls: read the MIND into the seed, remember (with provenance),
// predict (falsifiably), resolve against observed reality, and record every act
// to the ledger. This is the only object the heartbeat loop needs to hold.
//
// Holds the MIND in memory between ticks (loaded once via init) and writes
// through to the store on every mutation, so a crash never loses more than the
// last in-flight change. All clocks/ids injected for deterministic tests.

import {
  applyUpdate,
  summarizeMind,
  meanBrier,
  resolvePrediction,
  decayedConfidence,
  type IMindEntry,
  type IMindPrediction,
  type IMindPredictionOption,
} from './agentMindModel.js';
import type { IMindStore } from './mindStore.js';
import { ActionLedger, type AgentActionKind, type IAgentActionRecord } from './actionLedger.js';
import { CapabilityMeter, type ICapabilityReading } from './capabilityMeter.js';
import type { IStorage } from '../../platform/storage.js';

/** A serializable, UI-facing view of the whole MIND — for the Mind panel. */
export interface IMindSnapshot {
  readonly available: true;
  /** Mean Brier over resolved predictions (lower better); null if none yet. */
  readonly fidelity: number | null;
  readonly beliefs: readonly { readonly kind: string; readonly content: string; readonly confidence: number; readonly provenance: readonly string[] }[];
  readonly predictions: readonly { readonly subject: string; readonly top: string; readonly resolved?: { readonly actual: string; readonly brier: number } }[];
  readonly audit: { readonly ok: boolean; readonly brokenAt?: number };
  readonly recentActions: readonly { readonly kind: string; readonly summary: string; readonly origin: string; readonly ts: number }[];
  /** The conscience: is the human getting stronger, or is the agent taking over? */
  readonly capability: ICapabilityReading;
}

function defaultGenId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') {
      return (crypto as Crypto).randomUUID();
    }
  } catch { /* fall through */ }
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface IMindServiceOptions {
  readonly now?: () => number;
  readonly genId?: () => string;
  /** Optional storage for the persistent capability meter (the conscience). */
  readonly capabilityStorage?: IStorage;
}

const CAPABILITY_KEY = 'autonomy.capability.v1';

export class MindService {
  private _entries: readonly IMindEntry[] = [];
  private _loaded = false;
  private readonly _now: () => number;
  private readonly _genId: () => string;
  private readonly _meter = new CapabilityMeter();
  private readonly _capStorage?: IStorage;

  constructor(
    private readonly _store: IMindStore,
    private readonly _ledger: ActionLedger,
    opts: IMindServiceOptions = {},
  ) {
    this._now = opts.now ?? Date.now;
    this._genId = opts.genId ?? defaultGenId;
    this._capStorage = opts.capabilityStorage;
  }

  /** Load the persisted MIND once at loop start. Idempotent. */
  async init(): Promise<void> {
    if (this._loaded) return;
    this._entries = await this._store.load();
    await this._loadMeter();
    this._loaded = true;
  }

  private async _loadMeter(): Promise<void> {
    if (!this._capStorage) return;
    try {
      const raw = await this._capStorage.get(CAPABILITY_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) this._meter.restore(parsed as { key: number; human: number; agent: number }[]);
    } catch { /* corrupt → fresh meter */ }
  }

  private async _saveMeter(): Promise<void> {
    if (!this._capStorage) return;
    try { await this._capStorage.set(CAPABILITY_KEY, JSON.stringify(this._meter.snapshotBuckets())); }
    catch { /* best-effort */ }
  }

  /** Record a HUMAN action (their own work) — the denominator of the conscience. */
  async recordHuman(nowMs = this._now()): Promise<void> {
    this._meter.recordHuman(nowMs);
    await this._saveMeter();
  }

  /** The conscience reading: assistance share, trend, and the deskilling alarm. */
  capability(): ICapabilityReading {
    return this._meter.read();
  }

  /** The live MIND (for the mind panel / inspection). */
  current(): readonly IMindEntry[] {
    return this._entries;
  }

  /** The compact block injected into the heartbeat seed so the agent reads its
   *  own prior beliefs and open predictions — the substance of continuity. */
  seedBlock(): string {
    return summarizeMind(this._entries, this._now());
  }

  /** Fidelity meter: mean Brier over resolved predictions (NaN if none). */
  fidelity(): number {
    return meanBrier(this._entries);
  }

  /**
   * Governed write of a belief/thread. Returns false if rejected (no provenance,
   * blank content) — the governance rule is enforced here, not trusted. Persists
   * and ledgers on success.
   */
  async remember(
    kind: 'belief' | 'thread',
    content: string,
    confidence: number,
    provenance: readonly string[],
    id?: string,
  ): Promise<boolean> {
    const next = applyUpdate(this._entries, { id, kind, content, confidence, provenance }, this._now(), this._genId);
    if (next === this._entries) return false; // governance rejected it
    this._entries = next;
    await this._store.save(this._entries, this._now());
    await this._ledger.append({ kind: 'belief-update', summary: content, origin: 'mind' }, this._now());
    return true;
  }

  /**
   * Record a falsifiable prediction the agent will be graded on by REALITY.
   * Returns the created prediction, or undefined if rejected.
   */
  async predict(
    subject: string,
    options: readonly IMindPredictionOption[],
    horizonMs: number,
    provenance: readonly string[],
  ): Promise<IMindPrediction | undefined> {
    const confidence = options.reduce((m, o) => Math.max(m, o.prob), 0);
    const next = applyUpdate(
      this._entries,
      { kind: 'prediction', content: subject, confidence, provenance, subject, options, horizonMs: this._now() + horizonMs },
      this._now(),
      this._genId,
    );
    if (next === this._entries) return undefined;
    const created = next[next.length - 1] as IMindPrediction;
    this._entries = next;
    await this._store.save(this._entries, this._now());
    await this._ledger.append({ kind: 'prediction', summary: `${subject} → ${options.map(o => `${o.label}:${o.prob}`).join(', ')}`, origin: 'mind' }, this._now());
    return created;
  }

  /**
   * Grade a prediction against an EXTERNALLY-observed outcome (never the model's
   * self-judgement). Returns the Brier score, or undefined if not found/already
   * resolved. Persists and ledgers.
   */
  async resolve(predictionId: string, actual: string): Promise<number | undefined> {
    const target = this._entries.find(e => e.id === predictionId);
    if (!target || target.kind !== 'prediction' || target.resolved) return undefined;
    const resolved = resolvePrediction(target, actual, this._now());
    this._entries = this._entries.map(e => (e.id === predictionId ? resolved : e));
    await this._store.save(this._entries, this._now());
    await this._ledger.append(
      { kind: 'prediction-resolved', summary: `${target.subject} → actual "${actual}" (brier ${resolved.resolved!.brier.toFixed(3)})`, origin: 'mind' },
      this._now(),
    );
    return resolved.resolved!.brier;
  }

  /** Record an action to the audit ledger (review/note/act/noop/deferred/...). */
  async record(kind: AgentActionKind, summary: string, origin: string, detail?: string, reversible?: boolean): Promise<IAgentActionRecord> {
    const rec = await this._ledger.append({ kind, summary, origin, detail, reversible }, this._now());
    // An 'act' is the agent doing substantive work on the user's behalf — the
    // numerator of the conscience. (note/noop/review are not "doing the work".)
    if (kind === 'act') {
      this._meter.recordAgent(this._now());
      await this._saveMeter();
    }
    return rec;
  }

  /** Audit: is the action ledger intact? (for the mind panel). */
  auditOk(): Promise<{ ok: boolean; brokenAt?: number }> {
    return this._ledger.verify();
  }

  /**
   * A serializable view of the whole MIND for the Mind panel — beliefs (with
   * live decayed confidence), predictions (pending + graded), the fidelity
   * meter, the audit verdict, and recent ledger actions. Read-only; the mind is
   * the agent's, but the human can SEE all of it (transparency = trust).
   */
  async snapshot(nowMs = this._now()): Promise<IMindSnapshot> {
    const entries = this._entries;
    const beliefs = entries
      .filter(e => e.kind !== 'prediction')
      .map(e => ({ kind: e.kind, content: e.content, confidence: decayedConfidence(e, nowMs), provenance: e.provenance }))
      .sort((a, b) => b.confidence - a.confidence);
    const predictions = entries
      .filter((e): e is IMindPrediction => e.kind === 'prediction')
      .map(p => ({
        subject: p.subject,
        top: [...p.options].sort((a, b) => b.prob - a.prob)[0]?.label ?? '(none)',
        resolved: p.resolved ? { actual: p.resolved.actual, brier: p.resolved.brier } : undefined,
      }));
    const audit = await this._ledger.verify();
    const recent = (await this._ledger.load()).slice(-20).reverse();
    const fid = meanBrier(entries);
    return {
      available: true,
      fidelity: Number.isNaN(fid) ? null : fid,
      beliefs,
      predictions,
      audit,
      recentActions: recent.map(r => ({ kind: r.kind, summary: r.summary, origin: r.origin, ts: r.ts })),
      capability: this._meter.read(),
    };
  }
}
