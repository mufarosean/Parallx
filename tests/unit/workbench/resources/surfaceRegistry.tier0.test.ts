// surfaceRegistry.tier0.test.ts — Slice A3 verification

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurfaceRegistry, type ISurfaceChangeEvent } from '../../../../src/workbench/resources/surfaceRegistry.js';
import { surface } from '../../../../src/workbench/resources/surface.js';
import { fileResource, canvasPageResource } from '../../../../src/workbench/resources/resource.js';

describe('SurfaceRegistry — register / get / list / unregister', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => { reg = new SurfaceRegistry(); });

  it('registers a surface and reports via get / list', () => {
    const s = surface('editor:1', 'editor', 'a.md', fileResource('/tmp/a.md'));
    reg.register(s);
    expect(reg.get('editor:1')).toBe(s);
    expect(reg.list()).toEqual([s]);
  });

  it('throws on duplicate register', () => {
    const s = surface('s1', 'panel', 'P');
    reg.register(s);
    expect(() => reg.register(s)).toThrow(/already registered/);
  });

  it('unregisters and reports', () => {
    const s = surface('s1', 'panel', 'P');
    reg.register(s);
    expect(reg.unregister('s1')).toBe(true);
    expect(reg.unregister('s1')).toBe(false);
    expect(reg.get('s1')).toBeUndefined();
  });

  it('fires registered / unregistered events', () => {
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    const s = surface('s1', 'panel', 'P');
    reg.register(s);
    reg.unregister('s1');
    expect(events.map(e => e.kind)).toEqual(['registered', 'unregistered']);
  });
});

describe('SurfaceRegistry — update', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => { reg = new SurfaceRegistry(); });

  it('updates an existing surface in place', () => {
    const a = surface('editor:1', 'editor', 'a.md', fileResource('/tmp/a.md'));
    const b = surface('editor:1', 'editor', 'a.md', fileResource('/tmp/b.md'));
    reg.register(a);
    reg.update(b);
    expect(reg.get('editor:1')).toBe(b);
  });

  it('throws when updating unknown id', () => {
    expect(() => reg.update(surface('ghost', 'editor', 'x'))).toThrow(/not registered/);
  });

  it('no-ops when same identity is passed', () => {
    const s = surface('s', 'panel', 'P');
    reg.register(s);
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    reg.update(s);
    expect(events).toEqual([]);
  });

  it('fires updated event with previous snapshot', () => {
    const a = surface('s', 'panel', 'A');
    const b = surface('s', 'panel', 'B');
    reg.register(a);
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    reg.update(b);
    expect(events[0].kind).toBe('updated');
    expect(events[0].surface).toBe(b);
    expect(events[0].previous).toBe(a);
  });

  it('fires active event when updating the currently-active surface', () => {
    const a = surface('s', 'panel', 'A');
    const b = surface('s', 'panel', 'B');
    reg.register(a);
    reg.setActive('s');
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    reg.update(b);
    expect(events.map(e => e.kind)).toEqual(['updated', 'active']);
  });
});

describe('SurfaceRegistry — active surface', () => {
  let reg: SurfaceRegistry;
  beforeEach(() => { reg = new SurfaceRegistry(); });

  it('starts with no active surface', () => {
    expect(reg.getActive()).toBeUndefined();
  });

  it('setActive(id) sets active and fires event', () => {
    const s = surface('s', 'canvas', 'C', canvasPageResource('p'));
    reg.register(s);
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    reg.setActive('s');
    expect(reg.getActive()).toBe(s);
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('active');
    expect(events[0].surface).toBe(s);
    expect(events[0].previous).toBeUndefined();
  });

  it('setActive(undefined) clears active and fires event', () => {
    const s = surface('s', 'canvas', 'C');
    reg.register(s);
    reg.setActive('s');
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    reg.setActive(undefined);
    expect(reg.getActive()).toBeUndefined();
    expect(events[0]).toMatchObject({ kind: 'active', surface: undefined, previous: s });
  });

  it('setActive(unknown id) is a silent no-op', () => {
    const fn = vi.fn();
    reg.onDidChangeSurface(fn);
    reg.setActive('ghost');
    expect(reg.getActive()).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('setActive(currentId) is a no-op', () => {
    reg.register(surface('s', 'panel', 'P'));
    reg.setActive('s');
    const fn = vi.fn();
    reg.onDidChangeSurface(fn);
    reg.setActive('s');
    expect(fn).not.toHaveBeenCalled();
  });

  it('unregistering the active surface clears active and fires active event', () => {
    const s = surface('s', 'panel', 'P');
    reg.register(s);
    reg.setActive('s');
    const events: ISurfaceChangeEvent[] = [];
    reg.onDidChangeSurface(e => events.push(e));
    reg.unregister('s');
    // active=undefined first, then unregistered
    expect(events.map(e => e.kind)).toEqual(['active', 'unregistered']);
    expect(reg.getActive()).toBeUndefined();
  });
});

describe('SurfaceRegistry — dispose', () => {
  it('clears state and stops emitting', () => {
    const reg = new SurfaceRegistry();
    reg.register(surface('s', 'panel', 'P'));
    reg.dispose();
    expect(reg.get('s')).toBeUndefined();
    expect(reg.list()).toEqual([]);
    expect(reg.getActive()).toBeUndefined();
  });
});
