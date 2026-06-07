import { describe, expect, it } from 'vitest';

import { NagGovernor } from '../../src/openclaw/mind/nagGovernor';

const HOUR = 60 * 60 * 1000;

describe('NagGovernor — interruption budget tied to the dismiss-ratio', () => {
  it('allows an initial burst up to capacity, then throttles', () => {
    const g = new NagGovernor({ burstCapacity: 3, baseRefillPerHour: 0 });
    expect(g.allowInterruption(0)).toBe(true);
    expect(g.allowInterruption(0)).toBe(true);
    expect(g.allowInterruption(0)).toBe(true);
    expect(g.allowInterruption(0)).toBe(false); // burst spent, no refill
  });

  it('refills over time when the user keeps acting on suggestions', () => {
    const g = new NagGovernor({ burstCapacity: 1, baseRefillPerHour: 4 });
    expect(g.allowInterruption(0)).toBe(true); // spend the one token
    expect(g.allowInterruption(0)).toBe(false);
    g.recordOutcome('act'); g.recordOutcome('act');
    expect(g.allowInterruption(20 * 60 * 1000)).toBe(true); // ~20min @ 4/hr ≈ 1.3 tokens
  });

  it('throttles hard when the user keeps dismissing (refill collapses to the floor)', () => {
    const g = new NagGovernor({ burstCapacity: 1, baseRefillPerHour: 4, minRefillPerHour: 0.5 });
    for (let i = 0; i < 10; i++) g.recordOutcome('dismiss');
    expect(g.allowInterruption(0)).toBe(true); // spend the token
    // 20 min later: at the dismiss-floor (~0.5/hr) only ~0.17 tokens refilled → still throttled
    expect(g.allowInterruption(20 * 60 * 1000)).toBe(false);
    // but after ~2.5 hours even the floor refills a token
    expect(g.allowInterruption(20 * 60 * 1000 + 3 * HOUR)).toBe(true);
  });

  it('computes the dismiss-ratio over the window', () => {
    const g = new NagGovernor();
    expect(g.dismissRatio()).toBeNull();
    g.recordOutcome('act'); g.recordOutcome('dismiss'); g.recordOutcome('dismiss'); g.recordOutcome('dismiss');
    expect(g.dismissRatio()).toBeCloseTo(0.75, 5);
  });

  it('reading reflects the throttle state', () => {
    const g = new NagGovernor({ baseRefillPerHour: 4 });
    for (let i = 0; i < 8; i++) g.recordOutcome('dismiss');
    const r = g.reading(0);
    expect(r.dismissRatio).toBe(1);
    expect(r.throttled).toBe(true);
  });

  it('round-trips through serialize/restore (so a restart keeps the throttle)', () => {
    const g = new NagGovernor({ burstCapacity: 2 });
    for (let i = 0; i < 5; i++) g.recordOutcome('dismiss');
    g.allowInterruption(0);
    const state = JSON.parse(JSON.stringify(g.toState()));
    const g2 = new NagGovernor({ burstCapacity: 2 });
    g2.restore(state);
    expect(g2.dismissRatio()).toBe(1);
  });
});
