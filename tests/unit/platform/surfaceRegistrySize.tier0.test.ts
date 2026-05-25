// surfaceRegistrySize.tier0.test.ts — Slice A41

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

const surf = (id: string, kind: Surface['kind'] = 'editor'): Surface => ({
  id,
  kind,
  displayName: id,
  resource: undefined,
});

describe('ISurfaceRegistry.size (Slice A41)', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('is 0 on empty registry', () => {
    expect(reg.size).toBe(0);
  });

  it('increments on register', () => {
    reg.register(surf('a'));
    expect(reg.size).toBe(1);
    reg.register(surf('b'));
    expect(reg.size).toBe(2);
  });

  it('decrements on unregister', () => {
    reg.register(surf('a'));
    reg.register(surf('b'));
    reg.unregister('a');
    expect(reg.size).toBe(1);
  });

  it('does not change on update (same id)', () => {
    reg.register(surf('a'));
    reg.update({ ...surf('a'), displayName: 'renamed' });
    expect(reg.size).toBe(1);
  });

  it('returns to 0 after clear()', () => {
    reg.register(surf('a'));
    reg.register(surf('b'));
    reg.clear();
    expect(reg.size).toBe(0);
  });

  it('matches list().length', () => {
    reg.register(surf('a'));
    reg.register(surf('b'));
    reg.register(surf('c'));
    expect(reg.size).toBe(reg.list().length);
  });
});
