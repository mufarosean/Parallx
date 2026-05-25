// selectionServiceMostRecentSurfaceId.tier0.test.ts — Slice A49

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.mostRecentSurfaceId (Slice A49)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns undefined on empty service', () => {
    expect(s.mostRecentSurfaceId()).toBeUndefined();
  });

  it('returns the surface whose selection was just set', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    expect(s.mostRecentSurfaceId()).toBe('s1');
  });

  it('updates when another surface is set', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    s.setSelection('s2', { resource: fileResource('/b.md') });
    expect(s.mostRecentSurfaceId()).toBe('s2');
  });

  it('falls back to a remaining surface when the current is cleared', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    s.setSelection('s2', { resource: fileResource('/b.md') });
    s.setSelection('s2', undefined);
    expect(s.mostRecentSurfaceId()).toBe('s1');
  });

  it('returns undefined when the last selection is cleared', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    s.setSelection('s1', undefined);
    expect(s.mostRecentSurfaceId()).toBeUndefined();
  });

  it('returns undefined after clearAll()', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    s.setSelection('s2', { resource: fileResource('/b.md') });
    s.clearAll();
    expect(s.mostRecentSurfaceId()).toBeUndefined();
  });

  it('agrees with getSelection() identity', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    s.setSelection('s2', { resource: fileResource('/b.md') });
    const id = s.mostRecentSurfaceId()!;
    expect(s.getSelection()).toBe(s.getSelection(id));
  });
});
