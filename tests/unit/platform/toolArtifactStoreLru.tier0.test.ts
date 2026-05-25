/**
 * §86 / Slice B10 — bounded LRU eviction for `InMemoryToolArtifactStore`.
 *
 * Slice B8 introduced the first production writer for the store via
 * `onDidExecuteTool`. Without an upper bound the store would grow
 * indefinitely as tools opt in. B10 adds an opt-out-able insertion-order
 * eviction policy so the store is safe for long-running sessions.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryToolArtifactStore,
  type ToolArtifactRecord,
} from '../../../src/workbench/toolArtifactStore';

function rec(toolId: string, artifactId: string, extra: Partial<ToolArtifactRecord> = {}): ToolArtifactRecord {
  return {
    toolId,
    artifactId,
    data: `data:${toolId}/${artifactId}`,
    mimeType: 'text/plain',
    createdAt: Date.now(),
    ...extra,
  };
}

describe('§86 Slice B10 — InMemoryToolArtifactStore bounded LRU', () => {
  let store: InMemoryToolArtifactStore;

  afterEach(() => {
    store?.dispose();
  });

  it('default capacity allows up to 1000 entries without eviction', () => {
    store = new InMemoryToolArtifactStore();
    for (let i = 0; i < 1000; i++) {
      store.put(rec('t', String(i)));
    }
    expect(store.size).toBe(1000);
    expect(store.has('t', '0')).toBe(true);
  });

  it('evicts the oldest entry once `maxEntries` is exceeded', () => {
    store = new InMemoryToolArtifactStore({ maxEntries: 3 });
    store.put(rec('t', 'a'));
    store.put(rec('t', 'b'));
    store.put(rec('t', 'c'));
    store.put(rec('t', 'd')); // should evict 'a'
    expect(store.size).toBe(3);
    expect(store.has('t', 'a')).toBe(false);
    expect(store.has('t', 'b')).toBe(true);
    expect(store.has('t', 'd')).toBe(true);
  });

  it('replace-in-place preserves insertion order (FIFO eviction, not LRU)', () => {
    store = new InMemoryToolArtifactStore({ maxEntries: 3 });
    store.put(rec('t', 'a'));
    store.put(rec('t', 'b'));
    store.put(rec('t', 'c'));
    // Replace 'a' — its slot is preserved (A37 contract), so it remains
    // the oldest and is the next victim. This deliberately favours the
    // toolIds() insertion-order contract over LRU touch semantics.
    store.put(rec('t', 'a', { data: 'fresh' }));
    store.put(rec('t', 'd')); // evicts 'a'
    expect(store.has('t', 'a')).toBe(false);
    expect(store.has('t', 'b')).toBe(true);
    expect(store.has('t', 'c')).toBe(true);
    expect(store.has('t', 'd')).toBe(true);
  });

  it('fires a `delete` change event for the evicted entry', () => {
    store = new InMemoryToolArtifactStore({ maxEntries: 2 });
    const events: Array<{ toolId: string; artifactId: string; kind: 'put' | 'delete' }> = [];
    store.onDidChange((e) => events.push({ ...e }));
    store.put(rec('t', 'a'));
    store.put(rec('t', 'b'));
    events.length = 0;
    store.put(rec('t', 'c'));
    // Expect: put-c, then delete-a (eviction).
    expect(events).toEqual([
      { toolId: 't', artifactId: 'c', kind: 'put' },
      { toolId: 't', artifactId: 'a', kind: 'delete' },
    ]);
  });

  it('`maxEntries: 0` disables eviction (unbounded)', () => {
    store = new InMemoryToolArtifactStore({ maxEntries: 0 });
    for (let i = 0; i < 5000; i++) {
      store.put(rec('t', String(i)));
    }
    expect(store.size).toBe(5000);
  });

  it('negative `maxEntries` is clamped to 0 (unbounded)', () => {
    store = new InMemoryToolArtifactStore({ maxEntries: -10 });
    for (let i = 0; i < 1500; i++) {
      store.put(rec('t', String(i)));
    }
    expect(store.size).toBe(1500);
  });
});
