// timing.test.ts — debounce and sleep (platform/timing.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { debounce, sleep } from '../../src/platform/timing';

afterEach(() => vi.useRealTimers());

describe('debounce', () => {
  it('runs once after the last call, with the last arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a'); d('b'); d('c');
    expect(fn).not.toHaveBeenCalled();
    expect(d.pending).toBe(true);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
    expect(d.pending).toBe(false);
  });

  it('restarts the wait on every call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1); vi.advanceTimersByTime(80);
    d(2); vi.advanceTimersByTime(80);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it('cancel drops the pending call; flush runs it now', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('x'); d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    d('y'); d.flush();
    expect(fn).toHaveBeenCalledWith('y');
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    let done = false;
    void sleep(50).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(49);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
