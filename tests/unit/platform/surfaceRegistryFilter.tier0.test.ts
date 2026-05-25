// surfaceRegistryFilter.tier0.test.ts — Slice A68

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

describe('ISurfaceRegistry.filter() (Slice A68)', () => {
  let reg: SurfaceRegistry;

  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns empty array on empty registry', () => {
    expect(reg.filter(() => true)).toEqual([]);
  });

  it('returns empty array when no surface matches', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.filter((s) => s.kind === 'canvas')).toEqual([]);
  });

  it('returns all matches in registration order', () => {
    const a = surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' }));
    const b = surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' }));
    const c = surf('c', 'canvas', canvasPageResource('q', { workspaceId: 'w1' }));
    const d = surf('d', 'editor', fileResource('/d', { workspaceId: 'w1' }));
    reg.register(a);
    reg.register(b);
    reg.register(c);
    reg.register(d);
    expect(reg.filter((s) => s.kind === 'canvas')).toEqual([b, c]);
  });

  it('returns fresh array each call', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    const first = reg.filter(() => true) as Surface[];
    first.push({} as Surface);
    expect(reg.filter(() => true).length).toBe(1);
  });

  it('predicate returning all-true equals list()', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    expect(reg.filter(() => true)).toEqual(Array.from(reg.list()));
  });

  it('reflects unregister', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    reg.unregister('a');
    expect(reg.filter(() => true).map((s) => s.id)).toEqual(['b']);
  });

  it('after clear() → empty', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.clear();
    expect(reg.filter(() => true)).toEqual([]);
  });
});
