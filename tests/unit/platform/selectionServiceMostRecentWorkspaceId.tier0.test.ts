// selectionServiceMostRecentWorkspaceId.tier0.test.ts — Slice A57

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.mostRecentWorkspaceId (Slice A57)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns undefined on empty service', () => {
    expect(s.mostRecentWorkspaceId()).toBeUndefined();
  });

  it('returns the workspace id of the most recent selection', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.mostRecentWorkspaceId()).toBe('w1');
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    expect(s.mostRecentWorkspaceId()).toBe('w2');
  });

  it('returns undefined when most-recent selection has no resource', () => {
    s.setSelection('s1', {});
    expect(s.mostRecentWorkspaceId()).toBeUndefined();
  });

  it('returns undefined when resource has no workspace scope', () => {
    s.setSelection('s1', { resource: fileResource('/a.md') });
    expect(s.mostRecentWorkspaceId()).toBeUndefined();
  });

  it('falls back after most-recent surface clears', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    s.setSelection('s2', undefined);
    expect(s.mostRecentWorkspaceId()).toBe('w1');
  });

  it('returns undefined after clearAll', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    s.clearAll();
    expect(s.mostRecentWorkspaceId()).toBeUndefined();
  });

  it('agrees with manual resourceWorkspaceId(mostRecentResource())', async () => {
    const { resourceWorkspaceId } = await import('../../../src/workbench/resources/resource.js');
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    const r = s.mostRecentResource();
    expect(s.mostRecentWorkspaceId()).toBe(r ? resourceWorkspaceId(r) : undefined);
  });
});
