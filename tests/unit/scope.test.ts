// scope.test.ts — M86-W3 Scope, RefCountedResource, TypedEventBus
import { describe, it, expect } from 'vitest';
import { Scope, RefCountedResource, TypedEventBus } from '../../src/platform/scope.js';
import { toDisposable } from '../../src/platform/lifecycle.js';

describe('M86-W3 Scope', () => {
  it('disposes tracked disposables when the scope disposes', () => {
    const scope = new Scope();
    let disposed = false;
    scope.add(toDisposable(() => { disposed = true; }));
    expect(disposed).toBe(false);
    scope.dispose();
    expect(disposed).toBe(true);
  });

  it('disposes child scopes recursively', () => {
    const parent = new Scope();
    const child = parent.child();
    const grandchild = child.child();
    let parentDone = false;
    let childDone = false;
    let grandDone = false;
    parent.add(toDisposable(() => { parentDone = true; }));
    child.add(toDisposable(() => { childDone = true; }));
    grandchild.add(toDisposable(() => { grandDone = true; }));

    parent.dispose();
    expect(grandDone).toBe(true);
    expect(childDone).toBe(true);
    expect(parentDone).toBe(true);
    expect(parent.isDisposed).toBe(true);
    expect(child.isDisposed).toBe(true);
    expect(grandchild.isDisposed).toBe(true);
  });

  it('immediately disposes additions after the scope is disposed', () => {
    const scope = new Scope();
    scope.dispose();
    let disposed = false;
    scope.add(toDisposable(() => { disposed = true; }));
    expect(disposed).toBe(true);
  });

  it('child() on a disposed scope returns a pre-disposed scope', () => {
    const scope = new Scope();
    scope.dispose();
    const c = scope.child();
    expect(c.isDisposed).toBe(true);
  });
});

describe('M86-W3 RefCountedResource', () => {
  it('lazily instantiates on first acquire', () => {
    let made = 0;
    let killed = 0;
    const r = new RefCountedResource(
      () => { made++; return { id: made }; },
      () => { killed++; },
    );
    expect(made).toBe(0);
    const t = r.acquire();
    expect(made).toBe(1);
    expect(r.isActive).toBe(true);
    t.dispose();
    expect(killed).toBe(1);
    expect(r.isActive).toBe(false);
  });

  it('only disposes when the last reference is released', () => {
    let made = 0;
    let killed = 0;
    const r = new RefCountedResource(
      () => { made++; return made; },
      () => { killed++; },
    );
    const a = r.acquire();
    const b = r.acquire();
    const c = r.acquire();
    expect(made).toBe(1);
    expect(r.refCount).toBe(3);
    a.dispose();
    b.dispose();
    expect(killed).toBe(0);
    c.dispose();
    expect(killed).toBe(1);
  });

  it('re-acquires after full release builds a new instance', () => {
    let made = 0;
    const r = new RefCountedResource(
      () => { made++; return made; },
      () => undefined,
    );
    r.acquire().dispose();
    r.acquire().dispose();
    expect(made).toBe(2);
  });

  it('double-disposing a token is a no-op', () => {
    let killed = 0;
    const r = new RefCountedResource(
      () => 1,
      () => { killed++; },
    );
    const t = r.acquire();
    t.dispose();
    t.dispose();
    expect(killed).toBe(1);
  });
});

describe('M86-W3 TypedEventBus', () => {
  type Events = {
    'workspace:changed': { uuid: string };
    tick: number;
  };

  it('delivers typed payloads to subscribers', () => {
    const bus = new TypedEventBus<Events>();
    const scope = new Scope();
    const seen: string[] = [];
    bus.on('workspace:changed', scope, (p) => { seen.push(p.uuid); });
    bus.emit('workspace:changed', { uuid: 'A' });
    bus.emit('workspace:changed', { uuid: 'B' });
    expect(seen).toEqual(['A', 'B']);
    scope.dispose();
    bus.dispose();
  });

  it('auto-unsubscribes when the listener scope disposes', () => {
    const bus = new TypedEventBus<Events>();
    const scope = new Scope();
    let count = 0;
    bus.on('tick', scope, () => { count++; });
    bus.emit('tick', 1);
    scope.dispose();
    bus.emit('tick', 2);
    expect(count).toBe(1);
    bus.dispose();
  });

  it('emit after bus disposal is a no-op', () => {
    const bus = new TypedEventBus<Events>();
    const scope = new Scope();
    let count = 0;
    bus.on('tick', scope, () => { count++; });
    bus.dispose();
    bus.emit('tick', 1);
    expect(count).toBe(0);
    scope.dispose();
  });
});
