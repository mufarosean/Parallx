// storage.ts — storage abstraction (localStorage, IndexedDB, etc.)
//
// Provides both async (IStorage) and sync (ISyncStorage) interfaces with
// multiple backend implementations: in-memory, localStorage, and IndexedDB.
// Includes namespacing for isolation, quota-exceeded error reporting,
// key enumeration for migration, and graceful error handling throughout.

import { Emitter, Event } from './events.js';
import { IDisposable } from './lifecycle.js';

// ─── Storage Error ───────────────────────────────────────────────────────────

/**
 * Types of storage errors that can be reported.
 */
export const enum StorageErrorKind {
  QuotaExceeded = 'quotaExceeded',
  AccessDenied = 'accessDenied',
  Unknown = 'unknown',
}

interface StorageError {
  readonly kind: StorageErrorKind;
  readonly key: string;
  readonly message: string;
}

// ─── IStorage (async) ────────────────────────────────────────────────────────

/**
 * Async key-value storage interface.
 */
export interface IStorage {
  /** Get a value by key. Returns undefined if not found. */
  get(key: string): Promise<string | undefined>;

  /** Set a value by key. */
  set(key: string, value: string): Promise<void>;

  /** Delete a value by key. */
  delete(key: string): Promise<void>;

  /** Check if a key exists. */
  has(key: string): Promise<boolean>;

  /** Return all keys, optionally filtered by a prefix. */
  keys(prefix?: string): Promise<string[]>;

  /** Clear all values (optionally within a namespace prefix). */
  clear(): Promise<void>;

  /** Fires when a storage operation fails (e.g. quota exceeded). */
  readonly onError?: Event<StorageError>;
}

// ─── ISyncStorage ────────────────────────────────────────────────────────────

/**
 * Synchronous key-value storage interface for simple data.
 */
interface ISyncStorage {
  getSync(key: string): string | undefined;
  setSync(key: string, value: string): void;
  deleteSync(key: string): void;
  hasSync(key: string): boolean;
  keysSync(prefix?: string): string[];
  clearSync(): void;

  readonly onError?: Event<StorageError>;
}

// ─── NamespacedStorage ───────────────────────────────────────────────────────

/**
 * Namespaced storage that prefixes all keys for isolation.
 */
export class NamespacedStorage implements IStorage {
  constructor(
    private readonly _inner: IStorage,
    private readonly _namespace: string,
  ) {}

  private _key(key: string): string {
    return `${this._namespace}:${key}`;
  }

  get(key: string): Promise<string | undefined> {
    return this._inner.get(this._key(key));
  }

  set(key: string, value: string): Promise<void> {
    return this._inner.set(this._key(key), value);
  }

  delete(key: string): Promise<void> {
    return this._inner.delete(this._key(key));
  }

  has(key: string): Promise<boolean> {
    return this._inner.has(this._key(key));
  }

  async keys(prefix?: string): Promise<string[]> {
    const allKeys = await this._inner.keys(this._namespace + ':' + (prefix ?? ''));
    const nsLen = this._namespace.length + 1;
    return allKeys.map(k => k.slice(nsLen));
  }

  async clear(): Promise<void> {
    const allKeys = await this._inner.keys(this._namespace + ':');
    for (const key of allKeys) {
      await this._inner.delete(key);
    }
  }

  get onError(): Event<StorageError> | undefined {
    return this._inner.onError;
  }
}

/**
 * Namespaced wrapper for synchronous storage.
 */
export class NamespacedSyncStorage implements ISyncStorage {
  constructor(
    private readonly _inner: ISyncStorage,
    private readonly _namespace: string,
  ) {}

  private _key(key: string): string {
    return `${this._namespace}:${key}`;
  }

  getSync(key: string): string | undefined { return this._inner.getSync(this._key(key)); }
  setSync(key: string, value: string): void { this._inner.setSync(this._key(key), value); }
  deleteSync(key: string): void { this._inner.deleteSync(this._key(key)); }
  hasSync(key: string): boolean { return this._inner.hasSync(this._key(key)); }

  keysSync(prefix?: string): string[] {
    const allKeys = this._inner.keysSync(this._namespace + ':' + (prefix ?? ''));
    const nsLen = this._namespace.length + 1;
    return allKeys.map(k => k.slice(nsLen));
  }

  clearSync(): void {
    const allKeys = this._inner.keysSync(this._namespace + ':');
    for (const key of allKeys) {
      this._inner.deleteSync(key);
    }
  }

  get onError(): Event<StorageError> | undefined { return this._inner.onError; }
}

// ─── InMemoryStorage ─────────────────────────────────────────────────────────

/**
 * In-memory storage implementation. Useful for testing.
 * Implements both IStorage and ISyncStorage.
 */
export class InMemoryStorage implements IStorage, ISyncStorage {
  private readonly _store = new Map<string, string>();

  // ── Async ──

  async get(key: string): Promise<string | undefined> { return this._store.get(key); }
  async set(key: string, value: string): Promise<void> { this._store.set(key, value); }
  async delete(key: string): Promise<void> { this._store.delete(key); }
  async has(key: string): Promise<boolean> { return this._store.has(key); }

  async keys(prefix?: string): Promise<string[]> {
    const all = [...this._store.keys()];
    return prefix ? all.filter(k => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> { this._store.clear(); }

  // ── Sync ──

  getSync(key: string): string | undefined { return this._store.get(key); }
  setSync(key: string, value: string): void { this._store.set(key, value); }
  deleteSync(key: string): void { this._store.delete(key); }
  hasSync(key: string): boolean { return this._store.has(key); }

  keysSync(prefix?: string): string[] {
    const all = [...this._store.keys()];
    return prefix ? all.filter(k => k.startsWith(prefix)) : all;
  }

  clearSync(): void { this._store.clear(); }
}

// ─── LocalStorage ────────────────────────────────────────────────────────────

/**
 * localStorage-backed storage implementation.
 * Implements both IStorage (async) and ISyncStorage (sync).
 * Reports quota-exceeded and access errors via onError.
 */
export class LocalStorage implements IStorage, ISyncStorage, IDisposable {
  private readonly _onError = new Emitter<StorageError>();
  readonly onError: Event<StorageError> = this._onError.event;

  // ── Helpers ──

  private _handleError(err: unknown, key: string): void {
    let kind = StorageErrorKind.Unknown;
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof DOMException) {
      if (err.name === 'QuotaExceededError' || err.code === 22) {
        kind = StorageErrorKind.QuotaExceeded;
      } else if (err.name === 'SecurityError') {
        kind = StorageErrorKind.AccessDenied;
      }
    }
    this._onError.fire({ kind, key, message: msg });
  }

  // ── Async ──

  async get(key: string): Promise<string | undefined> {
    return this.getSync(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.setSync(key, value);
  }

  async delete(key: string): Promise<void> {
    this.deleteSync(key);
  }

  async has(key: string): Promise<boolean> {
    return this.hasSync(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    return this.keysSync(prefix);
  }

  async clear(): Promise<void> {
    this.clearSync();
  }

  // ── Sync ──

  getSync(key: string): string | undefined {
    try {
      const value = localStorage.getItem(key);
      return value ?? undefined;
    } catch (err) {
      this._handleError(err, key);
      return undefined;
    }
  }

  setSync(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      this._handleError(err, key);
    }
  }

  deleteSync(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      this._handleError(err, key);
    }
  }

  hasSync(key: string): boolean {
    try {
      return localStorage.getItem(key) !== null;
    } catch (err) {
      this._handleError(err, key);
      return false;
    }
  }

  keysSync(prefix?: string): string[] {
    try {
      const result: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k !== null && (!prefix || k.startsWith(prefix))) {
          result.push(k);
        }
      }
      return result;
    } catch (err) {
      this._handleError(err, '');
      return [];
    }
  }

  clearSync(): void {
    try {
      localStorage.clear();
    } catch (err) {
      this._handleError(err, '');
    }
  }

  dispose(): void {
    this._onError.dispose();
  }
}

// ─── IndexedDBStorage ────────────────────────────────────────────────────────

const IDB_DEFAULT_DB = 'parallx-storage';
const IDB_DEFAULT_STORE = 'kv';

/**
 * IndexedDB-backed storage for large data.
 * Async-only (IndexedDB is inherently asynchronous).
 */
export class IndexedDBStorage implements IStorage, IDisposable {
  private _db: IDBDatabase | undefined;
  private readonly _dbName: string;
  private readonly _storeName: string;
  private _opening: Promise<IDBDatabase> | undefined;

  private readonly _onError = new Emitter<StorageError>();
  readonly onError: Event<StorageError> = this._onError.event;

  constructor(dbName: string = IDB_DEFAULT_DB, storeName: string = IDB_DEFAULT_STORE) {
    this._dbName = dbName;
    this._storeName = storeName;
  }

  // ── Database lifecycle ──

  private _open(): Promise<IDBDatabase> {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;

    this._opening = new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const request = indexedDB.open(this._dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(this._storeName)) {
            db.createObjectStore(this._storeName);
          }
        };
        request.onsuccess = () => {
          this._db = request.result;
          this._opening = undefined;
          resolve(this._db);
        };
        request.onerror = () => {
          this._opening = undefined;
          reject(request.error);
        };
      } catch (err) {
        this._opening = undefined;
        reject(err);
      }
    });

    return this._opening;
  }

  private async _tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this._open();
    const tx = db.transaction(this._storeName, mode);
    return tx.objectStore(this._storeName);
  }

  private _request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ── IStorage ──

  async get(key: string): Promise<string | undefined> {
    try {
      const store = await this._tx('readonly');
      const value = await this._request(store.get(key));
      return typeof value === 'string' ? value : undefined;
    } catch (err) {
      this._handleError(err, key);
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const store = await this._tx('readwrite');
      await this._request(store.put(value, key));
    } catch (err) {
      this._handleError(err, key);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const store = await this._tx('readwrite');
      await this._request(store.delete(key));
    } catch (err) {
      this._handleError(err, key);
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const store = await this._tx('readonly');
      const count = await this._request(store.count(key));
      return count > 0;
    } catch (err) {
      this._handleError(err, key);
      return false;
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    try {
      const store = await this._tx('readonly');
      const allKeys = await this._request(store.getAllKeys()) as string[];
      return prefix ? allKeys.filter(k => typeof k === 'string' && k.startsWith(prefix)) : allKeys.filter(k => typeof k === 'string');
    } catch (err) {
      this._handleError(err, '');
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      const store = await this._tx('readwrite');
      await this._request(store.clear());
    } catch (err) {
      this._handleError(err, '');
    }
  }

  private _handleError(err: unknown, key: string): void {
    let kind = StorageErrorKind.Unknown;
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof DOMException) {
      if (err.name === 'QuotaExceededError' || err.code === 22) {
        kind = StorageErrorKind.QuotaExceeded;
      } else if (err.name === 'SecurityError') {
        kind = StorageErrorKind.AccessDenied;
      }
    }
    this._onError.fire({ kind, key, message: msg });
  }

  dispose(): void {
    this._db?.close();
    this._db = undefined;
    this._onError.dispose();
  }
}

// ─── Migration Utility ───────────────────────────────────────────────────────

/**
 * Copy all data from one storage backend to another.
 * Useful for migrating between implementations (e.g. localStorage → IndexedDB).
 */
export async function migrateStorage(
  source: IStorage,
  target: IStorage,
  prefix?: string,
): Promise<number> {
  const keys = await source.keys(prefix);
  let count = 0;
  for (const key of keys) {
    const value = await source.get(key);
    if (value !== undefined) {
      await target.set(key, value);
      count++;
    }
  }
  return count;
}
