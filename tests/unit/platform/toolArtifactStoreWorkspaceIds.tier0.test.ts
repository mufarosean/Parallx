// toolArtifactStoreWorkspaceIds.tier0.test.ts — Slice A39

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const rec = (toolId: string, artifactId: string, workspaceId?: string): ToolArtifactRecord => ({
  toolId,
  artifactId,
  data: null,
  workspaceId,
});

describe('IToolArtifactStore.workspaceIds() (Slice A39)', () => {
  let store: InMemoryToolArtifactStore;
  beforeEach(() => {
    store = new InMemoryToolArtifactStore();
  });

  it('returns empty array on empty store', () => {
    expect(store.workspaceIds()).toEqual([]);
  });

  it('returns distinct workspaceIds in first-insertion order', () => {
    store.put(rec('t', 'a', 'w1'));
    store.put(rec('t', 'b', 'w2'));
    store.put(rec('t', 'c', 'w1'));
    store.put(rec('t', 'd', 'w3'));
    expect(store.workspaceIds()).toEqual(['w1', 'w2', 'w3']);
  });

  it('skips records without a workspaceId', () => {
    store.put(rec('t', 'a'));
    store.put(rec('t', 'b', 'w1'));
    store.put(rec('t', 'c'));
    expect(store.workspaceIds()).toEqual(['w1']);
  });

  it('drops workspaceIds whose records were all deleted', () => {
    store.put(rec('t', 'a', 'w1'));
    store.put(rec('t', 'b', 'w2'));
    store.delete('t', 'a');
    expect(store.workspaceIds()).toEqual(['w2']);
  });

  it('returns a fresh snapshot', () => {
    store.put(rec('t', 'a', 'w1'));
    const snap = store.workspaceIds() as string[];
    store.put(rec('t', 'b', 'w2'));
    expect(snap).toEqual(['w1']);
  });

  it('returns empty after deleteByWorkspace removes all workspace records', () => {
    store.put(rec('t', 'a', 'w1'));
    store.put(rec('t', 'b', 'w1'));
    store.deleteByWorkspace('w1');
    expect(store.workspaceIds()).toEqual([]);
  });
});
