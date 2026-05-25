// toolArtifactStoreSome.tier0.test.ts — Slice A77

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

const pub = (s: InMemoryToolArtifactStore, toolId: string, artifactId: string, workspaceId?: string) =>
  s.put({ toolId, artifactId, data: { v: artifactId }, workspaceId, createdAt: Date.now() });

describe('IToolArtifactStore.some (Slice A77)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns false on empty store', () => {
    expect(s.some(() => true)).toBe(false);
  });

  it('returns false when no record matches', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    expect(s.some((r) => r.toolId === 'tX')).toBe(false);
  });

  it('returns true on first match', () => {
    pub(s, 't1', 'a');
    pub(s, 't2', 'b');
    expect(s.some((r) => r.toolId === 't2')).toBe(true);
  });

  it('short-circuits — does not visit records after first match', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    pub(s, 't1', 'c');
    pub(s, 't1', 'd');
    let calls = 0;
    const res = s.some((r) => {
      calls++;
      return r.artifactId === 'b';
    });
    expect(res).toBe(true);
    expect(calls).toBe(2);
  });

  it('predicate-true with non-empty → true', () => {
    pub(s, 't1', 'a');
    expect(s.some(() => true)).toBe(true);
  });

  it('reflects deletes', () => {
    pub(s, 't1', 'a');
    s.delete('t1', 'a');
    expect(s.some(() => true)).toBe(false);
  });

  it('after clear() → false', () => {
    pub(s, 't1', 'a');
    s.clear();
    expect(s.some(() => true)).toBe(false);
  });
});
