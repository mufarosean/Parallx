// toolArtifactStoreForEach.tier0.test.ts — Slice A71

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

const pub = (s: InMemoryToolArtifactStore, toolId: string, artifactId: string, workspaceId?: string) =>
  s.put({ toolId, artifactId, data: { v: artifactId }, workspaceId, createdAt: Date.now() });

describe('IToolArtifactStore.forEach (Slice A71)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('does not invoke cb on empty store', () => {
    let n = 0;
    s.forEach(() => {
      n++;
    });
    expect(n).toBe(0);
  });

  it('invokes cb once per record', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    pub(s, 't2', 'c');
    let n = 0;
    s.forEach(() => {
      n++;
    });
    expect(n).toBe(3);
  });

  it('iterates in insertion order', () => {
    pub(s, 't1', 'a');
    pub(s, 't2', 'b');
    pub(s, 't1', 'c');
    const seen: string[] = [];
    s.forEach((r) => {
      seen.push(r.artifactId);
    });
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('passes the record object to cb', () => {
    pub(s, 't1', 'a', 'w1');
    const seen: ToolArtifactRecord[] = [];
    s.forEach((r) => {
      seen.push(r);
    });
    expect(seen.length).toBe(1);
    expect(seen[0].toolId).toBe('t1');
    expect(seen[0].artifactId).toBe('a');
    expect(seen[0].workspaceId).toBe('w1');
  });

  it('reflects deletes', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    s.delete('t1', 'a');
    const seen: string[] = [];
    s.forEach((r) => {
      seen.push(r.artifactId);
    });
    expect(seen).toEqual(['b']);
  });

  it('after clear() → no invocations', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    s.clear();
    let n = 0;
    s.forEach(() => {
      n++;
    });
    expect(n).toBe(0);
  });

  it('cb may throw; later iterations are not invoked', () => {
    pub(s, 't1', 'a');
    pub(s, 't1', 'b');
    pub(s, 't1', 'c');
    let n = 0;
    expect(() =>
      s.forEach((r) => {
        n++;
        if (r.artifactId === 'b') throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(n).toBe(2);
  });
});
