// selectionServiceWorkspaceIds.tier0.test.ts — Slice A40

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import type { ISelection } from '../../../src/services/selectionActionTypes.js';
import {
  fileResource,
  canvasPageResource,
  externalResource,
} from '../../../src/workbench/resources/resource.js';

const sel = (resource: ISelection['resource'] | undefined): ISelection => ({
  source: { kind: 'text', filePath: '/x' },
  text: 'x',
  resource,
});

describe('ISelectionService.workspaceIds() (Slice A40)', () => {
  let svc: SelectionService;
  beforeEach(() => {
    svc = new SelectionService();
  });

  it('returns empty array on empty service', () => {
    expect(svc.workspaceIds()).toEqual([]);
  });

  it('returns distinct workspaceIds in first-insertion order', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w2' })));
    svc.setSelection('s3', sel(canvasPageResource('p', { workspaceId: 'w1' })));
    svc.setSelection('s4', sel(fileResource('/c', { workspaceId: 'w3' })));
    expect(svc.workspaceIds()).toEqual(['w1', 'w2', 'w3']);
  });

  it('skips selections without a resource', () => {
    svc.setSelection('s1', { source: { kind: 'free' }, text: 'x' } as ISelection);
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w1' })));
    expect(svc.workspaceIds()).toEqual(['w1']);
  });

  it('skips external resources (no workspace scope)', () => {
    svc.setSelection('s1', sel(externalResource('https://ex.com')));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w1' })));
    expect(svc.workspaceIds()).toEqual(['w1']);
  });

  it('returns a fresh snapshot', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    const snap = svc.workspaceIds() as string[];
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w2' })));
    expect(snap).toEqual(['w1']);
  });

  it('drops workspaceIds whose selections were all cleared', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w2' })));
    svc.setSelection('s1', undefined);
    expect(svc.workspaceIds()).toEqual(['w2']);
  });

  it('returns empty after clearAll()', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w2' })));
    svc.clearAll();
    expect(svc.workspaceIds()).toEqual([]);
  });
});
