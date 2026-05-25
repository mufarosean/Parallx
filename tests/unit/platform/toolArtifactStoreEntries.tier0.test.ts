// toolArtifactStoreEntries.tier0.test.ts — Slice A65

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';

function pub(s: InMemoryToolArtifactStore, toolId: string, artifactId: string, workspaceId?: string) {
  s.put({ toolId, artifactId, data: { v: artifactId }, workspaceId, createdAt: Date.now() });
}

describe('IToolArtifactStore.entries (Slice A65)', () => {
  it('empty store → empty array', () => {
    const s = new InMemoryToolArtifactStore();
    expect(s.entries()).toEqual([]);
    s.dispose();
  });

  it('single record → one [toolId, artifactId] tuple', () => {
    const s = new InMemoryToolArtifactStore();
    pub(s, 't', 'a', 'w');
    expect(s.entries()).toEqual([['t', 'a']]);
    s.dispose();
  });

  it('preserves insertion order across multiple tools', () => {
    const s = new InMemoryToolArtifactStore();
    pub(s, 't1', 'a1');
    pub(s, 't2', 'a2');
    pub(s, 't1', 'a3');
    expect(s.entries()).toEqual([
      ['t1', 'a1'],
      ['t2', 'a2'],
      ['t1', 'a3'],
    ]);
    s.dispose();
  });

  it('returns fresh array each call (mutation does not leak)', () => {
    const s = new InMemoryToolArtifactStore();
    pub(s, 't', 'a');
    const first = s.entries() as Array<readonly [string, string]>;
    first.push(['x', 'y'] as const);
    const second = s.entries();
    expect(second).toEqual([['t', 'a']]);
    s.dispose();
  });

  it('reflects deletions', () => {
    const s = new InMemoryToolArtifactStore();
    pub(s, 't', 'a');
    pub(s, 't', 'b');
    s.delete('t', 'a');
    expect(s.entries()).toEqual([['t', 'b']]);
    s.dispose();
  });

  it('after clear() → empty', () => {
    const s = new InMemoryToolArtifactStore();
    pub(s, 't', 'a');
    pub(s, 'u', 'b');
    s.clear();
    expect(s.entries()).toEqual([]);
    s.dispose();
  });

  it('matches list() length and pair contents', () => {
    const s = new InMemoryToolArtifactStore();
    pub(s, 't1', 'a1');
    pub(s, 't2', 'a2');
    pub(s, 't3', 'a3', 'w');
    const entries = s.entries();
    const list = s.list();
    expect(entries.length).toBe(list.length);
    for (let i = 0; i < list.length; i++) {
      expect(entries[i]).toEqual([list[i].toolId, list[i].artifactId]);
    }
    s.dispose();
  });
});
