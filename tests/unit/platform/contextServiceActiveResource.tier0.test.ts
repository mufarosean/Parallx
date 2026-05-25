// contextServiceActiveResource.tier0.test.ts — Slice A14
//
// Covers the `activeResource` field derived from `activeSelection.resource`.

import { describe, it, expect } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import {
  ContextService,
  type ContextWorkspaceSource,
  type ContextSurfaceSource,
  type ContextSelectionSource,
  type ContextSelectionLike,
} from '../../../src/workbench/resources/contextService.js';
import { fileResource, externalResource } from '../../../src/workbench/resources/resource.js';

class WSStub implements ContextWorkspaceSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeWorkspace = this._e.event;
  activeWorkspace: { id: string } | undefined;
}

class SFStub implements ContextSurfaceSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeSurface = this._e.event;
  getActive() { return undefined; }
}

class SelStub implements ContextSelectionSource {
  private readonly _e = new Emitter<unknown>();
  readonly onDidChangeSelection = this._e.event;
  private _sel: ContextSelectionLike | undefined;
  getSelection() { return this._sel; }
  set(s: ContextSelectionLike | undefined) { this._sel = s; this._e.fire(undefined); }
}

describe('ContextService.activeResource (Slice A14)', () => {
  it('is undefined when no selection', () => {
    const svc = new ContextService(new WSStub(), new SFStub(), new SelStub());
    expect(svc.getContext().activeResource).toBeUndefined();
  });

  it('is undefined when selection has no resource field', () => {
    const sel = new SelStub();
    sel.set({ kind: 'text' });
    const svc = new ContextService(new WSStub(), new SFStub(), sel);
    expect(svc.getContext().activeResource).toBeUndefined();
  });

  it('extracts a FileResource when selection.resource is one', () => {
    const sel = new SelStub();
    const r = fileResource('/tmp/note.md');
    sel.set({ resource: r });
    const svc = new ContextService(new WSStub(), new SFStub(), sel);
    expect(svc.getContext().activeResource).toBe(r);
  });

  it('extracts an ExternalResource when selection.resource is one', () => {
    const sel = new SelStub();
    const r = externalResource('https://example.com');
    sel.set({ resource: r });
    const svc = new ContextService(new WSStub(), new SFStub(), sel);
    expect(svc.getContext().activeResource).toEqual(r);
  });

  it('updates activeResource on selection change and fires once', () => {
    const sel = new SelStub();
    const svc = new ContextService(new WSStub(), new SFStub(), sel);
    const fired: Array<unknown> = [];
    svc.onDidChangeContext(c => fired.push(c.activeResource));
    const r = fileResource('/a.md');
    sel.set({ resource: r });
    expect(fired).toEqual([r]);
  });

  it('ignores selection.resource that is not a Resource-shape object', () => {
    const sel = new SelStub();
    sel.set({ resource: 'not-a-resource' });
    const svc = new ContextService(new WSStub(), new SFStub(), sel);
    expect(svc.getContext().activeResource).toBeUndefined();
  });

  it('ignores selection.resource missing the type field', () => {
    const sel = new SelStub();
    sel.set({ resource: { path: '/x' } });
    const svc = new ContextService(new WSStub(), new SFStub(), sel);
    expect(svc.getContext().activeResource).toBeUndefined();
  });
});
