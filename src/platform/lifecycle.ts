// lifecycle.ts — IDisposable pattern and lifecycle hooks

/**
 * An object that can release resources when no longer needed.
 */
export interface IDisposable {
  dispose(): void;
}

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
 * Combines multiple disposables into a single IDisposable.
 */
export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
  return toDisposable(() => {
    for (const d of disposables) {
      d.dispose();
    }
  });
}

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
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.clear();
  }

  /**
   * Dispose all items but keep the store usable (not marked as disposed).
   */
  clear(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.clear();
  }
}

/**
 * A disposable wrapper that holds a single disposable value that can be replaced.
 * When a new value is set, the old one is disposed.
 */
export class MutableDisposable<T extends IDisposable> implements IDisposable {
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

/**
 * Base class for objects that need disposal tracking.
 * Subclasses register disposables via `_register()` and they are
 * automatically cleaned up when `dispose()` is called.
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
