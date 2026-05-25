// toolArtifactStoreArtifactIdsByWorkspace.tier0.test.ts — Slice A61

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

describe('IToolArtifactStore.artifactIdsByWorkspace (Slice A61)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns empty array on empty store', () => {
    expect(s.artifactIdsByWorkspace('w1')).toEqual([]);
  });

  it('returns empty array for empty workspaceId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    expect(s.artifactIdsByWorkspace('')).toEqual([]);
  });

  it('returns ids by workspace in insertion order', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    s.put({ toolId: 't1', artifactId: 'a2', data: {}, createdAt: 2, workspaceId: 'w2' });
    s.put({ toolId: 't2', artifactId: 'b1', data: {}, createdAt: 3, workspaceId: 'w1' });
    expect(s.artifactIdsByWorkspace('w1')).toEqual(['a1', 'b1']);
    expect(s.artifactIdsByWorkspace('w2')).toEqual(['a2']);
  });

  it('skips records without a workspaceId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    s.put({ toolId: 't1', artifactId: 'a2', data: {}, createdAt: 2, workspaceId: 'w1' });
    expect(s.artifactIdsByWorkspace('w1')).toEqual(['a2']);
  });

  it('returns empty array for unknown workspaceId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    expect(s.artifactIdsByWorkspace('nope')).toEqual([]);
  });

  it('returns a fresh array snapshot', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    const first = s.artifactIdsByWorkspace('w1');
    const second = s.artifactIdsByWorkspace('w1');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('agrees with listByWorkspace(workspaceId).map(r => r.artifactId)', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    s.put({ toolId: 't2', artifactId: 'b1', data: {}, createdAt: 2, workspaceId: 'w1' });
    const ids = s.artifactIdsByWorkspace('w1');
    const fromList = s.listByWorkspace('w1').map((r) => r.artifactId);
    expect(ids).toEqual(fromList);
  });
});
