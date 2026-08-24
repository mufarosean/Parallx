/**
 * Parts move by hand — the drag interaction system.
 *
 * The zone math is pinned as pure functions (the FEEL of the zones must not
 * be rediscovered by accident), and the controller is exercised through real
 * DOM events, including the failure mode this codebase has already been
 * bitten by once: a drag whose source element is unmounted by its own drop
 * never receives dragend, so document-level capture listeners must tear the
 * overlay down.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  PART_DRAG_TYPE,
  EDGE_ZONE_PX,
  computeDropZone,
  indicatorRect,
  PartDragController,
  type PartDropZone,
} from '../../src/workbench/partDrag';
import { Orientation } from '../../src/layout/layoutTypes';

const GRID = { left: 0, top: 0, width: 1000, height: 800 };

// ── Zone math ───────────────────────────────────────────────────────────────

describe('computeDropZone', () => {
  const target = { id: 'p', rect: { left: 200, top: 0, width: 800, height: 800 } };

  it('gives the window edges priority inside their threshold', () => {
    expect(computeDropZone(GRID, 5, 400, target)).toEqual(
      { kind: 'edge', orientation: Orientation.Horizontal, before: true });
    expect(computeDropZone(GRID, 995, 400, target)).toEqual(
      { kind: 'edge', orientation: Orientation.Horizontal, before: false });
    expect(computeDropZone(GRID, 500, 10, target)).toEqual(
      { kind: 'edge', orientation: Orientation.Vertical, before: true });
    expect(computeDropZone(GRID, 500, 795, target)).toEqual(
      { kind: 'edge', orientation: Orientation.Vertical, before: false });
  });

  it('splits a target by its nearest side — left, right, top, bottom', () => {
    const at = (x: number, y: number): PartDropZone | undefined =>
      computeDropZone(GRID, x, y, target);
    expect(at(250, 400)).toEqual(
      { kind: 'beside', targetId: 'p', orientation: Orientation.Horizontal, before: true });
    expect(at(950, 400)).toEqual(
      { kind: 'beside', targetId: 'p', orientation: Orientation.Horizontal, before: false });
    expect(at(600, 100)).toEqual(
      { kind: 'beside', targetId: 'p', orientation: Orientation.Vertical, before: true });
    expect(at(600, 700)).toEqual(
      { kind: 'beside', targetId: 'p', orientation: Orientation.Vertical, before: false });
  });

  it('has no dead centre — the middle still resolves to a side', () => {
    // A centre with no meaning would read as "the drag stopped working"
    // exactly where the user is most likely to hover.
    const centre = computeDropZone(GRID, 600, 400, target);
    expect(centre).toBeDefined();
    expect(centre!.kind).toBe('beside');
  });

  it('offers only edges when there is no target under the cursor', () => {
    expect(computeDropZone(GRID, 500, 400, undefined)).toBeUndefined();
    expect(computeDropZone(GRID, EDGE_ZONE_PX - 1, 400, undefined)).toEqual(
      { kind: 'edge', orientation: Orientation.Horizontal, before: true });
  });
});

describe('indicatorRect', () => {
  it('fills the half of the target the drop would take', () => {
    const rect = indicatorRect(
      { kind: 'beside', targetId: 'p', orientation: Orientation.Vertical, before: false },
      GRID,
      { left: 200, top: 0, width: 800, height: 800 },
    );
    expect(rect).toEqual({ left: 200, top: 400, width: 800, height: 400 });
  });

  it('draws an edge strip along the full cross axis', () => {
    const rect = indicatorRect(
      { kind: 'edge', orientation: Orientation.Horizontal, before: true },
      GRID,
      undefined,
    );
    expect(rect.left).toBe(0);
    expect(rect.height).toBe(GRID.height);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.width).toBeLessThan(GRID.width / 2);
  });
});

// ── Controller ──────────────────────────────────────────────────────────────

function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    types: [] as unknown as readonly string[],
    dropEffect: '',
    effectAllowed: '',
    setData(type: string, value: string) {
      store.set(type, value);
      (this.types as string[]).length = 0;
      (this.types as string[]).push(...store.keys());
    },
    getData(type: string) { return store.get(type) ?? ''; },
  } as unknown as DataTransfer;
}

function dragEvent(type: string, dt: DataTransfer, x = 0, y = 0): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { configurable: true, value: dt });
  Object.defineProperty(ev, 'clientX', { configurable: true, value: x });
  Object.defineProperty(ev, 'clientY', { configurable: true, value: y });
  return ev;
}

const rectOf = (r: typeof GRID): DOMRect => ({
  ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
  toJSON: () => ({}),
}) as DOMRect;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe('PartDragController', () => {
  let grid: HTMLElement;
  let sidebar: HTMLElement;
  let editor: HTMLElement;
  let handle: HTMLElement;
  let controller: PartDragController;
  let moves: string[];

  beforeEach(() => {
    grid = document.createElement('div');
    grid.getBoundingClientRect = () => rectOf(GRID);

    sidebar = document.createElement('div');
    sidebar.setAttribute('data-part-id', 'workbench.parts.sidebar');
    sidebar.getBoundingClientRect = () => rectOf({ left: 0, top: 0, width: 200, height: 800 });
    handle = document.createElement('div');
    sidebar.appendChild(handle);

    editor = document.createElement('div');
    editor.setAttribute('data-part-id', 'workbench.parts.editor');
    editor.getBoundingClientRect = () => rectOf({ left: 200, top: 0, width: 800, height: 800 });

    grid.appendChild(sidebar);
    grid.appendChild(editor);
    document.body.appendChild(grid);

    moves = [];
    controller = new PartDragController({
      gridElement: grid,
      onMoveBeside: (id, target, o, before) => moves.push(`beside:${id}→${target}:${o}:${before}`),
      onMoveToEdge: (id, o, before) => moves.push(`edge:${id}:${o}:${before}`),
    });
    controller.armHandle('workbench.parts.sidebar', handle);
  });

  afterEach(() => {
    controller.dispose();
    grid.remove();
    vi.useRealTimers();
  });

  function startDrag(): DataTransfer {
    const dt = fakeDataTransfer();
    handle.dispatchEvent(dragEvent('dragstart', dt));
    return dt;
  }

  it('arms the handle as a grip', () => {
    expect(handle.draggable).toBe(true);
    expect(handle.classList.contains('part-drag-handle')).toBe(true);
  });

  it('shows the indicator over the half a drop would take', async () => {
    const dt = startDrag();
    editor.dispatchEvent(dragEvent('dragover', dt, 600, 700));
    await nextFrame();

    const indicator = grid.querySelector<HTMLElement>('.part-drop-overlay-indicator');
    expect(indicator).not.toBeNull();
    // Bottom half of the editor: stacking below it.
    expect(indicator!.style.top).toBe('400px');
    expect(indicator!.style.height).toBe('400px');
  });

  it('routes a drop on a part half to a beside-move', () => {
    const dt = startDrag();
    editor.dispatchEvent(dragEvent('dragover', dt, 600, 700));
    editor.dispatchEvent(dragEvent('drop', dt, 600, 700));
    expect(moves).toEqual(['beside:workbench.parts.sidebar→workbench.parts.editor:vertical:false']);
  });

  it('routes a drop at the window edge to an edge-move', () => {
    const dt = startDrag();
    editor.dispatchEvent(dragEvent('dragover', dt, 995, 400));
    editor.dispatchEvent(dragEvent('drop', dt, 995, 400));
    expect(moves).toEqual(['edge:workbench.parts.sidebar:horizontal:false']);
  });

  it('never offers the dragged part its own body as a target', async () => {
    const dt = startDrag();
    // Deep inside the sidebar's own rect, away from any grid edge.
    sidebar.dispatchEvent(dragEvent('dragover', dt, 120, 400));
    await nextFrame();
    expect(grid.querySelector('.part-drop-overlay-indicator')).toBeNull();

    sidebar.dispatchEvent(dragEvent('drop', dt, 120, 400));
    expect(moves).toEqual([]);
  });

  it('tears the overlay down when the cursor leaves the grid', async () => {
    const dt = startDrag();
    editor.dispatchEvent(dragEvent('dragover', dt, 600, 700));
    await nextFrame();
    expect(grid.querySelector('.part-drop-overlay')).not.toBeNull();

    document.body.dispatchEvent(dragEvent('dragover', dt, 2000, 2000));
    expect(grid.querySelector('.part-drop-overlay')).toBeNull();
  });

  it('tears down on document-level drop even if the source never fires dragend', async () => {
    // The Chromium trap this codebase has met before: a source unmounted by
    // its own drop fires no dragend. The document capture listener is the
    // guarantee.
    const dt = startDrag();
    editor.dispatchEvent(dragEvent('dragover', dt, 600, 700));
    await nextFrame();
    expect(grid.classList.contains('part-dragging')).toBe(true);

    handle.remove();
    document.dispatchEvent(dragEvent('drop', dt, 600, 700));
    await new Promise((r) => setTimeout(r, 1));

    expect(grid.querySelector('.part-drop-overlay')).toBeNull();
    expect(grid.classList.contains('part-dragging')).toBe(false);
  });

  it('tears down on dragend anywhere', async () => {
    const dt = startDrag();
    editor.dispatchEvent(dragEvent('dragover', dt, 600, 700));
    await nextFrame();

    document.dispatchEvent(dragEvent('dragend', dt));
    expect(grid.querySelector('.part-drop-overlay')).toBeNull();
    expect(grid.classList.contains('part-dragging')).toBe(false);
  });

  it('ignores drags that are not part drags', async () => {
    const dt = fakeDataTransfer();
    dt.setData('text/plain', 'hello');
    editor.dispatchEvent(dragEvent('dragover', dt, 600, 700));
    await nextFrame();
    expect(grid.querySelector('.part-drop-overlay')).toBeNull();
  });
});

describe('container drags over the grid', () => {
  let grid: HTMLElement;
  let sidebar: HTMLElement;
  let editor: HTMLElement;
  let controller: PartDragController;
  let containerMoves: string[];

  beforeEach(() => {
    grid = document.createElement('div');
    grid.getBoundingClientRect = () => rectOf(GRID);
    sidebar = document.createElement('div');
    sidebar.setAttribute('data-part-id', 'workbench.parts.sidebar');
    sidebar.getBoundingClientRect = () => rectOf({ left: 0, top: 0, width: 200, height: 800 });
    editor = document.createElement('div');
    editor.setAttribute('data-part-id', 'workbench.parts.editor');
    editor.getBoundingClientRect = () => rectOf({ left: 200, top: 0, width: 800, height: 800 });
    grid.appendChild(sidebar);
    grid.appendChild(editor);
    document.body.appendChild(grid);

    containerMoves = [];
    controller = new PartDragController({
      gridElement: grid,
      onMoveBeside: () => containerMoves.push('part-beside'),
      onMoveToEdge: () => containerMoves.push('part-edge'),
      dockTargets: { left: 'workbench.parts.sidebar', right: 'workbench.parts.auxiliarybar' },
      onContainerDrop: (id, zone) => containerMoves.push(`drop:${id}:${zone.kind}`),
      onContainerDock: (id, rail) => containerMoves.push(`dock:${id}:${rail}`),
    });
  });

  afterEach(() => {
    controller.dispose();
    grid.remove();
  });

  function containerDrag(type: string, x: number, y: number): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      configurable: true,
      value: {
        types: ['application/x-parallx-container'],
        dropEffect: '', effectAllowed: '',
        setData: () => {},
        getData: () => JSON.stringify({ containerId: 'view.explorer' }),
      },
    });
    Object.defineProperty(ev, 'clientX', { configurable: true, value: x });
    Object.defineProperty(ev, 'clientY', { configurable: true, value: y });
    return ev;
  }

  it('treats the whole rail card as a join zone for containers', async () => {
    // Deep inside the sidebar — a PART drag would read this as a split
    // zone; a CONTAINER means "dock into this rail".
    sidebar.dispatchEvent(containerDrag('dragover', 120, 400));
    await nextFrame();
    const indicator = grid.querySelector<HTMLElement>('.part-drop-overlay-indicator');
    expect(indicator).not.toBeNull();
    // The whole card lights, not a half of it.
    expect(indicator!.style.width).toBe('200px');
    expect(indicator!.style.height).toBe('800px');

    sidebar.dispatchEvent(containerDrag('drop', 120, 400));
    expect(containerMoves).toEqual(['dock:view.explorer:left']);
  });

  it('keeps the split language over non-rail targets — detach beside', () => {
    editor.dispatchEvent(containerDrag('dragover', 600, 700));
    editor.dispatchEvent(containerDrag('drop', 600, 700));
    expect(containerMoves).toEqual(['drop:view.explorer:beside']);
  });

  it('keeps the edge language at the window edges', () => {
    editor.dispatchEvent(containerDrag('dragover', 995, 400));
    editor.dispatchEvent(containerDrag('drop', 995, 400));
    expect(containerMoves).toEqual(['drop:view.explorer:edge']);
  });
});

describe('nested drag sources inside a handle', () => {
  it('a tab drag inside the panel strip stays a detach, never a panel move', () => {
    // Field report: dragging one panel tab moved the whole panel. The
    // strip is the panel's grip; tabs are their own drag sources; and
    // dragstart bubbles — so the grip stamped the PART payload over the
    // tab's detach payload, and the drop read as a part move.
    const grid = document.createElement('div');
    grid.getBoundingClientRect = () => rectOf(GRID);
    const panel = document.createElement('div');
    panel.setAttribute('data-part-id', 'workbench.parts.panel');
    const strip = document.createElement('div');
    strip.classList.add('view-container-tabs');
    const tab = document.createElement('div');
    tab.draggable = true;
    strip.appendChild(tab);
    panel.appendChild(strip);
    grid.appendChild(panel);
    document.body.appendChild(grid);

    const moves: string[] = [];
    const controller = new PartDragController({
      gridElement: grid,
      onMoveBeside: () => moves.push('part-move'),
      onMoveToEdge: () => moves.push('part-move'),
    });
    controller.armHandle('workbench.parts.panel', strip);

    try {
      // Drag starting ON the tab: the handle must not claim it.
      const tabDt = fakeDataTransfer();
      tab.dispatchEvent(dragEvent('dragstart', tabDt, 10, 10));
      expect(tabDt.types.includes(PART_DRAG_TYPE)).toBe(false);
      expect(grid.classList.contains('part-dragging')).toBe(false);

      // Drag starting on the strip's own empty area still moves the panel.
      const stripDt = fakeDataTransfer();
      strip.dispatchEvent(dragEvent('dragstart', stripDt, 10, 10));
      expect(stripDt.types.includes(PART_DRAG_TYPE)).toBe(true);
    } finally {
      controller.dispose();
      grid.remove();
    }
  });
});
