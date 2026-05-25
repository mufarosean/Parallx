// surfaceRegistryCount.tier0.test.ts — Slice A75

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

const surf = (id: string, kind: Surface['kind'], resource: Surface['resource']): Surface => ({
  id,
  kind,
  displayName: id,
  resource,
});

describe('ISurfaceRegistry.count (Slice A75)', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns 0 on empty registry', () => {
    expect(reg.count(() => true)).toBe(0);
  });

  it('returns 0 when no surface matches', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.count((s) => s.id === 'sX')).toBe(0);
  });

  it('counts all matches', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    reg.register(surf('d', 'canvas', canvasPageResource('q', { workspaceId: 'w1' })));
    expect(reg.count((s) => s.kind === 'editor')).toBe(2);
    expect(reg.count((s) => s.kind === 'canvas')).toBe(2);
  });

  it('predicate-true equals list().length', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    expect(reg.count(() => true)).toBe(reg.list().length);
  });

  it('matches filter(p).length', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w2' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    const p = (s: Surface) => s.kind === 'editor';
    expect(reg.count(p)).toBe(reg.filter(p).length);
  });

  it('reflects unregister', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    reg.unregister('a');
    expect(reg.count(() => true)).toBe(1);
  });

  it('after clear() → 0', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.clear();
    expect(reg.count(() => true)).toBe(0);
  });
});
