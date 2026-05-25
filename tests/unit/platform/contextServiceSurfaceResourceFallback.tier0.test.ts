// contextServiceSurfaceResourceFallback.tier0.test.ts — Slice B6
//
// Covers the surface-resource fallback added in §86 / Slice B6: when no
// selection holds a resource but the active surface does, `activeResource`
// (and therefore `activeResourceType`) falls back to the surface's resource.
//
// This closes the visible chain B1 → B3 → B4 → B5 → B6: an editor surface
// with a resolved resource is now observable as `activeResource` end-to-end
// without anybody publishing a synthetic primary selection.

import { describe, it, expect } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import {
  ContextService,
  type ContextWorkspaceSource,
  type ContextSurfaceSource,
  type ContextSelectionSource,
  type ContextSelectionLike,
} from '../../../src/workbench/resources/contextService.js';
import { fileResource, canvasPageResource } from '../../../src/workbench/resources/resource.js';
import { surface, type Surface } from '../../../src/workbench/resources/surface.js';

class WSStub implements ContextWorkspaceSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeWorkspace = this._e.event;
  activeWorkspace: { id: string } | undefined;
}

class SFStub implements ContextSurfaceSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeSurface = this._e.event;
  private _active: Surface | undefined;
  getActive() { return this._active; }
  setActive(s: Surface | undefined) { this._active = s; this._e.fire(undefined); }
}

class SelStub implements ContextSelectionSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeSelection = this._e.event;
  private _sel: ContextSelectionLike | undefined;
  getSelection() { return this._sel; }
  set(s: ContextSelectionLike | undefined) { this._sel = s; this._e.fire(undefined); }
}

describe('ContextService surface-resource fallback (Slice B6)', () => {
  it('falls back to activeSurface.resource when no selection', () => {
    const sf = new SFStub();
    const r = fileResource('/tmp/note.md');
    sf.setActive(surface('editor:1', 'editor', 'note.md', r));
    const svc = new ContextService(new WSStub(), sf, new SelStub());
    expect(svc.getContext().activeResource).toBe(r);
    expect(svc.getContext().activeResourceType).toBe('file');
  });

  it('falls back to activeSurface.resource when selection has no resource', () => {
    const sf = new SFStub();
    const r = canvasPageResource('p1');
    sf.setActive(surface('editor:1', 'editor', 'Page 1', r));
    const sel = new SelStub();
    sel.set({ kind: 'text' });
    const svc = new ContextService(new WSStub(), sf, sel);
    expect(svc.getContext().activeResource).toBe(r);
    expect(svc.getContext().activeResourceType).toBe('canvas-page');
  });

  it('selection.resource still wins over surface.resource when both present', () => {
    const sf = new SFStub();
    const surfaceRes = canvasPageResource('p1');
    sf.setActive(surface('editor:1', 'editor', 'Page 1', surfaceRes));
    const sel = new SelStub();
    const selRes = fileResource('/a.md');
    sel.set({ resource: selRes });
    const svc = new ContextService(new WSStub(), sf, sel);
    expect(svc.getContext().activeResource).toBe(selRes);
    expect(svc.getContext().activeResourceType).toBe('file');
  });

  it('fires onDidChangeContext when surface activates with a resource', () => {
    const sf = new SFStub();
    const svc = new ContextService(new WSStub(), sf, new SelStub());
    const fired: Array<unknown> = [];
    svc.onDidChangeContext(c => fired.push(c.activeResource));
    const r = fileResource('/x.md');
    sf.setActive(surface('editor:1', 'editor', 'x.md', r));
    expect(fired).toEqual([r]);
  });

  it('is undefined when both selection and surface lack a resource', () => {
    const sf = new SFStub();
    sf.setActive(surface('editor:1', 'editor', 'untitled', undefined));
    const svc = new ContextService(new WSStub(), sf, new SelStub());
    expect(svc.getContext().activeResource).toBeUndefined();
    expect(svc.getContext().activeResourceType).toBe(undefined);
  });
});
