// toolArtifactStoreHasGroup.tier0.test.ts — Slice A50

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryToolArtifactStore,
  type ToolArtifactRecord,
} from '../../../src/workbench/toolArtifactStore.js';

const rec = (
  toolId: string,
  artifactId: string,
  workspaceId?: string,
): ToolArtifactRecord => ({
  toolId,
  artifactId,
  data: null,
  createdAt: 0,
  ...(workspaceId ? { workspaceId } : {}),
});

describe('IToolArtifactStore.hasTool / hasWorkspace (Slice A50)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns false on empty store', () => {
    expect(s.hasTool('t1')).toBe(false);
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('hasTool returns true when a record matches', () => {
    s.put(rec('t1', 'a'));
    s.put(rec('t2', 'b'));
    expect(s.hasTool('t1')).toBe(true);
    expect(s.hasTool('t2')).toBe(true);
    expect(s.hasTool('tx')).toBe(false);
  });

  it('hasWorkspace returns true when a record matches', () => {
    s.put(rec('t1', 'a', 'w1'));
    s.put(rec('t1', 'b'));
    expect(s.hasWorkspace('w1')).toBe(true);
    expect(s.hasWorkspace('w2')).toBe(false);
  });

  it('hasWorkspace skips records without workspaceId', () => {
    s.put(rec('t1', 'a'));
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('empty arg returns false', () => {
    s.put(rec('t1', 'a', 'w1'));
    expect(s.hasTool('')).toBe(false);
    expect(s.hasWorkspace('')).toBe(false);
  });

  it('updates after deletes', () => {
    s.put(rec('t1', 'a', 'w1'));
    s.delete('t1', 'a');
    expect(s.hasTool('t1')).toBe(false);
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('agrees with countByTool > 0 and countByWorkspace > 0', () => {
    s.put(rec('t1', 'a', 'w1'));
    s.put(rec('t2', 'b'));
    expect(s.hasTool('t1')).toBe(s.countByTool('t1') > 0);
    expect(s.hasTool('t2')).toBe(s.countByTool('t2') > 0);
    expect(s.hasTool('tx')).toBe(s.countByTool('tx') > 0);
    expect(s.hasWorkspace('w1')).toBe(s.countByWorkspace('w1') > 0);
    expect(s.hasWorkspace('w2')).toBe(s.countByWorkspace('w2') > 0);
  });
});
