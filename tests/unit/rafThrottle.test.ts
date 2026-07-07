import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rafThrottle } from '../../src/platform/rafThrottle';

// In the node test env requestAnimationFrame is undefined, so rafThrottle
// falls back to setTimeout(16) — drive it with fake timers.
describe('rafThrottle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst into one call with the latest args', () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t(1); t(2); t(3);
    expect(fn).not.toHaveBeenCalled();       // deferred to the frame
    vi.advanceTimersByTime(16);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);      // most recent args win
  });

  it('re-arms after the frame runs', () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t('a'); vi.advanceTimersByTime(16);
    t('b'); vi.advanceTimersByTime(16);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'a');
    expect(fn).toHaveBeenNthCalledWith(2, 'b');
  });

  it('dispose cancels a pending frame', () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t();
    t.dispose();
    vi.advanceTimersByTime(64);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush runs the pending call immediately and does not double-run', () => {
    const fn = vi.fn();
    const t = rafThrottle(fn);
    t(7);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(64);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
