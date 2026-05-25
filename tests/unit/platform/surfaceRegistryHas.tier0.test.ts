// surfaceRegistryHas.tier0.test.ts — Slice A27

import { describe, it, expect } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { surface } from '../../../src/workbench/resources/surface.js';

describe('ISurfaceRegistry.has (Slice A27)', () => {
  it('returns false on empty registry', () => {
    const r = new SurfaceRegistry();
    expect(r.has('e1')).toBe(false);
  });

  it('returns true after register', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    expect(r.has('e1')).toBe(true);
  });

  it('returns false for unknown id', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    expect(r.has('other')).toBe(false);
  });

  it('returns false after unregister', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    r.unregister('e1');
    expect(r.has('e1')).toBe(false);
  });

  it('remains true after update', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    r.update(surface('e1', 'editor', 'A2'));
    expect(r.has('e1')).toBe(true);
  });

  it('agrees with get', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    expect(r.has('e1')).toBe(r.get('e1') !== undefined);
    expect(r.has('zzz')).toBe(r.get('zzz') !== undefined);
  });
});
