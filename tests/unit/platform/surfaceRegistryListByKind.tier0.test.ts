// surfaceRegistryListByKind.tier0.test.ts — Slice A18

import { describe, it, expect } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { surface } from '../../../src/workbench/resources/surface.js';

describe('SurfaceRegistry.listByKind (Slice A18)', () => {
  it('returns empty array when no surfaces registered', () => {
    const r = new SurfaceRegistry();
    expect(r.listByKind('editor')).toEqual([]);
  });

  it('returns only surfaces whose kind matches', () => {
    const r = new SurfaceRegistry();
    const e1 = surface('e1', 'editor', 'A');
    const c1 = surface('c1', 'canvas', 'C');
    const e2 = surface('e2', 'editor', 'B');
    r.register(e1); r.register(c1); r.register(e2);
    expect(r.listByKind('editor')).toEqual([e1, e2]);
    expect(r.listByKind('canvas')).toEqual([c1]);
    expect(r.listByKind('chat')).toEqual([]);
  });

  it('preserves insertion order', () => {
    const r = new SurfaceRegistry();
    const ids = ['e3', 'e1', 'e2', 'e4'];
    for (const id of ids) r.register(surface(id, 'editor', id));
    expect(r.listByKind('editor').map(s => s.id)).toEqual(ids);
  });

  it('returns a fresh snapshot independent of subsequent mutations', () => {
    const r = new SurfaceRegistry();
    const e1 = surface('e1', 'editor', 'A');
    r.register(e1);
    const snap = r.listByKind('editor');
    r.register(surface('e2', 'editor', 'B'));
    r.unregister('e1');
    expect(snap).toEqual([e1]);
  });

  it('reflects unregister between calls', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    r.register(surface('e2', 'editor', 'B'));
    expect(r.listByKind('editor').length).toBe(2);
    r.unregister('e1');
    expect(r.listByKind('editor').map(s => s.id)).toEqual(['e2']);
  });

  it('reflects update() replacements without duplicating', () => {
    const r = new SurfaceRegistry();
    r.register(surface('e1', 'editor', 'A'));
    r.update(surface('e1', 'editor', 'A-renamed'));
    const all = r.listByKind('editor');
    expect(all.length).toBe(1);
    expect(all[0].displayName).toBe('A-renamed');
  });

  it('accepts open-string kinds (extension-defined)', () => {
    const r = new SurfaceRegistry();
    r.register(surface('x1', 'extension:my-ext.view', 'X'));
    expect(r.listByKind('extension:my-ext.view').map(s => s.id)).toEqual(['x1']);
    expect(r.listByKind('editor')).toEqual([]);
  });
});
