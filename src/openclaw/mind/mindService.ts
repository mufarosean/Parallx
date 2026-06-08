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
  compact,
  type IMindEntry,
  type IMindPrediction,
  type IMindPredictionOption,
} from './agentMindModel.js';
import { ReflectionScheduler, type IReflectionState } from './reflectionScheduler.js';
import { HabitDetector, type IHabitState, type IHabitReading } from './habitDetector.js';
import type { IMindStore } from './mindStore.js';
import { ActionLedger, type AgentActionKind, type IAgentActionRecord } from './actionLedger.js';
import { CapabilityMeter, type ICapabilityReading } from './capabilityMeter.js';
import { SkillProbe, type ISkillProbeReading, type ISkillProbeState } from './skillProbe.js';
import { NagGovernor, type INagState, type NagOutcome } from './nagGovernor.js';
import type { IStorage } from '../../platform/storage.js';

/** A serializable, UI-facing view of the whole MIND — for the Mind panel. */
export interface IMindSnapshot {
  readonly available: true;
  /** Mean Brier over resolved predictions (lower better); null if none yet. */
  readonly fidelity: number | null;
  readonly beliefs: readonly { readonly id: string; readonly kind: string; readonly content: string; readonly confidence: number; readonly provenance: readonly string[] }[];
  readonly predictions: readonly { readonly subject: string; readonly top: string; readonly resolved?: { readonly actual: string; readonly brier: number } }[];
  readonly audit: { readonly ok: boolean; readonly brokenAt?: number };
  readonly recentActions: readonly { readonly kind: string; readonly summary: string; readonly origin: string; readonly ts: number }[];
  /** The conscience: is the human getting stronger, or is the agent taking over? */
  readonly capability: ICapabilityReading;
  /** The active conscience: the human's unaided fluency on held-out recurring tasks. */
  readonly fluency: ISkillProbeReading;
  /** The nag governor: how often the user dismisses, and whether it's throttled. */
  readonly nag: { readonly dismissRatio: number | null; readonly throttled: boolean };
  /** Daily habits detected — recurring actions the agent could offer to automate. */
  readonly habits: readonly IHabitReading[];
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
const SKILLPROBE_KEY = 'autonomy.skillprobe.v1';
const NAG_KEY = 'autonomy.nag.v1';
const REFLECTION_KEY = 'autonomy.reflection.v1';
const HABIT_KEY = 'autonomy.habits.v1';

export class MindService {
  private _entries: readonly IMindEntry[] = [];
  private _loaded = false;
  private readonly _now: () => number;
  private readonly _genId: () => string;
  private readonly _meter = new CapabilityMeter();
  private readonly _probe = new SkillProbe();
  private readonly _nag = new NagGovernor();
  private readonly _reflection = new ReflectionScheduler();
  private readonly _habits = new HabitDetector();
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
    await this._loadProbe();
    await this._loadNag();
    await this._loadReflection();
    await this._loadHabits();
    this._loaded = true;
  }

  private async _loadHabits(): Promise<void> {
    if (!this._capStorage) return;
    try {
      const raw = await this._capStorage.get(HABIT_KEY);
      if (raw) this._habits.restore(JSON.parse(raw) as IHabitState);
    } catch { /* corrupt → fresh */ }
  }

  private async _saveHabits(): Promise<void> {
    if (!this._capStorage) return;
    try { await this._capStorage.set(HABIT_KEY, JSON.stringify(this._habits.toState())); }
    catch { /* best-effort */ }
  }

  /**
   * Record a discrete user ACTION (e.g. "dashboard:refresh AI News") for habit
   * detection — distinct from recordHuman (file edits, for the conscience). This
   * is how the agent learns "you do X every morning" and can offer to automate it.
   */
  async observeAction(action: string, nowMs = this._now()): Promise<void> {
    if (!action) return;
    this._habits.observe(action, nowMs);
    await this._saveHabits();
  }

  /** Confirmed daily habits — recurring actions the agent could offer to automate. */
  habits(nowMs = this._now()): IHabitReading[] {
    return this._habits.habits(nowMs);
  }

  /**
   * Deterministically pull habits that are newly confirmed and not yet proposed,
   * marking them proposed (once). This is the LLM-FREE path: the caller surfaces a
   * concrete "Automate it?" card for each, so the proposal reliably appears the
   * moment a habit confirms — it never depends on the model choosing to mention it.
   */
  async takePendingHabitProposals(nowMs = this._now()): Promise<IHabitReading[]> {
    const pending = this._habits.habits(nowMs).filter(h => !this._habits.wasProposed(h.action));
    for (const h of pending) this._habits.markProposed(h.action);
    if (pending.length > 0) await this._saveHabits();
    return pending;
  }

  private async _loadReflection(): Promise<void> {
    if (!this._capStorage) return;
    try {
      const raw = await this._capStorage.get(REFLECTION_KEY);
      if (raw) this._reflection.restore(JSON.parse(raw) as IReflectionState);
    } catch { /* corrupt → fresh */ }
  }

  private async _saveReflection(): Promise<void> {
    if (!this._capStorage) return;
    try { await this._capStorage.set(REFLECTION_KEY, JSON.stringify(this._reflection.toState())); }
    catch { /* best-effort */ }
  }

  /** Slow loop (Build-10): is a daily reflection due? */
  reflectionDue(nowMs = this._now()): boolean {
    return this._reflection.isDue(nowMs);
  }

  /**
   * Run the daily consolidation: deliberately prune stale/decayed beliefs (not
   * just at the save boundary), mark reflected, and ledger it. The agent's own
   * higher-level consolidation happens in the reflection LLM turn (via
   * mind_remember); this is the housekeeping half.
   */
  async reflect(nowMs = this._now()): Promise<{ pruned: number }> {
    const before = this._entries.length;
    const { kept } = compact(this._entries, nowMs);
    const pruned = before - kept.length;
    this._entries = kept;
    await this._store.save(this._entries, nowMs);
    this._reflection.markReflected(nowMs);
    await this._saveReflection();
    await this._ledger.append(
      { kind: 'review', summary: `daily reflection — consolidated; pruned ${pruned} stale belief(s)`, origin: 'heartbeat:reflection' },
      nowMs,
    );
    return { pruned };
  }

  private async _loadNag(): Promise<void> {
    if (!this._capStorage) return;
    try {
      const raw = await this._capStorage.get(NAG_KEY);
      if (raw) this._nag.restore(JSON.parse(raw) as INagState);
    } catch { /* corrupt → fresh governor */ }
  }

  private async _saveNag(): Promise<void> {
    if (!this._capStorage) return;
    try { await this._capStorage.set(NAG_KEY, JSON.stringify(this._nag.toState())); }
    catch { /* best-effort */ }
  }

  /**
   * Record the user's response to a surfaced suggestion — the nag governor's
   * EXTERNAL sensor (their own Do-it/Dismiss clicks). 'act' keeps the agent
   * chatty; sustained 'dismiss' throttles it.
   */
  async recordFeedback(outcome: NagOutcome, nowMs = this._now()): Promise<void> {
    this._nag.recordOutcome(outcome, nowMs);
    await this._saveNag();
  }

  /** May the agent surface an interruption now? (Consumes from the nag budget.) */
  async allowInterruption(nowMs = this._now()): Promise<boolean> {
    const ok = this._nag.allowInterruption(nowMs);
    await this._saveNag();
    return ok;
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

  private async _loadProbe(): Promise<void> {
    if (!this._capStorage) return;
    try {
      const raw = await this._capStorage.get(SKILLPROBE_KEY);
      if (raw) this._probe.restore(JSON.parse(raw) as ISkillProbeState);
    } catch { /* corrupt → fresh probe */ }
  }

  private async _saveProbe(): Promise<void> {
    if (!this._capStorage) return;
    try { await this._capStorage.set(SKILLPROBE_KEY, JSON.stringify(this._probe.toState())); }
    catch { /* best-effort */ }
  }

  /**
   * Record a HUMAN action (their own work) — the denominator of the conscience.
   * When the action names a recurring `skill` (e.g. a file path), it also feeds
   * the held-out skills probe (unaided-fluency measurement).
   */
  async recordHuman(nowMs = this._now(), skill?: string): Promise<void> {
    this._meter.recordHuman(nowMs);
    if (skill) {
      this._probe.observe(skill, nowMs);
      this._probe.maybeIssue(nowMs); // rate-limited internally; may hold a skill out
      await this._saveProbe();
    }
    await this._saveMeter();
  }

  /** The conscience reading: assistance share, trend, and the deskilling alarm. */
  capability(): ICapabilityReading {
    return this._meter.read();
  }

  /** The active conscience reading: unaided-fluency on held-out recurring tasks. */
  fluency(): ISkillProbeReading {
    return this._probe.reading();
  }

  /** The live MIND (for the mind panel / inspection). */
  current(): readonly IMindEntry[] {
    return this._entries;
  }

  /** The compact block injected into the heartbeat seed so the agent reads its
   *  own prior beliefs and open predictions — the substance of continuity. */
  seedBlock(): string {
    const base = summarizeMind(this._entries, this._now());
    const habits = this._habits.habits(this._now());
    if (habits.length === 0) return base;
    const lines = habits.slice(0, 5).map(h => `- "${h.action}" — most days around ${h.typicalTime} (${h.daysObserved} days seen)`);
    return `${base}\n\nDaily habits I've noticed — you may OFFER to automate one with cron_create (propose via NOTE/ACT; never schedule without the user's yes):\n${lines.join('\n')}`;
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
   * The human corrects the agent's model: forget a belief by id. Ledgered with
   * origin 'user' so the correction itself is auditable. Returns false if not
   * found. This is the human steering the mind — the highest-trust affordance.
   */
  async forget(id: string): Promise<boolean> {
    const target = this._entries.find(e => e.id === id);
    if (!target) return false;
    this._entries = this._entries.filter(e => e.id !== id);
    await this._store.save(this._entries, this._now());
    await this._ledger.append(
      { kind: 'belief-update', summary: `forgot (user correction): ${target.content.slice(0, 120)}`, origin: 'user' },
      this._now(),
    );
    return true;
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
      .map(e => ({ id: e.id, kind: e.kind, content: e.content, confidence: decayedConfidence(e, nowMs), provenance: e.provenance }))
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
      fluency: this._probe.reading(),
      nag: (() => { const r = this._nag.reading(this._now()); return { dismissRatio: r.dismissRatio, throttled: r.throttled }; })(),
      habits: this._habits.habits(this._now()),
    };
  }
}
