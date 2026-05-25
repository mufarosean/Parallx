// surfaceRegistryIds.tier0.test.ts — Slice A44

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

const surf = (id: string): Surface => ({
  id,
  kind: 'editor',
  displayName: id,
  resource: undefined,
});

describe('ISurfaceRegistry.ids() (Slice A44)', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => {
    reg = new SurfaceRegistry();
  });

  it('returns empty array on empty registry', () => {
    expect(reg.ids()).toEqual([]);
  });

  it('returns ids in registration order', () => {
    reg.register(surf('c'));
    reg.register(surf('a'));
    reg.register(surf('b'));
    expect(reg.ids()).toEqual(['c', 'a', 'b']);
  });

  it('drops unregistered ids', () => {
    reg.register(surf('a'));
    reg.register(surf('b'));
    reg.unregister('a');
    expect(reg.ids()).toEqual(['b']);
  });

  it('returns a fresh snapshot', () => {
    reg.register(surf('a'));
    const snap = reg.ids() as string[];
    reg.register(surf('b'));
    expect(snap).toEqual(['a']);
  });

  it('returns empty after clear()', () => {
    reg.register(surf('a'));
    reg.register(surf('b'));
    reg.clear();
    expect(reg.ids()).toEqual([]);
  });

  it('matches list().map(s => s.id)', () => {
    reg.register(surf('a'));
    reg.register(surf('b'));
    reg.register(surf('c'));
    expect(reg.ids()).toEqual(reg.list().map(s => s.id));
  });
});
