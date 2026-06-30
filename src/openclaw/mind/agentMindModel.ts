// agentMindModel.ts — the agent's persistent inner model ("MIND"): the keystone
// of continuity (see docs/THE_LIVING_SYSTEM.md).
//
// The heartbeat is amnesiac today: every tick runs on a fresh ephemeral session
// that is purged, so model-fidelity can never compound and the trust flywheel
// can never spin. The MIND is the durable, agent-curated state the cognitive
// cycle READS and REWRITES each tick — beliefs about the user and the work, the
// open threads it is tracking, and falsifiable predictions it will be scored on.
//
// "Governed" is the load-bearing word, because self-summarizing agent memory is
// the documented engine of drift and poisoning. So the rules are built into the
// data model, not left to good behaviour:
//   1. PROVENANCE-REQUIRED  — you cannot assert into the MIND without citing a
//      receipt. A write with empty provenance is rejected.
//   2. DECAY                — every entry's confidence decays; stale beliefs fade
//      unless reaffirmed (so the model can't ossify around a one-time guess).
//   3. FORGETTING           — compaction is first-class, against unbounded bloat.
//   4. EXTERNAL GRADING     — predictions are scored by an OBSERVED outcome
//      (Brier), never by the model grading its own homework.
//
// Pure + deterministic (clock and id-gen injected) so every governance rule is
// unit-tested without a running app. Persistence and loop-wiring live elsewhere.

export type MindEntryKind = 'belief' | 'thread' | 'prediction';

/** Default confidence half-life: 14 days unreaffirmed → confidence halves. */
export const MIND_DEFAULT_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

interface IMindEntryBase {
  readonly id: string;
  readonly kind: MindEntryKind;
  /** One line the model can read back, e.g. "User works on design ~9–5 weekdays." */
  readonly content: string;
  /** 0..1 — stated confidence at last (re)affirmation. */
  readonly confidence: number;
  /** Receipt ids / sources that justify this entry. NEVER empty (governance #1). */
  readonly provenance: readonly string[];
  readonly createdMs: number;
  readonly updatedMs: number;
  /** Confidence half-life (ms). `Infinity` = never decays (use sparingly). */
  readonly halfLifeMs: number;
}

export interface IMindBelief extends IMindEntryBase {
  readonly kind: 'belief' | 'thread';
}

export interface IMindPredictionOption {
  readonly label: string;
  /** 0..1; options are mutually exclusive and SHOULD sum to ≤ 1 (the remainder
   *  is implicit "something else"). */
  readonly prob: number;
}

export interface IMindPrediction extends IMindEntryBase {
  readonly kind: 'prediction';
  /** What is forecast, e.g. "next file the user opens". */
  readonly subject: string;
  readonly options: readonly IMindPredictionOption[];
  /** Resolve-by deadline (absolute ms). */
  readonly horizonMs: number;
  /** Set once graded against an externally-observed outcome. */
  readonly resolved?: {
    readonly actual: string;
    readonly brier: number;
    readonly resolvedMs: number;
  };
}

export type IMindEntry = IMindBelief | IMindPrediction;

// ─── Decay ───────────────────────────────────────────────────────────────────

/** Exponential confidence decay since last (re)affirmation. Pure. */
export function decayedConfidence(entry: IMindEntry, nowMs: number): number {
  if (!Number.isFinite(entry.halfLifeMs) || entry.halfLifeMs <= 0) return entry.confidence;
  const age = Math.max(0, nowMs - entry.updatedMs);
  return entry.confidence * Math.pow(0.5, age / entry.halfLifeMs);
}

// ─── Governed writes ─────────────────────────────────────────────────────────

/** A write into the MIND. Provenance is required (governance #1). */
export interface IMindUpdate {
  /** Provide to update an existing entry; omit to create. */
  readonly id?: string;
  readonly kind: MindEntryKind;
  readonly content: string;
  readonly confidence: number;
  readonly provenance: readonly string[];
  readonly halfLifeMs?: number;
  // prediction-only:
  readonly subject?: string;
  readonly options?: readonly IMindPredictionOption[];
  readonly horizonMs?: number;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * Apply a governed write. Creates a new entry or merges into an existing one
 * (by id): content/confidence are replaced, provenance is UNIONED (the audit
 * trail only grows), timestamps advance. Returns the store UNCHANGED if the
 * update is invalid — empty provenance, blank content, or a malformed
 * prediction — so a bad write can never silently corrupt the model. Pure.
 */
export function applyUpdate(
  entries: readonly IMindEntry[],
  update: IMindUpdate,
  nowMs: number,
  genId: () => string,
): readonly IMindEntry[] {
  const content = (update.content ?? '').trim();
  const provenance = (update.provenance ?? []).map(p => p.trim()).filter(Boolean);
  if (!content || provenance.length === 0) return entries; // governance #1
  if (update.kind === 'prediction') {
    if (!update.subject?.trim() || !update.options || update.options.length === 0) return entries;
  }

  const halfLifeMs = update.halfLifeMs ?? MIND_DEFAULT_HALF_LIFE_MS;
  const confidence = clamp01(update.confidence);

  const existing = update.id ? entries.find(e => e.id === update.id) : undefined;
  if (existing) {
    const mergedProvenance = [...new Set([...existing.provenance, ...provenance])];
    const merged = {
      ...existing,
      content,
      confidence,
      halfLifeMs,
      provenance: mergedProvenance,
      updatedMs: nowMs,
    } as IMindEntry;
    return entries.map(e => (e.id === existing.id ? merged : e));
  }

  const base = {
    id: update.id ?? genId(),
    content,
    confidence,
    provenance,
    createdMs: nowMs,
    updatedMs: nowMs,
    halfLifeMs,
  };
  const created: IMindEntry = update.kind === 'prediction'
    ? { ...base, kind: 'prediction', subject: update.subject!.trim(), options: update.options!, horizonMs: update.horizonMs ?? nowMs }
    : { ...base, kind: update.kind };
  return [...entries, created];
}

// ─── Forgetting / compaction ─────────────────────────────────────────────────

export interface ICompactOptions {
  /** Drop entries whose DECAYED confidence is below this. Default 0.05. */
  readonly minConfidence?: number;
  /** Cap total entries; the least salient are dropped. Default 200. */
  readonly maxEntries?: number;
  /** Drop resolved predictions older than this. Default 7 days. */
  readonly keepResolvedMs?: number;
}

/**
 * Forgetting is first-class (governance #3): drop faded beliefs, aged-out
 * resolved predictions, and the least-salient overflow. Salience = decayed
 * confidence, recency tiebreak. Returns kept + dropped. Pure.
 */
export function compact(
  entries: readonly IMindEntry[],
  nowMs: number,
  opts: ICompactOptions = {},
): { readonly kept: readonly IMindEntry[]; readonly dropped: readonly IMindEntry[] } {
  const minConfidence = opts.minConfidence ?? 0.05;
  const maxEntries = opts.maxEntries ?? 200;
  const keepResolvedMs = opts.keepResolvedMs ?? 7 * 24 * 60 * 60 * 1000;

  const dropped: IMindEntry[] = [];
  let kept = entries.filter(e => {
    if (e.kind === 'prediction') {
      // An UNRESOLVED prediction owes an external outcome — never drop it for low
      // confidence; it is exactly the falsifiable commitment we score on.
      if (!e.resolved) return true;
      // Resolved predictions are the score record; keep until they age out.
      if (nowMs - e.resolved.resolvedMs > keepResolvedMs) { dropped.push(e); return false; }
      return true;
    }
    if (decayedConfidence(e, nowMs) < minConfidence) { dropped.push(e); return false; }
    return true;
  });

  if (kept.length > maxEntries) {
    const ranked = [...kept].sort((a, b) => {
      const d = decayedConfidence(b, nowMs) - decayedConfidence(a, nowMs);
      return d !== 0 ? d : b.updatedMs - a.updatedMs;
    });
    const survivors = new Set(ranked.slice(0, maxEntries).map(e => e.id));
    for (const e of kept) if (!survivors.has(e.id)) dropped.push(e);
    kept = kept.filter(e => survivors.has(e.id));
  }

  return { kept, dropped };
}

// ─── External prediction grading (Brier) ─────────────────────────────────────

/**
 * Categorical Brier score against an externally-observed `actual` outcome.
 * 0 = perfect, up to 2 = worst. The `actual` MUST come from observed reality
 * (the event bus), never from the model judging itself (governance #4). Pure.
 */
export function brierScore(options: readonly IMindPredictionOption[], actual: string): number {
  let score = 0;
  let matched = false;
  for (const o of options) {
    const y = o.label === actual ? 1 : 0;
    if (y) matched = true;
    score += (o.prob - y) ** 2;
  }
  if (!matched) score += 1; // the actual class was forecast with prob 0 → (0-1)^2
  return score;
}

/** Resolve a prediction against an observed outcome; attaches its Brier score. Pure. */
export function resolvePrediction(pred: IMindPrediction, actual: string, nowMs: number): IMindPrediction {
  return { ...pred, resolved: { actual, brier: brierScore(pred.options, actual), resolvedMs: nowMs } };
}

/** Mean Brier over resolved predictions — the fidelity meter. NaN if none. Pure. */
export function meanBrier(entries: readonly IMindEntry[]): number {
  const scores = entries.flatMap(e => (e.kind === 'prediction' && e.resolved ? [e.resolved.brier] : []));
  return scores.length === 0 ? NaN : scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ─── Seed rendering ──────────────────────────────────────────────────────────

/**
 * Render the live MIND as a compact block for the cognitive cycle's seed —
 * salient (decayed-confidence-weighted) first, predictions awaiting resolution
 * flagged. Beliefs the model can no longer justify (decayed) simply don't appear.
 */
export function summarizeMind(entries: readonly IMindEntry[], nowMs: number, maxItems = 12): string {
  // Seed floor (0.35) is much higher than the compact/prune floor (0.05): a
  // belief is KEPT in the store as it decays, but only surfaces in the review
  // seed while the agent is still genuinely confident in it. This stops weakly-
  // held or aging entries from being repeated to the model every tick.
  const SEED_MIN_CONFIDENCE = 0.35;
  const live = entries
    .map(e => ({ e, c: decayedConfidence(e, nowMs) }))
    .filter(x => x.c >= SEED_MIN_CONFIDENCE || (x.e.kind === 'prediction' && !x.e.resolved))
    .sort((a, b) => b.c - a.c)
    .slice(0, maxItems);

  if (live.length === 0) return 'MIND: (empty — no durable beliefs yet)';

  const lines = ['What I currently believe (confidence shown; fades if not reaffirmed):'];
  for (const { e, c } of live) {
    const pct = `${Math.round(c * 100)}%`;
    if (e.kind === 'prediction' && !e.resolved) {
      const top = [...e.options].sort((a, b) => b.prob - a.prob)[0];
      lines.push(`- [prediction · ${pct}] ${e.subject}: most likely "${top?.label}" (${Math.round((top?.prob ?? 0) * 100)}%) — awaiting outcome`);
    } else {
      lines.push(`- [${e.kind} · ${pct}] ${e.content}`);
    }
  }
  return lines.join('\n');
}
