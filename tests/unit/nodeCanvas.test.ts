// @vitest-environment jsdom
//
// nodeCanvas.test.ts — behavioural pins for the shared node-graph surface
// (ui/nodeCanvas.ts), the primitive under the mindmap editor today and the
// workflow editor next. jsdom has no layout, so geometry uses the canvas's
// documented 120×36 fallback boxes; what these tests hold is the CONTRACT:
// reconciliation by id, selection semantics, one-commit-per-drag, cancelled
// drags restoring positions, and zero leaked document listeners.

import { describe, expect, it, vi } from 'vitest';
import { NodeCanvas, type NodeCanvasDelegate } from '../../src/ui/nodeCanvas';

function make(delegate: Partial<NodeCanvasDelegate> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const full: NodeCanvasDelegate = {
    renderNode: (id, body) => { body.textContent = id; },
    ...delegate,
  };
  const canvas = new NodeCanvas(host, full);
  return { host, canvas };
}

const N = (id: string, x = 0, y = 0) => ({ id, x, y });
const E = (id: string, from: string, to: string, label: string | null = null) => ({ id, from, to, label });

function nodeEl(host: HTMLElement, id: string): HTMLElement {
  const el = host.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`node not rendered: ${id}`);
  return el;
}

function pointerDown(el: Element, x = 0, y = 0, opts: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...opts }));
}
function docMove(x: number, y: number): void {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
}
function docUp(): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

describe('model reconciliation', () => {
  it('adds, updates and removes nodes and edges by id', () => {
    const { host, canvas } = make();
    canvas.setModel([N('a'), N('b', 200, 0)], [E('e1', 'a', 'b', 'rel')]);
    expect(host.querySelectorAll('.px-node-canvas__node')).toHaveLength(2);
    expect(host.querySelectorAll('g[data-edge-id]')).toHaveLength(1);
    expect(host.querySelector('.px-node-canvas__edge-label')?.textContent).toBe('rel');

    canvas.setModel([N('a', 10, 10)], []);
    expect(host.querySelectorAll('.px-node-canvas__node')).toHaveLength(1);
    expect(host.querySelectorAll('g[data-edge-id]')).toHaveLength(0);
    expect(nodeEl(host, 'a').style.transform).toBe('translate(10px, 10px)');
    canvas.dispose();
    host.remove();
  });

  it('renders content through the delegate and re-renders on refreshNode', () => {
    let label = 'first';
    const { host, canvas } = make({ renderNode: (_id, body) => { body.textContent = label; } });
    canvas.setModel([N('a')], []);
    expect(nodeEl(host, 'a').textContent).toContain('first');
    label = 'second';
    canvas.refreshNode('a');
    expect(nodeEl(host, 'a').textContent).toContain('second');
    canvas.dispose();
    host.remove();
  });

  it('edges to removed nodes lose their path instead of throwing', () => {
    const { host, canvas } = make();
    canvas.setModel([N('a'), N('b')], [E('e1', 'a', 'b')]);
    // Tenant bug tolerance: an edge whose node vanished this frame.
    canvas.setModel([N('a')], [E('e1', 'a', 'b')]);
    const path = host.querySelector('.px-node-canvas__edge') as SVGPathElement;
    expect(path.getAttribute('d')).toBeNull();
    canvas.dispose();
    host.remove();
  });
});

describe('selection', () => {
  it('click on a node selects it; shift-click adds; background click clears', () => {
    const changes: string[][] = [];
    const { host, canvas } = make({ onSelectionChange: (s) => changes.push([...s.nodes]) });
    canvas.setModel([N('a'), N('b', 300, 0)], []);

    pointerDown(nodeEl(host, 'a'));
    docUp();
    expect(canvas.getSelection().nodes).toEqual(['a']);

    pointerDown(nodeEl(host, 'b'), 0, 0, { shiftKey: true });
    docUp();
    expect(new Set(canvas.getSelection().nodes)).toEqual(new Set(['a', 'b']));

    // Background: press + release without movement clears.
    pointerDown(host.querySelector('.px-node-canvas')!);
    docUp();
    expect(canvas.getSelection().nodes).toEqual([]);
    expect(changes.length).toBeGreaterThan(0);
    canvas.dispose();
    host.remove();
  });

  it('setSelection filters unknown ids and paints classes', () => {
    const { host, canvas } = make();
    canvas.setModel([N('a')], []);
    canvas.setSelection(['a', 'ghost']);
    expect(canvas.getSelection().nodes).toEqual(['a']);
    expect(nodeEl(host, 'a').classList.contains('is-selected')).toBe(true);
    canvas.dispose();
    host.remove();
  });
});

describe('node drag', () => {
  it('commits ONE move with final world positions', () => {
    const onMoveNodes = vi.fn();
    const { host, canvas } = make({ onMoveNodes });
    canvas.setModel([N('a', 0, 0)], []);

    pointerDown(nodeEl(host, 'a'), 10, 10);
    docMove(60, 40);
    docMove(110, 90);
    docUp();

    expect(onMoveNodes).toHaveBeenCalledTimes(1);
    expect(onMoveNodes.mock.calls[0][0]).toEqual([{ id: 'a', x: 100, y: 80 }]);
    canvas.dispose();
    host.remove();
  });

  it('Escape cancels the drag and restores the original transform', () => {
    const onMoveNodes = vi.fn();
    const { host, canvas } = make({ onMoveNodes });
    canvas.setModel([N('a', 5, 5)], []);

    pointerDown(nodeEl(host, 'a'), 0, 0);
    docMove(80, 80);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onMoveNodes).not.toHaveBeenCalled();
    expect(nodeEl(host, 'a').style.transform).toBe('translate(5px, 5px)');
    canvas.dispose();
    host.remove();
  });

  it('a sub-threshold jitter is a click, not a move', () => {
    const onMoveNodes = vi.fn();
    const { host, canvas } = make({ onMoveNodes });
    canvas.setModel([N('a')], []);
    pointerDown(nodeEl(host, 'a'), 10, 10);
    docMove(11, 12);
    docUp();
    expect(onMoveNodes).not.toHaveBeenCalled();
    expect(canvas.getSelection().nodes).toEqual(['a']);
    canvas.dispose();
    host.remove();
  });

  it('presses on tenant-marked interactive elements never start drags', () => {
    const onMoveNodes = vi.fn();
    const { host, canvas } = make({
      onMoveNodes,
      renderNode: (_id, body) => {
        body.textContent = '';
        const btn = document.createElement('button');
        btn.dataset.ncNoDrag = '';
        btn.textContent = 'open';
        body.appendChild(btn);
      },
    });
    canvas.setModel([N('a')], []);
    pointerDown(nodeEl(host, 'a').querySelector('button')!, 0, 0);
    docMove(90, 90);
    docUp();
    expect(onMoveNodes).not.toHaveBeenCalled();
    canvas.dispose();
    host.remove();
  });
});

describe('connect gesture', () => {
  it('port drag onto another node reports onConnect(from, to)', () => {
    const onConnect = vi.fn();
    const { host, canvas } = make({ onConnect });
    canvas.setModel([N('a'), N('b', 300, 0)], []);

    const bEl = nodeEl(host, 'b');
    const orig = document.elementFromPoint;
    (document as any).elementFromPoint = () => bEl;
    try {
      pointerDown(nodeEl(host, 'a').querySelector('.px-node-canvas__port')!, 0, 0);
      docMove(150, 0);
      docUp();
    } finally {
      (document as any).elementFromPoint = orig;
    }
    expect(onConnect).toHaveBeenCalledWith('a', 'b');
    canvas.dispose();
    host.remove();
  });
});

describe('view & lifecycle', () => {
  it('wheel zooms within clamps and worldFromClient round-trips', () => {
    const { host, canvas } = make();
    canvas.setModel([N('a')], []);
    const root = host.querySelector('.px-node-canvas')!;
    for (let i = 0; i < 60; i++) {
      root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -400 }));
    }
    expect(canvas.zoom).toBeLessThanOrEqual(2.5);
    for (let i = 0; i < 120; i++) {
      root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 400 }));
    }
    expect(canvas.zoom).toBeGreaterThanOrEqual(0.25);

    const world = canvas.worldFromClient(37, 91);
    const back = canvas.clientFromWorld(world.x, world.y);
    expect(back.x).toBeCloseTo(37, 5);
    expect(back.y).toBeCloseTo(91, 5);
    canvas.dispose();
    host.remove();
  });

  it('dispose removes the DOM and leaves no live drag listeners', () => {
    const onMoveNodes = vi.fn();
    const { host, canvas } = make({ onMoveNodes });
    canvas.setModel([N('a')], []);
    pointerDown(nodeEl(host, 'a'), 0, 0);
    canvas.dispose();
    // The guarded drag was cancelled by dispose: further document events are inert.
    docMove(500, 500);
    docUp();
    expect(onMoveNodes).not.toHaveBeenCalled();
    expect(host.querySelector('.px-node-canvas')).toBeNull();
    host.remove();
  });
});
