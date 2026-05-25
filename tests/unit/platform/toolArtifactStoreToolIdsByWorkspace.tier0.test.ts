// toolArtifactStoreToolIdsByWorkspace.tier0.test.ts — Slice A62

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

describe('IToolArtifactStore.toolIdsByWorkspace (Slice A62)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns empty array on empty store', () => {
    expect(s.toolIdsByWorkspace('w1')).toEqual([]);
  });

  it('returns empty array for empty workspaceId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    expect(s.toolIdsByWorkspace('')).toEqual([]);
  });

  it('returns distinct toolIds in first-insertion order', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    s.put({ toolId: 't2', artifactId: 'b1', data: {}, createdAt: 2, workspaceId: 'w1' });
    s.put({ toolId: 't1', artifactId: 'a2', data: {}, createdAt: 3, workspaceId: 'w1' });
    expect(s.toolIdsByWorkspace('w1')).toEqual(['t1', 't2']);
  });

  it('isolates toolIds per workspace', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    s.put({ toolId: 't2', artifactId: 'b1', data: {}, createdAt: 2, workspaceId: 'w2' });
    expect(s.toolIdsByWorkspace('w1')).toEqual(['t1']);
    expect(s.toolIdsByWorkspace('w2')).toEqual(['t2']);
  });

  it('skips records without a workspaceId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    s.put({ toolId: 't2', artifactId: 'b1', data: {}, createdAt: 2, workspaceId: 'w1' });
    expect(s.toolIdsByWorkspace('w1')).toEqual(['t2']);
  });

  it('returns a fresh array snapshot', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    const first = s.toolIdsByWorkspace('w1');
    const second = s.toolIdsByWorkspace('w1');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('returns empty array for unknown workspaceId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1, workspaceId: 'w1' });
    expect(s.toolIdsByWorkspace('nope')).toEqual([]);
  });
});
