// syncCachedStorage.ts — M86-W7
//
// Synchronous read / write-through cache layered over an async IStorage.
//
// Renderers occasionally need to read UI state synchronously during the
// first paint (e.g. property-bar collapsed/expanded, slash-menu recent
// colours). Before M86 those call sites reached for `localStorage`
// directly, which we are evicting workspace-wide.
//
// The workbench warms an `ISyncCachedStorage<T>` during Phase 1 and the
// renderer then reads with `get(key)` synchronously. Writes update the
// in-memory cache immediately and queue an async write-through to the
// backing IStorage. The write promise is intentionally returned so
// callers that want to observe persistence can `await set(...)`; the
// vast majority don't need to and fire-and-forget is the expected
// usage.
//
// Values are JSON-serialised so any structured-cloneable shape works
// (booleans, strings, arrays, plain objects).

import type { IStorage } from './storage.js';

export interface ISyncCachedStorage<T> {
  /** Load the backing store into the in-memory cache. Idempotent. */
  warm(): Promise<void>;
  /** Synchronous read. Returns undefined if missing or cache not warmed. */
  get(key: string): T | undefined;
  /** Update the cache and queue an async write-through. */
  set(key: string, value: T): Promise<void>;
  /** True once warm() has resolved at least once. */
  readonly isWarm: boolean;
}

/**
 * Default in-memory implementation backed by an async IStorage.
 *
 * Reads from IStorage are issued during `warm()` for every key listed
 * in `prefix`. We deliberately do NOT lazily refresh — the workbench
 * owns the lifecycle and re-calls `warm()` if the workspace changes.
 */
export class SyncCachedStorage<T> implements ISyncCachedStorage<T> {
  private readonly _cache = new Map<string, T>();
  private _warmed = false;
  private _writeQueue: Promise<unknown> = Promise.resolve();

  /**
   * @param _storage  Backing async storage (e.g. FileBackedGlobalStorage).
   * @param _prefix   Optional namespace prefix; only keys starting with
   *                  this prefix are read during warm() and written via
   *                  set(). Pass '' to mirror the whole store.
   */
  constructor(
    private readonly _storage: IStorage,
    private readonly _prefix: string = '',
  ) {}

  get isWarm(): boolean {
    return this._warmed;
  }

  async warm(): Promise<void> {
    const keys = await this._storage.keys(this._prefix || undefined);
    for (const k of keys) {
      try {
        const raw = await this._storage.get(k);
        if (raw === undefined) continue;
        this._cache.set(this._stripPrefix(k), JSON.parse(raw) as T);
      } catch {
        // Skip values that fail to parse — they came from a different
        // schema generation and the caller will overwrite on next set().
      }
    }
    this._warmed = true;
  }

  get(key: string): T | undefined {
    return this._cache.get(key);
  }

  set(key: string, value: T): Promise<void> {
    this._cache.set(key, value);
    const fullKey = this._prefix ? `${this._prefix}${key}` : key;
    const serialized = JSON.stringify(value);
    const p = this._writeQueue.then(() => this._storage.set(fullKey, serialized));
    this._writeQueue = p.catch(() => { /* swallow — onDidError on IStorage owns reporting */ });
    return p;
  }

  private _stripPrefix(key: string): string {
    if (!this._prefix) return key;
    return key.startsWith(this._prefix) ? key.slice(this._prefix.length) : key;
  }
}
