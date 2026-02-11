// contextBridge.ts — bridges parallx.context to internal ContextKeyService
//
// Creates tool-scoped context keys and provides read access to context values.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import type { ContextKeyValue, IContextKey } from '../../context/contextKey.js';
import type { IContextKeyService } from '../../services/serviceTypes.js';

/**
 * Bridge for the `parallx.context` API namespace.
 */
export class ContextBridge {
  private readonly _keys: IDisposable[] = [];
  private readonly _scopeId: string;
  private _scopeDisposable: IDisposable | undefined;
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _contextKeyService: IContextKeyService,
    private readonly _subscriptions: IDisposable[],
  ) {
    // Create a scope for this tool
    this._scopeId = `tool:${_toolId}`;
    this._scopeDisposable = this._contextKeyService.createScope(this._scopeId);
  }

  /**
   * Create a context key scoped to this tool.
   */
  createContextKey<T extends ContextKeyValue>(
    name: string,
    defaultValue: T,
  ): { key: string; get(): T; set(value: T): void; reset(): void } {
    this._throwIfDisposed();

    // Prefix the key with the tool ID for namespacing
    const fullKey = `${this._toolId}.${name}`;
    const handle = this._contextKeyService.createKey(fullKey, defaultValue, this._scopeId);

    const apiHandle = {
      get key() { return fullKey; },
      get(): T { return handle.get() as T; },
      set(value: T): void { handle.set(value); },
      reset(): void { handle.reset(); },
    };

    this._keys.push(toDisposable(() => handle.reset()));

    return apiHandle;
  }

  /**
   * Get the current value of a context key.
   */
  getContextValue(name: string): ContextKeyValue {
    this._throwIfDisposed();
    return this._contextKeyService.getContextValue(name, this._scopeId);
  }

  dispose(): void {
    this._disposed = true;
    for (const k of this._keys) {
      k.dispose();
    }
    this._keys.length = 0;
    this._scopeDisposable?.dispose();
    this._scopeDisposable = undefined;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[ContextBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
