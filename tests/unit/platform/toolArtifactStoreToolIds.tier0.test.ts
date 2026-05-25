// toolArtifactStoreToolIds.tier0.test.ts — Slice A37

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const rec = (toolId: string, artifactId: string): ToolArtifactRecord => ({
  toolId,
  artifactId,
  data: null,
});

describe('IToolArtifactStore.toolIds() (Slice A37)', () => {
  let store: InMemoryToolArtifactStore;
  beforeEach(() => {
    store = new InMemoryToolArtifactStore();
  });

  it('returns empty array on empty store', () => {
    expect(store.toolIds()).toEqual([]);
  });

  it('returns distinct toolIds in first-insertion order', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t2', 'b'));
    store.put(rec('t1', 'c'));
    store.put(rec('t3', 'd'));
    expect(store.toolIds()).toEqual(['t1', 't2', 't3']);
  });

  it('preserves first-insertion order even after overwrites', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t2', 'b'));
    store.put(rec('t1', 'a')); // overwrite — still inserted at t1's existing slot
    expect(store.toolIds()).toEqual(['t1', 't2']);
  });

  it('drops toolIds whose records were all deleted', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t2', 'b'));
    store.delete('t1', 'a');
    expect(store.toolIds()).toEqual(['t2']);
  });

  it('returns a fresh snapshot', () => {
    store.put(rec('t1', 'a'));
    const snap = store.toolIds() as string[];
    store.put(rec('t2', 'b'));
    expect(snap).toEqual(['t1']);
  });

  it('returns empty after clear()', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t2', 'b'));
    store.clear();
    expect(store.toolIds()).toEqual([]);
  });
});
