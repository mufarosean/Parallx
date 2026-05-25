// selectionServiceHasWorkspace.tier0.test.ts — Slice A52

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, externalResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.hasWorkspace (Slice A52)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns false on empty service', () => {
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('returns true when a matching selection exists', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.hasWorkspace('w1')).toBe(true);
    expect(s.hasWorkspace('w2')).toBe(false);
  });

  it('skips selections without a resource', () => {
    s.setSelection('s1', {});
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('skips external resources', () => {
    s.setSelection('s1', { resource: externalResource('https://example.com') });
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('empty arg returns false', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.hasWorkspace('')).toBe(false);
  });

  it('updates after clear', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.hasWorkspace('w1')).toBe(false);
  });

  it('agrees with countByWorkspace > 0', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    expect(s.hasWorkspace('w1')).toBe(s.countByWorkspace('w1') > 0);
    expect(s.hasWorkspace('w2')).toBe(s.countByWorkspace('w2') > 0);
    expect(s.hasWorkspace('wx')).toBe(s.countByWorkspace('wx') > 0);
  });
});
