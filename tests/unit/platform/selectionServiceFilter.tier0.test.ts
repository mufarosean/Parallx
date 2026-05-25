// selectionServiceFilter.tier0.test.ts — Slice A70

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.filter (Slice A70)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns empty array on empty service', () => {
    expect(s.filter(() => true)).toEqual([]);
  });

  it('returns empty when no entry matches', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.filter((e) => e.surfaceId === 'sX')).toEqual([]);
  });

  it('returns all matches in insertion order', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    s.setSelection('s4', { resource: canvasPageResource('q', { workspaceId: 'w1' }) });
    const hits = s.filter((e) => e.selection.resource?.type === 'canvas-page');
    expect(hits.map((e) => e.surfaceId)).toEqual(['s2', 's4']);
  });

  it('returns fresh array each call', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    const first = s.filter(() => true) as Array<{ surfaceId: string; selection: unknown }>;
    first.push({ surfaceId: 'x', selection: {} });
    expect(s.filter(() => true).length).toBe(1);
  });

  it('predicate-true-equals-entries', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(s.filter(() => true).map((e) => e.surfaceId)).toEqual(
      s.entries().map((e) => e.surfaceId),
    );
  });

  it('reflects cleared selections', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s1', undefined);
    expect(s.filter(() => true).map((e) => e.surfaceId)).toEqual(['s2']);
  });

  it('after clearAll() → empty', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.filter(() => true)).toEqual([]);
  });
});
