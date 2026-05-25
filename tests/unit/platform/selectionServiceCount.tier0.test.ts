// selectionServiceCount.tier0.test.ts — Slice A76

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.count (Slice A76)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns 0 on empty service', () => {
    expect(s.count(() => true)).toBe(0);
  });

  it('returns 0 when no entry matches', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.count((e) => e.surfaceId === 'sX')).toBe(0);
  });

  it('counts all matches', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    s.setSelection('s4', { resource: canvasPageResource('q', { workspaceId: 'w1' }) });
    expect(s.count((e) => e.selection.resource?.type === 'canvas-page')).toBe(2);
    expect(s.count((e) => e.selection.resource?.type === 'file')).toBe(2);
  });

  it('predicate-true equals entries().length', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    expect(s.count(() => true)).toBe(s.entries().length);
  });

  it('matches filter(p).length', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w2' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    const p = (e: { selection: { resource?: { type?: string } } }) =>
      e.selection.resource?.type === 'file';
    expect(s.count(p)).toBe(s.filter(p).length);
  });

  it('reflects setSelection(undefined) clearing', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s1', undefined);
    expect(s.count(() => true)).toBe(1);
  });

  it('after clearAll() → 0', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.count(() => true)).toBe(0);
  });
});
