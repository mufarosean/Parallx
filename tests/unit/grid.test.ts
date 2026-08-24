/**
 * Unit tests for Grid core algorithms — _distributeSizes, resizeSash,
 * addView/removeView, and serialize/deserialize.
 *
 * Uses jsdom for minimal DOM support required by GridBranchNode/GridLeafNode.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { Grid } from '../../src/layout/grid';
import { Orientation } from '../../src/layout/layoutTypes';
import type { IGridView } from '../../src/layout/gridView';
import { Emitter } from '../../src/platform/events';

// ── Mock IGridView ──────────────────────────────────────────────────────────

function createMockView(
  id: string,
  opts: {
    minW?: number; maxW?: number;
    minH?: number; maxH?: number;
    snap?: boolean;
  } = {},
): IGridView {
  const onDidChangeConstraints = new Emitter<void>();
  return {
    id,
    element: document.createElement('div'),
    minimumWidth: opts.minW ?? 50,
    maximumWidth: opts.maxW ?? Infinity,
    minimumHeight: opts.minH ?? 50,
    maximumHeight: opts.maxH ?? Infinity,
    snap: opts.snap ?? false,
    layout: () => {},
    setVisible: () => {},
    toJSON: () => ({ id }),
    onDidChangeConstraints: onDidChangeConstraints.event,
    dispose: () => onDidChangeConstraints.dispose(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Grid', () => {
  let grid: Grid;

  beforeEach(() => {
    grid = new Grid(Orientation.Horizontal, 1000, 600);
  });

  // ── addView / removeView ──

  describe('addView and removeView', () => {
    it('adds a view and reports correct count', () => {
      grid.addView(createMockView('a'), 500);
      expect(grid.viewCount).toBe(1);
      expect(grid.hasView('a')).toBe(true);
    });

    it('adds multiple views', () => {
      grid.addView(createMockView('a'), 500);
      grid.addView(createMockView('b'), 300);
      grid.addView(createMockView('c'), 200);
      expect(grid.viewCount).toBe(3);
    });

    it('removes a view and returns it', () => {
      const view = createMockView('a');
      grid.addView(view, 500);
      const removed = grid.removeView('a');
      expect(removed).toBe(view);
      expect(grid.viewCount).toBe(0);
      expect(grid.hasView('a')).toBe(false);
    });

    it('returns undefined when removing non-existent view', () => {
      const removed = grid.removeView('nonexistent');
      expect(removed).toBeUndefined();
    });
  });

  // ── Size distribution (tested via layout) ──

  describe('size distribution via layout', () => {
    it('single child receives entire available width', () => {
      const view = createMockView('a', { minW: 100, maxW: Infinity });
      grid.addView(view, 1000);
      grid.layout();
      const size = grid.getViewSize('a');
      expect(size).toBe(1000);
    });

    it('two children share space proportionally after resize', () => {
      grid.addView(createMockView('a', { minW: 100 }), 600);
      grid.addView(createMockView('b', { minW: 100 }), 400);
      grid.layout();

      // Resize grid to 500px (half) — proportions should be maintained
      grid.resize(500, 600);
      const sizeA = grid.getViewSize('a')!;
      const sizeB = grid.getViewSize('b')!;
      expect(sizeA + sizeB).toBe(500);
      // A was 60%, B was 40% — proportions should be approximately maintained
      expect(sizeA).toBeGreaterThanOrEqual(250); // ~300
      expect(sizeB).toBeGreaterThanOrEqual(100);  // ~200
    });

    it('respects minimum size constraints during proportional distribution', () => {
      grid.addView(createMockView('a', { minW: 300 }), 600);
      grid.addView(createMockView('b', { minW: 200 }), 400);
      grid.layout();

      // Shrink to just above the sum of minimums (500)
      grid.resize(510, 600);
      const sizeA = grid.getViewSize('a')!;
      const sizeB = grid.getViewSize('b')!;
      expect(sizeA).toBeGreaterThanOrEqual(300);
      expect(sizeB).toBeGreaterThanOrEqual(200);
      expect(sizeA + sizeB).toBe(510);
    });

    it('respects maximum size constraints', () => {
      grid.addView(createMockView('a', { minW: 50, maxW: 400 }), 400);
      grid.addView(createMockView('b', { minW: 50, maxW: 400 }), 400);
      grid.layout();

      // Expand far beyond maxima
      grid.resize(1200, 600);
      const sizeA = grid.getViewSize('a')!;
      const sizeB = grid.getViewSize('b')!;
      expect(sizeA).toBeLessThanOrEqual(400);
      expect(sizeB).toBeLessThanOrEqual(400);
    });
  });

  // ── resizeSash ──

  describe('resizeSash', () => {
    it('applies delta within constraints', () => {
      grid.addView(createMockView('a', { minW: 100, maxW: 800 }), 500);
      grid.addView(createMockView('b', { minW: 100, maxW: 800 }), 500);
      grid.layout();

      const branch = grid.root;
      const applied = grid.resizeSash(branch, 0, 100);
      expect(applied).toBe(100);

      const sizeA = grid.getViewSize('a')!;
      const sizeB = grid.getViewSize('b')!;
      expect(sizeA).toBe(600);
      expect(sizeB).toBe(400);
    });

    it('clamps when delta would push child below minimum', () => {
      grid.addView(createMockView('a', { minW: 100, maxW: 800 }), 500);
      grid.addView(createMockView('b', { minW: 300, maxW: 800 }), 500);
      grid.layout();

      // Try +300 → B would become 200 but minB=300 → clamped
      const applied = grid.resizeSash(grid.root, 0, 300);
      expect(applied).toBeLessThanOrEqual(200);

      const sizeB = grid.getViewSize('b')!;
      expect(sizeB).toBeGreaterThanOrEqual(300);
    });

    it('returns 0 when both sides are at their limits', () => {
      grid.addView(createMockView('a', { minW: 500, maxW: 500 }), 500);
      grid.addView(createMockView('b', { minW: 500, maxW: 500 }), 500);
      grid.layout();

      const applied = grid.resizeSash(grid.root, 0, 50);
      expect(applied).toBe(0);
    });

    it('preserves zero-sum invariant (total unchanged)', () => {
      grid.addView(createMockView('a', { minW: 100 }), 600);
      grid.addView(createMockView('b', { minW: 100 }), 400);
      grid.layout();

      grid.resizeSash(grid.root, 0, -200);
      const sizeA = grid.getViewSize('a')!;
      const sizeB = grid.getViewSize('b')!;
      expect(sizeA + sizeB).toBe(1000);
    });

    it('returns 0 for invalid sash index', () => {
      grid.addView(createMockView('a'), 500);
      grid.addView(createMockView('b'), 500);
      grid.layout();

      const applied = grid.resizeSash(grid.root, 5, 100);
      expect(applied).toBe(0);
    });
  });

  // ── splitView ──

  describe('splitView', () => {
    it('splits a view in the same orientation', () => {
      grid.addView(createMockView('a'), 1000);
      grid.splitView('a', createMockView('b'), 400, Orientation.Horizontal);

      expect(grid.viewCount).toBe(2);
      expect(grid.hasView('a')).toBe(true);
      expect(grid.hasView('b')).toBe(true);
    });

    it('splits a view in a different orientation (creates wrapper branch)', () => {
      grid.addView(createMockView('a'), 1000);
      grid.splitView('a', createMockView('b'), 300, Orientation.Vertical);

      expect(grid.viewCount).toBe(2);
      expect(grid.hasView('a')).toBe(true);
      expect(grid.hasView('b')).toBe(true);
    });
  });

  // ── serialize / deserialize ──

  describe('serialize and deserialize', () => {
    it('roundtrips a grid with multiple views', () => {
      grid.addView(createMockView('a'), 600);
      grid.addView(createMockView('b'), 400);
      grid.layout();

      const serialized = grid.serialize();
      expect(serialized.orientation).toBe(Orientation.Horizontal);
      expect(serialized.width).toBe(1000);
      expect(serialized.height).toBe(600);

      const restored = Grid.deserialize(serialized, (viewId: string) => createMockView(viewId));
      expect(restored.viewCount).toBe(2);
      expect(restored.hasView('a')).toBe(true);
      expect(restored.hasView('b')).toBe(true);
    });

    it('serializes an empty grid', () => {
      const serialized = grid.serialize();
      expect(serialized.root).toBeDefined();
      expect(serialized.width).toBe(1000);
    });
  });

  // ── Events ──

  describe('events', () => {
    it('fires onDidChange on addView', () => {
      let fired = false;
      grid.onDidChange(() => { fired = true; });
      grid.addView(createMockView('a'), 500);
      expect(fired).toBe(true);
    });

    it('fires onDidChange on resizeSash', () => {
      grid.addView(createMockView('a'), 500);
      grid.addView(createMockView('b'), 500);
      grid.layout();

      let fired = false;
      grid.onDidChange(() => { fired = true; });
      grid.resizeSash(grid.root, 0, 50);
      expect(fired).toBe(true);
    });
  });
});

// ── moveView / moveViewToEdge ────────────────────────────────────────────────
//
// The primitive the whole surface foundation rests on: a view changes position
// in the tree WITHOUT being torn down. removeView disposes, which is exactly
// what a move must not do, so these tests pin the live-instance guarantee
// first and the tree shape second.

describe('moveView', () => {
  let grid: Grid;

  beforeEach(() => {
    grid = new Grid(Orientation.Horizontal, 1000, 600);
  });

  /** A view that records whether anything disposed it. */
  function trackedView(id: string) {
    const view = createMockView(id);
    let disposed = false;
    const inner = view.dispose;
    return {
      view: { ...view, dispose: () => { disposed = true; inner.call(view); } } as IGridView,
      wasDisposed: () => disposed,
    };
  }

  it('keeps the SAME view instance alive across a move', () => {
    // The whole point. A running terminal dragged to another edge must not
    // restart, so the leaf may be detached but never disposed.
    const a = trackedView('a');
    grid.addView(a.view, 400);
    grid.addView(createMockView('b'), 300);
    grid.addView(createMockView('c'), 300);

    grid.moveView('a', 'c', Orientation.Vertical);

    expect(a.wasDisposed()).toBe(false);
    expect(grid.getView('a')).toBe(a.view);
    expect(grid.viewCount).toBe(3);
  });

  it('is a no-op when moving a view onto itself', () => {
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);
    grid.moveView('a', 'a', Orientation.Vertical);
    expect(grid.viewCount).toBe(2);
  });

  it('throws for an unknown view or target', () => {
    grid.addView(createMockView('a'), 500);
    expect(() => grid.moveView('nope', 'a', Orientation.Vertical)).toThrow();
    expect(() => grid.moveView('a', 'nope', Orientation.Vertical)).toThrow();
  });

  it('collapses the branch a move empties', () => {
    // a | (b / c) — moving c away must leave a | b, not a | (b) with a
    // one-child branch still wrapping b.
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);
    grid.splitView('b', createMockView('c'), 250, Orientation.Vertical);

    grid.moveView('c', 'a', Orientation.Horizontal, true);

    const root = grid.serialize().root;
    expect(root.children).toHaveLength(3);
    for (const child of root.children) {
      expect(child.type).toBe('leaf');
    }
  });

  it('survives a move whose source collapse reparents the target', () => {
    // The ordering trap: after detaching, the old parent collapses and the
    // target can end up under a different parent. Resolving the target's
    // parent before the detach would insert into a branch no longer in the
    // tree.
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);
    grid.splitView('b', createMockView('c'), 250, Orientation.Vertical);

    expect(() => grid.moveView('b', 'c', Orientation.Horizontal)).not.toThrow();
    expect(grid.viewCount).toBe(3);
    expect(grid.hasView('b')).toBe(true);
    expect(grid.hasView('c')).toBe(true);
  });

  it('moves across orientation by wrapping the target', () => {
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);
    grid.addView(createMockView('c'), 200);

    grid.moveView('c', 'a', Orientation.Vertical);

    const root = grid.serialize().root;
    // a became a vertical branch holding a and c; b stays a leaf beside it.
    expect(root.children.some((n) => n.type === 'branch')).toBe(true);
    expect(grid.viewCount).toBe(3);
  });

  it('round-trips through serialize with every view intact', () => {
    grid.addView(createMockView('a'), 400);
    grid.addView(createMockView('b'), 300);
    grid.addView(createMockView('c'), 300);
    grid.moveView('a', 'c', Orientation.Vertical);

    const ids: string[] = [];
    const walk = (n: { type: string; children?: unknown[]; viewId?: string }): void => {
      if (n.type === 'leaf') { ids.push(n.viewId as string); return; }
      for (const child of (n.children ?? []) as typeof n[]) walk(child);
    };
    walk(grid.serialize().root as unknown as { type: string });
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('moveViewToEdge', () => {
  let grid: Grid;

  beforeEach(() => {
    grid = new Grid(Orientation.Horizontal, 1000, 600);
  });

  it('does nothing with a single view — there is no edge to move to', () => {
    grid.addView(createMockView('a'), 1000);
    grid.moveViewToEdge('a', Orientation.Vertical);
    expect(grid.viewCount).toBe(1);
  });

  it('appends along the root axis without restructuring', () => {
    grid.addView(createMockView('a'), 400);
    grid.addView(createMockView('b'), 300);
    grid.addView(createMockView('c'), 300);

    grid.moveViewToEdge('a', Orientation.Horizontal);

    const root = grid.serialize().root;
    expect(root.children).toHaveLength(3);
    expect((root.children[root.children.length - 1] as { viewId: string }).viewId).toBe('a');
  });

  it('inserts at the head when insertBefore is set', () => {
    grid.addView(createMockView('a'), 400);
    grid.addView(createMockView('b'), 300);
    grid.addView(createMockView('c'), 300);

    grid.moveViewToEdge('c', Orientation.Horizontal, true);

    const root = grid.serialize().root;
    expect((root.children[0] as { viewId: string }).viewId).toBe('c');
  });

  it('turns the root when the edge runs across it, keeping every view', () => {
    // Dropping on the bottom edge of a horizontally-split layout: the whole
    // existing layout becomes one child of a now-vertical root.
    grid.addView(createMockView('a'), 400);
    grid.addView(createMockView('b'), 300);
    grid.addView(createMockView('c'), 300);

    grid.moveViewToEdge('c', Orientation.Vertical);

    const root = grid.serialize().root;
    expect(root.children).toHaveLength(2);
    expect(root.children.some((n) => n.type === 'branch')).toBe(true);
    expect(grid.viewCount).toBe(3);
    expect(grid.hasView('a')).toBe(true);
    expect(grid.hasView('b')).toBe(true);
    expect(grid.hasView('c')).toBe(true);
  });

  it('keeps the view instance alive across an edge move', () => {
    const a = trackedEdgeView('a');
    grid.addView(a.view, 400);
    grid.addView(createMockView('b'), 600);

    grid.moveViewToEdge('a', Orientation.Vertical);

    expect(a.wasDisposed()).toBe(false);
    expect(grid.getView('a')).toBe(a.view);
  });

  function trackedEdgeView(id: string) {
    const view = createMockView(id);
    let disposed = false;
    const inner = view.dispose;
    return {
      view: { ...view, dispose: () => { disposed = true; inner.call(view); } } as IGridView,
      wasDisposed: () => disposed,
    };
  }
});

describe('moveViewToEdge canonical shapes', () => {
  let grid: Grid;

  beforeEach(() => {
    grid = new Grid(Orientation.Horizontal, 1000, 600);
  });

  it('turns the root for two views without minting a one-child wrapper', () => {
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);

    grid.moveViewToEdge('a', Orientation.Vertical);

    const s = grid.serialize();
    expect(s.orientation).toBe(Orientation.Vertical);
    expect(s.root.children).toHaveLength(2);
    // A flat pair: a one-child branch is not a split, and an edge move must
    // not create the very shape the tree's canonical rule forbids.
    expect(s.root.children.every((n) => n.type === 'leaf')).toBe(true);
  });

  it('hoists a lone branch child instead of nesting same-orientation branches', () => {
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);
    grid.splitView('b', createMockView('c'), 200, Orientation.Vertical);

    // H[a, V[b, c]] — move a to the bottom edge. Detaching a leaves V[b, c]
    // as the root's only child, which is PARALLEL to the turned root.
    grid.moveViewToEdge('a', Orientation.Vertical);

    const s = grid.serialize();
    expect(s.orientation).toBe(Orientation.Vertical);
    expect(s.root.children).toHaveLength(3);
    expect(s.root.children.every((n) => n.type === 'leaf')).toBe(true);
    expect(s.root.children.map((n) => (n as { viewId: string }).viewId))
      .toEqual(['b', 'c', 'a']);
  });

  it('shares the new axis between the moved view and the rest', () => {
    grid.addView(createMockView('a'), 500);
    grid.addView(createMockView('b'), 500);

    grid.moveViewToEdge('a', Orientation.Vertical, false, 200);

    const s = grid.serialize();
    const byId = new Map(s.root.children.map((n) => [(n as { viewId: string }).viewId, n]));
    expect((byId.get('a') as { size: number }).size).toBe(200);
    // The rest takes the remainder of the axis — not the zero share that
    // crushed the whole existing layout to its minimums on the next layout.
    expect((byId.get('b') as { size: number }).size).toBe(400);
  });
});

describe('restoreFrom', () => {
  it('rebuilds a serialized shape in place, keeping the root element', () => {
    const source = new Grid(Orientation.Horizontal, 1000, 600);
    source.addView(createMockView('a'), 500);
    source.addView(createMockView('b'), 500);
    source.splitView('b', createMockView('c'), 200, Orientation.Vertical);
    source.layout();
    const state = source.serialize();

    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    grid.addView(createMockView('x'), 1000);
    const element = grid.element;

    grid.restoreFrom(state, (viewId) => createMockView(viewId));

    // Same DOM node: whoever mounted the grid does not have to re-mount it.
    expect(grid.element).toBe(element);
    // What was there before is out of the tree. Removal detaches, it never
    // disposes — view lifetime is the caller's everywhere in the grid.
    expect(grid.hasView('x')).toBe(false);
    expect(grid.viewCount).toBe(3);
    // Same dimensions in, same tree out — nesting, order and sizes included.
    expect(grid.serialize()).toEqual(state);
  });

  it('restores an empty state to an empty grid', () => {
    const empty = new Grid(Orientation.Horizontal, 1000, 600).serialize();
    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    grid.addView(createMockView('a'), 1000);

    grid.restoreFrom(empty, () => { throw new Error('no views to build'); });

    expect(grid.viewCount).toBe(0);
  });
});

describe('structural changes leave sibling DOM attached', () => {
  it('never detaches a bystander element while its neighbours rearrange', () => {
    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    const a = createMockView('a');
    const b = createMockView('b');
    grid.addView(a, 400);
    grid.addView(b, 300);

    // Record every element detached from here on. A detached iframe or
    // webview reloads, so an untouched sibling must never appear here.
    const detached = new Set<Node>();
    const origRemove = Element.prototype.remove;
    const origRemoveChild = Node.prototype.removeChild;
    Element.prototype.remove = function (this: Element) {
      detached.add(this);
      return origRemove.call(this);
    };
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      detached.add(child);
      return origRemoveChild.call(this, child) as T;
    } as typeof Node.prototype.removeChild;

    try {
      grid.addView(createMockView('c'), 300);
      grid.moveView('c', 'a', Orientation.Vertical);
      grid.removeView('c');
    } finally {
      Element.prototype.remove = origRemove;
      Node.prototype.removeChild = origRemoveChild;
    }

    // b was a bystander throughout the add, the move and the close.
    expect(detached.has(b.element)).toBe(false);
  });
});

describe('resizeWithFixedViews off the flex path', () => {
  it('settles a stack created beside the flex path — no void below it', () => {
    // The regression from the field: stack a part over the sidebar (a
    // cross-axis move leaves provisional half-of-WIDTH sizes as the stack's
    // HEIGHTS), then settle with fixed views. Only the flex path used to be
    // reconciled, so the stack rendered two ~100px parts in a full-height
    // column with a black void underneath.
    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    grid.addView(createMockView('side'), 200);
    grid.addView(createMockView('ed'), 800);
    grid.addView(createMockView('chat'), 100);
    grid.moveView('chat', 'side', Orientation.Vertical, true);

    grid.resizeWithFixedViews(1000, 600, 'ed');

    expect(grid.getViewSize('chat')! + grid.getViewSize('side')!).toBe(600);
    expect(grid.getViewSize('ed')).toBe(800);
  });

  it('settles deep stacks recursively', () => {
    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    grid.addView(createMockView('side'), 200);
    grid.addView(createMockView('ed'), 800);
    grid.addView(createMockView('a'), 100);
    grid.moveView('a', 'side', Orientation.Vertical, true);
    grid.addView(createMockView('b'), 100);
    grid.moveView('b', 'a', Orientation.Horizontal, false);

    grid.resizeWithFixedViews(1000, 600, 'ed');

    // The inner horizontal pair fills the stack's width...
    expect(grid.getViewSize('a')! + grid.getViewSize('b')!).toBe(200);
    // ...and the vertical stack fills the body height.
    expect(grid.getViewSize('side')).toBeGreaterThan(0);
  });
});

describe('edgeTouches', () => {
  it('reports which window edges a nested cell touches', () => {
    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    grid.addView(createMockView('side'), 200);
    grid.addView(createMockView('ed'), 800);
    grid.addView(createMockView('chat'), 100);
    grid.moveView('chat', 'side', Orientation.Vertical, true);
    // H[ V[chat, side], ed ]

    expect(grid.edgeTouches('chat')).toEqual({ top: true, right: false, bottom: false, left: true });
    expect(grid.edgeTouches('side')).toEqual({ top: false, right: false, bottom: true, left: true });
    expect(grid.edgeTouches('ed')).toEqual({ top: true, right: true, bottom: true, left: false });
    expect(grid.edgeTouches('nope')).toBeUndefined();
  });
});

describe('named keep-alive regions', () => {
  function gridWithRegion(): { grid: Grid; serialize: () => ReturnType<Grid['serialize']> } {
    const grid = new Grid(Orientation.Horizontal, 1000, 600);
    grid.addView(createMockView('side'), 200);
    grid.restoreFrom({
      orientation: Orientation.Horizontal, width: 1000, height: 600,
      root: {
        type: 'branch', orientation: Orientation.Horizontal, size: 0, sizingMode: 'pixel',
        children: [
          { type: 'leaf', viewId: 'side', size: 200, sizingMode: 'pixel' },
          {
            type: 'branch', orientation: Orientation.Horizontal, size: 800, sizingMode: 'pixel',
            regionId: 'region.editor', keepAlive: true,
            children: [
              { type: 'leaf', viewId: 'g1', size: 400, sizingMode: 'pixel' },
              { type: 'leaf', viewId: 'g2', size: 400, sizingMode: 'pixel' },
            ],
          },
        ],
      },
    } as never, (id) => createMockView(id));
    return { grid, serialize: () => grid.serialize() };
  }

  const regionOf = (s: ReturnType<Grid['serialize']>) =>
    s.root.children.find((c) => c.type === 'branch') as
      | { regionId?: string; keepAlive?: boolean; children: unknown[] }
      | undefined;

  it('round-trips region identity through serialize and restore', () => {
    const { serialize } = gridWithRegion();
    const region = regionOf(serialize());
    expect(region?.regionId).toBe('region.editor');
    expect(region?.keepAlive).toBe(true);
  });

  it('survives shrinking to ONE child — a place is not a split', () => {
    const { grid, serialize } = gridWithRegion();
    grid.removeView('g2');
    const region = regionOf(serialize());
    expect(region?.regionId).toBe('region.editor');
    expect(region?.children).toHaveLength(1);
  });

  it('survives EMPTY, and takes new views by name', () => {
    const { grid, serialize } = gridWithRegion();
    grid.removeView('g1');
    grid.removeView('g2');
    let region = regionOf(serialize());
    expect(region?.regionId).toBe('region.editor');
    expect(region?.children).toHaveLength(0);

    expect(grid.addViewToRegion('region.editor', createMockView('g3'), 400)).toBe(true);
    region = regionOf(serialize());
    expect(region?.children).toHaveLength(1);
  });

  it('flexes BY REGION on resizeWithFixedViews, normalizing its interior', () => {
    const { grid } = gridWithRegion();
    grid.resizeWithFixedViews(1200, 600, 'region.editor');
    // The side strip kept its width; the region absorbed the growth…
    expect(grid.getViewSize('side')).toBe(200);
    // …and its interior fills the region exactly.
    expect(grid.getViewSize('g1')! + grid.getViewSize('g2')!).toBe(1000);
  });

  it('splits beside a region as a whole', () => {
    const { grid, serialize } = gridWithRegion();
    expect(grid.splitBesideRegion('region.editor', createMockView('panel'), 200, Orientation.Vertical)).toBe(true);
    // The region wrapped with the panel below it, groups untouched.
    const s = serialize();
    const wrapper = s.root.children[1] as { type: string; orientation: string; children: { regionId?: string; viewId?: string }[] };
    expect(wrapper.orientation).toBe(Orientation.Vertical);
    expect(wrapper.children[0].regionId).toBe('region.editor');
    expect(wrapper.children[1].viewId).toBe('panel');
  });

  it('reports edge touches for a region by name', () => {
    const { grid } = gridWithRegion();
    expect(grid.edgeTouches('region.editor')).toEqual({
      top: true, right: true, bottom: true, left: false,
    });
  });

  it('is not hoisted when a root turn leaves it the lone child', () => {
    const { grid, serialize } = gridWithRegion();
    grid.moveViewToEdge('side', Orientation.Vertical, false);
    const s = serialize();
    // V root: [ region (whole), side ] — the region kept its identity and
    // its children instead of being dissolved into the turned root.
    expect(s.orientation).toBe(Orientation.Vertical);
    const region = regionOf(s);
    expect(region?.regionId).toBe('region.editor');
    expect(region?.children).toHaveLength(2);
  });
});
