// surfaceRegistryActiveId.tier0.test.ts — Slice A48

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { surface } from '../../../src/workbench/resources/surface.js';

describe('ISurfaceRegistry.getActiveId (Slice A48)', () => {
  let r: SurfaceRegistry;
  beforeEach(() => {
    r = new SurfaceRegistry();
  });

  it('returns undefined on empty registry', () => {
    expect(r.getActiveId()).toBeUndefined();
  });

  it('returns undefined when nothing is active', () => {
    r.register(surface('a', 'editor', 'A'));
    expect(r.getActiveId()).toBeUndefined();
  });

  it('returns the active id after setActive', () => {
    r.register(surface('a', 'editor', 'A'));
    r.setActive('a');
    expect(r.getActiveId()).toBe('a');
  });

  it('returns undefined after setActive(undefined)', () => {
    r.register(surface('a', 'editor', 'A'));
    r.setActive('a');
    r.setActive(undefined);
    expect(r.getActiveId()).toBeUndefined();
  });

  it('returns undefined after active surface is unregistered', () => {
    r.register(surface('a', 'editor', 'A'));
    r.setActive('a');
    r.unregister('a');
    expect(r.getActiveId()).toBeUndefined();
  });

  it('agrees with getActive()?.id', () => {
    r.register(surface('a', 'editor', 'A'));
    r.register(surface('b', 'editor', 'B'));
    r.setActive('b');
    expect(r.getActiveId()).toBe(r.getActive()?.id);
  });

  it('returns undefined after clear()', () => {
    r.register(surface('a', 'editor', 'A'));
    r.setActive('a');
    r.clear();
    expect(r.getActiveId()).toBeUndefined();
  });
});
