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
import { resolveArrangement, type Arrangement } from '../../src/surfaces/arrangement';
import { SizingMode } from '../../src/layout/layoutTypes';
import type { SerializedBranchNode } from '../../src/layout/layoutModel';
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

/** Loose view of a captured arrangement node, for walking in asserts. */
type SerializedArrangementNode = {
  type: string;
  typeId?: string;
  orientation?: Orientation;
  binding?: { key?: string };
  state?: Record<string, unknown>;
  children?: SerializedArrangementNode[];
};

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

  it('captures and restores a layout with its bindings', async () => {
    const a = tree.open('editor.text', file('/taylor.pdf')) as TestSurface;
    a.setState({ page: 12 });
    tree.open('explorer');

    const arrangement = tree.capture({ id: 'study', name: 'Study' });
    expect(arrangement.name).toBe('Study');

    const resolved = resolveArrangement(arrangement, (t) => registry.getDescriptor(t));
    expect(resolved.unavailable).toHaveLength(0);

    const { opened, placeholders } = tree.restore(resolved);
    expect(opened).toBe(2);
    expect(placeholders).toBe(0);
    expect(tree.surfaceCount).toBe(2);

    // State is applied after the binding resolves, not before — a scroll
    // position applied to a not-yet-loaded document would be clobbered by
    // the load. Give the microtask chain a turn.
    await Promise.resolve();
    await Promise.resolve();

    const restoredEditor = tree.surfaces.find((s) => s.typeId === 'editor.text') as TestSurface;
    expect(restoredEditor.binding?.key).toBe('/taylor.pdf');
    expect(restoredEditor.restored).toEqual({ page: 12 });
  });

  it('restores nesting and sizes exactly as captured', () => {
    const mkLeaf = (key: string, size: number) => ({
      type: 'leaf' as const, size, sizingMode: SizingMode.Pixel,
      typeId: 'editor.text', binding: file(key),
    });
    const arrangement: Arrangement = {
      version: 1, id: 'nested', name: 'Nested',
      rootOrientation: Orientation.Horizontal,
      root: {
        type: 'branch', orientation: Orientation.Horizontal, size: 0, sizingMode: SizingMode.Pixel,
        children: [
          {
            type: 'branch', orientation: Orientation.Vertical, size: 700, sizingMode: SizingMode.Pixel,
            children: [mkLeaf('/a.md', 500), mkLeaf('/b.md', 300)],
          },
          {
            type: 'branch', orientation: Orientation.Vertical, size: 500, sizingMode: SizingMode.Pixel,
            children: [mkLeaf('/c.md', 400), mkLeaf('/d.md', 400)],
          },
        ],
      },
    };

    const { opened, placeholders } = tree.restore(
      resolveArrangement(arrangement, (t) => registry.getDescriptor(t)),
    );
    expect(opened).toBe(4);
    expect(placeholders).toBe(0);

    // H[ V[a,b], V[c,d] ] — the shape, not a flattened stack of four. The
    // single-anchor rebuild this replaces produced exactly that flattening,
    // and the old round-trip test compared sorted typeIds so it never saw.
    const s = tree.grid.serialize();
    expect(s.root.children).toHaveLength(2);
    const [left, right] = s.root.children as [SerializedBranchNode, SerializedBranchNode];
    expect(left.type).toBe('branch');
    expect(right.type).toBe('branch');
    expect(left.orientation).toBe(Orientation.Vertical);
    expect(right.orientation).toBe(Orientation.Vertical);
    expect(left.size).toBe(700);
    expect(right.size).toBe(500);

    const keys = (b: SerializedBranchNode): (string | undefined)[] =>
      b.children.map((c) => tree.getSurface((c as { viewId: string }).viewId)?.binding?.key);
    expect(keys(left)).toEqual(['/a.md', '/b.md']);
    expect(keys(right)).toEqual(['/c.md', '/d.md']);
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

  it('keeps a missing type as a named placeholder pane instead of a hole', () => {
    const ex = tree.open('explorer') as TestSurface;
    ex.setState({ scroll: 40 });
    tree.open('editor.text', file('/a.md'));
    const arrangement = tree.capture({ id: 'x', name: 'X' });

    // The explorer's extension is gone.
    const resolved = resolveArrangement(
      arrangement,
      (t) => (t === 'explorer' ? undefined : registry.getDescriptor(t)),
    );
    expect(resolved.unavailable).toHaveLength(1);

    const { opened, placeholders } = tree.restore(resolved);
    expect(opened).toBe(1);
    expect(placeholders).toBe(1);
    // The SHAPE survives: both panes are in the tree, one of them standing
    // in. A layout with a hole where the explorer was is not the layout the
    // user saved.
    expect(tree.surfaceCount).toBe(2);
    expect(tree.grid.viewCount).toBe(2);

    // The placeholder answers for what is missing, and focus went to the
    // real surface rather than the apology.
    const ph = tree.surfaces.find((s) => s.typeId === 'explorer');
    expect(ph?.title).toBe('explorer');
    const real = tree.surfaces.find((s) => s.typeId === 'editor.text');
    expect(tree.activeSurfaceId).toBe(real?.id);

    // Saving again loses nothing: the missing type is stored as itself, with
    // the state it went missing with.
    const again = tree.capture({ id: 'x2', name: 'X2' });
    const leaves: { typeId: string; state?: Record<string, unknown> }[] = [];
    const walk = (n: SerializedArrangementNode): void => {
      if (n.type === 'leaf') {
        leaves.push({ typeId: n.typeId as string, ...(n.state ? { state: n.state } : {}) });
        return;
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(again.root as SerializedArrangementNode);
    expect(leaves.map((l) => l.typeId).sort()).toEqual(['editor.text', 'explorer']);
    expect(leaves.find((l) => l.typeId === 'explorer')?.state).toEqual({ scroll: 40 });
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

    // Deep equality of nesting, order and bindings. Comparing a sorted
    // multiset of typeIds here once let a restore that flattened the whole
    // tree pass — the shape IS the property.
    const strip = (n: SerializedArrangementNode): unknown => n.type === 'leaf'
      ? { t: n.typeId, b: n.binding?.key }
      : { o: n.orientation, c: (n.children ?? []).map(strip) };
    expect(strip(second.root as SerializedArrangementNode))
      .toEqual(strip(first.root as SerializedArrangementNode));
  });

  // ── Teardown ──

  it('disposes cleanly with surfaces still open', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('explorer');
    expect(() => tree.dispose()).not.toThrow();
  });
});
