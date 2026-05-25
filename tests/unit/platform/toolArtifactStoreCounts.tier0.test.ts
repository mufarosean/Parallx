// toolArtifactStoreCounts.tier0.test.ts — Slice A45

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

describe('IToolArtifactStore.countByTool / countByWorkspace (Slice A45)', () => {
  let s: InMemoryToolArtifactStore;
  beforeEach(() => {
    s = new InMemoryToolArtifactStore();
  });

  it('returns 0 on empty store', () => {
    expect(s.countByTool('t1')).toBe(0);
    expect(s.countByWorkspace('w1')).toBe(0);
  });

  it('counts records by toolId', () => {
    s.put(rec('t1', 'a'));
    s.put(rec('t1', 'b'));
    s.put(rec('t2', 'a'));
    expect(s.countByTool('t1')).toBe(2);
    expect(s.countByTool('t2')).toBe(1);
    expect(s.countByTool('tx')).toBe(0);
  });

  it('counts records by workspaceId, skipping records without one', () => {
    s.put(rec('t1', 'a', 'w1'));
    s.put(rec('t1', 'b', 'w1'));
    s.put(rec('t1', 'c', 'w2'));
    s.put(rec('t1', 'd'));
    expect(s.countByWorkspace('w1')).toBe(2);
    expect(s.countByWorkspace('w2')).toBe(1);
    expect(s.countByWorkspace('wx')).toBe(0);
  });

  it('empty/undefined arg returns 0', () => {
    s.put(rec('t1', 'a', 'w1'));
    expect(s.countByTool('')).toBe(0);
    expect(s.countByWorkspace('')).toBe(0);
  });

  it('matches list(toolId).length', () => {
    s.put(rec('t1', 'a'));
    s.put(rec('t1', 'b'));
    s.put(rec('t2', 'c'));
    expect(s.countByTool('t1')).toBe(s.list('t1').length);
    expect(s.countByTool('t2')).toBe(s.list('t2').length);
  });

  it('matches listByWorkspace(id).length', () => {
    s.put(rec('t1', 'a', 'w1'));
    s.put(rec('t2', 'b', 'w1'));
    s.put(rec('t1', 'c', 'w2'));
    expect(s.countByWorkspace('w1')).toBe(s.listByWorkspace('w1').length);
    expect(s.countByWorkspace('w2')).toBe(s.listByWorkspace('w2').length);
  });

  it('updates after deletes', () => {
    s.put(rec('t1', 'a', 'w1'));
    s.put(rec('t1', 'b', 'w1'));
    s.delete('t1', 'a');
    expect(s.countByTool('t1')).toBe(1);
    expect(s.countByWorkspace('w1')).toBe(1);
  });
});
