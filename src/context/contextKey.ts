// contextKey.ts — context key definitions and API
//
// Provides the ContextKeyService: a hierarchical, scoped key-value store
// that tracks context state across the workbench. Context keys drive
// when-clause evaluation for command enablement and UI rendering.
//
// Scoping: each scope (global, part, view) can set its own keys.
// A child scope inherits from its parent, so a lookup walks up the chain
// until a value is found (or returns undefined).

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { testWhenClause, parseWhenClause, evaluateWhenClause } from './whenClause.js';
import type { ContextKeyLookup } from './whenClause.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Allowed context key value types. */
export type ContextKeyValue = string | number | boolean | string[] | Record<string, unknown> | undefined;

/** Event payload when context keys change. */
export interface ContextKeyChangeEvent {
  /** The keys that changed. */
  readonly affectedKeys: ReadonlySet<string>;
}

// ─── IContextKey ─────────────────────────────────────────────────────────────

/**
 * A typed handle to a single context key. Allows setting and resetting
 * values with proper change tracking.
 */
export interface IContextKey<T extends ContextKeyValue = ContextKeyValue> {
  readonly key: string;
  get(): T;
  set(value: T): void;
  reset(): void;
}

// ─── ContextKeyScope ─────────────────────────────────────────────────────────

/**
 * A named scope that holds context key values.
 * Scopes form a parent→child chain. Lookups walk up the chain.
 */
class ContextKeyScope extends Disposable {
  private readonly _values = new Map<string, ContextKeyValue>();

  constructor(
    readonly scopeId: string,
    private readonly _parent: ContextKeyScope | undefined,
    private readonly _onDidChangeKeys: (keys: ReadonlySet<string>) => void,
  ) {
    super();
  }

  get(key: string): ContextKeyValue {
    if (this._values.has(key)) {
      return this._values.get(key);
    }
    return this._parent?.get(key);
  }

  set(key: string, value: ContextKeyValue): void {
    const old = this._values.get(key);
    if (old === value) return;
    this._values.set(key, value);
    this._onDidChangeKeys(new Set([key]));
  }

  delete(key: string): void {
    if (!this._values.has(key)) return;
    this._values.delete(key);
    this._onDidChangeKeys(new Set([key]));
  }

  /** Get all keys set at this scope level (not inherited). */
  ownKeys(): IterableIterator<string> {
    return this._values.keys();
  }

  /** Collect all key-value pairs visible from this scope (including inherited). */
  collectAll(): Map<string, ContextKeyValue> {
    const result = this._parent ? this._parent.collectAll() : new Map<string, ContextKeyValue>();
    for (const [k, v] of this._values) {
      result.set(k, v);
    }
    return result;
  }

  override dispose(): void {
    this._values.clear();
    super.dispose();
  }
}

// ─── ContextKeyHandle ────────────────────────────────────────────────────────

/**
 * Concrete implementation of IContextKey — a typed handle to a single key
 * within a specific scope.
 */
class ContextKeyHandle<T extends ContextKeyValue> implements IContextKey<T> {
  constructor(
    readonly key: string,
    private _defaultValue: T,
    private readonly _scope: ContextKeyScope,
  ) {}

  get(): T {
    const val = this._scope.get(this.key);
    return (val !== undefined ? val : this._defaultValue) as T;
  }

  set(value: T): void {
    this._scope.set(this.key, value);
  }

  reset(): void {
    this._scope.delete(this.key);
  }
}

// ─── ContextKeyService ───────────────────────────────────────────────────────

/**
 * Central context key service. Manages scoped context state, provides
 * context key handles, and evaluates when-clause expressions.
 *
 * Scopes:
 *  - `'global'`  — root scope, always exists
 *  - Part scopes — created via `createScope('workbench.parts.sidebar', 'global')`
 *  - View scopes — created via `createScope('view:explorer', 'workbench.parts.sidebar')`
 *
 * When-clause evaluation resolves keys against a specified scope
 * (defaulting to global).
 */
export class ContextKeyService extends Disposable {
  private readonly _scopes = new Map<string, ContextKeyScope>();
  private readonly _globalScope: ContextKeyScope;

  // ── Events ──

  private readonly _onDidChangeContext = this._register(new Emitter<ContextKeyChangeEvent>());
  readonly onDidChangeContext: Event<ContextKeyChangeEvent> = this._onDidChangeContext.event;

  constructor() {
    super();

    // Create the root global scope
    this._globalScope = new ContextKeyScope('global', undefined, (keys) => {
      this._onDidChangeContext.fire({ affectedKeys: keys });
    });
    this._register(this._globalScope);
    this._scopes.set('global', this._globalScope);
  }

  // ─── Scope Management ──────────────────────────────────────────────────

  /**
   * Create a child scope that inherits from a parent.
   * Returns a disposable that removes the scope on disposal.
   *
   * @param scopeId   Unique scope identifier (e.g. part ID, "view:explorer")
   * @param parentId  Parent scope ID (default: 'global')
   */
  createScope(scopeId: string, parentId = 'global'): IDisposable {
    if (this._scopes.has(scopeId)) {
      console.warn(`[ContextKeyService] Scope already exists: ${scopeId}`);
      return toDisposable(() => {});
    }

    const parent = this._scopes.get(parentId) ?? this._globalScope;
    const scope = new ContextKeyScope(scopeId, parent, (keys) => {
      this._onDidChangeContext.fire({ affectedKeys: keys });
    });
    this._scopes.set(scopeId, scope);

    return toDisposable(() => {
      scope.dispose();
      this._scopes.delete(scopeId);
    });
  }

  /**
   * Check if a scope exists.
   */
  hasScope(scopeId: string): boolean {
    return this._scopes.has(scopeId);
  }

  // ─── Key Operations ────────────────────────────────────────────────────

  /**
   * Create a typed context key handle.
   *
   * @param key          The context key name
   * @param defaultValue Default value when the key is not set
   * @param scopeId      Which scope to bind to (default: 'global')
   */
  createKey<T extends ContextKeyValue>(key: string, defaultValue: T, scopeId = 'global'): IContextKey<T> {
    const scope = this._scopes.get(scopeId) ?? this._globalScope;
    return new ContextKeyHandle<T>(key, defaultValue, scope);
  }

  /**
   * Set a context key value directly (convenience, uses global scope).
   */
  setContext(key: string, value: ContextKeyValue): void {
    this._globalScope.set(key, value);
  }

  /**
   * Set a context key value in a specific scope.
   */
  setContextInScope(key: string, value: ContextKeyValue, scopeId: string): void {
    const scope = this._scopes.get(scopeId) ?? this._globalScope;
    scope.set(key, value);
  }

  /**
   * Get a context key value from a scope (with parent inheritance).
   */
  getContextValue(key: string, scopeId = 'global'): ContextKeyValue {
    const scope = this._scopes.get(scopeId) ?? this._globalScope;
    return scope.get(key);
  }

  /**
   * Remove a context key from a scope.
   */
  removeContext(key: string, scopeId = 'global'): void {
    const scope = this._scopes.get(scopeId);
    scope?.delete(key);
  }

  /**
   * Get all context key-value pairs visible from a scope.
   */
  getAllContext(scopeId = 'global'): Map<string, ContextKeyValue> {
    const scope = this._scopes.get(scopeId) ?? this._globalScope;
    return scope.collectAll();
  }

  // ─── When-Clause Evaluation ────────────────────────────────────────────

  /**
   * Create a context lookup function for a given scope.
   * This is the bridge between the context key store and the when-clause evaluator.
   */
  createLookup(scopeId = 'global'): ContextKeyLookup {
    const scope = this._scopes.get(scopeId) ?? this._globalScope;
    return (key: string) => scope.get(key);
  }

  /**
   * Evaluate a when-clause expression against a scope.
   *
   * @param expression  The when-clause string (e.g. `'sidebarVisible && !panelVisible'`)
   * @param scopeId     Which scope to evaluate in (default: 'global')
   * @returns           Whether the expression is satisfied
   */
  evaluate(expression: string | undefined, scopeId = 'global'): boolean {
    if (!expression) return true; // undefined/empty → always true
    const lookup = this.createLookup(scopeId);
    return testWhenClause(expression, lookup);
  }

  /**
   * Check if a command's when-clause is satisfied.
   * Aggregates context from ALL scopes so tool-scoped keys are visible
   * during global evaluation (e.g. command enablement, menu visibility).
   */
  contextMatchesRules(whenClause: string | undefined): boolean {
    if (!whenClause) return true;
    // Aggregate own keys from every scope so tool-scoped context keys
    // (set in child scopes like `tool:<id>`) are visible for evaluation.
    const aggregated = new Map<string, ContextKeyValue>();
    for (const scope of this._scopes.values()) {
      for (const key of scope.ownKeys()) {
        aggregated.set(key, scope.get(key));
      }
    }
    const lookup: ContextKeyLookup = (key: string) => aggregated.get(key);
    return testWhenClause(whenClause, lookup);
  }

  // ─── Disposal ──────────────────────────────────────────────────────────

  override dispose(): void {
    for (const scope of this._scopes.values()) {
      scope.dispose();
    }
    this._scopes.clear();
    super.dispose();
  }
}
