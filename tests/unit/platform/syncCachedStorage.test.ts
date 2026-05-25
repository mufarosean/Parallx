// syncCachedStorage.test.ts — M86-W7 tier-0
//
// Validates the synchronous read / write-through cache. Backing IStorage
// is a tiny in-memory fake (Map) so the test runs under tier-0 (node env).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncCachedStorage } from '../../../src/platform/syncCachedStorage.js';
import type { IStorage } from '../../../src/platform/storage.js';

class FakeStorage implements IStorage {
  readonly store = new Map<string, string>();
  readonly setCalls: Array<[string, string]> = [];
  setLatencyMs = 0;
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    if (this.setLatencyMs) await new Promise(r => setTimeout(r, this.setLatencyMs));
    this.setCalls.push([key, value]);
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async has(key: string): Promise<boolean> { return this.store.has(key); }
  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.store.keys()];
    return prefix ? all.filter(k => k.startsWith(prefix)) : all;
  }
  async clear(): Promise<void> { this.store.clear(); }
}

describe('M86-W7 SyncCachedStorage', () => {
  let storage: FakeStorage;
  beforeEach(() => { storage = new FakeStorage(); });

  it('isWarm starts false and flips after warm()', async () => {
    const c = new SyncCachedStorage<boolean>(storage);
    expect(c.isWarm).toBe(false);
    await c.warm();
    expect(c.isWarm).toBe(true);
  });

  it('warm() loads pre-existing values from the backing store', async () => {
    storage.store.set('a', JSON.stringify(true));
    storage.store.set('b', JSON.stringify('hello'));
    const c = new SyncCachedStorage<unknown>(storage);
    await c.warm();
    expect(c.get('a')).toBe(true);
    expect(c.get('b')).toBe('hello');
  });

  it('get returns undefined for missing keys', async () => {
    const c = new SyncCachedStorage<string>(storage);
    await c.warm();
    expect(c.get('nope')).toBeUndefined();
  });

  it('set updates the cache synchronously and queues a write-through', async () => {
    const c = new SyncCachedStorage<boolean>(storage);
    await c.warm();
    const p = c.set('collapsed', true);
    // Synchronous read sees the new value before the write resolves.
    expect(c.get('collapsed')).toBe(true);
    await p;
    expect(storage.store.get('collapsed')).toBe(JSON.stringify(true));
  });

  it('serialises concurrent writes through the write queue', async () => {
    storage.setLatencyMs = 10;
    const c = new SyncCachedStorage<number>(storage);
    await c.warm();
    const p1 = c.set('k', 1);
    const p2 = c.set('k', 2);
    const p3 = c.set('k', 3);
    await Promise.all([p1, p2, p3]);
    expect(storage.setCalls.map(([, v]) => v)).toEqual([
      JSON.stringify(1),
      JSON.stringify(2),
      JSON.stringify(3),
    ]);
    expect(c.get('k')).toBe(3);
  });

  it('respects a key prefix on both warm() and set()', async () => {
    storage.store.set('canvas.recent.text', JSON.stringify(['red']));
    storage.store.set('other.key', JSON.stringify('ignored'));
    const c = new SyncCachedStorage<string[]>(storage, 'canvas.recent.');
    await c.warm();
    // Prefix is stripped on read.
    expect(c.get('text')).toEqual(['red']);
    expect(c.get('other.key')).toBeUndefined();
    await c.set('bg', ['blue']);
    expect(storage.store.get('canvas.recent.bg')).toBe(JSON.stringify(['blue']));
  });

  it('swallows JSON parse errors during warm without failing', async () => {
    storage.store.set('good', JSON.stringify(1));
    storage.store.set('bad', '{not valid json');
    const c = new SyncCachedStorage<unknown>(storage);
    await c.warm();
    expect(c.get('good')).toBe(1);
    expect(c.get('bad')).toBeUndefined();
    expect(c.isWarm).toBe(true);
  });

  it('write-queue errors do not poison subsequent writes', async () => {
    const c = new SyncCachedStorage<number>(storage);
    await c.warm();
    const setSpy = vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('disk full'));
    await c.set('a', 1).catch(() => {});
    setSpy.mockRestore();
    await c.set('b', 2);
    expect(storage.store.get('b')).toBe(JSON.stringify(2));
  });
});
