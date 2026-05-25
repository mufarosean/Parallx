// selectionServiceSurfaceIdsByWorkspace.tier0.test.ts — Slice A59

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.surfaceIdsByWorkspace (Slice A59)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns empty array on empty service', () => {
    expect(s.surfaceIdsByWorkspace('w1')).toEqual([]);
  });

  it('returns empty array for empty workspaceId', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.surfaceIdsByWorkspace('')).toEqual([]);
  });

  it('returns surface ids of selections matching the workspaceId', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    expect(s.surfaceIdsByWorkspace('w1')).toEqual(['s1', 's3']);
    expect(s.surfaceIdsByWorkspace('w2')).toEqual(['s2']);
  });

  it('skips selections with no resource', () => {
    s.setSelection('s1', {});
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(s.surfaceIdsByWorkspace('w1')).toEqual(['s2']);
  });

  it('skips resources with no workspace scope', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(s.surfaceIdsByWorkspace('w1')).toEqual(['s2']);
  });

  it('returns a fresh array snapshot', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    const first = s.surfaceIdsByWorkspace('w1');
    const second = s.surfaceIdsByWorkspace('w1');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('agrees with entriesByWorkspace(id).map(e => e.surfaceId)', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    const ids = s.surfaceIdsByWorkspace('w1');
    const fromEntries = s.entriesByWorkspace('w1').map((e) => e.surfaceId);
    expect(ids).toEqual(fromEntries);
  });
});
