/**
 * Pin-the-invariant: platform/events.ts Emitter + EventUtils contract.
 *
 * Foundation event system. Used by ~every service in the shell. The pins:
 *   - fire() before/after dispose(): pre-dispose hits all subscribers,
 *     post-dispose is a no-op (no throw)
 *   - subscription returns IDisposable; disposing removes the listener
 *   - subscribing to a disposed emitter returns a no-op disposable
 *   - listener exceptions in fire(): NOT swallowed (let-it-throw — pinning
 *     this so a "helpful try/catch" refactor doesn't silently hide bugs)
 *   - EventUtils.once: fires exactly once; auto-disposes
 *   - EventUtils.map / filter: transformation chains
 *   - EventUtils.any: merges multiple sources
 *   - EventUtils.None: never fires
 *
 * No prior unit test exists.
 */

import { describe, expect, it, vi } from 'vitest';
import { Emitter, EventUtils } from '../../src/platform/events';

describe('Emitter — core', () => {
  it('fires the event to every listener', () => {
    const e = new Emitter<number>();
    const a = vi.fn();
    const b = vi.fn();
    e.event(a);
    e.event(b);
    e.fire(42);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it('listenerCount + hasListeners track subscription state', () => {
    const e = new Emitter<void>();
    expect(e.hasListeners).toBe(false);
    expect(e.listenerCount).toBe(0);
    const sub = e.event(() => {});
    expect(e.hasListeners).toBe(true);
    expect(e.listenerCount).toBe(1);
    sub.dispose();
    expect(e.hasListeners).toBe(false);
    expect(e.listenerCount).toBe(0);
  });

  it('disposing a subscription stops further notifications to it', () => {
    const e = new Emitter<number>();
    const a = vi.fn();
    const sub = e.event(a);
    e.fire(1);
    sub.dispose();
    e.fire(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(1);
  });

  it('fire() after dispose() is a no-op (no listeners, no throw)', () => {
    const e = new Emitter<number>();
    const a = vi.fn();
    e.event(a);
    e.dispose();
    expect(() => e.fire(7)).not.toThrow();
    expect(a).not.toHaveBeenCalled();
  });

  it('subscribing after dispose returns a no-op disposable', () => {
    const e = new Emitter<number>();
    e.dispose();
    const a = vi.fn();
    const sub = e.event(a);
    expect(() => sub.dispose()).not.toThrow();
    e.fire(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('listener removal during fire does not affect the current fire iteration', () => {
    // The emitter snapshots listeners (`[...this._listeners]`) before
    // iterating, so a listener that disposes another listener mid-fire
    // does NOT skip subsequent listeners. Pinning the snapshot semantics.
    const e = new Emitter<number>();
    const a = vi.fn();
    const subB = e.event(() => { subB.dispose(); });
    const subC = e.event(a);
    e.fire(1);
    expect(a).toHaveBeenCalledWith(1);
    subC.dispose();
  });

  it('listener exceptions propagate (NOT swallowed)', () => {
    // Pin contract: emitter does NOT try/catch around listeners. A future
    // "helpful" refactor that adds try/catch must update this test
    // intentionally — silent error swallowing is the wrong default.
    const e = new Emitter<void>();
    e.event(() => { throw new Error('listener-boom'); });
    expect(() => e.fire(undefined)).toThrow('listener-boom');
  });

  it('dispose() is idempotent', () => {
    const e = new Emitter<void>();
    e.event(() => {});
    e.dispose();
    expect(() => e.dispose()).not.toThrow();
  });
});

describe('EventUtils.once', () => {
  it('fires the wrapped listener exactly once and auto-disposes', () => {
    const e = new Emitter<number>();
    const a = vi.fn();
    EventUtils.once(e.event)(a);
    e.fire(1);
    e.fire(2);
    e.fire(3);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(1);
  });
});

describe('EventUtils.map', () => {
  it('transforms event payloads', () => {
    const e = new Emitter<number>();
    const a = vi.fn();
    EventUtils.map(e.event, (n) => `n=${n}`)(a);
    e.fire(5);
    expect(a).toHaveBeenCalledWith('n=5');
  });
});

describe('EventUtils.filter', () => {
  it('only passes through values matching the predicate', () => {
    const e = new Emitter<number>();
    const a = vi.fn();
    EventUtils.filter(e.event, (n) => n % 2 === 0)(a);
    e.fire(1);
    e.fire(2);
    e.fire(3);
    e.fire(4);
    expect(a).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenNthCalledWith(1, 2);
    expect(a).toHaveBeenNthCalledWith(2, 4);
  });
});

describe('EventUtils.any', () => {
  it('merges multiple events into one', () => {
    const e1 = new Emitter<string>();
    const e2 = new Emitter<string>();
    const a = vi.fn();
    EventUtils.any(e1.event, e2.event)(a);
    e1.fire('one');
    e2.fire('two');
    e1.fire('three');
    expect(a.mock.calls.map(c => c[0])).toEqual(['one', 'two', 'three']);
  });

  it('disposes every underlying subscription when the merged sub disposes', () => {
    const e1 = new Emitter<void>();
    const e2 = new Emitter<void>();
    const sub = EventUtils.any(e1.event, e2.event)(() => {});
    expect(e1.listenerCount).toBe(1);
    expect(e2.listenerCount).toBe(1);
    sub.dispose();
    expect(e1.listenerCount).toBe(0);
    expect(e2.listenerCount).toBe(0);
  });
});

describe('EventUtils.None', () => {
  it('never fires and yields a no-op disposable', () => {
    const a = vi.fn();
    const sub = EventUtils.None(a);
    expect(() => sub.dispose()).not.toThrow();
    expect(a).not.toHaveBeenCalled();
  });
});
