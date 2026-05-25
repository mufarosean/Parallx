// toolArtifactStoreCount.tier0.test.ts — Slice A74

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

const pub = (s: InMemoryToolArtifactStore, toolId: string, artifactId: string, workspaceId?: string) =>
  s.put({ toolId, artifactId, data: { v: artifactId }, workspaceId, createdAt: Date.now() });

describe('IToolArtifactStore.count (Slice A74)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns 0 on empty store', () => {
    expect(s.count(() => true)).toBe(0);
  });

  it('returns 0 when no record matches', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    expect(s.count((r) => r.toolId === 'tX')).toBe(0);
  });

  it('counts all matches across the store', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    pub(s, 't2', 'c');
    pub(s, 't1', 'd');
    expect(s.count((r) => r.toolId === 't1')).toBe(3);
    expect(s.count((r) => r.toolId === 't2')).toBe(1);
  });

  it('predicate-true counts every record (equals list().length)', () => {
    pub(s, 't1', 'a');
    pub(s, 't2', 'b');
    pub(s, 't3', 'c');
    expect(s.count(() => true)).toBe(s.list().length);
    expect(s.count(() => true)).toBe(3);
  });

  it('matches filter(p).length', () => {
    pub(s, 't1', 'a', 'w1');
    pub(s, 't1', 'b', 'w2');
    pub(s, 't2', 'c', 'w1');
    const p = (r: { workspaceId?: string }) => r.workspaceId === 'w1';
    expect(s.count(p)).toBe(s.filter(p).length);
  });

  it('reflects deletes', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    pub(s, 't1', 'c');
    s.delete('t1', 'b');
    expect(s.count(() => true)).toBe(2);
  });

  it('after clear() → 0', () => {
    pub(s, 't1', 'a');
    s.clear();
    expect(s.count(() => true)).toBe(0);
  });
});
