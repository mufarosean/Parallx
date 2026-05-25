// editorSurfaceBinding.tier0.test.ts — Slice B1
//
// Proves the new bind between IEditorService and ISurfaceRegistry that
// makes ISurfaceRegistry the first product-side writer for the §86
// platform primitives. The binding is the first real consumer of the
// register / update / unregister / setActive lifecycle that A1..A79 spent
// 80 iterations defining.

import { describe, it, expect, beforeEach } from 'vitest';
import { Emitter } from '../../../src/platform/events.js';
import { SurfaceRegistry } from '../../../src/workbench/resources/surfaceRegistry.js';
import { bindEditorToSurfaceRegistry } from '../../../src/workbench/resources/editorSurfaceBinding.js';
import { URI } from '../../../src/platform/uri.js';

interface FakeInput {
  id: string;
  name: string;
  uri?: URI;
}

class FakeEditorService {
  readonly _onDidActiveEditorChange = new Emitter<FakeInput | undefined>();
  readonly _onDidChangeOpenEditors = new Emitter<void>();
  readonly onDidActiveEditorChange = this._onDidActiveEditorChange.event;
  readonly onDidChangeOpenEditors = this._onDidChangeOpenEditors.event;

  activeEditor: FakeInput | undefined = undefined;
  open: FakeInput[] = [];

  getOpenEditors(): Array<{ id: string }> {
    return this.open.map(e => ({ id: e.id }));
  }

  setOpen(open: FakeInput[], active: FakeInput | undefined) {
    this.open = open;
    this.activeEditor = active;
    this._onDidChangeOpenEditors.fire();
    this._onDidActiveEditorChange.fire(active);
  }
  // Unused IDisposable / IEditorService members are not referenced by the
  // binding; cast through `unknown` at the call site.
  dispose() { /* noop */ }
}

class FakeWorkspaceService {
  activeWorkspace: { identity: { id: string } } | undefined = { identity: { id: 'ws-1' } };
  dispose() { /* noop */ }
}

function makeBinding(reg: SurfaceRegistry, svc: FakeEditorService, ws: FakeWorkspaceService) {
  return bindEditorToSurfaceRegistry(
    svc as unknown as Parameters<typeof bindEditorToSurfaceRegistry>[0],
    ws as unknown as Parameters<typeof bindEditorToSurfaceRegistry>[1],
    reg,
  );
}

describe('editorSurfaceBinding (Slice B1)', () => {
  let reg: SurfaceRegistry;
  let svc: FakeEditorService;
  let ws: FakeWorkspaceService;

  beforeEach(() => {
    reg = new SurfaceRegistry();
    svc = new FakeEditorService();
    ws = new FakeWorkspaceService();
  });

  it('empty editor state → empty registry, no active surface', () => {
    const b = makeBinding(reg, svc, ws);
    expect(reg.size).toBe(0);
    expect(reg.getActive()).toBeUndefined();
    expect(b.registeredIds).toEqual([]);
    b.dispose();
  });

  it('opening a file-backed editor registers an editor surface and makes it active', () => {
    const b = makeBinding(reg, svc, ws);
    const a: FakeInput = { id: 'a', name: 'a.ts', uri: URI.file('/repo/a.ts') };
    svc.setOpen([a], a);

    expect(reg.size).toBe(1);
    expect(reg.has('editor:a')).toBe(true);
    expect(reg.activeKind()).toBe('editor');
    const active = reg.getActive();
    expect(active?.kind).toBe('editor');
    expect(active?.displayName).toBe('a.ts');
    expect(active?.resource).toEqual({ type: 'file', path: '/repo/a.ts', hash: undefined, workspaceId: 'ws-1' });
    expect(reg.activeWorkspaceId()).toBe('ws-1');
    b.dispose();
  });

  it('opening a non-file input registers a surface with no resource', () => {
    const b = makeBinding(reg, svc, ws);
    const settings: FakeInput = { id: 'settings', name: 'Settings' };
    svc.setOpen([settings], settings);

    expect(reg.has('editor:settings')).toBe(true);
    expect(reg.activeKind()).toBe('editor');
    expect(reg.activeResource()).toBeUndefined();
    expect(reg.activeWorkspaceId()).toBeUndefined();
    b.dispose();
  });

  it('switching active editor registers + activates the new one (lazy registration)', () => {
    const b = makeBinding(reg, svc, ws);
    const a: FakeInput = { id: 'a', name: 'a.ts', uri: URI.file('/repo/a.ts') };
    const c: FakeInput = { id: 'c', name: 'c.ts', uri: URI.file('/repo/c.ts') };
    svc.setOpen([a, c], a);
    expect(reg.getActiveId()).toBe('editor:a');
    expect(reg.size).toBe(1); // only the active editor is registered
    svc.setOpen([a, c], c);
    expect(reg.size).toBe(2);
    expect(reg.getActiveId()).toBe('editor:c');
    b.dispose();
  });

  it('closing the active editor unregisters its surface and clears active', () => {
    const b = makeBinding(reg, svc, ws);
    const a: FakeInput = { id: 'a', name: 'a.ts', uri: URI.file('/repo/a.ts') };
    const c: FakeInput = { id: 'c', name: 'c.ts', uri: URI.file('/repo/c.ts') };
    svc.setOpen([a, c], a);
    svc.setOpen([a, c], c); // both now registered
    expect(reg.size).toBe(2);
    svc.setOpen([a], a); // c closes
    expect(reg.has('editor:c')).toBe(false);
    expect(reg.size).toBe(1);
    expect(reg.getActiveId()).toBe('editor:a');
    svc.setOpen([], undefined);
    expect(reg.size).toBe(0);
    expect(reg.getActive()).toBeUndefined();
    b.dispose();
  });

  it('renaming the active editor flows through update (no register/unregister churn)', () => {
    const b = makeBinding(reg, svc, ws);
    const a: FakeInput = { id: 'a', name: 'a.ts', uri: URI.file('/repo/a.ts') };
    svc.setOpen([a], a);
    const events: string[] = [];
    reg.onDidChangeSurface(e => { events.push(e.kind); });
    // simulate a label change: same id, new name
    const renamed: FakeInput = { id: 'a', name: 'renamed.ts', uri: URI.file('/repo/renamed.ts') };
    svc.setOpen([renamed], renamed);
    expect(events).toContain('updated');
    expect(events).not.toContain('registered');
    expect(events).not.toContain('unregistered');
    expect(reg.getActive()?.displayName).toBe('renamed.ts');
    b.dispose();
  });

  it('dispose unregisters every editor surface owned by the binding', () => {
    const b = makeBinding(reg, svc, ws);
    const a: FakeInput = { id: 'a', name: 'a.ts', uri: URI.file('/repo/a.ts') };
    const c: FakeInput = { id: 'c', name: 'c.ts', uri: URI.file('/repo/c.ts') };
    svc.setOpen([a, c], a);
    svc.setOpen([a, c], c);
    expect(reg.size).toBe(2);
    b.dispose();
    expect(reg.size).toBe(0);
    expect(reg.getActive()).toBeUndefined();
  });

  it('reads workspaceId fresh on every active change (workspace switch is observable in resource)', () => {
    const b = makeBinding(reg, svc, ws);
    const a: FakeInput = { id: 'a', name: 'a.ts', uri: URI.file('/repo/a.ts') };
    svc.setOpen([a], a);
    expect(reg.activeWorkspaceId()).toBe('ws-1');
    ws.activeWorkspace = { identity: { id: 'ws-2' } };
    // simulate active-editor re-fire after workspace switch (workbench will
    // typically reload editors; we just exercise the read path here)
    svc.setOpen([a], a);
    expect(reg.activeWorkspaceId()).toBe('ws-2');
    b.dispose();
  });
});
