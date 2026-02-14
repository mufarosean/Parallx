// lifecycle.ts — IDisposable pattern and lifecycle hooks
//
// Provides disposal tracking, async disposal, leak detection,
// and resource management utilities used throughout the platform.

// ─── Disposal Tracking ───────────────────────────────────────────────────────

/**
 * Global flag to enable disposal leak tracking in development.
 * When enabled, every Disposable records a creation stack trace and
 * logs a warning if it is garbage-collected without being disposed.
 */
let _trackDisposals = false;
let _disposalTraces = new Map<number, string>();
let _nextTrackingId = 1;

/**
 * Enable disposal tracking. Call once at app startup in development.
 */
function enableDisposalTracking(): void {
  _trackDisposals = true;
}

/**
 * Disable disposal tracking.
 */
function disableDisposalTracking(): void {
  _trackDisposals = false;
  _disposalTraces.clear();
}

/**
 * Get the number of tracked but not-yet-disposed objects (for diagnostics).
 */
function getUndisposedCount(): number {
  return _disposalTraces.size;
}

/**
 * Get creation stack traces of all undisposed tracked objects.
 */
function getUndisposedTraces(): string[] {
  return [..._disposalTraces.values()];
}

// ─── IDisposable ─────────────────────────────────────────────────────────────

/**
 * An object that can release resources when no longer needed.
 */
export interface IDisposable {
  dispose(): void;
}

// ─── IAsyncDisposable ────────────────────────────────────────────────────────

/**
 * An object that performs asynchronous cleanup.
 */
interface IAsyncDisposable {
  disposeAsync(): Promise<void>;
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

/**
 * Wraps an async cleanup function into an IAsyncDisposable.
 */
function toAsyncDisposable(fn: () => Promise<void>): IAsyncDisposable {
  let disposed = false;
  return {
    async disposeAsync() {
      if (!disposed) {
        disposed = true;
        await fn();
      }
    },
  };
}

/**
 * Combines multiple disposables into a single IDisposable.
 */
function combinedDisposable(...disposables: IDisposable[]): IDisposable {
  return toDisposable(() => {
    for (const d of disposables) {
      d.dispose();
    }
  });
}

/**
 * Check if a value is an IDisposable.
 */
function isDisposable(value: unknown): value is IDisposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as IDisposable).dispose === 'function'
  );
}

/**
 * Safely dispose a value if it implements IDisposable.
 */
function safeDispose(value: unknown): void {
  if (isDisposable(value)) {
    try {
      value.dispose();
    } catch {
      // Swallow disposal errors for safety
    }
  }
}

/**
 * Marks a disposable as already disposed to prevent double-dispose warnings.
 */
function markAsDisposed(disposable: IDisposable): void {
  // Used by tracking — remove from the tracking map
  if (_trackDisposals && '_trackingId' in disposable) {
    _disposalTraces.delete((disposable as any)._trackingId);
  }
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

// ─── AsyncDisposableStore ────────────────────────────────────────────────────

/**
 * Like DisposableStore but supports async disposal.
 */
class AsyncDisposableStore implements IAsyncDisposable, IDisposable {
  private readonly _disposables: (IDisposable | IAsyncDisposable)[] = [];
  private _isDisposed = false;

  get isDisposed(): boolean { return this._isDisposed; }

  add<T extends IDisposable | IAsyncDisposable>(disposable: T): T {
    if (this._isDisposed) {
      if ('disposeAsync' in disposable) {
        (disposable as IAsyncDisposable).disposeAsync();
      } else {
        (disposable as IDisposable).dispose();
      }
      return disposable;
    }
    this._disposables.push(disposable);
    return disposable;
  }

  /** Synchronous dispose — disposes sync items, begins async dispose for async items. */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    for (const d of this._disposables) {
      if ('disposeAsync' in d) {
        (d as IAsyncDisposable).disposeAsync();
      } else {
        (d as IDisposable).dispose();
      }
    }
    this._disposables.length = 0;
  }

  /** Async dispose — awaits all disposals. */
  async disposeAsync(): Promise<void> {
    if (this._isDisposed) return;
    this._isDisposed = true;
    const promises: Promise<void>[] = [];
    for (const d of this._disposables) {
      if ('disposeAsync' in d) {
        promises.push((d as IAsyncDisposable).disposeAsync());
      } else {
        (d as IDisposable).dispose();
      }
    }
    this._disposables.length = 0;
    await Promise.all(promises);
  }
}

// ─── MutableDisposable ───────────────────────────────────────────────────────

/**
 * A disposable wrapper that holds a single disposable value that can be replaced.
 * When a new value is set, the old one is disposed.
 */
class MutableDisposable<T extends IDisposable> implements IDisposable {
  private _value: T | undefined;
  private _isDisposed = false;

  get value(): T | undefined {
    return this._isDisposed ? undefined : this._value;
  }

  set value(value: T | undefined) {
    if (this._isDisposed) {
      value?.dispose();
      return;
    }
    if (this._value !== value) {
      this._value?.dispose();
      this._value = value;
    }
  }

  /**
   * Clear the current value (disposing it) without marking the holder as disposed.
   */
  clear(): void {
    this.value = undefined;
  }

  dispose(): void {
    this._isDisposed = true;
    this._value?.dispose();
    this._value = undefined;
  }
}

// ─── RefCountDisposable ──────────────────────────────────────────────────────

/**
 * A disposable that is only disposed when its reference count reaches zero.
 * Useful for shared resources that may be referenced by multiple owners.
 */
class RefCountDisposable implements IDisposable {
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
 * Base class for objects that need disposal tracking.
 * Subclasses register disposables via `_register()` and they are
 * automatically cleaned up when `dispose()` is called.
 *
 * When disposal tracking is enabled, logs a warning if the object
 * is not disposed.
 */
export abstract class Disposable implements IDisposable {
  private readonly _store = new DisposableStore();
  private _isDisposed = false;
  private _trackingId: number | undefined;

  constructor() {
    if (_trackDisposals) {
      this._trackingId = _nextTrackingId++;
      _disposalTraces.set(this._trackingId, new Error().stack ?? 'unknown');
    }
  }

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

    // Remove from tracking
    if (this._trackingId !== undefined) {
      _disposalTraces.delete(this._trackingId);
    }

    this._store.dispose();
  }
}

// ─── AsyncDisposable Base Class ──────────────────────────────────────────────

/**
 * Base class for objects that need async disposal.
 */
abstract class AsyncDisposable implements IDisposable, IAsyncDisposable {
  private readonly _syncStore = new DisposableStore();
  private readonly _asyncStore = new AsyncDisposableStore();
  private _isDisposed = false;

  get isDisposed(): boolean { return this._isDisposed; }

  protected _register<T extends IDisposable>(disposable: T): T {
    return this._syncStore.add(disposable);
  }

  protected _registerAsync<T extends IAsyncDisposable>(disposable: T): T {
    return this._asyncStore.add(disposable);
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    this._syncStore.dispose();
    this._asyncStore.dispose();
  }

  async disposeAsync(): Promise<void> {
    if (this._isDisposed) return;
    this._isDisposed = true;
    this._syncStore.dispose();
    await this._asyncStore.disposeAsync();
  }
}
