// toolArtifactStoreDeleteByWorkspace.tier0.test.ts — Slice A21

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore } from '../../../src/workbench/toolArtifactStore.js';
import type { ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

function rec(toolId: string, artifactId: string, workspaceId?: string): ToolArtifactRecord {
  return { toolId, artifactId, data: { artifactId }, createdAt: Date.now(), workspaceId };
}

describe('IToolArtifactStore.deleteByWorkspace (Slice A21)', () => {
  it('returns 0 when store is empty', () => {
    const s = new InMemoryToolArtifactStore();
    expect(s.deleteByWorkspace('ws-1')).toBe(0);
  });

  it('returns 0 and fires no events for empty workspaceId', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t', 'a', 'ws-1'));
    const events: unknown[] = [];
    s.onDidChange((e) => events.push(e));
    expect(s.deleteByWorkspace('')).toBe(0);
    expect(events.length).toBe(0);
    expect(s.size).toBe(1);
  });

  it('deletes only records for the matching workspace', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t1', 'a', 'ws-1'));
    s.put(rec('t1', 'b', 'ws-2'));
    s.put(rec('t2', 'c', 'ws-1'));
    s.put(rec('t2', 'd', 'ws-2'));
    expect(s.deleteByWorkspace('ws-1')).toBe(2);
    expect(s.size).toBe(2);
    expect(s.get('t1', 'a')).toBeUndefined();
    expect(s.get('t2', 'c')).toBeUndefined();
    expect(s.get('t1', 'b')).toBeDefined();
    expect(s.get('t2', 'd')).toBeDefined();
  });

  it('never matches records with no workspaceId', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t', 'a')); // no workspaceId
    s.put(rec('t', 'b', 'ws-1'));
    expect(s.deleteByWorkspace('ws-1')).toBe(1);
    expect(s.size).toBe(1);
    expect(s.get('t', 'a')).toBeDefined();
  });

  it('fires one delete event per record, in insertion order', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t1', 'a', 'ws-1'));
    s.put(rec('t2', 'b', 'ws-2'));
    s.put(rec('t1', 'c', 'ws-1'));
    s.put(rec('t3', 'd', 'ws-1'));
    const events: Array<{ toolId: string; artifactId: string; kind: string }> = [];
    s.onDidChange((e) => events.push({ toolId: e.toolId, artifactId: e.artifactId, kind: e.kind }));
    const n = s.deleteByWorkspace('ws-1');
    expect(n).toBe(3);
    expect(events).toEqual([
      { toolId: 't1', artifactId: 'a', kind: 'delete' },
      { toolId: 't1', artifactId: 'c', kind: 'delete' },
      { toolId: 't3', artifactId: 'd', kind: 'delete' },
    ]);
  });

  it('returns 0 and fires no events when no record matches', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t', 'a', 'ws-1'));
    const events: unknown[] = [];
    s.onDidChange((e) => events.push(e));
    expect(s.deleteByWorkspace('ws-XYZ')).toBe(0);
    expect(events.length).toBe(0);
  });

  it('list() reflects the deletion afterwards', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t', 'a', 'ws-1'));
    s.put(rec('t', 'b', 'ws-2'));
    s.deleteByWorkspace('ws-1');
    expect(s.list().map(r => r.artifactId)).toEqual(['b']);
  });
});
