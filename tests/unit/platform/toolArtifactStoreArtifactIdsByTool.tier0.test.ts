// toolArtifactStoreArtifactIdsByTool.tier0.test.ts — Slice A60

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

describe('IToolArtifactStore.artifactIdsByTool (Slice A60)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns empty array on empty store', () => {
    expect(s.artifactIdsByTool('t1')).toEqual([]);
  });

  it('returns empty array for empty toolId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    expect(s.artifactIdsByTool('')).toEqual([]);
  });

  it('returns artifact ids owned by the toolId in insertion order', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    s.put({ toolId: 't2', artifactId: 'b1', data: {}, createdAt: 2 });
    s.put({ toolId: 't1', artifactId: 'a2', data: {}, createdAt: 3 });
    expect(s.artifactIdsByTool('t1')).toEqual(['a1', 'a2']);
    expect(s.artifactIdsByTool('t2')).toEqual(['b1']);
  });

  it('returns empty array for unknown toolId', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    expect(s.artifactIdsByTool('nope')).toEqual([]);
  });

  it('returns a fresh array snapshot', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    const first = s.artifactIdsByTool('t1');
    const second = s.artifactIdsByTool('t1');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('updates after delete', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    s.put({ toolId: 't1', artifactId: 'a2', data: {}, createdAt: 2 });
    s.delete('t1', 'a1');
    expect(s.artifactIdsByTool('t1')).toEqual(['a2']);
  });

  it('agrees with list(toolId).map(r => r.artifactId)', () => {
    s.put({ toolId: 't1', artifactId: 'a1', data: {}, createdAt: 1 });
    s.put({ toolId: 't1', artifactId: 'a2', data: {}, createdAt: 2 });
    const ids = s.artifactIdsByTool('t1');
    const fromList = s.list('t1').map((r) => r.artifactId);
    expect(ids).toEqual(fromList);
  });
});
