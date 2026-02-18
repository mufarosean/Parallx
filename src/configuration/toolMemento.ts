// toolMemento.ts — per-tool persistent Memento storage
//
// Implements the Memento pattern providing tools with `globalState` and
// `workspaceState` key-value stores. Keys are namespaced by tool ID to
// prevent collisions between tools. Values are JSON-serialized.
//
// Storage scopes:
//   - globalState: persists across all workspaces (namespace: `tool-global:<toolId>`)
//   - workspaceState: persists within current workspace (namespace: `tool-ws:<toolId>`)
//
// Integrates with M1's IStorage abstraction.

import { IStorage } from '../platform/storage.js';
import type { Memento } from '../tools/toolModuleLoader.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Warn when a tool's storage exceeds this many bytes. */
const QUOTA_WARN_BYTES = 5 * 1024 * 1024;   // 5 MB

/** Hard limit — updates are rejected once storage exceeds this. */
const QUOTA_HARD_BYTES = 10 * 1024 * 1024;   // 10 MB

/** Storage key prefix for global scope. */
const GLOBAL_PREFIX = 'tool-global';

/** Storage key prefix for workspace scope. */
const WORKSPACE_PREFIX = 'tool-ws';

// ─── ToolMemento ─────────────────────────────────────────────────────────────

/**
 * Persistent Memento implementation backed by IStorage.
 *
 * Each instance is scoped to a single tool and a single storage scope
 * (global or workspace). Keys are namespaced as `<prefix>:<toolId>/<key>`.
 */
export class ToolMemento implements Memento {
  /** In-memory cache of deserialized values (lazy-populated). */
  private readonly _cache = new Map<string, unknown>();

  /** Whether the initial load from storage has completed. */
  private _loaded = false;

  /** Approximate byte size of all stored values (tracked on writes). */
  private _estimatedBytes = 0;

  constructor(
    private readonly _storage: IStorage,
    private readonly _toolId: string,
    private readonly _scope: 'global' | 'workspace',
    private readonly _workspaceIdProvider?: () => string | undefined,
  ) {}

  // ── Memento interface ────────────────────────────────────────────────

  /**
   * Get a value by key. Returns `undefined` if the key does not exist
   * and no default is provided.
   */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const fullKey = this._fullKey(key);
    if (this._cache.has(fullKey)) {
      return this._cache.get(fullKey) as T;
    }
    return defaultValue;
  }

  /**
   * Update (or delete) a value. Pass `undefined` to delete.
   * Values must be JSON-serializable — functions, symbols, and
   * circular references will throw.
   */
  async update(key: string, value: unknown): Promise<void> {
    const fullKey = this._fullKey(key);

    if (value === undefined) {
      // Delete — decrement quota estimate for the removed value
      const oldValue = this._cache.get(fullKey);
      if (oldValue !== undefined) {
        const oldSize = JSON.stringify(oldValue).length;
        this._estimatedBytes = Math.max(0, this._estimatedBytes - oldSize);
      }
      this._cache.delete(fullKey);
      await this._storage.delete(fullKey);
      return;
    }

    // JSON-serialize to validate and compute size
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      throw new Error(
        `[ToolMemento] Value for key "${key}" (tool: ${this._toolId}) is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Quota check — account for the old value being replaced
    const oldValue = this._cache.get(fullKey);
    const oldSize = oldValue !== undefined ? JSON.stringify(oldValue).length : 0;
    const newSize = this._estimatedBytes - oldSize + serialized.length;
    if (newSize > QUOTA_HARD_BYTES) {
      throw new Error(
        `[ToolMemento] Storage quota exceeded for tool "${this._toolId}" (${this._scope}). ` +
        `Limit: ${(QUOTA_HARD_BYTES / 1024 / 1024).toFixed(0)}MB.`,
      );
    }
    if (newSize > QUOTA_WARN_BYTES && this._estimatedBytes <= QUOTA_WARN_BYTES) {
      console.warn(
        `[ToolMemento] Storage for tool "${this._toolId}" (${this._scope}) exceeds ${(QUOTA_WARN_BYTES / 1024 / 1024).toFixed(0)}MB warning threshold.`,
      );
    }

    // Update cache and persist
    this._cache.set(fullKey, value);
    await this._storage.set(fullKey, serialized);
    this._estimatedBytes = newSize;
  }

  /**
   * Return all stored keys for this tool (without the namespace prefix).
   */
  keys(): readonly string[] {
    const prefix = this._keyPrefix();
    return [...this._cache.keys()]
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Load all persisted entries for this tool from storage into the
   * in-memory cache. Call once before first access.
   */
  async load(): Promise<void> {
    if (this._loaded) return;

    const prefix = this._keyPrefix();
    const allKeys = await this._storage.keys(prefix);
    let totalBytes = 0;

    for (const key of allKeys) {
      const raw = await this._storage.get(key);
      if (raw !== undefined) {
        try {
          this._cache.set(key, JSON.parse(raw));
          totalBytes += raw.length;
        } catch {
          // Skip entries that cannot be deserialized
          console.warn(`[ToolMemento] Skipping corrupt entry "${key}" for tool "${this._toolId}"`);
        }
      }
    }

    this._estimatedBytes = totalBytes;
    this._loaded = true;
  }

  /**
   * Flush the in-memory cache to storage. Useful before workspace switch.
   */
  async flush(): Promise<void> {
    const prefix = this._keyPrefix();
    for (const [key, value] of this._cache) {
      if (key.startsWith(prefix)) {
        await this._storage.set(key, JSON.stringify(value));
      }
    }
  }

  /**
   * Clear all stored data for this tool in this scope.
   */
  async clear(): Promise<void> {
    const prefix = this._keyPrefix();
    const allKeys = await this._storage.keys(prefix);
    for (const key of allKeys) {
      await this._storage.delete(key);
    }
    // Remove cached entries
    for (const key of [...this._cache.keys()]) {
      if (key.startsWith(prefix)) {
        this._cache.delete(key);
      }
    }
    this._estimatedBytes = 0;
  }

  // ── Internal ─────────────────────────────────────────────────────────

  /**
   * The namespace prefix for all keys in this scope.
   * Format: `tool-global:<toolId>/` or `tool-ws:<toolId>/`
   */
  private _keyPrefix(): string {
    const scopePrefix = this._scope === 'global' ? GLOBAL_PREFIX : WORKSPACE_PREFIX;
    if (this._scope === 'workspace') {
      const workspaceId = this._workspaceIdProvider?.() ?? '__default__';
      return `${scopePrefix}:${this._toolId}:${workspaceId}/`;
    }
    return `${scopePrefix}:${this._toolId}/`;
  }

  /**
   * Build the full namespaced key for storage.
   */
  private _fullKey(key: string): string {
    return `${this._keyPrefix()}${key}`;
  }
}

// ─── Factory Helpers ─────────────────────────────────────────────────────────

/**
 * Create a pair of mementos (global + workspace) for a tool.
 */
export function createToolMementos(
  globalStorage: IStorage,
  workspaceStorage: IStorage,
  toolId: string,
  workspaceIdProvider?: () => string | undefined,
): { globalState: ToolMemento; workspaceState: ToolMemento } {
  return {
    globalState: new ToolMemento(globalStorage, toolId, 'global'),
    workspaceState: new ToolMemento(workspaceStorage, toolId, 'workspace', workspaceIdProvider),
  };
}
