// surfaceRegistryKinds.tier0.test.ts — Slice A38

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

const surf = (id: string, kind: Surface['kind']): Surface => ({
  id,
  kind,
  displayName: id,
  resource: undefined,
});

describe('ISurfaceRegistry.kinds() (Slice A38)', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns empty array on empty registry', () => {
    expect(reg.kinds()).toEqual([]);
  });

  it('returns distinct kinds in first-insertion order', () => {
    reg.register(surf('a', 'editor'));
    reg.register(surf('b', 'canvas'));
    reg.register(surf('c', 'editor'));
    reg.register(surf('d', 'chat'));
    expect(reg.kinds()).toEqual(['editor', 'canvas', 'chat']);
  });

  it('drops kinds when all surfaces of that kind unregister', () => {
    reg.register(surf('a', 'editor'));
    reg.register(surf('b', 'canvas'));
    reg.unregister('a');
    expect(reg.kinds()).toEqual(['canvas']);
  });

  it('returns a fresh snapshot', () => {
    reg.register(surf('a', 'editor'));
    const snap = reg.kinds() as string[];
    reg.register(surf('b', 'canvas'));
    expect(snap).toEqual(['editor']);
  });

  it('returns empty after clear()', () => {
    reg.register(surf('a', 'editor'));
    reg.register(surf('b', 'canvas'));
    reg.clear();
    expect(reg.kinds()).toEqual([]);
  });

  it('handles custom string kinds (open union)', () => {
    reg.register(surf('a', 'my-custom-view' as Surface['kind']));
    expect(reg.kinds()).toEqual(['my-custom-view']);
  });
});
