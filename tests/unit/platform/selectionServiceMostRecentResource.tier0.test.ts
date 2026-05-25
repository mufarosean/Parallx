// selectionServiceMostRecentResource.tier0.test.ts — Slice A55

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.mostRecentResource (Slice A55)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns undefined on empty service', () => {
    expect(s.mostRecentResource()).toBeUndefined();
  });

  it('returns the resource of the most recent selection', () => {
    const r1 = fileResource('/a.md', { workspaceId: 'w1' });
    const r2 = fileResource('/b.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r1 });
    expect(s.mostRecentResource()).toEqual(r1);
    s.setSelection('s2', { resource: r2 });
    expect(s.mostRecentResource()).toEqual(r2);
  });

  it('returns undefined when the most-recent selection has no resource', () => {
    s.setSelection('s1', {});
    expect(s.mostRecentResource()).toBeUndefined();
  });

  it('falls back after the most-recent surface clears', () => {
    const r1 = fileResource('/a.md', { workspaceId: 'w1' });
    const r2 = fileResource('/b.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r1 });
    s.setSelection('s2', { resource: r2 });
    s.setSelection('s2', undefined);
    expect(s.mostRecentResource()).toEqual(r1);
  });

  it('returns undefined after clearAll', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.mostRecentResource()).toBeUndefined();
  });

  it('agrees with getSelection()?.resource', () => {
    const r = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r });
    expect(s.mostRecentResource()).toEqual(s.getSelection()?.resource);
  });

  it('updates with explicit setSelection that has no resource', () => {
    const r = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r });
    s.setSelection('s2', {});
    // s2 became most-recent; its resource is undefined
    expect(s.mostRecentResource()).toBeUndefined();
  });
});
