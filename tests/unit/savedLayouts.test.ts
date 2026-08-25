// savedLayouts.test.ts — named body shapes, saved and switchable.
//
// The store: round-trip through the key-value storage, rename, remove,
// and the corrupt-JSON contract (a bad store loses its contents, never
// the session).
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { SavedLayoutStore, type SavedLayout } from '../../src/workbench/savedLayouts';
import type { SerializedGrid } from '../../src/layout/layoutModel';

function memoryStorage(seed?: Record<string, string>) {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    map,
    get: async (k: string) => map.get(k),
    set: async (k: string, v: string) => { map.set(k, v); },
  };
}

const FAKE_TREE = { root: { type: 'branch', children: [] }, orientation: 'horizontal', width: 100, height: 100 } as unknown as SerializedGrid;

function layout(id: string, name: string, savedAt = '2026-08-24T00:00:00.000Z'): SavedLayout {
  return { id, name, savedAt, tree: FAKE_TREE, rails: [] };
}

describe('SavedLayoutStore', () => {
  it('round-trips layouts through storage', async () => {
    const storage = memoryStorage();
    const store = new SavedLayoutStore(storage);
    await store.load();
    await store.save(layout('a', 'Writing', '2026-08-24T01:00:00.000Z'));
    await store.save(layout('b', 'Study', '2026-08-24T02:00:00.000Z'));

    const reread = new SavedLayoutStore(storage);
    await reread.load();
    expect(reread.list().map((l) => l.name)).toEqual(['Study', 'Writing']); // newest first
    expect(reread.get('a')?.tree).toEqual(FAKE_TREE);
  });

  it('renames and removes, persisting each change', async () => {
    const storage = memoryStorage();
    const store = new SavedLayoutStore(storage);
    await store.load();
    await store.save(layout('a', 'Writing'));

    expect(await store.rename('a', '  Deep Work  ')).toBe(true);
    expect(store.get('a')?.name).toBe('Deep Work');
    expect(await store.rename('a', '   ')).toBe(false); // empty names refused
    expect(await store.rename('missing', 'X')).toBe(false);

    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('a')).toBe(false);

    const reread = new SavedLayoutStore(storage);
    await reread.load();
    expect(reread.list()).toEqual([]);
  });

  it('survives corrupt or foreign storage content', async () => {
    for (const bad of ['not json', '{"a":1}', '[{"id":1},{"nope":true},null]']) {
      const store = new SavedLayoutStore(memoryStorage({ 'workbench.savedLayouts': bad }));
      await store.load();
      expect(store.list()).toEqual([]);
    }
  });

  it('accepts valid entries mixed with junk, defaulting missing rails', async () => {
    const good = { id: 'a', name: 'Writing', savedAt: '2026-08-24T00:00:00.000Z', tree: FAKE_TREE };
    const store = new SavedLayoutStore(memoryStorage({
      'workbench.savedLayouts': JSON.stringify([good, { id: 'x' }, 42]),
    }));
    await store.load();
    expect(store.list().map((l) => l.id)).toEqual(['a']);
    expect(store.get('a')?.rails).toEqual([]);
  });
});
