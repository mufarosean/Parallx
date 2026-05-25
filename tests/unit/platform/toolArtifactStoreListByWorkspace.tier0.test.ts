// toolArtifactStoreListByWorkspace.tier0.test.ts — Slice A33

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const rec = (toolId: string, artifactId: string, workspaceId?: string): ToolArtifactRecord => ({
  toolId,
  artifactId,
  data: { v: artifactId },
  workspaceId,
});

describe('IToolArtifactStore.listByWorkspace() (Slice A33)', () => {
  let store: InMemoryToolArtifactStore;

  beforeEach(() => {
    store = new InMemoryToolArtifactStore();
  });

  it('returns empty array on empty store', () => {
    expect(store.listByWorkspace('w1')).toEqual([]);
  });

  it('returns only records matching workspaceId, in insertion order', () => {
    store.put(rec('t1', 'a', 'w1'));
    store.put(rec('t2', 'b', 'w2'));
    store.put(rec('t1', 'c', 'w1'));
    store.put(rec('t3', 'd', 'w2'));
    const w1 = store.listByWorkspace('w1');
    expect(w1.map(r => r.artifactId)).toEqual(['a', 'c']);
    const w2 = store.listByWorkspace('w2');
    expect(w2.map(r => r.artifactId)).toEqual(['b', 'd']);
  });

  it('excludes records with no workspaceId', () => {
    store.put(rec('t1', 'a'));
    store.put(rec('t1', 'b', 'w1'));
    expect(store.listByWorkspace('w1').map(r => r.artifactId)).toEqual(['b']);
  });

  it('returns empty array for empty workspaceId', () => {
    store.put(rec('t1', 'a', 'w1'));
    expect(store.listByWorkspace('')).toEqual([]);
  });

  it('returns empty array for unmatched workspaceId', () => {
    store.put(rec('t1', 'a', 'w1'));
    expect(store.listByWorkspace('w2')).toEqual([]);
  });

  it('returns a fresh snapshot (mutations after the call do not affect the result)', () => {
    store.put(rec('t1', 'a', 'w1'));
    const snap = store.listByWorkspace('w1') as ToolArtifactRecord[];
    store.put(rec('t1', 'b', 'w1'));
    expect(snap).toHaveLength(1);
  });

  it('is symmetric with deleteByWorkspace', () => {
    store.put(rec('t1', 'a', 'w1'));
    store.put(rec('t1', 'b', 'w1'));
    store.put(rec('t2', 'c', 'w2'));
    expect(store.listByWorkspace('w1')).toHaveLength(2);
    expect(store.deleteByWorkspace('w1')).toBe(2);
    expect(store.listByWorkspace('w1')).toHaveLength(0);
    expect(store.listByWorkspace('w2')).toHaveLength(1);
  });
});
