// surfaceRegistryIdsByWorkspace.tier0.test.ts — Slice A58

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

describe('ISurfaceRegistry.idsByWorkspace (Slice A58)', () => {
  let r: SurfaceRegistry;
  beforeEach(() => {
    r = new SurfaceRegistry();
  });

  it('returns empty array for empty registry', () => {
    expect(r.idsByWorkspace('w1')).toEqual([]);
  });

  it('returns empty array for empty workspaceId', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    expect(r.idsByWorkspace('')).toEqual([]);
  });

  it('returns ids of surfaces matching the workspaceId in registration order', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    r.register({ id: 's2', kind: 'editor', resource: fileResource('/b.md', { workspaceId: 'w2' }) });
    r.register({ id: 's3', kind: 'editor', resource: fileResource('/c.md', { workspaceId: 'w1' }) });
    expect(r.idsByWorkspace('w1')).toEqual(['s1', 's3']);
    expect(r.idsByWorkspace('w2')).toEqual(['s2']);
  });

  it('skips surfaces with no resource', () => {
    r.register({ id: 's1', kind: 'editor' });
    r.register({ id: 's2', kind: 'editor', resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(r.idsByWorkspace('w1')).toEqual(['s2']);
  });

  it('skips resources with no workspace scope', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md') });
    r.register({ id: 's2', kind: 'editor', resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    expect(r.idsByWorkspace('w1')).toEqual(['s2']);
  });

  it('returns a fresh array snapshot', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    const first = r.idsByWorkspace('w1');
    const second = r.idsByWorkspace('w1');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('agrees with listByWorkspace(id).map(s => s.id)', () => {
    r.register({ id: 's1', kind: 'editor', resource: fileResource('/a.md', { workspaceId: 'w1' }) });
    r.register({ id: 's2', kind: 'editor', resource: fileResource('/b.md', { workspaceId: 'w1' }) });
    const ids = r.idsByWorkspace('w1');
    const fromList = r.listByWorkspace('w1').map((s) => s.id);
    expect(ids).toEqual(fromList);
  });
});
