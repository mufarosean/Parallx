// toolArtifactStoreList.tier0.test.ts — Slice A15
//
// Verifies list() query API on IToolArtifactStore.

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore, type ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

function rec(toolId: string, artifactId: string, data: unknown = null): ToolArtifactRecord {
  return { toolId, artifactId, data, createdAt: 1 };
}

describe('InMemoryToolArtifactStore.list (Slice A15)', () => {
  it('returns empty array when store is empty', () => {
    const s = new InMemoryToolArtifactStore();
    expect(s.list()).toEqual([]);
  });

  it('returns empty array when filtering by toolId on empty store', () => {
    const s = new InMemoryToolArtifactStore();
    expect(s.list('web-research')).toEqual([]);
  });

  it('returns all records when called with no argument', () => {
    const s = new InMemoryToolArtifactStore();
    const r1 = rec('a', 'x');
    const r2 = rec('b', 'y');
    s.put(r1); s.put(r2);
    expect(s.list()).toEqual([r1, r2]);
  });

  it('preserves insertion order', () => {
    const s = new InMemoryToolArtifactStore();
    const ids = ['c', 'a', 'b', 'd'];
    for (const id of ids) s.put(rec('t', id));
    expect(s.list().map(r => r.artifactId)).toEqual(ids);
  });

  it('filters by toolId', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('b', '2'));
    s.put(rec('a', '3'));
    s.put(rec('c', '4'));
    expect(s.list('a').map(r => r.artifactId)).toEqual(['1', '3']);
    expect(s.list('b').map(r => r.artifactId)).toEqual(['2']);
    expect(s.list('zzz')).toEqual([]);
  });

  it('snapshot is independent of subsequent mutations', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    const snap = s.list();
    s.put(rec('a', '2'));
    s.delete('a', '1');
    expect(snap.length).toBe(1);
    expect(snap[0].artifactId).toBe('1');
  });

  it('reflects replaced records (put with same key) without duplicating', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1', 'first'));
    s.put(rec('a', '1', 'second'));
    const all = s.list();
    expect(all.length).toBe(1);
    expect(all[0].data).toBe('second');
  });

  it('omits deleted records', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('a', '2'));
    s.delete('a', '1');
    expect(s.list().map(r => r.artifactId)).toEqual(['2']);
  });
});
