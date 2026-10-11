// lruCache.ts — a Map that forgets its least recently used entry past a size.
//
// A read moves the entry to the newest end; a write past the cap drops the
// oldest. Used where a cache would otherwise grow for as long as the app
// runs: file contents, embeddings.

export class LRUCache<K, V> {
  private readonly _map = new Map<K, V>();
  constructor(private readonly _max: number) {}

  get(key: K): V | undefined {
    const v = this._map.get(key);
    if (v !== undefined) {
      // Move to end (most recently used)
      this._map.delete(key);
      this._map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    this._map.delete(key);
    this._map.set(key, value);
    if (this._map.size > this._max) {
      // Evict oldest
      const first = this._map.keys().next().value;
      if (first !== undefined) this._map.delete(first);
    }
  }

  delete(key: K): void {
    this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  get size(): number {
    return this._map.size;
  }
}
