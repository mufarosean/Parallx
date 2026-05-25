// selectionServiceEntriesByWorkspace.tier0.test.ts — Slice A36

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

describe('ISelectionService.entriesByWorkspace() (Slice A36)', () => {
  let svc: SelectionService;
  beforeEach(() => {
    svc = new SelectionService();
  });

  it('returns empty array on empty service', () => {
    expect(svc.entriesByWorkspace('w1')).toEqual([]);
  });

  it('returns only selections in the given workspace, insertion order', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w2' })));
    svc.setSelection('s3', sel(canvasPageResource('p', { workspaceId: 'w1' })));
    expect(svc.entriesByWorkspace('w1').map(e => e.surfaceId)).toEqual(['s1', 's3']);
    expect(svc.entriesByWorkspace('w2').map(e => e.surfaceId)).toEqual(['s2']);
  });

  it('excludes selections without a resource', () => {
    svc.setSelection('s1', { source: { kind: 'free' }, text: 'x' } as ISelection);
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w1' })));
    expect(svc.entriesByWorkspace('w1').map(e => e.surfaceId)).toEqual(['s2']);
  });

  it('excludes external resources (no workspace scope)', () => {
    svc.setSelection('s1', sel(externalResource('https://example.com')));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w1' })));
    expect(svc.entriesByWorkspace('w1').map(e => e.surfaceId)).toEqual(['s2']);
  });

  it('excludes resources with no workspaceId', () => {
    svc.setSelection('s1', sel(fileResource('/a')));
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w1' })));
    expect(svc.entriesByWorkspace('w1').map(e => e.surfaceId)).toEqual(['s2']);
  });

  it('returns empty array for empty workspaceId', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    expect(svc.entriesByWorkspace('')).toEqual([]);
  });

  it('returns a fresh snapshot', () => {
    svc.setSelection('s1', sel(fileResource('/a', { workspaceId: 'w1' })));
    const snap = svc.entriesByWorkspace('w1') as Array<{ surfaceId: string; selection: ISelection }>;
    svc.setSelection('s2', sel(fileResource('/b', { workspaceId: 'w1' })));
    expect(snap).toHaveLength(1);
  });
});
