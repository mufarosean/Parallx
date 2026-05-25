// selectionServiceFindByResource.tier0.test.ts — Slice A53

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionService } from '../../../src/services/selectionService.js';
import { fileResource, externalResource } from '../../../src/workbench/resources/resource.js';

describe('ISelectionService.findByResource (Slice A53)', () => {
  let s: SelectionService;
  beforeEach(() => {
    s = new SelectionService();
  });

  it('returns empty array on empty service', () => {
    expect(s.findByResource(fileResource('/a.md', { workspaceId: 'w1' }))).toEqual([]);
  });

  it('returns matching surfaces by structural equality', () => {
    const r1 = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r1 });
    s.setSelection('s2', { resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    s.setSelection('s3', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    const found = s.findByResource(r1);
    expect(found.map(e => e.surfaceId).sort()).toEqual(['s1', 's3']);
  });

  it('preserves insertion order', () => {
    const r = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s3', { resource: r });
    s.setSelection('s1', { resource: r });
    s.setSelection('s2', { resource: r });
    const found = s.findByResource(r);
    expect(found.map(e => e.surfaceId)).toEqual(['s3', 's1', 's2']);
  });

  it('skips selections without a resource', () => {
    const r = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s1', {});
    s.setSelection('s2', { resource: r });
    const found = s.findByResource(r);
    expect(found.map(e => e.surfaceId)).toEqual(['s2']);
  });

  it('matches external resources by structural equality', () => {
    const ext = externalResource('https://example.com');
    s.setSelection('s1', { resource: ext });
    s.setSelection('s2', { resource: externalResource('https://example.org') });
    const found = s.findByResource(ext);
    expect(found.map(e => e.surfaceId)).toEqual(['s1']);
  });

  it('returns empty array when no match', () => {
    s.setSelection('s1', { resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(s.findByResource(fileResource('/zzz', { workspaceId: 'w1' }))).toEqual([]);
  });

  it('returns a fresh array', () => {
    const r = fileResource('/a.md', { workspaceId: 'w1' });
    s.setSelection('s1', { resource: r });
    const a = s.findByResource(r);
    const b = s.findByResource(r);
    expect(a).not.toBe(b);
  });
});
