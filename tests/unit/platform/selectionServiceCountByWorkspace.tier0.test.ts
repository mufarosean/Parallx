// selectionServiceCountByWorkspace.tier0.test.ts — Slice A47

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, externalResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.countByWorkspace (Slice A47)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns 0 on empty service', () => {
    expect(s.countByWorkspace('w1')).toBe(0);
  });

  it('counts selections by workspace', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w2' }) });
    expect(s.countByWorkspace('w1')).toBe(2);
    expect(s.countByWorkspace('w2')).toBe(1);
    expect(s.countByWorkspace('wx')).toBe(0);
  });

  it('skips selections without a resource', () => {
    s.setSelection('s1', { /* no resource */ });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(s.countByWorkspace('w1')).toBe(1);
  });

  it('skips external resources', () => {
    s.setSelection('s1', { resource: externalResource('https://example.com') });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(s.countByWorkspace('w1')).toBe(1);
  });

  it('empty/undefined arg returns 0', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.countByWorkspace('')).toBe(0);
  });

  it('matches entriesByWorkspace(id).length', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w2' }) });
    expect(s.countByWorkspace('w1')).toBe(s.entriesByWorkspace('w1').length);
    expect(s.countByWorkspace('w2')).toBe(s.entriesByWorkspace('w2').length);
  });

  it('updates after clearing', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s1', undefined);
    expect(s.countByWorkspace('w1')).toBe(1);
  });
});
