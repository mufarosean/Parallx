// surfaceRegistryFindByResource.tier0.test.ts — Slice A22

import { describe, it, expect } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { surface } from '../../../src/workbench/resources/surface.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';

describe('SurfaceRegistry.findByResource (Slice A22)', () => {
  it('returns [] when no surfaces are registered', () => {
    const r = new SurfaceRegistry();
    expect(r.findByResource(fileResource('/a.md'))).toEqual([]);
  });

  it('returns surfaces showing a structurally-equal resource', () => {
    const r = new SurfaceRegistry();
    const target = fileResource('/a.md', { workspaceId: 'w1' });
    r.register(surface('e1', 'editor', 'A', target));
    r.register(surface('e2', 'editor', 'A2', fileResource('/a.md', { workspaceId: 'w1' })));
    r.register(surface('e3', 'editor', 'B', fileResource('/b.md')));
    expect(r.findByResource(target).map(s => s.id)).toEqual(['e1', 'e2']);
  });

  it('ignores surfaces with no resource', () => {
    const r = new SurfaceRegistry();
    const target = fileResource('/a.md');
    r.register(surface('e1', 'editor', 'A'));
    r.register(surface('e2', 'editor', 'A', target));
    expect(r.findByResource(target).map(s => s.id)).toEqual(['e2']);
  });

  it('does not cross resource types', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A', fileResource('/a.md')));
    r.register(surface('c1', 'canvas', 'C', canvasPageResource('a.md')));
    expect(r.findByResource(fileResource('/a.md')).map(s => s.id)).toEqual(['e1']);
    expect(r.findByResource(canvasPageResource('a.md')).map(s => s.id)).toEqual(['c1']);
  });

  it('respects workspaceId in identity', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A', fileResource('/a.md', { workspaceId: 'w1' })));
    r.register(surface('e2', 'editor', 'A', fileResource('/a.md', { workspaceId: 'w2' })));
    expect(r.findByResource(fileResource('/a.md', { workspaceId: 'w1' })).map(s => s.id)).toEqual(['e1']);
  });

  it('reflects update() that swaps the resource', () => {
    const r = new SurfaceRegistry();
    const target = fileResource('/a.md');
    r.register(surface('e1', 'editor', 'A', target));
    expect(r.findByResource(target).length).toBe(1);
    r.update(surface('e1', 'editor', 'A', fileResource('/b.md')));
    expect(r.findByResource(target).length).toBe(0);
    expect(r.findByResource(fileResource('/b.md')).length).toBe(1);
  });

  it('returns a fresh snapshot', () => {
    const r = new SurfaceRegistry();
    const target = fileResource('/a.md');
    r.register(surface('e1', 'editor', 'A', target));
    const snap = r.findByResource(target);
    r.unregister('e1');
    expect(snap.length).toBe(1);
    expect(r.findByResource(target).length).toBe(0);
  });
});
