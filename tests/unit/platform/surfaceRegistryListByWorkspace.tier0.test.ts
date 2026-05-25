// surfaceRegistryListByWorkspace.tier0.test.ts — Slice A34

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { fileResource, canvasPageResource, externalResource } from '../../../src/workbench/resources/resource.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

const surf = (id: string, kind: Surface['kind'], resource: Surface['resource']): Surface => ({
  id,
  kind,
  displayName: id,
  resource,
});

describe('ISurfaceRegistry.listByWorkspace() (Slice A34)', () => {
  let reg: SurfaceRegistry;

  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns empty array on empty registry', () => {
    expect(reg.listByWorkspace('w1')).toEqual([]);
  });

  it('matches surfaces whose resource is in the given workspace, insertion order', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w2' })));
    reg.register(surf('c', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    expect(reg.listByWorkspace('w1').map(s => s.id)).toEqual(['a', 'c']);
    expect(reg.listByWorkspace('w2').map(s => s.id)).toEqual(['b']);
  });

  it('excludes surfaces with no resource', () => {
    reg.register(surf('a', 'panel', undefined));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    expect(reg.listByWorkspace('w1').map(s => s.id)).toEqual(['b']);
  });

  it('excludes surfaces whose resource is external (no workspace scope)', () => {
    reg.register(surf('a', 'panel', externalResource('https://example.com')));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    expect(reg.listByWorkspace('w1').map(s => s.id)).toEqual(['b']);
  });

  it('excludes surfaces whose resource has no workspaceId', () => {
    reg.register(surf('a', 'editor', fileResource('/a')));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    expect(reg.listByWorkspace('w1').map(s => s.id)).toEqual(['b']);
  });

  it('returns empty array for empty workspaceId', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.listByWorkspace('')).toEqual([]);
  });

  it('returns a fresh snapshot', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    const snap = reg.listByWorkspace('w1') as Surface[];
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    expect(snap).toHaveLength(1);
  });
});
