import { describe, expect, it } from 'vitest';

import { ReflectionScheduler } from '../../src/openclaw/mind/reflectionScheduler';

const DAY = 24 * 60 * 60 * 1000;

describe('ReflectionScheduler — the daily slow loop', () => {
  it('is due initially (a fresh mind reflects once early)', () => {
    expect(new ReflectionScheduler().isDue(0)).toBe(true);
  });

  it('is not due again until the interval elapses', () => {
    const s = new ReflectionScheduler({ intervalMs: DAY });
    s.markReflected(1000);
    expect(s.isDue(1000)).toBe(false);
    expect(s.isDue(1000 + DAY - 1)).toBe(false);
    expect(s.isDue(1000 + DAY)).toBe(true);
  });

  it('reports the next due time', () => {
    const s = new ReflectionScheduler({ intervalMs: DAY });
    s.markReflected(5000);
    expect(s.nextDueMs()).toBe(5000 + DAY);
  });

  it('round-trips through serialize/restore (so a restart does not re-reflect)', () => {
    const s = new ReflectionScheduler({ intervalMs: DAY });
    s.markReflected(10_000);
    const state = JSON.parse(JSON.stringify(s.toState()));
    const s2 = new ReflectionScheduler({ intervalMs: DAY });
    s2.restore(state);
    expect(s2.isDue(10_000)).toBe(false);
    expect(s2.isDue(10_000 + DAY)).toBe(true);
  });
});
