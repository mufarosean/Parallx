// lifecycle.ts — the IDisposable pattern: what it is and the ways to hold one.
//
// Everything that owns a listener, a timer or a DOM node implements
// IDisposable and is released by its owner. The helpers here are the whole
// vocabulary: toDisposable wraps a function, DisposableStore holds many,
// Disposable is the base class that registers its own, RefCountDisposable
// releases a shared one when its last owner lets go.

// ─── IDisposable ─────────────────────────────────────────────────────────────

/**
 * An object that can release resources when no longer needed.
 */
export interface IDisposable {
  dispose(): void;
}

// ─── Simple Helpers ──────────────────────────────────────────────────────────

/**
 * Wraps a cleanup function into an IDisposable.
 */
export function toDisposable(fn: () => void): IDisposable {
  let disposed = false;
  return {
    dispose() {
      if (!disposed) {
        disposed = true;
        fn();
      }
    },
  };
}

// ─── DisposableStore ─────────────────────────────────────────────────────────

/**
 * Manages a collection of disposables and disposes them all at once.
 * Adding to a disposed store immediately disposes the added item.
 */
export class DisposableStore implements IDisposable {
  private readonly _disposables = new Set<IDisposable>();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /** Number of items in the store. */
  get size(): number {
    return this._disposables.size;
  }

  /**
   * Add a disposable to the store. Returns the disposable for chaining.
   */
  add<T extends IDisposable>(disposable: T): T {
    if (this._isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this._disposables.add(disposable);
    return disposable;
  }

  /**
   * Delete a disposable from the store without disposing it.
   */
  delete(disposable: IDisposable): void {
    this._disposables.delete(disposable);
  }

  /**
   * Dispose all items in the store and mark the store as disposed.
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    const errors: unknown[] = [];
    for (const d of this._disposables) {
      try {
        d.dispose();
      } catch (e) {
        errors.push(e);
      }
    }
    this._disposables.clear();
    if (errors.length > 0) {
      console.error(`[DisposableStore] ${errors.length} error(s) during dispose:`, errors);
    }
  }

  /**
   * Dispose all items but keep the store usable (not marked as disposed).
   */
  clear(): void {
    const errors: unknown[] = [];
    for (const d of this._disposables) {
      try {
        d.dispose();
      } catch (e) {
        errors.push(e);
      }
    }
    this._disposables.clear();
    if (errors.length > 0) {
      console.error(`[DisposableStore] ${errors.length} error(s) during clear:`, errors);
    }
  }
}

// ─── RefCountDisposable ──────────────────────────────────────────────────────

/**
 * A disposable that is only disposed when its reference count reaches zero.
 * Useful for shared resources that may be referenced by multiple owners.
 */
export class RefCountDisposable implements IDisposable {
  private _refCount: number;
  private _disposed = false;

  constructor(
    private readonly _inner: IDisposable,
    initialCount = 1,
  ) {
    this._refCount = initialCount;
  }

  /** Increase the reference count. */
  acquire(): void {
    if (this._disposed) {
      throw new Error('Cannot acquire a disposed RefCountDisposable');
    }
    this._refCount++;
  }

  /** Decrease the reference count. Disposes when zero. */
  dispose(): void {
    if (this._disposed) return;
    this._refCount--;
    if (this._refCount <= 0) {
      this._disposed = true;
      this._inner.dispose();
    }
  }
}

// ─── Disposable Base Class ───────────────────────────────────────────────────

/**
 * Base class for objects that own disposables. Subclasses register them via
 * `_register()` and they are released together when `dispose()` is called.
 */
export abstract class Disposable implements IDisposable {
  private readonly _store = new DisposableStore();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  protected _register<T extends IDisposable>(disposable: T): T {
    return this._store.add(disposable);
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._store.dispose();
  }
}
