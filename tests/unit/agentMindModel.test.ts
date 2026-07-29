import { describe, expect, it } from 'vitest';

import {
  applyUpdate,
  compact,
  decayedConfidence,
  brierScore,
  resolvePrediction,
  meanBrier,
  summarizeMind,
  MIND_DEFAULT_HALF_LIFE_MS,
  PREDICTION_EXPIRY_GRACE_MS,
  type IMindEntry,
  type IMindPrediction,
  type IMindUpdate,
} from '../../src/openclaw/mind/agentMindModel';

const DAY = 24 * 60 * 60 * 1000;
let counter = 0;
const genId = () => `e${++counter}`;

const belief = (over: Partial<IMindUpdate> = {}): IMindUpdate => ({
  kind: 'belief', content: 'User works on design ~9–5', confidence: 0.8, provenance: ['receipt-1'], ...over,
});

describe('governance #1 — provenance required', () => {
  it('rejects a write with no provenance (store unchanged)', () => {
    const out = applyUpdate([], belief({ provenance: [] }), 0, genId);
    expect(out).toEqual([]);
  });
  it('rejects blank content', () => {
    expect(applyUpdate([], belief({ content: '   ' }), 0, genId)).toEqual([]);
  });
  it('accepts a well-formed write and stamps provenance + timestamps', () => {
    const out = applyUpdate([], belief(), 1000, genId);
    expect(out).toHaveLength(1);
    expect(out[0].provenance).toEqual(['receipt-1']);
    expect(out[0].createdMs).toBe(1000);
    expect(out[0].halfLifeMs).toBe(MIND_DEFAULT_HALF_LIFE_MS);
  });
  it('merging an entry UNIONS provenance (audit trail only grows)', () => {
    const a = applyUpdate([], belief(), 0, () => 'fixed');
    const b = applyUpdate(a, belief({ id: 'fixed', provenance: ['receipt-2'], confidence: 0.9 }), DAY, genId);
    expect(b).toHaveLength(1);
    expect(b[0].provenance.sort()).toEqual(['receipt-1', 'receipt-2']);
    expect(b[0].confidence).toBe(0.9);
    expect(b[0].updatedMs).toBe(DAY);
  });
});

describe('governance #2 — decay', () => {
  it('halves confidence after one half-life', () => {
    const [e] = applyUpdate([], belief({ confidence: 0.8 }), 0, genId);
    expect(decayedConfidence(e, MIND_DEFAULT_HALF_LIFE_MS)).toBeCloseTo(0.4, 5);
  });
  it('does not decay before any time passes', () => {
    const [e] = applyUpdate([], belief({ confidence: 0.8 }), 0, genId);
    expect(decayedConfidence(e, 0)).toBeCloseTo(0.8, 5);
  });
});

describe('governance #3 — forgetting / compaction', () => {
  it('drops beliefs whose decayed confidence falls below the floor', () => {
    const e = applyUpdate([], belief({ confidence: 0.5 }), 0, genId);
    const { kept, dropped } = compact(e, 10 * MIND_DEFAULT_HALF_LIFE_MS, { minConfidence: 0.05 });
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
  it('keeps an unresolved prediction even at low confidence while its horizon is open (it owes an outcome)', () => {
    const e = applyUpdate([], { kind: 'prediction', content: 'p', confidence: 0.01, provenance: ['r'], subject: 'next file', options: [{ label: 'a.ts', prob: 0.6 }], horizonMs: 200 * MIND_DEFAULT_HALF_LIFE_MS }, 0, genId);
    const { kept } = compact(e, 100 * MIND_DEFAULT_HALF_LIFE_MS);
    expect(kept).toHaveLength(1);
  });
  it('drops an unresolved prediction whose resolve-by horizon is long past (unresolvable orphan)', () => {
    const e = applyUpdate([], { kind: 'prediction', content: 'p', confidence: 0.9, provenance: ['r'], subject: 'next file', options: [{ label: 'a.ts', prob: 0.9 }], horizonMs: 1_000 }, 0, genId);
    const { kept, dropped } = compact(e, 1_000 + PREDICTION_EXPIRY_GRACE_MS + 1);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
  it('grants the grace window: a just-past-horizon prediction survives compaction', () => {
    const e = applyUpdate([], { kind: 'prediction', content: 'p', confidence: 0.9, provenance: ['r'], subject: 'next file', options: [{ label: 'a.ts', prob: 0.9 }], horizonMs: 1_000 }, 0, genId);
    const { kept } = compact(e, 1_000 + PREDICTION_EXPIRY_GRACE_MS - 1);
    expect(kept).toHaveLength(1);
  });
  it('caps to maxEntries, keeping the most salient', () => {
    let store: readonly IMindEntry[] = [];
    for (let i = 0; i < 5; i++) store = applyUpdate(store, belief({ content: `b${i}`, confidence: i / 10 }), 0, genId);
    const { kept } = compact(store, 0, { maxEntries: 2 });
    expect(kept).toHaveLength(2);
    expect(kept.map(e => e.confidence).sort()).toEqual([0.3, 0.4]); // top-2 confidence survive
  });
});

describe('governance #4 — external Brier scoring', () => {
  it('scores a perfect forecast as 0', () => {
    expect(brierScore([{ label: 'a', prob: 1 }], 'a')).toBe(0);
  });
  it('scores a confident miss near 2', () => {
    expect(brierScore([{ label: 'a', prob: 1 }], 'b')).toBe(2); // (1-0)^2 + missed (0-1)^2
  });
  it('handles an actual outcome that was not among the forecast options', () => {
    // forecast a:0.6 b:0.3 → actual c (unforecast): a&b wrong + c had prob 0
    expect(brierScore([{ label: 'a', prob: 0.6 }, { label: 'b', prob: 0.3 }], 'c')).toBeCloseTo(0.36 + 0.09 + 1, 5);
  });
  it('resolvePrediction attaches the score from the OBSERVED outcome', () => {
    const [p] = applyUpdate([], { kind: 'prediction', content: 'p', confidence: 0.7, provenance: ['r'], subject: 'next file', options: [{ label: 'a.ts', prob: 0.7 }], horizonMs: 1 }, 0, genId) as IMindPrediction[];
    const resolved = resolvePrediction(p, 'a.ts', 500);
    expect(resolved.resolved?.actual).toBe('a.ts');
    expect(resolved.resolved?.brier).toBeCloseTo(0.09, 5); // (0.7-1)^2
    expect(meanBrier([resolved])).toBeCloseTo(0.09, 5);
  });
});

describe('summarizeMind', () => {
  it('renders salient beliefs and flags unresolved predictions', () => {
    let store: readonly IMindEntry[] = [];
    store = applyUpdate(store, belief({ content: 'Ships on Fridays', confidence: 0.9 }), 0, genId);
    store = applyUpdate(store, { kind: 'prediction', content: 'p', confidence: 0.6, provenance: ['r'], subject: 'next file', options: [{ label: 'main.ts', prob: 0.6 }], horizonMs: 1 }, 0, genId);
    const out = summarizeMind(store, 0);
    expect(out).toContain('Ships on Fridays');
    expect(out).toContain('awaiting outcome');
    // Past horizon + grace, the same open prediction is noise, not continuity.
    const later = summarizeMind(store, 1 + PREDICTION_EXPIRY_GRACE_MS + 1);
    expect(later).not.toContain('awaiting outcome');
    expect(out).toContain('main.ts');
  });
  it('reports empty when nothing durable survives', () => {
    expect(summarizeMind([], 0)).toContain('empty');
  });
});
