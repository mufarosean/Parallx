// toolArtifactStoreFindFilter.tier0.test.ts — Slice A23

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore, type ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

function rec(toolId: string, artifactId: string, extra: Partial<ToolArtifactRecord> = {}): ToolArtifactRecord {
  return { toolId, artifactId, data: null, createdAt: 0, ...extra };
}

describe('InMemoryToolArtifactStore.find / .filter (Slice A23)', () => {
  describe('find', () => {
    it('returns undefined on empty store', () => {
      const s = new InMemoryToolArtifactStore();
      expect(s.find(() => true)).toBeUndefined();
    });

    it('returns undefined when no record matches', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1'));
      expect(s.find(r => r.toolId === 'z')).toBeUndefined();
    });

    it('returns first match in insertion order', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1'));
      s.put(rec('b', '2'));
      s.put(rec('b', '3'));
      const got = s.find(r => r.toolId === 'b');
      expect(got?.artifactId).toBe('2');
    });

    it('predicate sees full record including workspaceId and mimeType', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1', { workspaceId: 'w1', mimeType: 'text/plain' }));
      const got = s.find(r => r.workspaceId === 'w1' && r.mimeType === 'text/plain');
      expect(got?.artifactId).toBe('1');
    });
  });

  describe('filter', () => {
    it('returns [] on empty store', () => {
      const s = new InMemoryToolArtifactStore();
      expect(s.filter(() => true)).toEqual([]);
    });

    it('returns [] when no record matches', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1'));
      expect(s.filter(r => r.toolId === 'z')).toEqual([]);
    });

    it('returns every match in insertion order', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1'));
      s.put(rec('b', '2'));
      s.put(rec('a', '3'));
      s.put(rec('b', '4'));
      expect(s.filter(r => r.toolId === 'a').map(r => r.artifactId)).toEqual(['1', '3']);
    });

    it('returns a fresh snapshot independent of later mutations', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1'));
      const snap = s.filter(() => true);
      s.delete('a', '1');
      expect(snap.length).toBe(1);
      expect(s.filter(() => true).length).toBe(0);
    });

    it('does not mutate the store when predicate is identity-true', () => {
      const s = new InMemoryToolArtifactStore();
      s.put(rec('a', '1'));
      s.put(rec('a', '2'));
      s.filter(() => true);
      expect(s.size).toBe(2);
    });
  });
});
