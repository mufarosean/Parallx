// nodeCanvas.ts — ONE pan/zoom node-graph surface for the whole app.
//
// docs/WORKFLOWS_BRIEF.md: the (coming) workflow editor needs a
// world-coordinate surface with draggable nodes, curved edges, selection,
// and connect gestures. (The mindmap editor was its first tenant; that
// program was retired 2026-08-31 — this surface deliberately survives it.)
// This is that surface, built once, with NO domain knowledge:
// node CONTENT is rendered by the tenant through the delegate, node MEANING
// never enters this file.
//
// Contract with the tenant:
//   • the tenant owns the model; this class owns geometry and gesture;
//   • during a drag the canvas moves its own DOM (cheap transforms) and the
//     tenant hears ONE `onMoveNodes` at commit — previews never touch the
//     document, so undo history stays one-entry-per-gesture;
//   • keyboard is the tenant's entirely (focus, Tab/Enter/Delete semantics);
//   • every pointer gesture runs on `beginPointerDrag` (SYSTEM_INTEGRITY
//     Phase A): Escape / window blur / lost capture cancel cleanly, and this
//     file owns zero document-level listeners of its own.

import './nodeCanvas.css';
import { rafThrottle, type RafThrottledFn } from '../platform/rafThrottle.js';
import { beginPointerDrag, type PointerDragHandle } from './interactionMode.js';
import type { IDisposable } from '../platform/lifecycle.js';

// ── Model handed in by the tenant ───────────────────────────────────────────

export interface NodeCanvasNodeItem {
  readonly id: string;
  /** World coordinates of the node's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Explicit width in world px, or null/undefined for auto-size. */
  readonly w?: number | null;
}

export interface NodeCanvasEdgeItem {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string | null;
}

export interface NodeCanvasSelection {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

export interface NodeCanvasDelegate {
  /** (Re)fill a node's content element. Called on add and on refreshNode. */
  renderNode(id: string, body: HTMLElement): void;
  /** One call per completed drag gesture, with final world positions. */
  onMoveNodes?(moves: ReadonlyArray<{ id: string; x: number; y: number }>): void;
  onSelectionChange?(selection: NodeCanvasSelection): void;
  onNodeDoubleClick?(id: string): void;
  onEdgeDoubleClick?(id: string): void;
  /** Double-click on empty canvas, in world coordinates. */
  onCanvasDoubleClick?(point: { x: number; y: number }): void;
  /** A connect gesture completed from one node onto another. */
  onConnect?(fromId: string, toId: string): void;
  /**
   * A resize gesture committed a new explicit width. Presence of this
   * callback is what makes nodes resizable at all — the handle renders
   * only when the tenant can persist the result.
   */
  onResizeNode?(id: string, w: number): void;
}

// ── Internals ───────────────────────────────────────────────────────────────

interface NodeView {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeView {
  readonly group: SVGGElement;
  readonly path: SVGPathElement;
  readonly hit: SVGPathElement;
  readonly labelEl: HTMLElement;
  from: string;
  to: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const CLICK_DIST = 4;
const MIN_NODE_W = 96;
const MAX_NODE_W = 640;
const SVG_NS = 'http://www.w3.org/2000/svg';

export class NodeCanvas implements IDisposable {
  private readonly _root: HTMLElement;
  private readonly _viewport: HTMLElement;
  private readonly _svg: SVGSVGElement;
  private readonly _edgeLayer: SVGGElement;
  private readonly _tempPath: SVGPathElement;
  private readonly _nodeLayer: HTMLElement;
  private readonly _labelLayer: HTMLElement;

  private readonly _nodes = new Map<string, NodeView>();
  private readonly _edges = new Map<string, EdgeView>();
  private _selectedNodes = new Set<string>();
  private _selectedEdges = new Set<string>();

  private _panX = 0;
  private _panY = 0;
  private _zoom = 1;

  private _drag: PointerDragHandle | null = null;
  private _dragPreview: RafThrottledFn<[number, number]> | null = null;
  private _disposed = false;

  constructor(
    container: HTMLElement,
    private readonly _delegate: NodeCanvasDelegate,
  ) {
    this._root = document.createElement('div');
    this._root.className = 'px-node-canvas';
    container.appendChild(this._root);

    this._viewport = document.createElement('div');
    this._viewport.className = 'px-node-canvas__viewport';
    this._root.appendChild(this._viewport);

    this._svg = document.createElementNS(SVG_NS, 'svg');
    this._svg.setAttribute('class', 'px-node-canvas__edges');
    this._edgeLayer = document.createElementNS(SVG_NS, 'g');
    this._svg.appendChild(this._edgeLayer);
    this._tempPath = document.createElementNS(SVG_NS, 'path');
    this._tempPath.setAttribute('class', 'px-node-canvas__edge-temp');
    this._tempPath.style.display = 'none';
    this._svg.appendChild(this._tempPath);
    this._viewport.appendChild(this._svg);

    this._labelLayer = document.createElement('div');
    this._labelLayer.className = 'px-node-canvas__edge-labels';
    this._viewport.appendChild(this._labelLayer);

    this._nodeLayer = document.createElement('div');
    this._nodeLayer.className = 'px-node-canvas__nodes';
    this._viewport.appendChild(this._nodeLayer);

    if (this._delegate.onResizeNode) this._root.classList.add('is-resizable');

    this._root.addEventListener('pointerdown', this._onPointerDown);
    this._root.addEventListener('dblclick', this._onDoubleClick);
    this._root.addEventListener('wheel', this._onWheel, { passive: false });
  }

  dispose(): void {
    this._disposed = true;
    this._drag?.cancel();
    this._dragPreview?.dispose();
    this._root.removeEventListener('pointerdown', this._onPointerDown);
    this._root.removeEventListener('dblclick', this._onDoubleClick);
    this._root.removeEventListener('wheel', this._onWheel);
    this._root.remove();
    this._nodes.clear();
    this._edges.clear();
  }

  // ── Model sync ──────────────────────────────────────────────────────────

  /** Reconcile the rendered graph with the tenant's model, by id. */
  setModel(nodes: readonly NodeCanvasNodeItem[], edges: readonly NodeCanvasEdgeItem[]): void {
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const [id, view] of this._nodes) {
      if (!nodeIds.has(id)) {
        view.el.remove();
        this._nodes.delete(id);
        this._selectedNodes.delete(id);
      }
    }
    for (const n of nodes) {
      let view = this._nodes.get(n.id);
      if (!view) {
        view = this._createNodeView(n.id);
        this._nodes.set(n.id, view);
      }
      view.x = n.x;
      view.y = n.y;
      view.el.style.transform = `translate(${n.x}px, ${n.y}px)`;
      this._applyExplicitWidth(view, n.w ?? null);
      this._delegate.renderNode(n.id, view.body);
      this._measure(n.id);
    }

    const edgeIds = new Set(edges.map((e) => e.id));
    for (const [id, view] of this._edges) {
      if (!edgeIds.has(id)) {
        view.group.remove();
        view.labelEl.remove();
        this._edges.delete(id);
        this._selectedEdges.delete(id);
      }
    }
    for (const e of edges) {
      let view = this._edges.get(e.id);
      if (!view) {
        view = this._createEdgeView(e.id);
        this._edges.set(e.id, view);
      }
      view.from = e.from;
      view.to = e.to;
      view.labelEl.textContent = e.label ?? '';
      view.labelEl.style.display = e.label ? '' : 'none';
    }
    this._rePathAll();
    this._applySelectionClasses();
  }

  /** Re-render one node's content (label change) and re-route its edges. */
  refreshNode(id: string): void {
    const view = this._nodes.get(id);
    if (!view) return;
    this._delegate.renderNode(id, view.body);
    this._measure(id);
    this._rePathTouching(id);
  }

  // ── Selection ───────────────────────────────────────────────────────────

  getSelection(): NodeCanvasSelection {
    return { nodes: [...this._selectedNodes], edges: [...this._selectedEdges] };
  }

  setSelection(nodes: readonly string[], edges: readonly string[] = []): void {
    this._selectedNodes = new Set(nodes.filter((id) => this._nodes.has(id)));
    this._selectedEdges = new Set(edges.filter((id) => this._edges.has(id)));
    this._applySelectionClasses();
    this._delegate.onSelectionChange?.(this.getSelection());
  }

  // ── View control ────────────────────────────────────────────────────────

  get zoom(): number { return this._zoom; }

  /** World point for a client (viewport) coordinate. */
  worldFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this._root.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this._panX) / this._zoom,
      y: (clientY - rect.top - this._panY) / this._zoom,
    };
  }

  /** Client (viewport) point for a world coordinate. */
  clientFromWorld(x: number, y: number): { x: number; y: number } {
    const rect = this._root.getBoundingClientRect();
    return {
      x: rect.left + this._panX + x * this._zoom,
      y: rect.top + this._panY + y * this._zoom,
    };
  }

  /** Fit the whole graph into view (never zooms in past 1). */
  fitToContent(padding = 48): void {
    if (this._nodes.size === 0) return;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const v of this._nodes.values()) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x + v.w);
      maxY = Math.max(maxY, v.y + v.h);
    }
    const rect = this._root.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return; // not laid out yet
    const w = maxX - minX + 2 * padding;
    const h = maxY - minY + 2 * padding;
    this._zoom = Math.min(1, rect.width / w, rect.height / h);
    this._zoom = Math.max(MIN_ZOOM, this._zoom);
    this._panX = (rect.width - (maxX - minX) * this._zoom) / 2 - minX * this._zoom;
    this._panY = (rect.height - (maxY - minY) * this._zoom) / 2 - minY * this._zoom;
    this._applyTransform();
  }

  // ── Gestures ────────────────────────────────────────────────────────────

  private readonly _onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this._root.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this._zoom * factor));
    if (next === this._zoom) return;
    // Keep the point under the cursor stationary.
    this._panX = cx - ((cx - this._panX) / this._zoom) * next;
    this._panY = cy - ((cy - this._panY) / this._zoom) * next;
    this._zoom = next;
    this._applyTransform();
  };

  private readonly _onPointerDown = (e: PointerEvent | MouseEvent): void => {
    if (this._disposed || (e as MouseEvent).button !== 0) return;
    const target = e.target as HTMLElement;

    const resize = target.closest('.px-node-canvas__resize') as HTMLElement | null;
    if (resize) {
      const nodeEl = resize.closest('.px-node-canvas__node') as HTMLElement | null;
      if (nodeEl?.dataset.nodeId) this._beginResize(e, nodeEl.dataset.nodeId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const port = target.closest('.px-node-canvas__port') as HTMLElement | null;
    if (port) {
      const nodeEl = port.closest('.px-node-canvas__node') as HTMLElement | null;
      const fromId = nodeEl?.dataset.nodeId;
      if (fromId) this._beginConnect(e, fromId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    const nodeEl = target.closest('.px-node-canvas__node') as HTMLElement | null;
    if (nodeEl?.dataset.nodeId) {
      // Presses inside tenant-editable content (a label editor) or on
      // elements the tenant marks interactive are not drags.
      if (target.closest('input, textarea, [contenteditable], [data-nc-no-drag]')) return;
      this._beginNodeDrag(e, nodeEl.dataset.nodeId, e.shiftKey);
      e.preventDefault();
      return;
    }

    const edgeHit = (e.target as Element).closest?.('.px-node-canvas__edge-hit') as SVGPathElement | null;
    const edgeLabel = target.closest?.('.px-node-canvas__edge-label') as HTMLElement | null;
    const edgeId = edgeHit?.parentElement?.getAttribute('data-edge-id') ?? edgeLabel?.dataset.edgeId;
    if (edgeId) {
      this.setSelection([], [edgeId]);
      e.preventDefault();
      return;
    }

    this._beginPan(e);
  };

  private readonly _onDoubleClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable], [data-nc-no-drag]')) return;
    const nodeEl = target.closest('.px-node-canvas__node') as HTMLElement | null;
    if (nodeEl?.dataset.nodeId) {
      this._delegate.onNodeDoubleClick?.(nodeEl.dataset.nodeId);
      return;
    }
    const edgeLabel = target.closest('.px-node-canvas__edge-label') as HTMLElement | null;
    const edgeHit = (e.target as Element).closest?.('.px-node-canvas__edge-hit') as SVGPathElement | null;
    const edgeId = edgeHit?.parentElement?.getAttribute('data-edge-id') ?? edgeLabel?.dataset.edgeId;
    if (edgeId) {
      this._delegate.onEdgeDoubleClick?.(edgeId);
      return;
    }
    this._delegate.onCanvasDoubleClick?.(this.worldFromClient(e.clientX, e.clientY));
  };

  private _beginPan(e: PointerEvent | MouseEvent): void {
    const startX = e.clientX;
    const startY = e.clientY;
    const origPanX = this._panX;
    const origPanY = this._panY;
    let moved = false;
    this._drag = beginPointerDrag(e, {
      id: 'node-canvas-pan',
      cursor: 'grabbing',
      onMove: (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < CLICK_DIST) return;
        moved = true;
        this._panX = origPanX + dx;
        this._panY = origPanY + dy;
        this._applyTransform();
      },
      onEnd: (canceled) => {
        this._drag = null;
        if (canceled) {
          this._panX = origPanX;
          this._panY = origPanY;
          this._applyTransform();
          return;
        }
        // A stationary press on the background is a click: clear selection.
        if (!moved) this.setSelection([], []);
      },
    });
  }

  private _beginNodeDrag(e: PointerEvent | MouseEvent, nodeId: string, additive: boolean): void {
    const alreadySelected = this._selectedNodes.has(nodeId);
    if (!alreadySelected) {
      this.setSelection(additive ? [...this._selectedNodes, nodeId] : [nodeId], []);
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const moving = [...this._selectedNodes]
      .map((id) => ({ id, view: this._nodes.get(id)! }))
      .filter((m) => !!m.view)
      .map((m) => ({ id: m.id, view: m.view, ox: m.view.x, oy: m.view.y }));
    let moved = false;

    this._dragPreview?.dispose();
    this._dragPreview = rafThrottle((clientX: number, clientY: number) => {
      const dx = (clientX - startX) / this._zoom;
      const dy = (clientY - startY) / this._zoom;
      for (const m of moving) {
        m.view.x = m.ox + dx;
        m.view.y = m.oy + dy;
        m.view.el.style.transform = `translate(${m.view.x}px, ${m.view.y}px)`;
      }
      const touched = new Set(moving.map((m) => m.id));
      this._rePathWhere((edge) => touched.has(edge.from) || touched.has(edge.to));
    });

    this._drag = beginPointerDrag(e, {
      id: 'node-canvas-move',
      cursor: 'grabbing',
      onMove: (ev) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < CLICK_DIST) return;
        moved = true;
        this._dragPreview!(ev.clientX, ev.clientY);
      },
      onEnd: (canceled) => {
        this._drag = null;
        this._dragPreview?.flush();
        if (canceled || !moved) {
          for (const m of moving) {
            m.view.x = m.ox;
            m.view.y = m.oy;
            m.view.el.style.transform = `translate(${m.ox}px, ${m.oy}px)`;
          }
          this._rePathAll();
          // A stationary click on an already-selected node narrows to it.
          if (!canceled && !moved && alreadySelected && !additive) {
            this.setSelection([nodeId], []);
          }
          return;
        }
        this._delegate.onMoveNodes?.(moving.map((m) => ({ id: m.id, x: m.view.x, y: m.view.y })));
      },
    });
  }

  private _beginResize(e: PointerEvent | MouseEvent, nodeId: string): void {
    const view = this._nodes.get(nodeId);
    if (!view || !this._delegate.onResizeNode) return;
    this.setSelection([nodeId], []);
    const startX = e.clientX;
    const startW = view.w;
    const hadExplicit = view.el.classList.contains('has-explicit-width');
    let w = startW;

    this._drag = beginPointerDrag(e, {
      id: 'node-canvas-resize',
      cursor: 'ew-resize',
      onMove: (ev) => {
        w = Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, Math.round(startW + (ev.clientX - startX) / this._zoom)));
        this._applyExplicitWidth(view, w);
        this._measure(nodeId);
        this._rePathTouching(nodeId);
      },
      onEnd: (canceled) => {
        this._drag = null;
        if (canceled || w === startW) {
          this._applyExplicitWidth(view, hadExplicit ? startW : null);
          this._measure(nodeId);
          this._rePathTouching(nodeId);
          return;
        }
        this._delegate.onResizeNode!(nodeId, w);
      },
    });
  }

  private _applyExplicitWidth(view: NodeView, w: number | null): void {
    if (w === null) {
      view.el.style.width = '';
      view.el.classList.remove('has-explicit-width');
    } else {
      view.el.style.width = `${w}px`;
      view.el.classList.add('has-explicit-width');
    }
  }

  private _beginConnect(e: PointerEvent | MouseEvent, fromId: string): void {
    const fromView = this._nodes.get(fromId);
    if (!fromView) return;
    this._tempPath.style.display = '';
    this._root.classList.add('is-connecting');
    let targetId: string | null = null;

    this._drag = beginPointerDrag(e, {
      id: 'node-canvas-connect',
      cursor: 'crosshair',
      onMove: (ev) => {
        const world = this.worldFromClient(ev.clientX, ev.clientY);
        this._tempPath.setAttribute('d', this._pathBetweenPoints(
          { x: fromView.x + fromView.w / 2, y: fromView.y + fromView.h / 2 },
          world,
        ));
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const overNode = el?.closest?.('.px-node-canvas__node') as HTMLElement | null;
        const overId = overNode?.dataset.nodeId ?? null;
        targetId = overId && overId !== fromId ? overId : null;
        for (const [id, v] of this._nodes) {
          v.el.classList.toggle('is-connect-target', id === targetId);
        }
      },
      onEnd: (canceled) => {
        this._drag = null;
        this._tempPath.style.display = 'none';
        this._root.classList.remove('is-connecting');
        for (const v of this._nodes.values()) v.el.classList.remove('is-connect-target');
        if (!canceled && targetId) this._delegate.onConnect?.(fromId, targetId);
      },
    });
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private _createNodeView(id: string): NodeView {
    const el = document.createElement('div');
    el.className = 'px-node-canvas__node';
    el.dataset.nodeId = id;
    const body = document.createElement('div');
    body.className = 'px-node-canvas__node-body';
    el.appendChild(body);
    const port = document.createElement('div');
    port.className = 'px-node-canvas__port';
    port.title = 'Drag To Connect';
    el.appendChild(port);
    const resize = document.createElement('div');
    resize.className = 'px-node-canvas__resize';
    resize.title = 'Drag To Resize';
    el.appendChild(resize);
    this._nodeLayer.appendChild(el);
    return { el, body, x: 0, y: 0, w: 0, h: 0 };
  }

  private _createEdgeView(id: string): EdgeView {
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-edge-id', id);
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('class', 'px-node-canvas__edge-hit');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'px-node-canvas__edge');
    group.appendChild(hit);
    group.appendChild(path);
    this._edgeLayer.appendChild(group);

    const labelEl = document.createElement('div');
    labelEl.className = 'px-node-canvas__edge-label';
    labelEl.dataset.edgeId = id;
    this._labelLayer.appendChild(labelEl);
    return { group, path, hit, labelEl, from: '', to: '' };
  }

  private _measure(id: string): void {
    const view = this._nodes.get(id);
    if (!view) return;
    // jsdom (tests) reports 0×0; fall back to a sane box so geometry math
    // stays finite. Real rendering always re-measures after content changes.
    view.w = view.el.offsetWidth || 120;
    view.h = view.el.offsetHeight || 36;
  }

  /** Anchor a connection on the side of the node facing the other point. */
  private _anchor(view: NodeView, towards: { x: number; y: number }): { x: number; y: number; horizontal: boolean } {
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const dx = towards.x - cx;
    const dy = towards.y - cy;
    if (Math.abs(dx) * view.h >= Math.abs(dy) * view.w) {
      return { x: dx >= 0 ? view.x + view.w : view.x, y: cy, horizontal: true };
    }
    return { x: cx, y: dy >= 0 ? view.y + view.h : view.y, horizontal: false };
  }

  private _pathBetweenPoints(a: { x: number; y: number }, b: { x: number; y: number }): string {
    const bend = Math.min(120, Math.max(28, Math.abs(b.x - a.x) / 2));
    return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`;
  }

  private _pathFor(edge: EdgeView): string | null {
    const from = this._nodes.get(edge.from);
    const to = this._nodes.get(edge.to);
    if (!from || !to) return null;
    const a = this._anchor(from, { x: to.x + to.w / 2, y: to.y + to.h / 2 });
    const b = this._anchor(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 });
    const bend = Math.min(120, Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) / 2.6));
    const c1 = a.horizontal
      ? { x: a.x + Math.sign(b.x - a.x || 1) * bend, y: a.y }
      : { x: a.x, y: a.y + Math.sign(b.y - a.y || 1) * bend };
    const c2 = b.horizontal
      ? { x: b.x + Math.sign(a.x - b.x || 1) * bend, y: b.y }
      : { x: b.x, y: b.y + Math.sign(a.y - b.y || 1) * bend };
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
  }

  private _rePath(edge: EdgeView): void {
    const d = this._pathFor(edge);
    if (!d) {
      edge.path.removeAttribute('d');
      edge.hit.removeAttribute('d');
      edge.labelEl.style.display = 'none';
      return;
    }
    edge.path.setAttribute('d', d);
    edge.hit.setAttribute('d', d);
    if (edge.labelEl.textContent) {
      const from = this._nodes.get(edge.from)!;
      const to = this._nodes.get(edge.to)!;
      const mx = (from.x + from.w / 2 + to.x + to.w / 2) / 2;
      const my = (from.y + from.h / 2 + to.y + to.h / 2) / 2;
      edge.labelEl.style.transform = `translate(-50%, -50%) translate(${mx}px, ${my}px)`;
    }
  }

  private _rePathAll(): void {
    for (const edge of this._edges.values()) this._rePath(edge);
  }

  private _rePathTouching(nodeId: string): void {
    this._rePathWhere((e) => e.from === nodeId || e.to === nodeId);
  }

  private _rePathWhere(pred: (edge: EdgeView) => boolean): void {
    for (const edge of this._edges.values()) {
      if (pred(edge)) this._rePath(edge);
    }
  }

  private _applyTransform(): void {
    this._viewport.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
  }

  private _applySelectionClasses(): void {
    for (const [id, v] of this._nodes) v.el.classList.toggle('is-selected', this._selectedNodes.has(id));
    for (const [id, v] of this._edges) {
      v.group.classList.toggle('is-selected', this._selectedEdges.has(id));
      v.labelEl.classList.toggle('is-selected', this._selectedEdges.has(id));
    }
  }
}
