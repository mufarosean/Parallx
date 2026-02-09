// storage.ts — storage abstraction (localStorage, IndexedDB, etc.)

/**
 * Async key-value storage interface.
 */
export interface IStorage {
  /**
   * Get a value by key. Returns undefined if not found.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Set a value by key.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Delete a value by key.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a key exists.
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all values (optionally within a namespace prefix).
   */
  clear(): Promise<void>;
}

/**
 * Namespaced storage that prefixes all keys for isolation.
 */
export class NamespacedStorage implements IStorage {
  constructor(
    private readonly _inner: IStorage,
    private readonly _namespace: string
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

  clear(): Promise<void> {
    return this._inner.clear();
  }
}

/**
 * In-memory storage implementation. Useful for testing.
 */
export class InMemoryStorage implements IStorage {
  private readonly _store = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this._store.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this._store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this._store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this._store.has(key);
  }

  async clear(): Promise<void> {
    this._store.clear();
  }
}

/**
 * localStorage-backed storage implementation.
 */
export class LocalStorage implements IStorage {
  async get(key: string): Promise<string | undefined> {
    try {
      const value = localStorage.getItem(key);
      return value ?? undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or access denied — silently fail
    }
  }

  async delete(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silently fail
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.clear();
    } catch {
      // Silently fail
    }
  }
}
