// surfaceRegistryKindsByWorkspace.tier0.test.ts — Slice A63

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

describe('ISurfaceRegistry.kindsByWorkspace() (Slice A63)', () => {
  let reg: SurfaceRegistry;

  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns empty array on empty registry', () => {
    expect(reg.kindsByWorkspace('w1')).toEqual([]);
  });

  it('returns empty array for empty workspaceId', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.kindsByWorkspace('')).toEqual([]);
  });

  it('returns distinct kinds in first-insertion order, scoped to workspace', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    expect(reg.kindsByWorkspace('w1')).toEqual(['editor', 'canvas']);
  });

  it('isolates kinds per workspace', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w2' })));
    expect(reg.kindsByWorkspace('w1')).toEqual(['editor']);
    expect(reg.kindsByWorkspace('w2')).toEqual(['canvas']);
  });

  it('skips surfaces with no resource', () => {
    reg.register(surf('a', 'panel', undefined));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    expect(reg.kindsByWorkspace('w1')).toEqual(['editor']);
  });

  it('skips surfaces with external (no workspace) resources', () => {
    reg.register(surf('a', 'editor', externalResource('https://example.com')));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    expect(reg.kindsByWorkspace('w1')).toEqual(['canvas']);
  });

  it('returns a fresh array snapshot', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    const first = reg.kindsByWorkspace('w1');
    const second = reg.kindsByWorkspace('w1');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
