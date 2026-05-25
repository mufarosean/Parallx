// contextService.tier0.test.ts — Slice A4 verification

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Emitter } from '../../../../src/platform/events.js';
import {
  ContextService,
  type WorkbenchContext,
  type ContextWorkspaceSource,
  type ContextSurfaceSource,
  type ContextSelectionSource,
  type ContextSelectionLike,
} from '../../../../src/workbench/resources/contextService.js';
import { surface, type Surface } from '../../../../src/workbench/resources/surface.js';
import { fileResource } from '../../../../src/workbench/resources/resource.js';

class WorkspaceStub implements ContextWorkspaceSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeWorkspace = this._e.event;
  activeWorkspace: { id: string } | undefined = undefined;
  set(id: string | undefined) {
    this.activeWorkspace = id ? { id } : undefined;
    this._e.fire(undefined);
  }
}

class SurfaceStub implements ContextSurfaceSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeSurface = this._e.event;
  private _active: Surface | undefined = undefined;
  getActive() { return this._active; }
  set(s: Surface | undefined) { this._active = s; this._e.fire(undefined); }
}

class SelectionStub implements ContextSelectionSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeSelection = this._e.event;
  private _sel: ContextSelectionLike | undefined = undefined;
  getSelection() { return this._sel; }
  set(s: ContextSelectionLike | undefined) { this._sel = s; this._e.fire(undefined); }
}

describe('ContextService — initial snapshot', () => {
  it('starts with all undefined when sources are empty', () => {
    const svc = new ContextService(new WorkspaceStub(), new SurfaceStub(), new SelectionStub());
    const ctx = svc.getContext();
    expect(ctx).toEqual({ workspaceId: undefined, activeSurface: undefined, activeSelection: undefined });
  });

  it('reflects pre-existing state of sources', () => {
    const ws = new WorkspaceStub();
    ws.activeWorkspace = { id: 'w1' };
    const sf = new SurfaceStub();
    const s = surface('editor:1', 'editor', 'a.md', fileResource('/tmp/a.md'));
    sf.set(s);
    const sel = new SelectionStub();
    sel.set({ kind: 'text' });
    const svc = new ContextService(ws, sf, sel);
    const ctx = svc.getContext();
    expect(ctx.workspaceId).toBe('w1');
    expect(ctx.activeSurface).toBe(s);
    expect(ctx.activeSelection).toEqual({ kind: 'text' });
  });
});

describe('ContextService — composed change events', () => {
  let ws: WorkspaceStub;
  let sf: SurfaceStub;
  let sel: SelectionStub;
  let svc: ContextService;
  let fired: WorkbenchContext[];

  beforeEach(() => {
    ws = new WorkspaceStub();
    sf = new SurfaceStub();
    sel = new SelectionStub();
    svc = new ContextService(ws, sf, sel);
    fired = [];
    svc.onDidChangeContext(c => fired.push(c));
  });

  it('fires when workspace changes', () => {
    ws.set('w1');
    expect(fired).toHaveLength(1);
    expect(fired[0].workspaceId).toBe('w1');
  });

  it('fires when active surface changes', () => {
    const s = surface('s', 'panel', 'P');
    sf.set(s);
    expect(fired).toHaveLength(1);
    expect(fired[0].activeSurface).toBe(s);
  });

  it('fires when selection changes', () => {
    sel.set({ kind: 'text' });
    expect(fired).toHaveLength(1);
    expect(fired[0].activeSelection).toEqual({ kind: 'text' });
  });

  it('fires once per atomic source change', () => {
    ws.set('w1');
    sf.set(surface('s', 'panel', 'P'));
    sel.set({ kind: 'text' });
    expect(fired).toHaveLength(3);
  });

  it('coalesces no-op events (source fires but snapshot is identical)', () => {
    ws.set('w1');
    fired.length = 0;
    // Re-set same id — same string reference at the {id:string} comparison level.
    ws.activeWorkspace = { id: 'w1' };
    (ws as unknown as { _e: Emitter<unknown> })._e?.fire?.(undefined);
    // Even with new object, workspaceId string is === 'w1' → no fire.
    // We can't access the private emitter here cleanly; use ws.set('w1') which DOES set a new object.
    // After that, snapshot.workspaceId is still 'w1' === prev.workspaceId → no fire.
    ws.set('w1');
    expect(fired).toHaveLength(0);
  });

  it('does NOT fire after dispose', () => {
    svc.dispose();
    ws.set('w1');
    sf.set(surface('s', 'panel', 'P'));
    expect(fired).toHaveLength(0);
  });
});

describe('ContextService — composed snapshot', () => {
  it('getContext always returns a fresh snapshot', () => {
    const ws = new WorkspaceStub();
    const sf = new SurfaceStub();
    const sel = new SelectionStub();
    const svc = new ContextService(ws, sf, sel);
    ws.activeWorkspace = { id: 'w1' }; // direct mutation, no event
    const ctx = svc.getContext();
    expect(ctx.workspaceId).toBe('w1');
  });

  it('all three fields update independently in one snapshot', () => {
    const ws = new WorkspaceStub();
    const sf = new SurfaceStub();
    const sel = new SelectionStub();
    const svc = new ContextService(ws, sf, sel);
    ws.set('w1');
    const s = surface('s', 'canvas', 'C');
    sf.set(s);
    sel.set({ blockId: 'b1' });
    const ctx = svc.getContext();
    expect(ctx).toEqual({ workspaceId: 'w1', activeSurface: s, activeSelection: { blockId: 'b1' }, activeSurfaceKind: 'canvas' });
  });
});

describe('ContextService — workspace clear', () => {
  it('reflects workspace going from set to undefined', () => {
    const ws = new WorkspaceStub();
    const sf = new SurfaceStub();
    const sel = new SelectionStub();
    const svc = new ContextService(ws, sf, sel);
    const fn = vi.fn();
    svc.onDidChangeContext(fn);
    ws.set('w1');
    ws.set(undefined);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(svc.getContext().workspaceId).toBeUndefined();
  });
});
