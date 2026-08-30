// storage.ts — storage abstraction (localStorage, IndexedDB, etc.)
//
// Provides both async (IStorage) and sync (ISyncStorage) interfaces with
// multiple backend implementations: in-memory, localStorage, and IndexedDB.
// Includes namespacing for isolation, quota-exceeded error reporting,
// key enumeration for migration, and graceful error handling throughout.

import { Event } from './events.js';

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
  readonly onDidError?: Event<StorageError>;
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

  readonly onDidError?: Event<StorageError>;
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

// ─── IndexedDBStorage ────────────────────────────────────────────────────────

