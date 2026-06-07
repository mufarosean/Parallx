import { describe, expect, it } from 'vitest';

import { MindStore } from '../../src/openclaw/mind/mindStore';
import { applyUpdate, type IMindEntry, type IMindUpdate } from '../../src/openclaw/mind/agentMindModel';
import type { IStorage } from '../../src/platform/storage';

/** Minimal in-memory IStorage for the persistence boundary. */
class FakeStorage implements IStorage {
  readonly map = new Map<string, string>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async has(k: string) { return this.map.has(k); }
  async keys(prefix?: string) { return [...this.map.keys()].filter(k => !prefix || k.startsWith(prefix)); }
}

let n = 0;
const genId = () => `e${++n}`;
const belief = (over: Partial<IMindUpdate> = {}): IMindUpdate => ({
  kind: 'belief', content: 'b', confidence: 0.8, provenance: ['r'], ...over,
});

describe('MindStore', () => {
  it('round-trips the MIND across save/load (continuity)', async () => {
    const storage = new FakeStorage();
    const store = new MindStore(storage);
    const entries = applyUpdate([], belief({ content: 'User ships Fridays' }), 0, genId);

    await store.save(entries, 0);
    const loaded = await store.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('User ships Fridays');
    expect(loaded[0].provenance).toEqual(['r']);
  });

  it('returns an empty MIND when nothing is persisted', async () => {
    expect(await new MindStore(new FakeStorage()).load()).toEqual([]);
  });

  it('degrades a corrupt document to empty (never crashes the loop)', async () => {
    const storage = new FakeStorage();
    await storage.set('autonomy.mind.v1', '{ not valid json');
    expect(await new MindStore(storage).load()).toEqual([]);
  });

  it('drops malformed entries on load but keeps valid ones', async () => {
    const storage = new FakeStorage();
    const good = applyUpdate([], belief(), 0, genId)[0];
    await storage.set('autonomy.mind.v1', JSON.stringify([good, { id: 'x', kind: 'belief' /* missing fields */ }]));
    const loaded = await new MindStore(storage).load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(good.id);
  });

  it('compacts at the persistence boundary so the document cannot grow unbounded', async () => {
    const storage = new FakeStorage();
    const store = new MindStore(storage);
    let entries: readonly IMindEntry[] = [];
    for (let i = 0; i < 10; i++) entries = applyUpdate(entries, belief({ content: `b${i}`, confidence: (i + 1) / 11 }), 0, genId);

    await store.save(entries, 0, { maxEntries: 3 });
    const loaded = await store.load();
    expect(loaded).toHaveLength(3); // only the 3 most salient persisted
  });

  it('survives a swallowed storage read error by returning empty', async () => {
    const broken: IStorage = {
      get: async () => { throw new Error('disk gone'); },
      set: async () => {}, delete: async () => {}, has: async () => false, keys: async () => [],
    };
    expect(await new MindStore(broken).load()).toEqual([]);
  });
});
