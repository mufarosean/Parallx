// surfaceRegistryFind.tier0.test.ts — Slice A67

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

describe('ISurfaceRegistry.find() (Slice A67)', () => {
  let reg: SurfaceRegistry;

  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns undefined on empty registry', () => {
    expect(reg.find(() => true)).toBeUndefined();
  });

  it('returns undefined when no surface matches predicate', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.find((s) => s.kind === 'canvas')).toBeUndefined();
  });

  it('returns the first matching surface in registration order', () => {
    const a = surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' }));
    const b = surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' }));
    const c = surf('c', 'canvas', canvasPageResource('q', { workspaceId: 'w1' }));
    reg.register(a);
    reg.register(b);
    reg.register(c);
    expect(reg.find((s) => s.kind === 'canvas')).toBe(b);
  });

  it('predicate may inspect id', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    expect(reg.find((s) => s.id === 'b')?.id).toBe('b');
  });

  it('reflects unregister', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.unregister('a');
    expect(reg.find(() => true)).toBeUndefined();
  });

  it('after clear() → undefined', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.clear();
    expect(reg.find(() => true)).toBeUndefined();
  });

  it('does not invoke predicate after first match', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    let n = 0;
    reg.find((s) => {
      n++;
      return s.id === 'b';
    });
    expect(n).toBe(2);
  });
});
