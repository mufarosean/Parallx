// partDrag.ts — parts move by hand
//
// The primary touchpoint for rearranging the workbench: grab a part by its
// header, drag, and live drop zones show exactly what will happen — the
// left/right/top/bottom half of another part to split beside it (stack the
// panel under the sidebar), or a strip along a window edge to take that
// edge. Drop, and it lands; the body tree persists it.
//
// Same visual language as the editor's drag-to-split (editorDropTarget.ts):
// same drop tokens, same indicator motion — dragging feels like ONE system
// wherever it happens. Same hard-won teardown too: Chromium does not fire
// `dragend` on a drag source that was removed by its own drop, so the
// document-level capture listeners are the guarantee, not the source's
// events. One deliberate difference: this overlay is pointer-events NONE and
// the grid container owns the events, which removes the enter/leave counter
// dance entirely — an overlay that cannot swallow input cannot get stuck
// swallowing input.
//
// Zone math is exported pure, so the feel of the zones is pinned by tests,
// not rediscovered by hand after every refactor.

import { Disposable } from '../platform/lifecycle.js';
import { Orientation } from '../layout/layoutTypes.js';
import { rafThrottle } from '../platform/rafThrottle.js';
import { $ } from '../ui/dom.js';

export const PART_DRAG_TYPE = 'application/x-parallx-part';

export interface PartDragData {
  readonly partId: string;
}

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type PartDropZone =
  | { kind: 'beside'; targetId: string; orientation: Orientation; before: boolean }
  | { kind: 'edge'; orientation: Orientation; before: boolean };

/** Within this many pixels of the grid boundary, the drop means "take the edge". */
export const EDGE_ZONE_PX = 28;

/** Edge indicator strip: this fraction of the axis, capped. */
const EDGE_STRIP_FRACTION = 0.22;
const EDGE_STRIP_MAX_PX = 360;

/**
 * What dropping at (x, y) would mean.
 *
 * Grid edges win inside their threshold — an edge drop is the bigger,
 * easier gesture and must not require pixel-hunting past a part's corner.
 * Over a part, the nearest side of its rect decides: left/right split the
 * space horizontally, top/bottom stack it. There is no centre zone — parts
 * have no merge semantics, and a dead zone in the middle of every target
 * would read as the drag not working.
 */
export function computeDropZone(
  gridRect: RectLike,
  x: number,
  y: number,
  target: { id: string; rect: RectLike } | undefined,
  edgeThreshold: number = EDGE_ZONE_PX,
): PartDropZone | undefined {
  if (gridRect.width <= 0 || gridRect.height <= 0) return undefined;

  const dLeft = x - gridRect.left;
  const dRight = gridRect.left + gridRect.width - x;
  const dTop = y - gridRect.top;
  const dBottom = gridRect.top + gridRect.height - y;
  const minEdge = Math.min(dLeft, dRight, dTop, dBottom);

  if (minEdge <= edgeThreshold) {
    if (minEdge === dLeft) return { kind: 'edge', orientation: Orientation.Horizontal, before: true };
    if (minEdge === dRight) return { kind: 'edge', orientation: Orientation.Horizontal, before: false };
    if (minEdge === dTop) return { kind: 'edge', orientation: Orientation.Vertical, before: true };
    return { kind: 'edge', orientation: Orientation.Vertical, before: false };
  }

  if (!target || target.rect.width <= 0 || target.rect.height <= 0) return undefined;

  const fx = (x - target.rect.left) / target.rect.width;
  const fy = (y - target.rect.top) / target.rect.height;
  const d = Math.min(fx, 1 - fx, fy, 1 - fy);

  if (d === fx) return { kind: 'beside', targetId: target.id, orientation: Orientation.Horizontal, before: true };
  if (d === 1 - fx) return { kind: 'beside', targetId: target.id, orientation: Orientation.Horizontal, before: false };
  if (d === fy) return { kind: 'beside', targetId: target.id, orientation: Orientation.Vertical, before: true };
  return { kind: 'beside', targetId: target.id, orientation: Orientation.Vertical, before: false };
}

/**
 * The indicator's rectangle for a zone, in grid-relative pixels: the half of
 * the target that would be taken, or a strip along the grid edge.
 */
export function indicatorRect(
  zone: PartDropZone,
  gridRect: RectLike,
  targetRect: RectLike | undefined,
): RectLike {
  if (zone.kind === 'edge') {
    const strip = zone.orientation === Orientation.Horizontal
      ? Math.min(gridRect.width * EDGE_STRIP_FRACTION, EDGE_STRIP_MAX_PX)
      : Math.min(gridRect.height * EDGE_STRIP_FRACTION, EDGE_STRIP_MAX_PX);
    if (zone.orientation === Orientation.Horizontal) {
      return {
        left: zone.before ? 0 : gridRect.width - strip,
        top: 0, width: strip, height: gridRect.height,
      };
    }
    return {
      left: 0, top: zone.before ? 0 : gridRect.height - strip,
      width: gridRect.width, height: strip,
    };
  }

  const t = targetRect ?? gridRect;
  const left = t.left - gridRect.left;
  const top = t.top - gridRect.top;
  if (zone.orientation === Orientation.Horizontal) {
    return {
      left: zone.before ? left : left + t.width / 2,
      top, width: t.width / 2, height: t.height,
    };
  }
  return {
    left, top: zone.before ? top : top + t.height / 2,
    width: t.width, height: t.height / 2,
  };
}

// ── Controller ──────────────────────────────────────────────────────────────

export interface PartDragControllerOptions {
  readonly gridElement: HTMLElement;
  onMoveBeside(partId: string, targetId: string, orientation: Orientation, before: boolean): void;
  onMoveToEdge(partId: string, orientation: Orientation, before: boolean): void;
}

export class PartDragController extends Disposable {

  private _draggedPartId: string | undefined;
  private _overlay: HTMLElement | undefined;
  private _indicator: HTMLElement | undefined;
  private _zone: PartDropZone | undefined;

  constructor(private readonly _opts: PartDragControllerOptions) {
    super();
    this._registerContainerListeners();
  }

  /**
   * Make `handle` the drag grip for a part. The whole header drags —
   * children that are draggable themselves (view tabs) win the gesture, so
   * their own drag keeps working.
   */
  armHandle(partId: string, handle: HTMLElement): void {
    handle.draggable = true;
    handle.classList.add('part-drag-handle');

    const onDragStart = (e: DragEvent): void => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData(PART_DRAG_TYPE, JSON.stringify({ partId } satisfies PartDragData));
      e.dataTransfer.effectAllowed = 'move';
      // Chromium hides payloads during dragover (only types are readable),
      // so the id is stashed for the same-window duration of the drag.
      this._draggedPartId = partId;
      this._opts.gridElement.classList.add('part-dragging');
    };

    handle.addEventListener('dragstart', onDragStart);
    this._register({
      dispose: () => {
        handle.removeEventListener('dragstart', onDragStart);
        handle.draggable = false;
        handle.classList.remove('part-drag-handle');
      },
    });
  }

  private _registerContainerListeners(): void {
    const grid = this._opts.gridElement;

    // preventDefault must be synchronous or the browser refuses the drop;
    // the geometry work coalesces to one run per painted frame.
    const position = rafThrottle((x: number, y: number, eventTarget: EventTarget | null) => {
      this._position(x, y, eventTarget);
    });

    const onDragOver = (e: DragEvent): void => {
      if (!this._isPartDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      position(e.clientX, e.clientY, e.target);
    };

    const onDrop = (e: DragEvent): void => {
      if (!this._isPartDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      position.flush();

      const partId = this._draggedPartId ?? this._parseDropData(e)?.partId;
      const zone = this._zone;
      this._teardown();
      if (!partId || !zone) return;

      if (zone.kind === 'edge') {
        this._opts.onMoveToEdge(partId, zone.orientation, zone.before);
      } else if (zone.targetId !== partId) {
        this._opts.onMoveBeside(partId, zone.targetId, zone.orientation, zone.before);
      }
    };

    // Outside the grid there is no drop; the overlay must say so by leaving.
    const onDocumentDragOver = (e: DragEvent): void => {
      if (!this._overlay) return;
      const rect = grid.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) this._clearOverlay();
    };

    // The guaranteed teardown. Chromium never fires dragend on a source
    // element that was unmounted by its own drop; capture-phase document
    // listeners survive that, and `drop` defers a tick so the grid's own
    // drop handler runs first.
    const onDocumentDrop = (): void => {
      setTimeout(() => this._teardown(), 0);
    };
    const onDocumentDragEnd = (): void => this._teardown();

    grid.addEventListener('dragover', onDragOver);
    grid.addEventListener('drop', onDrop);
    document.addEventListener('dragover', onDocumentDragOver);
    document.addEventListener('drop', onDocumentDrop, { capture: true });
    document.addEventListener('dragend', onDocumentDragEnd, { capture: true });

    this._register({
      dispose: () => {
        position.dispose();
        grid.removeEventListener('dragover', onDragOver);
        grid.removeEventListener('drop', onDrop);
        document.removeEventListener('dragover', onDocumentDragOver);
        document.removeEventListener('drop', onDocumentDrop, { capture: true });
        document.removeEventListener('dragend', onDocumentDragEnd, { capture: true });
        this._teardown();
      },
    });
  }

  // ── Geometry → overlay ──

  private _position(x: number, y: number, eventTarget: EventTarget | null): void {
    const grid = this._opts.gridElement;
    const gridRect = grid.getBoundingClientRect();

    // The part under the cursor — excluding the one being dragged, whose
    // own body is not a meaningful target.
    let target: { id: string; rect: RectLike } | undefined;
    const partEl = eventTarget instanceof HTMLElement
      ? partElementWithin(eventTarget, grid)
      : null;
    if (partEl) {
      const id = partEl.getAttribute('data-part-id') ?? '';
      if (id && id !== this._draggedPartId) {
        target = { id, rect: partEl.getBoundingClientRect() };
      }
    }

    const zone = computeDropZone(gridRect, x, y, target);
    if (!zone) {
      this._clearOverlay();
      return;
    }
    if (this._zone && zonesEqual(this._zone, zone)) return;
    this._zone = zone;

    this._ensureOverlay();
    const rect = indicatorRect(zone, gridRect, target?.rect);
    const s = this._indicator!.style;
    // Instant jump between distant zones, then eased settle — the editor
    // overlay's motion, verbatim.
    this._indicator!.classList.remove('overlay-move-transition');
    void this._indicator!.offsetWidth;
    this._indicator!.classList.add('overlay-move-transition');
    s.left = `${Math.round(rect.left)}px`;
    s.top = `${Math.round(rect.top)}px`;
    s.width = `${Math.round(rect.width)}px`;
    s.height = `${Math.round(rect.height)}px`;
  }

  private _ensureOverlay(): void {
    if (this._overlay) return;
    this._overlay = $('div');
    this._overlay.classList.add('part-drop-overlay');
    this._indicator = $('div');
    this._indicator.classList.add('part-drop-overlay-indicator');
    this._overlay.appendChild(this._indicator);
    this._opts.gridElement.appendChild(this._overlay);
  }

  private _clearOverlay(): void {
    this._overlay?.remove();
    this._overlay = undefined;
    this._indicator = undefined;
    this._zone = undefined;
  }

  private _teardown(): void {
    this._clearOverlay();
    this._draggedPartId = undefined;
    this._opts.gridElement.classList.remove('part-dragging');
  }

  // ── Helpers ──

  private _isPartDrag(e: DragEvent): boolean {
    return e.dataTransfer?.types.includes(PART_DRAG_TYPE) ?? false;
  }

  private _parseDropData(e: DragEvent): PartDragData | undefined {
    try {
      const raw = e.dataTransfer?.getData(PART_DRAG_TYPE);
      return raw ? JSON.parse(raw) as PartDragData : undefined;
    } catch {
      return undefined;
    }
  }
}

/** Nearest ancestor with a data-part-id, stopping at the grid boundary. */
function partElementWithin(el: HTMLElement | null, boundary: HTMLElement): HTMLElement | null {
  while (el && el !== boundary) {
    if (el.hasAttribute('data-part-id')) return el;
    el = el.parentElement;
  }
  return null;
}

function zonesEqual(a: PartDropZone, b: PartDropZone): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'edge' || b.kind === 'edge') {
    return a.orientation === b.orientation && a.before === b.before;
  }
  return a.targetId === b.targetId && a.orientation === b.orientation && a.before === b.before;
}
