/**
 * Foundation step 5, second half — arrangements kept by name.
 *
 * The store's promises: everything loads through the same untrusted-input
 * gate as an imported file, one corrupt entry never costs the list, and the
 * home arrangement is an ordinary entry with a reserved identity rather than
 * a special code path.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  ArrangementStore,
  HOME_ARRANGEMENT_ID,
  type IArrangementStorage,
} from '../../src/surfaces/arrangementStore';
import type { Arrangement } from '../../src/surfaces/arrangement';
import { Orientation, SizingMode } from '../../src/layout/layoutTypes';

function memoryStorage(): IArrangementStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k),
    set: async (k, v) => { map.set(k, v); },
  };
}

function arrangement(id: string, name: string): Arrangement {
  return {
    version: 1, id, name,
    rootOrientation: Orientation.Horizontal,
    root: {
      type: 'branch', orientation: Orientation.Horizontal, size: 0, sizingMode: SizingMode.Pixel,
      children: [{
        type: 'leaf', size: 600, sizingMode: SizingMode.Pixel,
        typeId: 'editor.text', binding: { kind: 'file', key: '/a.md', label: 'a.md' },
      }],
    },
  };
}

describe('ArrangementStore', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let store: ArrangementStore;

  beforeEach(() => {
    storage = memoryStorage();
    store = new ArrangementStore(storage);
  });

  it('round-trips arrangements through storage', async () => {
    await store.load();
    await store.save(arrangement('a1', 'Study'));
    await store.save(arrangement('a2', 'Writing'));

    const second = new ArrangementStore(storage);
    const { loaded, dropped } = await second.load();
    expect(loaded).toBe(2);
    expect(dropped).toBe(0);
    expect(second.get('a1')?.name).toBe('Study');
    expect(second.get('a2')?.root.children).toHaveLength(1);
  });

  it('drops a corrupt entry without costing the list', async () => {
    await store.load();
    await store.save(arrangement('good', 'Good'));
    // Corrupt the stored array by hand: one broken entry among the real ones.
    const entries = JSON.parse(storage.map.get('surfaces.arrangements')!) as unknown[];
    entries.push({ version: 1, id: 'bad' }); // no name, no root
    storage.map.set('surfaces.arrangements', JSON.stringify(entries));

    const second = new ArrangementStore(storage);
    const { loaded, dropped } = await second.load();
    expect(loaded).toBe(1);
    expect(dropped).toBe(1);
    expect(second.get('good')).toBeDefined();
  });

  it('survives storage holding garbage instead of an array', async () => {
    storage.map.set('surfaces.arrangements', '{"not": "an array"}');
    const { loaded, dropped } = await store.load();
    expect(loaded).toBe(0);
    expect(dropped).toBe(1);

    storage.map.set('surfaces.arrangements', 'not json at all');
    const again = new ArrangementStore(storage);
    await expect(again.load()).resolves.toEqual({ loaded: 0, dropped: 0 });
  });

  it('keeps the active id, and forgets it when its arrangement goes', async () => {
    await store.load();
    await store.save(arrangement('a1', 'Study'));
    await store.setActive('a1');

    const second = new ArrangementStore(storage);
    await second.load();
    expect(second.activeId).toBe('a1');

    await second.remove('a1');
    expect(second.activeId).toBeUndefined();

    const third = new ArrangementStore(storage);
    await third.load();
    expect(third.activeId).toBeUndefined();
  });

  it('refuses to activate an id it does not hold', async () => {
    await store.load();
    await store.setActive('nope');
    expect(store.activeId).toBeUndefined();
  });

  it('treats home as a reserved identity, listed first', async () => {
    await store.load();
    await store.save(arrangement('z', 'Zed'));
    // Whatever the capture was called, saving it as home re-stamps it.
    await store.saveAsHome(arrangement('temp-capture', 'Anything'));

    expect(store.getHome()?.id).toBe(HOME_ARRANGEMENT_ID);
    expect(store.getHome()?.name).toBe('Home');
    expect(store.list()[0].id).toBe(HOME_ARRANGEMENT_ID);
    expect(store.get('temp-capture')).toBeUndefined();
  });

  it('renames in place', async () => {
    await store.load();
    await store.save(arrangement('a1', 'Study'));
    await store.rename('a1', 'Exam 7');
    const second = new ArrangementStore(storage);
    await second.load();
    expect(second.get('a1')?.name).toBe('Exam 7');
  });

  it('imports through the same gate that loads, and exports what imports', () => {
    const exported = ArrangementStore.serializeExport(arrangement('x', 'Shared'));
    const back = ArrangementStore.parseImport(exported);
    expect(back?.id).toBe('x');
    expect(back?.name).toBe('Shared');

    expect(ArrangementStore.parseImport('not json')).toBeUndefined();
    expect(ArrangementStore.parseImport('{"version": 999}')).toBeUndefined();
  });
});
