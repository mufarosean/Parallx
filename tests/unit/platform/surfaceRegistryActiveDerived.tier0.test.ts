// surfaceRegistryActiveDerived.tier0.test.ts — Slice A54

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';
import { fileResource } from '../../../src/workbench/resources/resource.js';

const editor = (id: string, workspaceId = 'w1'): Surface => ({
  id,
  kind: 'editor',
  resource: fileResource(`/${id}`, { workspaceId }),
});
const view = (id: string): Surface => ({ id, kind: 'view' });

describe('ISurfaceRegistry.activeKind / activeResource (Slice A54)', () => {
  let r: SurfaceRegistry;
  beforeEach(() => {
    r = new SurfaceRegistry();
  });

  it('returns undefined when no active surface', () => {
    expect(r.activeKind()).toBeUndefined();
    expect(r.activeResource()).toBeUndefined();
  });

  it('returns active surface kind and resource', () => {
    r.register(editor('a', 'w1'));
    r.setActive('a');
    expect(r.activeKind()).toBe('editor');
    expect(r.activeResource()).toEqual(fileResource('/a', { workspaceId: 'w1' }));
  });

  it('returns undefined resource when active surface has no resource', () => {
    r.register(view('v'));
    r.setActive('v');
    expect(r.activeKind()).toBe('view');
    expect(r.activeResource()).toBeUndefined();
  });

  it('updates when active changes', () => {
    r.register(editor('a', 'w1'));
    r.register(view('v'));
    r.setActive('a');
    expect(r.activeKind()).toBe('editor');
    r.setActive('v');
    expect(r.activeKind()).toBe('view');
    expect(r.activeResource()).toBeUndefined();
  });

  it('clears when active cleared', () => {
    r.register(editor('a'));
    r.setActive('a');
    r.setActive(undefined);
    expect(r.activeKind()).toBeUndefined();
    expect(r.activeResource()).toBeUndefined();
  });

  it('clears when active surface unregistered', () => {
    r.register(editor('a'));
    r.setActive('a');
    r.unregister('a');
    expect(r.activeKind()).toBeUndefined();
    expect(r.activeResource()).toBeUndefined();
  });

  it('agrees with getActive()?.kind / getActive()?.resource', () => {
    r.register(editor('a', 'w2'));
    r.setActive('a');
    expect(r.activeKind()).toBe(r.getActive()?.kind);
    expect(r.activeResource()).toEqual(r.getActive()?.resource);
  });
});
