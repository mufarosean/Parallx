// toolArtifactStoreHas.tier0.test.ts — Slice A26

import { describe, it, expect } from 'vitest';
import { InMemoryToolArtifactStore, type ToolArtifactRecord } from '../../../src/workbench/toolArtifactStore.js';

function rec(toolId: string, artifactId: string): ToolArtifactRecord {
  return { toolId, artifactId, data: null, createdAt: 0 };
}

describe('IToolArtifactStore.has (Slice A26)', () => {
  it('returns false on empty store', () => {
    const s = new InMemoryToolArtifactStore();
    expect(s.has('a', '1')).toBe(false);
  });

  it('returns true after put', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    expect(s.has('a', '1')).toBe(true);
  });

  it('returns false for wrong toolId', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    expect(s.has('b', '1')).toBe(false);
  });

  it('returns false for wrong artifactId', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    expect(s.has('a', '2')).toBe(false);
  });

  it('returns false after delete', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.delete('a', '1');
    expect(s.has('a', '1')).toBe(false);
  });

  it('returns false after deleteByTool', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    s.put(rec('a', '2'));
    s.deleteByTool('a');
    expect(s.has('a', '1')).toBe(false);
    expect(s.has('a', '2')).toBe(false);
  });

  it('agrees with get', () => {
    const s = new InMemoryToolArtifactStore();
    s.put(rec('a', '1'));
    expect(s.has('a', '1')).toBe(s.get('a', '1') !== undefined);
    expect(s.has('a', '2')).toBe(s.get('a', '2') !== undefined);
  });
});
