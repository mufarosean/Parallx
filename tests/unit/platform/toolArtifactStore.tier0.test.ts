// toolArtifactStore.tier0.test.ts — Slice A10

import { describe, it, expect, vi } from 'vitest';
import { InMemoryToolArtifactStore, type ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

function rec(toolId: string, artifactId: string, data: unknown = { x: 1 }): ToolArtifactRecord {
  return { toolId, artifactId, data, createdAt: Date.now() };
}

describe('InMemoryToolArtifactStore', () => {
  it('starts empty', () => {
    expect(new InMemoryToolArtifactStore().size).toBe(0);
  });

  it('put then get returns the record', () => {
    const s = new InMemoryToolArtifactStore();
    const r = rec('search', 'a1');
    s.put(r);
    expect(s.get('search', 'a1')).toBe(r);
    expect(s.size).toBe(1);
  });

  it('put overwrites existing', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('search', 'a1', 'old'));
    s.put(rec('search', 'a1', 'new'));
    expect(s.get('search', 'a1')?.data).toBe('new');
    expect(s.size).toBe(1);
  });

  it('delete removes record and returns true', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t', 'a'));
    expect(s.delete('t', 'a')).toBe(true);
    expect(s.delete('t', 'a')).toBe(false);
    expect(s.get('t', 'a')).toBeUndefined();
  });

  it('fires onDidChange on put and delete', () => {
    const s = new InMemoryToolArtifactStore();
    const events: Array<{ kind: string; toolId: string; artifactId: string }> = [];
    s.onDidChange(e => events.push({ ...e }));
    s.put(rec('t', 'a'));
    s.delete('t', 'a');
    s.delete('t', 'a'); // no-op, no event
    expect(events.map(e => e.kind)).toEqual(['put', 'delete']);
  });

  it('rejects put with empty ids', () => {
    const s = new InMemoryToolArtifactStore();
    expect(() => s.put(rec('', 'a'))).toThrow(/required/);
    expect(() => s.put(rec('t', ''))).toThrow(/required/);
  });

  it('dispose clears records', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t', 'a'));
    s.dispose();
    expect(s.size).toBe(0);
  });

  it('different (toolId, artifactId) pairs do not collide', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('t1', 'a'));
    s.put(rec('t2', 'a'));
    expect(s.size).toBe(2);
    expect(s.get('t1', 'a')).toBeDefined();
    expect(s.get('t2', 'a')).toBeDefined();
  });
});
