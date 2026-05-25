// scope.ts — M86-W3 disposable scopes, reference-counted resources, typed event bus
//
// Bakes the M85-F1 consumer-ref-count pattern into a reusable primitive so
// future authors don't reinvent it (and don't ship periodic timers that run
// while no UI consumer is mounted).
//
// Layers:
//   - Scope: a DisposableStore with explicit parent/child semantics so a parent
//     scope's disposal recursively kills children. Listeners and resources
//     attached to a scope clean up automatically.
//   - RefCountedResource: lazy single-instance resource with consumer
//     acquire/release. Last release disposes the inner resource.
//   - TypedEventBus: typed wrapper over Emitter where subscriptions are tied
//     to a Scope so they auto-unsubscribe with the scope.

import { Emitter } from './events.js';
import {
  DisposableStore,
  IDisposable,
  toDisposable,
} from './lifecycle.js';

// ─── Scope ───────────────────────────────────────────────────────────────────

/**
 * A disposable scope. Extends DisposableStore with explicit child-scope
 * creation; disposing a parent disposes all children recursively.
 */
export class Scope implements IDisposable {
  private _store = new DisposableStore();
  private _children = new Set<Scope>();
  private _parent: Scope | null;
  private _disposed = false;

  constructor(parent: Scope | null = null) {
    this._parent = parent;
    if (parent) {
      parent._children.add(this);
    }
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Track a disposable; it will be disposed when this scope disposes. */
  add<T extends IDisposable>(d: T): T {
    if (this._disposed) {
      d.dispose();
      return d;
    }
    this._store.add(d);
    return d;
  }

  /** Create a child scope that disposes when this scope does. */
  child(): Scope {
    if (this._disposed) {
      // Return a pre-disposed scope so callers don't crash.
      const s = new Scope();
      s.dispose();
      return s;
    }
    return new Scope(this);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Dispose children first; each removes itself via _onChildDisposed.
    for (const child of [...this._children]) {
      child.dispose();
    }
    this._children.clear();
    this._store.dispose();
    if (this._parent) {
      this._parent._children.delete(this);
      this._parent = null;
    }
  }
}

// ─── RefCountedResource ──────────────────────────────────────────────────────

/**
 * Wraps a factory and disposer for a single shared resource. Lazily
 * instantiates on first `acquire`; disposes when the last token is released.
 *
 * Usage:
 *   const refCounted = new RefCountedResource(
 *     () => setInterval(refresh, 30_000),
 *     (timer) => clearInterval(timer),
 *   );
 *   const token = refCounted.acquire(); // starts the timer
 *   token.dispose();                    // releases; timer stops if no others
 */
export class RefCountedResource<T> {
  private _value: T | null = null;
  private _count = 0;

  constructor(
    private readonly _factory: () => T,
    private readonly _disposer: (value: T) => void,
  ) {}

  get isActive(): boolean {
    return this._count > 0;
  }

  get refCount(): number {
    return this._count;
  }

  /** Acquire a reference. Returns a token that must be disposed. */
  acquire(): IDisposable {
    if (this._count === 0) {
      this._value = this._factory();
    }
    this._count++;
    let released = false;
    return toDisposable(() => {
      if (released) return;
      released = true;
      this._count--;
      if (this._count === 0 && this._value !== null) {
        try {
          this._disposer(this._value);
        } finally {
          this._value = null;
        }
      }
    });
  }
}

// ─── TypedEventBus ───────────────────────────────────────────────────────────

/**
 * Typed event bus. Each event name has a payload type declared in the
 * TEvents map. Subscriptions are attached to a Scope so they
 * auto-disposed.
 *
 * Example:
 *   type Events = { 'workspace:changed': { uuid: string } };
 *   const bus = new TypedEventBus<Events>();
 *   bus.on('workspace:changed', scope, (payload) => { ... });
 *   bus.emit('workspace:changed', { uuid: 'abc' });
 */
export class TypedEventBus<TEvents extends Record<string, unknown>>
  implements IDisposable
{
  private _emitters = new Map<keyof TEvents, Emitter<unknown>>();
  private _disposed = false;

  on<K extends keyof TEvents>(
    name: K,
    scope: Scope,
    listener: (payload: TEvents[K]) => void,
  ): IDisposable {
    if (this._disposed) {
      return toDisposable(() => undefined);
    }
    let em = this._emitters.get(name);
    if (!em) {
      em = new Emitter<unknown>();
      this._emitters.set(name, em);
    }
    const sub = em.event((p) => listener(p as TEvents[K]));
    return scope.add(sub);
  }

  emit<K extends keyof TEvents>(name: K, payload: TEvents[K]): void {
    if (this._disposed) return;
    const em = this._emitters.get(name);
    if (em) em.fire(payload);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const em of this._emitters.values()) {
      em.dispose();
    }
    this._emitters.clear();
  }
}
