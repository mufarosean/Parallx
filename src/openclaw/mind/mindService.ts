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
  type IMindEntry,
  type IMindPrediction,
  type IMindPredictionOption,
} from './agentMindModel.js';
import type { IMindStore } from './mindStore.js';
import { ActionLedger, type AgentActionKind, type IAgentActionRecord } from './actionLedger.js';

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
}

export class MindService {
  private _entries: readonly IMindEntry[] = [];
  private _loaded = false;
  private readonly _now: () => number;
  private readonly _genId: () => string;

  constructor(
    private readonly _store: IMindStore,
    private readonly _ledger: ActionLedger,
    opts: IMindServiceOptions = {},
  ) {
    this._now = opts.now ?? Date.now;
    this._genId = opts.genId ?? defaultGenId;
  }

  /** Load the persisted MIND once at loop start. Idempotent. */
  async init(): Promise<void> {
    if (this._loaded) return;
    this._entries = await this._store.load();
    this._loaded = true;
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
    return this._ledger.append({ kind, summary, origin, detail, reversible }, this._now());
  }

  /** Audit: is the action ledger intact? (for the mind panel). */
  auditOk(): Promise<{ ok: boolean; brokenAt?: number }> {
    return this._ledger.verify();
  }
}
