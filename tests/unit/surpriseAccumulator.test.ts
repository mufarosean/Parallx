import { describe, expect, it } from 'vitest';

import { SurpriseAccumulator } from '../../src/openclaw/mind/surpriseAccumulator';

const MIN = 60 * 1000;

describe('SurpriseAccumulator', () => {
  it('a single small surprise does not warrant a review', () => {
    const a = new SurpriseAccumulator({ threshold: 1.5 });
    a.add(0.6, 0);
    expect(a.shouldReview(0)).toBe(false);
  });

  it('sustained surprise crosses the threshold and warrants a review', () => {
    const a = new SurpriseAccumulator({ threshold: 1.5, halfLifeMs: 10 * MIN });
    a.add(0.8, 0);
    a.add(0.8, 1 * MIN);
    a.add(0.8, 2 * MIN); // ~2.2 pressure (with mild decay) ≥ 1.5
    expect(a.shouldReview(2 * MIN)).toBe(true);
  });

  it('one very strong surprise (novel) crosses on its own', () => {
    const a = new SurpriseAccumulator({ threshold: 1.5 });
    a.add(2.0, 0); // totally unforecast
    expect(a.shouldReview(0)).toBe(true);
  });

  it('pressure decays — old surprise stops warranting a review', () => {
    const a = new SurpriseAccumulator({ threshold: 1.5, halfLifeMs: 10 * MIN });
    a.add(2.0, 0);
    expect(a.shouldReview(0)).toBe(true);
    expect(a.shouldReview(60 * MIN)).toBe(false); // decayed far below threshold
  });

  it('cooldown caps how often surprise can trigger a review', () => {
    const a = new SurpriseAccumulator({ threshold: 1.5, cooldownMs: 5 * MIN });
    a.add(2.0, 0);
    expect(a.shouldReview(0)).toBe(true);
    a.markReviewed(0); // a review was triggered
    a.add(2.0, 1 * MIN); // surprised again, but still in cooldown
    expect(a.shouldReview(1 * MIN)).toBe(false);
    a.add(2.0, 6 * MIN); // cooldown elapsed
    expect(a.shouldReview(6 * MIN)).toBe(true);
  });

  it('markReviewed resets accumulated pressure', () => {
    const a = new SurpriseAccumulator({ threshold: 1.5, cooldownMs: 0 });
    a.add(2.0, 0);
    a.markReviewed(0);
    expect(a.pressure(0)).toBe(0);
    expect(a.shouldReview(0)).toBe(false);
  });

  it('ignores non-positive surprise', () => {
    const a = new SurpriseAccumulator();
    a.add(0, 0);
    a.add(-1, 0);
    expect(a.pressure(0)).toBe(0);
  });
});
