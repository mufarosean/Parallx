// tableControls.ts — the grips, the ✛ buttons, and drag-to-reorder for tables
//
// Until this file existed a canvas table had NO structural affordance at all:
// three columns forever, and the only way to gain a row was to press Tab in
// the last cell.  This is the layer the user actually reaches for — Notion's:
//
//   ┌──────── column grips (one per column, above the table) ─┐  [＋]
//   ▣ ┌────────┬────────┬────────┐                              add column
//   │ │ header │ header │ header │
//   ▤ ├────────┼────────┼────────┤   ▤ = row grips (left of the table)
//   ▤ │        │        │        │   ▣ = corner grip (selects the table)
//   └─┴────────┴────────┴────────┘
//   [＋ add row]
//
//   • hover a table → the grips fade in;
//   • click a grip  → selects that row/column AND opens its menu;
//   • drag a grip   → reorders the row/column, with a drop line;
//   • the ✛ bars append a row / a column.
//
// Two things this file is deliberately NOT: it owns no table operations (they
// all live in tableOps.ts, shared with the keyboard policy and the menu), and
// it owns no menu markup (that is menus/tableActionMenu.ts).  It owns GEOMETRY
// and GESTURE — the same split blockHandles/handleGeometry already use.
//
// Gate: handles/ — imports only from handleRegistry.ts (plus platform/ui).

import type { Editor } from '@tiptap/core';
import { rafThrottle, type RafThrottledFn } from '../../../platform/rafThrottle.js';
import { beginPointerDrag, type PointerDragHandle } from '../../../ui/interactionMode.js';
import {
  svgIcon,
  appendColumn,
  appendRow,
  moveColumnBy,
  moveRowBy,
  selectTableColumn,
  selectTableNode,
  selectTableRow,
  tableFrameAt,
  resolveBlockUnitFromDOM,
} from './handleRegistry.js';
import type { ITableActionMenu } from './handleRegistry.js';

// ── Host ────────────────────────────────────────────────────────────────────

export interface TableControlsHost {
  readonly editor: Editor | null;
  readonly editorContainer: HTMLElement | null;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** Viewport-space measurements of one rendered table. */
interface TableMetrics {
  readonly rect: DOMRect;
  /** One band per rendered `<tr>`, top-to-bottom. */
  readonly rows: { top: number; height: number }[];
  /** One band per visual column, left-to-right. */
  readonly cols: { left: number; width: number }[];
}

/**
 * Column edges are derived from the UNION of every row's cell boundaries, not
 * from the first row's cells: a header cell with `colspan=2` would otherwise
 * report two columns as one, and every grip below it would aim one column off.
 * Any row that splits that span contributes the missing edge.
 */
function measureTable(tableEl: HTMLTableElement): TableMetrics | null {
  const body = tableEl.tBodies[0] ?? tableEl;
  const rowEls = Array.from(body.rows ?? []);
  if (rowEls.length === 0) return null;

  const rect = tableEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const rows = rowEls.map((tr) => {
    const r = tr.getBoundingClientRect();
    return { top: r.top, height: r.height };
  });

  const edges = new Set<number>([Math.round(rect.left), Math.round(rect.right)]);
  for (const tr of rowEls) {
    for (const cell of Array.from(tr.cells)) {
      const r = cell.getBoundingClientRect();
      edges.add(Math.round(r.left));
      edges.add(Math.round(r.right));
    }
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const cols: { left: number; width: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const width = sorted[i + 1] - sorted[i];
    if (width < 2) continue; // sub-pixel duplicate edge
    cols.push({ left: sorted[i], width });
  }
  if (cols.length === 0) return null;

  return { rect, rows, cols };
}

// ── Controller ──────────────────────────────────────────────────────────────

/** Thickness of a grip bar, px.  Sits clear of the block drag handle. */
const GRIP = 10;
/** Gap between the table edge and its grip bar, px. */
const GAP = 3;
/** Pointer slack (px) around a table that still counts as "hovering" it. */
const HOVER_SLACK = 28;
/** Drag threshold before a grip click becomes a reorder, px. */
const REORDER_THRESHOLD = 4;

type Axis = 'row' | 'column';

export class TableControlsController {
  private _layer: HTMLElement | null = null;
  private _cornerEl: HTMLElement | null = null;
  private _addRowEl: HTMLElement | null = null;
  private _addColEl: HTMLElement | null = null;
  private _indicatorEl: HTMLElement | null = null;
  private _rowGrips: HTMLElement[] = [];
  private _colGrips: HTMLElement[] = [];

  /** The table the controls currently describe. */
  private _tableEl: HTMLTableElement | null = null;
  private _tablePos = -1;
  private _metrics: TableMetrics | null = null;

  /** Live reorder gesture, or null. */
  private _drag: {
    axis: Axis;
    index: number;
    origin: { x: number; y: number };
    moved: boolean;
    target: number;
    grip: HTMLElement;
  } | null = null;

  /** The guarded-drag handle while a reorder is in flight. */
  private _dragHandle: PointerDragHandle | null = null;

  private _onMove: RafThrottledFn<[MouseEvent]> | null = null;
  private _onScroll: RafThrottledFn<[]> | null = null;
  /**
   * Re-measure is O(cells) in forced layout reads, and `docChanged` fires on
   * every keystroke.  One coalesced pass per frame — the same discipline the
   * rest of the canvas hot paths use.
   */
  private _onDocChange: RafThrottledFn<[]> | null = null;

  constructor(
    private readonly _host: TableControlsHost,
    private readonly _menu: ITableActionMenu,
  ) {}

  // ── Setup / teardown ────────────────────────────────────────────────────

  setup(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;

    const layer = document.createElement('div');
    layer.className = 'table-controls hide';
    ec.appendChild(layer);
    this._layer = layer;

    this._cornerEl = this._makeControl('table-grip table-grip--corner', 'Select Table');
    this._cornerEl.addEventListener('mousedown', this._onCornerDown);

    this._addColEl = this._makeControl('table-add table-add--col', 'Add Column');
    this._addColEl.innerHTML = svgIcon('plus');
    this._addColEl.addEventListener('mousedown', this._onAddColumn);

    this._addRowEl = this._makeControl('table-add table-add--row', 'Add Row');
    this._addRowEl.innerHTML = svgIcon('plus');
    this._addRowEl.addEventListener('mousedown', this._onAddRow);

    this._indicatorEl = this._makeControl('table-reorder-line', '');
    this._indicatorEl.style.display = 'none';

    this._onMove = rafThrottle((e: MouseEvent) => this._handlePointer(e));
    this._onScroll = rafThrottle(() => this._render());
    this._onDocChange = rafThrottle(() => this._render());

    ec.addEventListener('mousemove', this._onMove as unknown as EventListener);
    ec.addEventListener('mouseleave', this._onContainerLeave);
    ec.addEventListener('scroll', this._onScroll as EventListener, { passive: true });
  }

  dispose(): void {
    const ec = this._host.editorContainer;
    if (ec) {
      if (this._onMove) ec.removeEventListener('mousemove', this._onMove as unknown as EventListener);
      ec.removeEventListener('mouseleave', this._onContainerLeave);
      if (this._onScroll) ec.removeEventListener('scroll', this._onScroll as EventListener);
    }
    this._onMove?.dispose();
    this._onScroll?.dispose();
    this._onDocChange?.dispose();
    this._onMove = null;
    this._onScroll = null;
    this._onDocChange = null;
    this._endDrag();
    this._layer?.remove();
    this._layer = null;
    this._tableEl = null;
  }

  /**
   * The document changed under us: rows/columns may have appeared, vanished,
   * or moved.  Re-measure rather than leaving grips aimed at stale bands.
   */
  notifyDocChanged(): void {
    if (!this._tableEl) return;
    if (!this._tableEl.isConnected) { this._hide(); return; }
    this._onDocChange?.();
  }

  // ── Element helpers ─────────────────────────────────────────────────────

  private _makeControl(className: string, title: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    if (title) el.title = title;
    this._layer!.appendChild(el);
    return el;
  }

  // ── Hover tracking ──────────────────────────────────────────────────────

  private readonly _onContainerLeave = (): void => {
    if (!this._drag) this._hide();
  };

  private _handlePointer(e: MouseEvent): void {
    if (this._drag) return; // the drag handlers own the pointer
    const editor = this._host.editor;
    if (!editor?.isEditable) { this._hide(); return; }

    const target = e.target as HTMLElement | null;
    if (target && this._layer?.contains(target)) return; // over our own chrome

    const tableEl = target?.closest?.('.canvas-tiptap-editor table') as HTMLTableElement | null;
    if (tableEl) {
      if (tableEl !== this._tableEl) this._attach(tableEl);
      else this._refreshIfMoved();
      return;
    }

    // Not over a table — keep the controls up while the pointer is still in
    // the slack band around the attached one (it has to cross the gap to
    // reach the grips at all).
    if (this._tableEl && this._metrics) {
      const r = this._metrics.rect;
      if (e.clientX >= r.left - HOVER_SLACK && e.clientX <= r.right + HOVER_SLACK
        && e.clientY >= r.top - HOVER_SLACK && e.clientY <= r.bottom + HOVER_SLACK) {
        return;
      }
    }
    this._hide();
  }

  /**
   * Hovering the same table shouldn't re-measure every cell on every frame.
   * One cheap read of the table's own rect answers "did anything move?"; the
   * O(cells) pass only runs when it did.
   */
  private _refreshIfMoved(): void {
    if (!this._tableEl) return;
    const cached = this._metrics?.rect;
    const now = this._tableEl.getBoundingClientRect();
    if (cached
      && Math.abs(cached.top - now.top) < 0.5
      && Math.abs(cached.left - now.left) < 0.5
      && Math.abs(cached.width - now.width) < 0.5
      && Math.abs(cached.height - now.height) < 0.5) {
      return;
    }
    this._render();
  }

  private _attach(tableEl: HTMLTableElement): void {
    const editor = this._host.editor;
    if (!editor) return;

    // Resolve through the canonical unit resolver rather than arithmetic on
    // posAtDOM: TableView renders the table inside a `.tableWrapper` NodeView
    // whose contentDOM is the <tbody>, so raw offsets from the <table> element
    // are not a stable "position of the table node".  resolveBlockUnitFromDOM
    // walks the document to the nearest page-container child, which for any
    // point inside a table IS the table — the same answer the drag handle,
    // the marquee and the block menu get.
    const unit = resolveBlockUnitFromDOM(editor.view, tableEl);
    if (!unit || unit.node?.type?.name !== 'table') { this._hide(); return; }

    this._tableEl = tableEl;
    this._tablePos = unit.pos;
    this._render();
  }

  private _hide(): void {
    this._layer?.classList.add('hide');
    this._tableEl = null;
    this._tablePos = -1;
    this._metrics = null;
  }

  // ── Build & position ────────────────────────────────────────────────────

  /**
   * Measure ONCE, then size the grip pools and place everything from that one
   * snapshot.  (The first cut measured twice per pass — once to count, once to
   * position — which doubled the forced-layout cost for no gain.)
   */
  private _render(): void {
    const ec = this._host.editorContainer;
    if (!ec || !this._layer || !this._tableEl) return;
    if (!this._tableEl.isConnected) { this._hide(); return; }

    const metrics = measureTable(this._tableEl);
    if (!metrics) { this._hide(); return; }
    this._metrics = metrics;

    this._syncGripCount(this._rowGrips, metrics.rows.length, 'row');
    this._syncGripCount(this._colGrips, metrics.cols.length, 'column');
    this._layer.classList.remove('hide');
    this._place(ec, metrics);
  }

  private _syncGripCount(pool: HTMLElement[], want: number, axis: Axis): void {
    while (pool.length > want) {
      pool.pop()!.remove();
    }
    while (pool.length < want) {
      const grip = document.createElement('div');
      grip.className = `table-grip table-grip--${axis}`;
      grip.dataset.axis = axis;
      grip.dataset.index = String(pool.length);
      grip.title = axis === 'row' ? 'Click for row options, drag to reorder'
        : 'Click for column options, drag to reorder';
      grip.addEventListener('mousedown', this._onGripDown);
      this._layer!.appendChild(grip);
      pool.push(grip);
    }
    // Indices are positional — restamp after a resize so a grip never keeps
    // an index that now belongs to a different row.
    pool.forEach((grip, i) => { grip.dataset.index = String(i); });
  }

  /**
   * Viewport → container coordinates.  The controls live inside
   * `.canvas-editor-wrapper` (position:relative, overflow-y:auto), so every
   * placement subtracts the container's viewport offset and adds its scroll —
   * identical to the block drag handle's convention.
   */
  private _place(ec: HTMLElement, metrics: TableMetrics): void {
    const ecRect = ec.getBoundingClientRect();
    const dx = -ecRect.left + ec.scrollLeft;
    const dy = -ecRect.top + ec.scrollTop;
    const { rect, rows, cols } = metrics;

    // A table wider than its wrapper scrolls horizontally inside it.  The row
    // grips and the corner PIN to whichever left edge is visible — they belong
    // to rows, which are always on screen — while column grips scrolled out of
    // view are hidden rather than left floating over neighbouring text.
    const wrapper = this._tableEl?.closest('.tableWrapper') as HTMLElement | null;
    const clip = wrapper ? wrapper.getBoundingClientRect() : null;
    const viewLeft = clip ? Math.max(rect.left, clip.left) : rect.left;
    const viewRight = clip ? Math.min(rect.right, clip.right) : rect.right;

    const place = (el: HTMLElement | null, left: number, top: number, w: number, h: number): void => {
      if (!el) return;
      el.style.display = '';
      el.style.left = `${left + dx}px`;
      el.style.top = `${top + dy}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };

    for (let i = 0; i < this._rowGrips.length && i < rows.length; i++) {
      place(this._rowGrips[i], viewLeft - GRIP - GAP, rows[i].top, GRIP, rows[i].height);
    }
    for (let i = 0; i < this._colGrips.length && i < cols.length; i++) {
      const col = cols[i];
      const grip = this._colGrips[i];
      if (clip && (col.left + col.width <= clip.left || col.left >= clip.right)) {
        grip.style.display = 'none';
        continue;
      }
      place(grip, col.left, rect.top - GRIP - GAP, col.width, GRIP);
    }
    place(this._cornerEl, viewLeft - GRIP - GAP, rect.top - GRIP - GAP, GRIP, GRIP);
    place(this._addColEl, viewRight + GAP, rect.top, GRIP + 6, rect.height);
    place(this._addRowEl, viewLeft, rect.bottom + GAP, Math.max(viewRight - viewLeft, GRIP), GRIP + 6);
  }

  // ── Grip gestures ───────────────────────────────────────────────────────
  //
  // The reorder runs on `beginPointerDrag` (ui/interactionMode.ts), not on
  // hand-rolled document listeners.  SYSTEM_INTEGRITY.md Phase A item 3 names
  // canvas drags as adopters of the guarded-drag helper for exactly this
  // reason: a drag whose only end path is `mouseup` strands the app when the
  // button is released outside the window or the OS steals focus.  Through the
  // helper, Escape / pointercancel / lost capture / window blur all route to
  // one cleanup that restores the body cursor and user-select — and Escape
  // now CANCELS a reorder in flight instead of committing it.

  private readonly _onGripDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget as HTMLElement;
    const axis = (grip.dataset.axis as Axis) ?? 'row';
    const index = Number(grip.dataset.index ?? -1);
    const editor = this._host.editor;
    if (!editor || index < 0 || this._tablePos < 0) return;

    // Aim first, always — the selection IS the feedback, and every command
    // the menu can run reads it.
    const aimed = axis === 'row'
      ? selectTableRow(editor, this._tablePos, index)
      : selectTableColumn(editor, this._tablePos, index);
    if (!aimed) return;

    const drag = {
      axis, index, grip,
      origin: { x: e.clientX, y: e.clientY },
      moved: false,
      target: index,
    };
    this._drag = drag;
    this._dragHandle = beginPointerDrag(e, {
      id: `canvas-table-${axis}-reorder`,
      captureTarget: grip,
      cursor: 'grabbing',
      onMove: (ev) => this._onDragMove(ev),
      onEnd: (canceled) => this._onDragEnd(canceled),
    });
  };

  private _onDragMove(e: { clientX: number; clientY: number }): void {
    const drag = this._drag;
    if (!drag || !this._metrics) return;
    const dist = Math.hypot(e.clientX - drag.origin.x, e.clientY - drag.origin.y);
    if (!drag.moved && dist < REORDER_THRESHOLD) return;

    if (!drag.moved) {
      drag.moved = true;
      this._layer?.classList.add('table-controls--reordering');
      this._menu.hide();
    }

    const bands = drag.axis === 'row'
      ? this._metrics.rows.map((r) => ({ start: r.top, size: r.height }))
      : this._metrics.cols.map((c) => ({ start: c.left, size: c.width }));
    const pointer = drag.axis === 'row' ? e.clientY : e.clientX;

    // Insertion index = the band whose midpoint the pointer has passed.
    let target = bands.length - 1;
    for (let i = 0; i < bands.length; i++) {
      if (pointer < bands[i].start + bands[i].size / 2) { target = i; break; }
    }
    drag.target = this._clampToMovableRange(drag.axis, target);
    this._showIndicator(drag.axis, drag.target);
  }

  private _onDragEnd(canceled: boolean): void {
    const drag = this._drag;
    this._clearDragVisuals();
    this._drag = null;
    this._dragHandle = null;
    if (!drag) return;
    const editor = this._host.editor;
    if (!editor) return;

    // Escape / blur / lost capture: abandon the gesture entirely.  The row
    // stays selected (the aim still happened) but nothing moves and no menu
    // opens — a canceled drag must not silently become a click.
    if (canceled) return;

    if (!drag.moved) {
      // A click, not a drag: open the menu on the grip we aimed with.
      const rect = drag.grip.getBoundingClientRect();
      this._menu.show(drag.axis === 'row' ? 'row' : 'column', this._tablePos, drag.index, rect, drag.grip);
      return;
    }

    const delta = drag.target - drag.index;
    if (delta !== 0) {
      if (drag.axis === 'row') moveRowBy(editor, delta);
      else moveColumnBy(editor, delta);
      this._render();
    }
    editor.view.focus();
  }

  /** Header row/column are pinned — nothing may be dropped above or before them. */
  private _clampToMovableRange(axis: Axis, index: number): number {
    const editor = this._host.editor;
    if (!editor) return index;
    const frame = tableFrameAt(editor.state.doc, this._tablePos);
    if (!frame) return index;
    if (axis === 'row') {
      const floor = frame.headerRow ? 1 : 0;
      return Math.min(Math.max(index, floor), frame.rows - 1);
    }
    const floor = frame.headerCol ? 1 : 0;
    return Math.min(Math.max(index, floor), frame.cols - 1);
  }

  private _showIndicator(axis: Axis, index: number): void {
    const ec = this._host.editorContainer;
    if (!ec || !this._indicatorEl || !this._metrics) return;
    const ecRect = ec.getBoundingClientRect();
    const dx = -ecRect.left + ec.scrollLeft;
    const dy = -ecRect.top + ec.scrollTop;
    const { rect, rows, cols } = this._metrics;

    this._indicatorEl.style.display = 'block';
    if (axis === 'row') {
      const band = rows[Math.min(index, rows.length - 1)];
      this._indicatorEl.style.left = `${rect.left + dx}px`;
      this._indicatorEl.style.top = `${band.top + dy}px`;
      this._indicatorEl.style.width = `${rect.width}px`;
      this._indicatorEl.style.height = '2px';
    } else {
      const band = cols[Math.min(index, cols.length - 1)];
      this._indicatorEl.style.left = `${band.left + dx}px`;
      this._indicatorEl.style.top = `${rect.top + dy}px`;
      this._indicatorEl.style.width = '2px';
      this._indicatorEl.style.height = `${rect.height}px`;
    }
  }

  private _clearDragVisuals(): void {
    this._layer?.classList.remove('table-controls--reordering');
    if (this._indicatorEl) this._indicatorEl.style.display = 'none';
  }

  /** Abort any drag in flight (teardown). Routes through the same one exit. */
  private _endDrag(): void {
    this._dragHandle?.cancel();
    this._dragHandle = null;
    this._drag = null;
    this._clearDragVisuals();
  }

  // ── Corner & ✛ buttons ──────────────────────────────────────────────────

  private readonly _onCornerDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const editor = this._host.editor;
    if (!editor || this._tablePos < 0) return;
    if (!selectTableNode(editor, this._tablePos)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._menu.show('table', this._tablePos, 0, rect, e.currentTarget as HTMLElement);
  };

  private readonly _onAddRow = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const editor = this._host.editor;
    if (!editor || this._tablePos < 0) return;
    appendRow(editor, this._tablePos);
    editor.view.focus();
    this._render();
  };

  private readonly _onAddColumn = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const editor = this._host.editor;
    if (!editor || this._tablePos < 0) return;
    appendColumn(editor, this._tablePos);
    editor.view.focus();
    this._render();
  };
}
