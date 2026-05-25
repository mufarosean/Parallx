// surfaceRegistryEntries.tier0.test.ts — Slice A66

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

describe('ISurfaceRegistry.entries() (Slice A66)', () => {
  let reg: SurfaceRegistry;

  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns empty array on empty registry', () => {
    expect(reg.entries()).toEqual([]);
  });

  it('returns one [id, Surface] tuple after single register', () => {
    const s = surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' }));
    reg.register(s);
    const e = reg.entries();
    expect(e.length).toBe(1);
    expect(e[0][0]).toBe('a');
    expect(e[0][1]).toBe(s);
  });

  it('preserves registration order across multiple surfaces', () => {
    const a = surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' }));
    const b = surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' }));
    const c = surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' }));
    reg.register(a);
    reg.register(b);
    reg.register(c);
    const e = reg.entries();
    expect(e.map((t) => t[0])).toEqual(['a', 'b', 'c']);
    expect(e.map((t) => t[1])).toEqual([a, b, c]);
  });

  it('returns fresh array each call (mutation does not leak)', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    const first = reg.entries() as Array<readonly [string, Surface]>;
    first.push(['x', {} as Surface] as const);
    expect(reg.entries().length).toBe(1);
  });

  it('reflects unregister', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    reg.unregister('a');
    const e = reg.entries();
    expect(e.length).toBe(1);
    expect(e[0][0]).toBe('b');
  });

  it('after clear() → empty', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    reg.clear();
    expect(reg.entries()).toEqual([]);
  });

  it('agrees with ids() and list() pairwise', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w2' })));
    const e = reg.entries();
    const ids = reg.ids();
    const list = reg.list();
    expect(e.map((t) => t[0])).toEqual(Array.from(ids));
    expect(e.map((t) => t[1])).toEqual(Array.from(list));
  });
});
