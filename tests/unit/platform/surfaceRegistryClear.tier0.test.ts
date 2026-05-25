// surfaceRegistryClear.tier0.test.ts — Slice A31

import { describe, it, expect, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { surface as makeSurface } from '../../../src/workbench/resources/surface.js';
import type { ISurfaceChangeEvent } from '../../../src/workbench/resources/surfaceRegistry.js';

describe('ISurfaceRegistry.clear() (Slice A31)', () => {
  let reg: SurfaceRegistry;
  let events: ISurfaceChangeEvent[];

  beforeEach(() => {
    reg = new SurfaceRegistry();
    events = [];
    reg.onDidChangeSurface(e => events.push(e));
  });

  it('returns empty array and fires no events on empty registry', () => {
    expect(reg.clear()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('unregisters every surface and reports ids in insertion order', () => {
    reg.register(makeSurface('s1', 'editor', 'A'));
    reg.register(makeSurface('s2', 'canvas', 'B'));
    reg.register(makeSurface('s3', 'chat', 'C'));
    events.length = 0;
    expect(reg.clear()).toEqual(['s1', 's2', 's3']);
    expect(reg.list()).toEqual([]);
    expect(reg.getActive()).toBeUndefined();
  });

  it('fires one unregistered event per surface in insertion order', () => {
    reg.register(makeSurface('s1', 'editor', 'A'));
    reg.register(makeSurface('s2', 'canvas', 'B'));
    events.length = 0;
    reg.clear();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'unregistered', surface: expect.objectContaining({ id: 's1' }) });
    expect(events[1]).toEqual({ kind: 'unregistered', surface: expect.objectContaining({ id: 's2' }) });
  });

  it('clears active and fires active=undefined before unregistered events', () => {
    const s1 = makeSurface('s1', 'editor', 'A');
    const s2 = makeSurface('s2', 'canvas', 'B');
    reg.register(s1);
    reg.register(s2);
    reg.setActive('s1');
    events.length = 0;
    reg.clear();
    expect(events[0].kind).toBe('active');
    expect(events[0].surface).toBeUndefined();
    expect(events[0].previous).toBe(s1);
    expect(events.slice(1).every(e => e.kind === 'unregistered')).toBe(true);
  });

  it('does not fire active when nothing was active', () => {
    reg.register(makeSurface('s1', 'editor', 'A'));
    events.length = 0;
    reg.clear();
    expect(events.every(e => e.kind === 'unregistered')).toBe(true);
  });

  it('is idempotent', () => {
    reg.register(makeSurface('s1', 'editor', 'A'));
    reg.clear();
    events.length = 0;
    expect(reg.clear()).toEqual([]);
    expect(events).toEqual([]);
  });

  it('leaves the registry usable', () => {
    reg.register(makeSurface('s1', 'editor', 'A'));
    reg.clear();
    reg.register(makeSurface('s2', 'canvas', 'B'));
    expect(reg.list().map(s => s.id)).toEqual(['s2']);
    expect(reg.has('s1')).toBe(false);
    expect(reg.has('s2')).toBe(true);
  });
});
