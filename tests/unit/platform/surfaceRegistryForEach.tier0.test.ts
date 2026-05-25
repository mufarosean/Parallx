// surfaceRegistryForEach.tier0.test.ts — Slice A72

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

describe('ISurfaceRegistry.forEach (Slice A72)', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('does not invoke cb on empty registry', () => {
    let n = 0;
    reg.forEach(() => {
      n++;
    });
    expect(n).toBe(0);
  });

  it('invokes cb once per surface in registration order', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    const seen: string[] = [];
    reg.forEach((s) => {
      seen.push(s.id);
    });
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('passes the surface object to cb', () => {
    const a = surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' }));
    reg.register(a);
    const seen: Surface[] = [];
    reg.forEach((s) => {
      seen.push(s);
    });
    expect(seen).toEqual([a]);
  });

  it('reflects unregister', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    reg.unregister('a');
    const seen: string[] = [];
    reg.forEach((s) => {
      seen.push(s.id);
    });
    expect(seen).toEqual(['b']);
  });

  it('after clear() → no invocations', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.clear();
    let n = 0;
    reg.forEach(() => {
      n++;
    });
    expect(n).toBe(0);
  });

  it('cb may throw; later iterations are not invoked', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    let n = 0;
    expect(() =>
      reg.forEach((s) => {
        n++;
        if (s.id === 'b') throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(n).toBe(2);
  });

  it('agrees with list() over iteration', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w2' })));
    const seen: Surface[] = [];
    reg.forEach((s) => seen.push(s));
    expect(seen).toEqual(Array.from(reg.list()));
  });
});
