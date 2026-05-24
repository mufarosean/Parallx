/**
 * Pin-the-invariant: platform/lifecycle.ts Disposable contract.
 *
 * Disposable / DisposableStore / MutableDisposable / RefCountDisposable
 * are foundation primitives used by every service in the shell (events,
 * services, watchers, view models). The contracts they enforce are:
 *
 *   - dispose() is idempotent — calling twice must not throw / re-run
 *   - DisposableStore.add() on a disposed store immediately disposes
 *     the added item (no leaks)
 *   - DisposableStore.dispose() continues past a throwing child (the
 *     rest still get cleaned up)
 *   - DisposableStore.clear() drops children but keeps the store usable
 *   - MutableDisposable.value = x disposes the prior value
 *   - MutableDisposable assignments after dispose() immediately dispose
 *     the new value
 *   - RefCountDisposable defers inner dispose until count hits zero;
 *     acquire() after dispose throws
 *   - safeDispose() swallows throws by design
 *
 * No prior unit test exists for this module. A regression here would silently
 * leak handles across the whole shell.
 */

import { describe, expect, it } from 'vitest';
import {
  Disposable,
  DisposableStore,
  MutableDisposable,
  RefCountDisposable,
  combinedDisposable,
  safeDispose,
  toDisposable,
} from '../../src/platform/lifecycle';
import type { IDisposable } from '../../src/platform/lifecycle';

function makeSpyDisposable() {
  let count = 0;
  const d: IDisposable & { count: () => number } = {
    dispose() { count++; },
    count: () => count,
  };
  return d;
}

describe('toDisposable / combinedDisposable', () => {
  it('toDisposable invokes the cleanup exactly once', () => {
    let n = 0;
    const d = toDisposable(() => { n++; });
    d.dispose();
    d.dispose();
    d.dispose();
    expect(n).toBe(1);
  });

  it('combinedDisposable disposes every child', () => {
    const a = makeSpyDisposable();
    const b = makeSpyDisposable();
    const c = makeSpyDisposable();
    combinedDisposable(a, b, c).dispose();
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(1);
    expect(c.count()).toBe(1);
  });
});

describe('safeDispose', () => {
  it('disposes an IDisposable', () => {
    const d = makeSpyDisposable();
    safeDispose(d);
    expect(d.count()).toBe(1);
  });

  it('is a no-op for non-disposables', () => {
    expect(() => safeDispose(undefined)).not.toThrow();
    expect(() => safeDispose(null)).not.toThrow();
    expect(() => safeDispose(42)).not.toThrow();
    expect(() => safeDispose({})).not.toThrow();
  });

  it('swallows errors thrown during disposal', () => {
    const bad: IDisposable = { dispose() { throw new Error('boom'); } };
    expect(() => safeDispose(bad)).not.toThrow();
  });
});

describe('DisposableStore', () => {
  it('disposes all children on dispose()', () => {
    const store = new DisposableStore();
    const a = makeSpyDisposable();
    const b = makeSpyDisposable();
    store.add(a);
    store.add(b);
    store.dispose();
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(1);
    expect(store.isDisposed).toBe(true);
  });

  it('dispose() is idempotent', () => {
    const store = new DisposableStore();
    const a = makeSpyDisposable();
    store.add(a);
    store.dispose();
    store.dispose();
    expect(a.count()).toBe(1);
  });

  it('add() after dispose() immediately disposes the incoming child', () => {
    const store = new DisposableStore();
    store.dispose();
    const a = makeSpyDisposable();
    store.add(a);
    expect(a.count()).toBe(1);
  });

  it('dispose() continues past a throwing child', () => {
    const store = new DisposableStore();
    const a = makeSpyDisposable();
    const bad: IDisposable = { dispose() { throw new Error('boom'); } };
    const c = makeSpyDisposable();
    store.add(a);
    store.add(bad);
    store.add(c);
    expect(() => store.dispose()).not.toThrow();
    expect(a.count()).toBe(1);
    expect(c.count()).toBe(1);
  });

  it('delete() removes without disposing', () => {
    const store = new DisposableStore();
    const a = makeSpyDisposable();
    store.add(a);
    store.delete(a);
    store.dispose();
    expect(a.count()).toBe(0);
  });

  it('clear() disposes children but keeps the store usable', () => {
    const store = new DisposableStore();
    const a = makeSpyDisposable();
    store.add(a);
    store.clear();
    expect(a.count()).toBe(1);
    expect(store.isDisposed).toBe(false);
    expect(store.size).toBe(0);

    const b = makeSpyDisposable();
    store.add(b);
    store.dispose();
    expect(b.count()).toBe(1);
  });

  it('size reflects current children', () => {
    const store = new DisposableStore();
    expect(store.size).toBe(0);
    const a = makeSpyDisposable();
    store.add(a);
    expect(store.size).toBe(1);
    store.delete(a);
    expect(store.size).toBe(0);
  });
});

describe('MutableDisposable', () => {
  it('setting a new value disposes the prior value', () => {
    const m = new MutableDisposable<IDisposable & { count: () => number }>();
    const a = makeSpyDisposable();
    const b = makeSpyDisposable();
    m.value = a;
    m.value = b;
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(0);
    m.dispose();
    expect(b.count()).toBe(1);
  });

  it('setting the same value twice does NOT dispose it', () => {
    const m = new MutableDisposable<IDisposable & { count: () => number }>();
    const a = makeSpyDisposable();
    m.value = a;
    m.value = a;
    expect(a.count()).toBe(0);
  });

  it('clear() disposes the value but keeps the holder usable', () => {
    const m = new MutableDisposable<IDisposable & { count: () => number }>();
    const a = makeSpyDisposable();
    m.value = a;
    m.clear();
    expect(a.count()).toBe(1);
    const b = makeSpyDisposable();
    m.value = b;
    m.dispose();
    expect(b.count()).toBe(1);
  });

  it('assignment after dispose immediately disposes the incoming value', () => {
    const m = new MutableDisposable<IDisposable & { count: () => number }>();
    m.dispose();
    const a = makeSpyDisposable();
    m.value = a;
    expect(a.count()).toBe(1);
    expect(m.value).toBeUndefined();
  });

  it('dispose() is idempotent', () => {
    const m = new MutableDisposable<IDisposable & { count: () => number }>();
    const a = makeSpyDisposable();
    m.value = a;
    m.dispose();
    m.dispose();
    expect(a.count()).toBe(1);
  });
});

describe('RefCountDisposable', () => {
  it('inner dispose runs only when refcount hits zero', () => {
    const inner = makeSpyDisposable();
    const r = new RefCountDisposable(inner, 1);
    r.acquire();   // 2
    r.acquire();   // 3
    r.dispose();   // 2
    expect(inner.count()).toBe(0);
    r.dispose();   // 1
    expect(inner.count()).toBe(0);
    r.dispose();   // 0 → inner.dispose()
    expect(inner.count()).toBe(1);
  });

  it('dispose() past zero stays at zero (idempotent)', () => {
    const inner = makeSpyDisposable();
    const r = new RefCountDisposable(inner, 1);
    r.dispose();
    r.dispose();
    r.dispose();
    expect(inner.count()).toBe(1);
  });

  it('acquire() after final dispose throws', () => {
    const inner = makeSpyDisposable();
    const r = new RefCountDisposable(inner, 1);
    r.dispose();
    expect(() => r.acquire()).toThrow(/disposed/i);
  });
});

describe('Disposable abstract base class', () => {
  class Owner extends Disposable {
    constructor(public readonly child: IDisposable) {
      super();
      this._register(child);
    }
  }

  it('disposes every _register()ed child', () => {
    const a = makeSpyDisposable();
    const b = makeSpyDisposable();
    class Two extends Disposable {
      constructor() {
        super();
        this._register(a);
        this._register(b);
      }
    }
    const o = new Two();
    o.dispose();
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(1);
    expect(o.isDisposed).toBe(true);
  });

  it('dispose() is idempotent at the owner level', () => {
    const a = makeSpyDisposable();
    const o = new Owner(a);
    o.dispose();
    o.dispose();
    expect(a.count()).toBe(1);
  });

  it('isDisposed flips on first dispose()', () => {
    const o = new Owner(makeSpyDisposable());
    expect(o.isDisposed).toBe(false);
    o.dispose();
    expect(o.isDisposed).toBe(true);
  });
});
