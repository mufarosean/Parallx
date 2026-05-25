// surfaceRegistrySome.tier0.test.ts — Slice A78

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

describe('ISurfaceRegistry.some (Slice A78)', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns false on empty registry', () => {
    expect(reg.some(() => true)).toBe(false);
  });

  it('returns false when no surface matches', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.some((s) => s.id === 'sX')).toBe(false);
  });

  it('returns true on first match', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'canvas', canvasPageResource('p', { workspaceId: 'w1' })));
    expect(reg.some((s) => s.kind === 'canvas')).toBe(true);
  });

  it('short-circuits — does not visit surfaces after first match', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.register(surf('b', 'editor', fileResource('/b', { workspaceId: 'w1' })));
    reg.register(surf('c', 'editor', fileResource('/c', { workspaceId: 'w1' })));
    reg.register(surf('d', 'editor', fileResource('/d', { workspaceId: 'w1' })));
    let calls = 0;
    const res = reg.some((s) => {
      calls++;
      return s.id === 'b';
    });
    expect(res).toBe(true);
    expect(calls).toBe(2);
  });

  it('predicate-true with non-empty → true', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    expect(reg.some(() => true)).toBe(true);
  });

  it('reflects unregister', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.unregister('a');
    expect(reg.some(() => true)).toBe(false);
  });

  it('after clear() → false', () => {
    reg.register(surf('a', 'editor', fileResource('/a', { workspaceId: 'w1' })));
    reg.clear();
    expect(reg.some(() => true)).toBe(false);
  });
});
