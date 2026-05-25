// selectionServiceSome.tier0.test.ts — Slice A79

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.some (Slice A79)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns false on empty service', () => {
    expect(s.some(() => true)).toBe(false);
  });

  it('returns false when no entry matches', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.some((e) => e.surfaceId === 'sX')).toBe(false);
  });

  it('returns true on first match', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: canvasPageResource('p', { workspaceId: 'w1' }) });
    expect(s.some((e) => e.selection.resource?.type === 'canvas-page')).toBe(true);
  });

  it('short-circuits — stops after first match', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    let calls = 0;
    const res = s.some((e) => {
      calls++;
      return e.surfaceId === 's2';
    });
    expect(res).toBe(true);
    expect(calls).toBe(2);
  });

  it('predicate-true with non-empty → true', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.some(() => true)).toBe(true);
  });

  it('reflects setSelection(undefined) clearing', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s1', undefined);
    expect(s.some(() => true)).toBe(false);
  });

  it('after clearAll() → false', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.some(() => true)).toBe(false);
  });
});
