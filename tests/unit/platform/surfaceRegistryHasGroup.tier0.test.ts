// surfaceRegistryHasGroup.tier0.test.ts — Slice A51

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import type { Surface } from '../../../src/workbench/resources/surface.js';

const editor = (id: string, workspaceId = 'w1'): Surface => ({
  id,
  kind: 'editor',
  resource: { type: 'file', path: `/${id}`, workspaceId },
});
const view = (id: string): Surface => ({ id, kind: 'view' });

describe('ISurfaceRegistry.hasKind / hasWorkspace (Slice A51)', () => {
  let r: SurfaceRegistry;
  beforeEach(() => {
    r = new SurfaceRegistry();
  });

  it('returns false on empty registry', () => {
    expect(r.hasKind('editor')).toBe(false);
    expect(r.hasWorkspace('w1')).toBe(false);
  });

  it('hasKind returns true when a surface matches', () => {
    r.register(editor('a'));
    r.register(view('v'));
    expect(r.hasKind('editor')).toBe(true);
    expect(r.hasKind('view')).toBe(true);
    expect(r.hasKind('panel')).toBe(false);
  });

  it('hasWorkspace returns true when a surface matches', () => {
    r.register(editor('a', 'w1'));
    r.register(view('v'));
    expect(r.hasWorkspace('w1')).toBe(true);
    expect(r.hasWorkspace('w2')).toBe(false);
  });

  it('hasWorkspace skips surfaces with no resource', () => {
    r.register(view('v'));
    expect(r.hasWorkspace('w1')).toBe(false);
  });

  it('empty arg returns false', () => {
    r.register(editor('a', 'w1'));
    expect(r.hasKind('' as never)).toBe(false);
    expect(r.hasWorkspace('')).toBe(false);
  });

  it('updates after unregister', () => {
    r.register(editor('a', 'w1'));
    r.unregister('a');
    expect(r.hasKind('editor')).toBe(false);
    expect(r.hasWorkspace('w1')).toBe(false);
  });

  it('agrees with countByKind > 0 / countByWorkspace > 0', () => {
    r.register(editor('a', 'w1'));
    r.register(view('v'));
    expect(r.hasKind('editor')).toBe(r.countByKind('editor') > 0);
    expect(r.hasKind('view')).toBe(r.countByKind('view') > 0);
    expect(r.hasKind('panel')).toBe(r.countByKind('panel') > 0);
    expect(r.hasWorkspace('w1')).toBe(r.countByWorkspace('w1') > 0);
    expect(r.hasWorkspace('w2')).toBe(r.countByWorkspace('w2') > 0);
  });
});
