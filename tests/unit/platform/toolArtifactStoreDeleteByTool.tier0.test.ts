// toolArtifactStoreDeleteByTool.tier0.test.ts — Slice A16
//
// Verifies bulk deleteByTool(toolId) on IToolArtifactStore.

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore, type ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

function rec(toolId: string, artifactId: string): ToolArtifactRecord {
  return { toolId, artifactId, data: null, createdAt: 1 };
}

describe('InMemoryToolArtifactStore.deleteByTool (Slice A16)', () => {
  it('returns 0 on empty store', () => {
    const s = new InMemoryToolArtifactStore();
    expect(s.deleteByTool('a')).toBe(0);
  });

  it('returns 0 when no artifacts match the toolId', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('b', '2'));
    expect(s.deleteByTool('c')).toBe(0);
    expect(s.size).toBe(2);
  });

  it('deletes all artifacts for a given toolId and returns the count', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('b', '2'));
    s.put(rec('a', '3'));
    s.put(rec('a', '4'));
    expect(s.deleteByTool('a')).toBe(3);
    expect(s.size).toBe(1);
    expect(s.list().map(r => r.artifactId)).toEqual(['2']);
  });

  it('leaves other tools untouched', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('b', '2'));
    s.put(rec('b', '3'));
    s.deleteByTool('a');
    expect(s.list('b').map(r => r.artifactId)).toEqual(['2', '3']);
  });

  it('fires onDidChange once per removed record (delete kind)', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', 'x'));
    s.put(rec('a', 'y'));
    s.put(rec('b', 'z'));
    const events: Array<{ toolId: string; artifactId: string; kind: string }> = [];
    s.onDidChange(e => events.push({ toolId: e.toolId, artifactId: e.artifactId, kind: e.kind }));
    s.deleteByTool('a');
    expect(events).toEqual([
      { toolId: 'a', artifactId: 'x', kind: 'delete' },
      { toolId: 'a', artifactId: 'y', kind: 'delete' },
    ]);
  });

  it('handles empty toolId by returning 0 without firing events', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    const events: Array<unknown> = [];
    s.onDidChange(e => events.push(e));
    expect(s.deleteByTool('')).toBe(0);
    expect(events).toEqual([]);
    expect(s.size).toBe(1);
  });

  it('subsequent get() returns undefined for deleted records', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('a', '2'));
    s.deleteByTool('a');
    expect(s.get('a', '1')).toBeUndefined();
    expect(s.get('a', '2')).toBeUndefined();
  });
});
