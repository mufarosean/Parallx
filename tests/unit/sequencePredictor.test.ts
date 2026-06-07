import { describe, expect, it } from 'vitest';

import { SequencePredictor } from '../../src/openclaw/mind/sequencePredictor';

describe('SequencePredictor', () => {
  it('abstains (empty forecast) with no history', () => {
    expect(new SequencePredictor().forecast()).toEqual([]);
  });

  it('forecasts a single observed item at high (sub-1) probability', () => {
    const p = new SequencePredictor({ noveltyMass: 0.15 });
    p.observe('a.ts');
    const f = p.forecast();
    expect(f).toHaveLength(1);
    expect(f[0].label).toBe('a.ts');
    expect(f[0].prob).toBeCloseTo(0.85, 5); // 1 * (1 - noveltyMass)
  });

  it('ranks more frequent items higher', () => {
    const p = new SequencePredictor({ halfLifeCount: 1000 }); // ~flat weighting
    for (const x of ['a', 'a', 'a', 'b', 'b', 'c']) p.observe(x);
    const f = p.forecast();
    expect(f[0].label).toBe('a');
    expect(f[1].label).toBe('b');
    expect(f[0].prob).toBeGreaterThan(f[1].prob);
  });

  it('recency-weights: a recent burst outranks a stale-but-frequent item', () => {
    const p = new SequencePredictor({ halfLifeCount: 2 }); // strong recency
    // 'old' appears 5x long ago, 'new' appears 2x most recently
    for (const x of ['old', 'old', 'old', 'old', 'old', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'new', 'new']) p.observe(x);
    const f = p.forecast();
    expect(f[0].label).toBe('new');
  });

  it('forecasts sum to (1 - noveltyMass), reserving mass for the unseen', () => {
    const p = new SequencePredictor({ noveltyMass: 0.2, topK: 10 });
    for (const x of ['a', 'b', 'c', 'a', 'b']) p.observe(x);
    const sum = p.forecast().reduce((s, o) => s + o.prob, 0);
    expect(sum).toBeCloseTo(0.8, 5);
  });

  it('respects topK', () => {
    const p = new SequencePredictor({ topK: 2 });
    for (const x of ['a', 'b', 'c', 'd']) p.observe(x);
    expect(p.forecast()).toHaveLength(2);
  });

  it('caps history at historyLimit', () => {
    const p = new SequencePredictor({ historyLimit: 3 });
    for (const x of ['a', 'b', 'c', 'd', 'e']) p.observe(x);
    expect(p.size).toBe(3);
    // only c,d,e retained → 'a' and 'b' gone
    expect(p.forecast().map(o => o.label).sort()).toEqual(['c', 'd', 'e']);
  });

  it('ignores empty observations', () => {
    const p = new SequencePredictor();
    p.observe('');
    expect(p.size).toBe(0);
  });
});
