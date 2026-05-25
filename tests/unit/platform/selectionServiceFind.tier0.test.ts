// selectionServiceFind.tier0.test.ts — Slice A69

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.find (Slice A69)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns undefined on empty service', () => {
    expect(s.find(() => true)).toBeUndefined();
  });

  it('returns undefined when no entry matches', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.find((e) => e.surfaceId === 'sX')).toBeUndefined();
  });

  it('returns the first matching entry in insertion order', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: canvasPageResource('q', { workspaceId: 'w1' }) });
    const hit = s.find((e) => e.selection.resource?.type === 'canvas-page');
    expect(hit?.surfaceId).toBe('s2');
  });

  it('exposes both surfaceId and selection to predicate', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    const hit = s.find((e) => e.surfaceId === 's1' && e.selection.resource?.type === 'file');
    expect(hit?.surfaceId).toBe('s1');
  });

  it('short-circuits after first match', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    let n = 0;
    s.find((e) => {
      n++;
      return e.surfaceId === 's2';
    });
    expect(n).toBe(2);
  });

  it('reflects cleared selections', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s1', undefined);
    expect(s.find(() => true)).toBeUndefined();
  });

  it('after clearAll() → undefined', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.find(() => true)).toBeUndefined();
  });
});
