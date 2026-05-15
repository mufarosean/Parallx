// workspaceGraphBridge.ts — bridges `parallx.workspaceGraph` to a shared
// in-process registry of graph data providers.
//
// The workspace-graph extension (or any other consumer) reads the registry
// to merge nodes/edges contributed by every active tool. Each provider
// can also push a `notifyChange()` to signal its data has changed; the
// bridge re-emits this as a global `onDidChange` event so consumers can
// refresh without polling.
//
// The bridge itself is per-tool (so registrations are cleaned up on
// deactivation), but the underlying registry is module-global so all
// bridges share the same view.

import { type IDisposable, toDisposable } from '../../platform/lifecycle.js';

// ─── Public types ────────────────────────────────────────────────────────────

/** A node contributed by a provider. */
export interface GraphProviderNode {
  /** Stable id, must be unique across the whole graph. Convention: `<domain>:<localId>`. */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Logical domain (e.g. 'budget', 'media', 'character'). Used for legend + filtering. */
  readonly domain: string;
  /** Optional hex color (e.g. '#88aaff'). Falls back to domain default. */
  readonly color?: string;
  /** Optional emoji or codicon name shown in label. */
  readonly icon?: string;
  /** Optional size hint (1–10). Defaults from degree. */
  readonly weight?: number;
  /** Arbitrary metadata copied into the rendered node (used by inspector). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** An edge contributed by a provider. */
export interface GraphProviderEdge {
  readonly source: string;
  readonly target: string;
  /** Optional kind (e.g. 'mention', 'parent', 'reference'). For future styling. */
  readonly kind?: string;
  /** Optional strength/weight hint for consumers that style or lay out edges. */
  readonly weight?: number;
  /** Optional normalized score (0-1) for semantic or confidence-ranked edges. */
  readonly score?: number;
}

export interface GraphSnapshot {
  readonly nodes: readonly GraphProviderNode[];
  readonly edges: readonly GraphProviderEdge[];
}

export interface GraphProvider {
  /** Stable provider id (e.g. 'budget'). Used for diagnostics + dedup. */
  readonly id: string;
  /** Optional human-readable label for the legend. Defaults to id. */
  readonly displayName?: string;
  /** Build a fresh snapshot. Called on initial load and after notifyChange(). */
  snapshot(): Promise<GraphSnapshot> | GraphSnapshot;
}

// ─── Module-global registry ──────────────────────────────────────────────────

interface RegisteredProvider {
  readonly toolId: string;
  readonly provider: GraphProvider;
}

const _providers = new Map<string, RegisteredProvider>();
const _changeListeners = new Set<() => void>();

function _fireChange(): void {
  for (const fn of _changeListeners) {
    try { fn(); } catch (err) { console.warn('[WorkspaceGraphBridge] change listener threw:', err); }
  }
}

/**
 * Read-only access to all currently registered providers.
 * Used by the workspace-graph extension (and tests).
 */
export function getRegisteredGraphProviders(): readonly GraphProvider[] {
  return Array.from(_providers.values(), e => e.provider);
}

/**
 * Subscribe to global change notifications. Fires whenever any provider
 * is added, removed, or calls `notifyChange()`.
 */
export function onWorkspaceGraphDidChange(listener: () => void): IDisposable {
  _changeListeners.add(listener);
  return toDisposable(() => { _changeListeners.delete(listener); });
}

// ─── Per-tool bridge ─────────────────────────────────────────────────────────

export class WorkspaceGraphBridge {
  private _disposed = false;
  private readonly _registered = new Set<string>();

  constructor(
    private readonly _toolId: string,
    private readonly _subscriptions: IDisposable[],
  ) {}

  registerProvider(provider: GraphProvider): IDisposable {
    this._throwIfDisposed();
    if (!provider || !provider.id) {
      throw new Error('[WorkspaceGraphBridge] provider.id is required');
    }
    const key = provider.id;
    if (_providers.has(key)) {
      console.warn(`[WorkspaceGraphBridge] Provider "${key}" is already registered — replacing.`);
    }
    _providers.set(key, { toolId: this._toolId, provider });
    this._registered.add(key);
    _fireChange();
    const d = toDisposable(() => {
      const current = _providers.get(key);
      if (current && current.toolId === this._toolId) {
        _providers.delete(key);
        this._registered.delete(key);
        _fireChange();
      }
    });
    this._subscriptions.push(d);
    return d;
  }

  /**
   * Signal that data from one of this tool's providers has changed.
   * Consumers will re-snapshot all providers (cheap — they each return
   * pre-built node lists).
   */
  notifyChange(): void {
    this._throwIfDisposed();
    _fireChange();
  }

  onDidChange(listener: () => void): IDisposable {
    this._throwIfDisposed();
    const d = onWorkspaceGraphDidChange(listener);
    this._subscriptions.push(d);
    return d;
  }

  /**
   * Return all currently-registered providers (from all tools). Used by the
   * workspace-graph extension (and any other consumer that wants to merge
   * contributions). The returned list is a snapshot — call again after
   * `onDidChange` fires.
   */
  getAll(): readonly GraphProvider[] {
    this._throwIfDisposed();
    return getRegisteredGraphProviders();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Remove any providers this bridge owned that weren't already
    // disposed individually.
    let removed = false;
    for (const key of this._registered) {
      const current = _providers.get(key);
      if (current && current.toolId === this._toolId) {
        _providers.delete(key);
        removed = true;
      }
    }
    this._registered.clear();
    if (removed) _fireChange();
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[WorkspaceGraphBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
