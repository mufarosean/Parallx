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
