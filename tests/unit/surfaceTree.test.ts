/**
 * Foundation step 3 — the workspace tree.
 *
 * One grid, one kind of citizen, positions instead of classes. These tests
 * exercise the replacement layout model in isolation: it is NOT yet mounted in
 * the workbench, which still runs on the seven singleton Parts.
 *
 * The properties that matter here are the ones a visual check would not catch:
 * a move preserves the live instance, closing disposes exactly once through
 * one path, and an arrangement round-trips through capture and restore.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { SurfaceTree } from '../../src/surfaces/surfaceTree';
import { SurfaceRegistry } from '../../src/surfaces/surfaceRegistry';
import { resolveArrangement } from '../../src/surfaces/arrangement';
import {
  SurfacePlacement,
  type ISurface,
  type ISurfaceBinding,
  type ISurfaceDescriptor,
  type SurfaceState,
} from '../../src/surfaces/surfaceTypes';
import { Emitter } from '../../src/platform/events';
import { Orientation, DEFAULT_SIZE_CONSTRAINTS } from '../../src/layout/layoutTypes';

class TestSurface implements ISurface {
  binding: ISurfaceBinding | undefined;
  element: HTMLElement | undefined;
  minimumWidth = 80; maximumWidth = Infinity;
  minimumHeight = 80; maximumHeight = Infinity;
  disposed = false;
  disposeCount = 0;
  restored: SurfaceState | undefined;
  private _state: SurfaceState = {};

  private readonly _t = new Emitter<void>();
  readonly onDidChangeTitle = this._t.event;
  private readonly _c = new Emitter<void>();
  readonly onDidChangeConstraints = this._c.event;
  private readonly _v = new Emitter<boolean>();
  readonly onDidChangeVisibility = this._v.event;

  constructor(readonly id: string, readonly typeId: string) {}
  get title(): string { return this.binding?.label ?? this.typeId; }
  create(c: HTMLElement): void { this.element = document.createElement('div'); c.appendChild(this.element); }
  async setBinding(b: ISurfaceBinding | undefined): Promise<void> { this.binding = b; }
  layout(): void {}
  setVisible(v: boolean): void { this._v.fire(v); }
  focus(): void {}
  saveState(): SurfaceState { return this._state; }
  restoreState(s: SurfaceState): void { this.restored = s; this._state = s; }
  setState(s: SurfaceState): void { this._state = s; }
  dispose(): void {
    this.disposed = true; this.disposeCount++;
    this._t.dispose(); this._c.dispose(); this._v.dispose();
  }
}

function descriptor(typeId: string, placement = SurfacePlacement.Center): ISurfaceDescriptor {
  return {
    typeId, name: typeId, placement,
    constraints: DEFAULT_SIZE_CONSTRAINTS,
    bindingKinds: ['file'],
    create: (instanceId) => new TestSurface(instanceId, typeId),
  };
}

const file = (p: string): ISurfaceBinding => ({ kind: 'file', key: p, label: p });

describe('SurfaceTree', () => {
  let registry: SurfaceRegistry;
  let tree: SurfaceTree;

  beforeEach(() => {
    registry = new SurfaceRegistry();
    registry.register(descriptor('editor.text'));
    registry.register(descriptor('explorer', SurfacePlacement.Side));
    registry.register(descriptor('terminal', SurfacePlacement.Bottom));
    tree = new SurfaceTree(registry, Orientation.Horizontal, 1200, 800);
  });

  // ── Opening ──

  it('opens a surface and makes it active', () => {
    const s = tree.open('editor.text', file('/a.md'));
    expect(tree.surfaceCount).toBe(1);
    expect(tree.activeSurfaceId).toBe(s.id);
  });

  it('focuses an already-open binding instead of opening a second copy', () => {
    const a = tree.open('editor.text', file('/a.md'));
    const b = tree.open('editor.text', file('/a.md'));
    expect(b).toBe(a);
    expect(tree.surfaceCount).toBe(1);
  });

  it('opens a genuine second view on forceNew', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('editor.text', file('/a.md'), { forceNew: true });
    expect(tree.surfaceCount).toBe(2);
  });

  it('places every placement kind without special-casing any of them', () => {
    // Side, Bottom and Center are POSITIONS, not classes. If any of these
    // needed the tree to know what a surface is, Decision 2 has broken.
    tree.open('editor.text', file('/a.md'));
    tree.open('explorer');
    tree.open('terminal');
    expect(tree.surfaceCount).toBe(3);
    expect(tree.grid.viewCount).toBe(3);
  });

  it('respects an explicit placement override', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('editor.text', file('/b.md'), { placement: SurfacePlacement.Bottom });
    expect(tree.surfaceCount).toBe(2);
  });

  it('can open without stealing focus', () => {
    const a = tree.open('editor.text', file('/a.md'));
    tree.open('editor.text', file('/b.md'), { preserveFocus: true });
    expect(tree.activeSurfaceId).toBe(a.id);
  });

  // ── Moving ──

  it('keeps the live instance across a move', () => {
    // The guarantee the whole foundation rests on: a running surface dragged
    // elsewhere does not restart.
    const a = tree.open('editor.text', file('/a.md')) as TestSurface;
    const b = tree.open('editor.text', file('/b.md'));
    tree.move(a.id, b.id, Orientation.Vertical);
    expect(a.disposed).toBe(false);
    expect(tree.getSurface(a.id)).toBe(a);
    expect(tree.surfaceCount).toBe(2);
  });

  it('moves a surface to any edge without knowing what it is', () => {
    const a = tree.open('editor.text', file('/a.md')) as TestSurface;
    tree.open('editor.text', file('/b.md'));
    for (const [o, before] of [
      [Orientation.Horizontal, true], [Orientation.Horizontal, false],
      [Orientation.Vertical, true], [Orientation.Vertical, false],
    ] as const) {
      tree.moveToEdge(a.id, o, before);
      expect(a.disposed).toBe(false);
      expect(tree.surfaceCount).toBe(2);
    }
  });

  it('ignores a move of an unknown surface', () => {
    const a = tree.open('editor.text', file('/a.md'));
    expect(() => tree.move('nope', a.id, Orientation.Vertical)).not.toThrow();
    expect(() => tree.moveToEdge('nope', Orientation.Vertical)).not.toThrow();
  });

  // ── Closing ──

  it('disposes exactly once when closed', () => {
    // Close routes through the registry so that closing here and an extension
    // unloading run the SAME path and cannot drift into a double dispose.
    const a = tree.open('editor.text', file('/a.md')) as TestSurface;
    tree.close(a.id);
    expect(a.disposeCount).toBe(1);
    expect(tree.surfaceCount).toBe(0);
    expect(tree.grid.viewCount).toBe(0);
  });

  it('leaves the tree when the registry disposes a surface from elsewhere', () => {
    const a = tree.open('editor.text', file('/a.md'));
    registry.disposeInstance(a.id);
    expect(tree.surfaceCount).toBe(0);
  });

  it('hands active status to a survivor when the active one closes', () => {
    const a = tree.open('editor.text', file('/a.md'));
    const b = tree.open('editor.text', file('/b.md'));
    tree.setActive(a.id);
    tree.close(a.id);
    expect(tree.activeSurfaceId).toBe(b.id);
  });

  it('clears active status when the last surface closes', () => {
    const a = tree.open('editor.text', file('/a.md'));
    tree.close(a.id);
    expect(tree.activeSurfaceId).toBeUndefined();
  });

  // ── Arrangements ──

  it('captures and restores a layout with its bindings', () => {
    const a = tree.open('editor.text', file('/taylor.pdf')) as TestSurface;
    a.setState({ page: 12 });
    tree.open('explorer');

    const arrangement = tree.capture({ id: 'study', name: 'Study' });
    expect(arrangement.name).toBe('Study');

    const resolved = resolveArrangement(arrangement, (t) => registry.getDescriptor(t));
    expect(resolved.unavailable).toHaveLength(0);

    const { opened, skipped } = tree.restore(resolved);
    expect(opened).toBe(2);
    expect(skipped).toBe(0);
    expect(tree.surfaceCount).toBe(2);

    const restoredEditor = tree.surfaces.find((s) => s.typeId === 'editor.text') as TestSurface;
    expect(restoredEditor.binding?.key).toBe('/taylor.pdf');
    expect(restoredEditor.restored).toEqual({ page: 12 });
  });

  it('closes everything already open before restoring', () => {
    // An arrangement is a WHOLE shape of the app. Merging one into another
    // produces a layout neither the user nor the arrangement asked for.
    tree.open('editor.text', file('/old.md'));
    const arrangement = tree.capture({ id: 'x', name: 'X' });
    tree.open('editor.text', file('/also-old.md'));
    expect(tree.surfaceCount).toBe(2);

    tree.restore(resolveArrangement(arrangement, (t) => registry.getDescriptor(t)));
    expect(tree.surfaceCount).toBe(1);
    expect(tree.surfaces[0].binding?.key).toBe('/old.md');
  });

  it('restores what it can when a type is missing, and reports the rest', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('explorer');
    const arrangement = tree.capture({ id: 'x', name: 'X' });

    // The explorer's extension is gone.
    const resolved = resolveArrangement(
      arrangement,
      (t) => (t === 'explorer' ? undefined : registry.getDescriptor(t)),
    );
    expect(resolved.unavailable).toHaveLength(1);

    const { opened, skipped } = tree.restore(resolved);
    expect(opened).toBe(1);
    expect(skipped).toBe(1);
    expect(tree.surfaceCount).toBe(1);
  });

  it('survives a restore of an empty arrangement', () => {
    tree.open('editor.text', file('/a.md'));
    const empty = tree.capture({ id: 'e', name: 'E' });
    tree.close(tree.surfaces[0].id);
    const emptyArrangement = tree.capture({ id: 'e2', name: 'E2' });

    expect(() => tree.restore(resolveArrangement(emptyArrangement, (t) => registry.getDescriptor(t))))
      .not.toThrow();
    expect(tree.surfaceCount).toBe(0);
    expect(empty.root.children).toHaveLength(1);
  });

  it('round-trips a capture → restore → capture unchanged in shape', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('editor.text', file('/b.md'));
    tree.open('terminal');

    const first = tree.capture({ id: 'x', name: 'X' });
    tree.restore(resolveArrangement(first, (t) => registry.getDescriptor(t)));
    const second = tree.capture({ id: 'x', name: 'X' });

    const bindings = (a: typeof first): string[] => {
      const out: string[] = [];
      const walk = (n: { type: string; children?: unknown[]; typeId?: string }): void => {
        if (n.type === 'leaf') { out.push(n.typeId as string); return; }
        for (const c of (n.children ?? []) as typeof n[]) walk(c);
      };
      walk(a.root);
      return out.sort();
    };
    expect(bindings(second)).toEqual(bindings(first));
  });

  // ── Teardown ──

  it('disposes cleanly with surfaces still open', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('explorer');
    expect(() => tree.dispose()).not.toThrow();
  });
});
