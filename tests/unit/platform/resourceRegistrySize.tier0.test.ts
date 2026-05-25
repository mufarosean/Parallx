// resourceRegistrySize.tier0.test.ts — Slice A43

import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceRegistry } from '../../../src/workbench/resources/resourceRegistry.js';
import type { ResourceResolver } from '../../../src/workbench/resources/resourceRegistry.js';
import type { Resource } from '../../../src/workbench/resources/resource.js';

const stub = (type: Resource['type']): ResourceResolver => ({
  type,
  resolve: async () => null,
});

describe('IResourceRegistry.size (Slice A43)', () => {
  let reg: ResourceRegistry;
  beforeEach(() => {
    reg = new ResourceRegistry();
  });

  it('is 0 on empty registry', () => {
    expect(reg.size).toBe(0);
  });

  it('increments on register', () => {
    reg.register(stub('file'));
    expect(reg.size).toBe(1);
    reg.register(stub('canvas-page'));
    expect(reg.size).toBe(2);
  });

  it('does not change on override (same type)', () => {
    reg.register(stub('file'));
    reg.override(stub('file'));
    expect(reg.size).toBe(1);
  });

  it('decrements on unregister', () => {
    reg.register(stub('file'));
    reg.register(stub('canvas-page'));
    reg.unregister('file');
    expect(reg.size).toBe(1);
  });

  it('returns to 0 after clear()', () => {
    reg.register(stub('file'));
    reg.register(stub('external'));
    reg.clear();
    expect(reg.size).toBe(0);
  });

  it('matches types().length', () => {
    reg.register(stub('file'));
    reg.register(stub('canvas-page'));
    reg.register(stub('external'));
    expect(reg.size).toBe(reg.types().length);
  });
});
