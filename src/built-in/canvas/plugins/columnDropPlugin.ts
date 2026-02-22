// columnDropPlugin.ts — Drag-and-drop event shell for block movement
//
// Per docs/BLOCK_INTERACTION_RULES.md Rules 3-4.
//
// Two guide types:
//   • Horizontal (above/below) — reorder blocks at any level
//   • Vertical (left/right)    — create or extend column layouts
//
// Supports ALL drop scenarios:
//   4A  top-level → top-level          (reorder or new columnList)
//   4B  top-level → block in column    (insert into column or add column)
//   4C  column → top-level             (extract or new columnList)
//   4D  column → same column           (reorder or split column)
//   4E  column → different column      (transfer or add column)
//   4F  column → different columnList  (same as 4B from source)
//
// This plugin is a thin event-handling shell.  All actual block relocation
// logic lives in blockMovement.ts (part of blockStateRegistry).  The plugin
// resolves drop targets from DOM events, then delegates to movement
// primitives: moveBlockAboveBelow, createColumnLayoutFromDrop,
// addColumnToLayoutFromDrop.
//
// Empty-column cleanup is delegated to columnAutoDissolvePlugin.
// Width redistribution is handled by addColumnToLayoutFromDrop.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  PAGE_CONTAINERS,
  resolveBlockAncestry,
  moveBlockAboveBelow,
  createColumnLayoutFromDrop,
  addColumnToLayoutFromDrop,
} from '../config/blockStateRegistry/blockStateRegistry.js';

export function columnDropPlugin(): Plugin {
  const pluginKey = new PluginKey('columnDrop');

  // ── Indicator elements ──
  let vertIndicator: HTMLElement | null = null;
  let horzIndicator: HTMLElement | null = null;

  interface DropTarget {
    zone: 'above' | 'below' | 'left' | 'right';
    blockEl: HTMLElement;
    blockPos: number;
    blockNode: any;
    // Column context (null = top-level block)
    columnPos: number | null;
    columnListPos: number | null;
    columnIndex: number;
  }

  let activeTarget: DropTarget | null = null;

  // ── Indicator helpers ──

  function ensureVert(container: HTMLElement): HTMLElement {
    if (!vertIndicator) {
      vertIndicator = document.createElement('div');
      vertIndicator.className = 'column-drop-indicator';
    }
    if (vertIndicator.parentElement !== container) {
      container.style.position = 'relative';
      container.appendChild(vertIndicator);
    }
    return vertIndicator;
  }

  function ensureHorz(container: HTMLElement): HTMLElement {
    if (!horzIndicator) {
      horzIndicator = document.createElement('div');
      horzIndicator.className = 'canvas-drop-guide';
    }
    if (horzIndicator.parentElement !== container) {
      container.style.position = 'relative';
      container.appendChild(horzIndicator);
    }
    return horzIndicator;
  }

  function hideAll() {
    if (vertIndicator) vertIndicator.style.display = 'none';
    if (horzIndicator) horzIndicator.style.display = 'none';
    activeTarget = null;
  }

  function showVert(container: HTMLElement, blockEl: HTMLElement, side: 'left' | 'right') {
    const el = ensureVert(container);
    const bRect = blockEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const sT = container.scrollTop;
    const sL = container.scrollLeft;
    el.style.top = `${bRect.top - cRect.top + sT}px`;
    el.style.height = `${bRect.height}px`;
    el.style.left = side === 'left'
      ? `${bRect.left - cRect.left + sL - 2}px`
      : `${bRect.right - cRect.left + sL}px`;
    el.style.display = 'block';
    if (horzIndicator) horzIndicator.style.display = 'none';
  }

  function showHorz(
    container: HTMLElement,
    blockEl: HTMLElement,
    pos: 'above' | 'below',
    proseMirrorRoot: HTMLElement,
  ) {
    const el = ensureHorz(container);
    const bRect = blockEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const sT = container.scrollTop;
    const sL = container.scrollLeft;
    const parent = blockEl.parentElement;
    const spanRect = (parent && parent !== proseMirrorRoot)
      ? parent.getBoundingClientRect()
      : bRect;
    el.style.top = pos === 'above'
      ? `${bRect.top - cRect.top + sT - 1}px`
      : `${bRect.bottom - cRect.top + sT + 1}px`;
    el.style.left = `${spanRect.left - cRect.left + sL}px`;
    el.style.width = `${spanRect.width}px`;
    el.style.display = 'block';
    if (vertIndicator) vertIndicator.style.display = 'none';
  }

  // ── Target detection ──
  // Walk up from elementsFromPoint hits to find the nearest block-level
  // element that is a direct child of a Page-container (doc, column,
  // callout, detailsContent, blockquote).  Works at any nesting depth.

  // PAGE_CONTAINERS imported from blockRegistry — single source of truth.

  /** DOM selectors for page-container elements. */
  function isPageContainerDom(el: HTMLElement | null, proseMirrorRoot: HTMLElement): boolean {
    if (!el) return false;
    if (el === proseMirrorRoot) return true; // doc root
    return (
      el.classList.contains('canvas-column') ||
      el.classList.contains('canvas-callout-content') ||
      el.matches?.('[data-type=detailsContent]') ||
      el.tagName === 'BLOCKQUOTE'
    );
  }

  function resolveBlockTarget(view: EditorView, blockEl: HTMLElement): Omit<DropTarget, 'zone'> | null {
    try {
      const inner = view.posAtDOM(blockEl, 0);
      const $p = view.state.doc.resolve(inner);
      const ancestry = resolveBlockAncestry($p);

      if (ancestry.blockDepth > $p.depth) return null;

      const blockPos = $p.before(ancestry.blockDepth);
      const blockNode = view.state.doc.nodeAt(blockPos);
      if (!blockNode) return null;

      let columnPos: number | null = null;
      let columnListPos: number | null = null;
      let colIdx = 0;

      if (ancestry.columnDepth !== null && ancestry.columnListDepth !== null) {
        columnPos = $p.before(ancestry.columnDepth);
        columnListPos = $p.before(ancestry.columnListDepth);
        const clNode = view.state.doc.nodeAt(columnListPos);
        if (clNode) {
          let off = columnListPos + 1;
          for (let i = 0; i < clNode.childCount; i++) {
            if (off === columnPos) { colIdx = i; break; }
            off += clNode.child(i).nodeSize;
          }
        }
      }

      return { blockEl, blockPos, blockNode, columnPos, columnListPos, columnIndex: colIdx };
    } catch {
      return null;
    }
  }

  function resolveNearestBlockInColumn(
    view: EditorView,
    columnEl: HTMLElement,
    y: number,
  ): Omit<DropTarget, 'zone'> | null {
    const children = Array.from(columnEl.children) as HTMLElement[];
    const candidates = children.filter((child) =>
      !child.classList?.contains('column-drop-indicator') &&
      !child.classList?.contains('canvas-drop-guide'));
    if (candidates.length === 0) return null;

    let nearestEl: HTMLElement | null = null;
    let nearestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const child = candidates[i];
      const r = child.getBoundingClientRect();
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        nearestEl = child;
        nearestIdx = i;
      }
    }
    if (!nearestEl) return null;

    try {
      const columnListEl = columnEl.parentElement as HTMLElement | null;
      if (!columnListEl) return null;

      const columnEls = (Array.from(columnListEl.children) as HTMLElement[])
        .filter((el) => el.classList.contains('canvas-column'));
      const colIdx = columnEls.findIndex((el) => el === columnEl);
      if (colIdx < 0) return null;

      const listInner = view.posAtDOM(columnListEl, 0);
      const $list = view.state.doc.resolve(listInner);
      let clDepth = 0;
      for (let d = 1; d <= $list.depth; d++) {
        if ($list.node(d).type.name === 'columnList') {
          clDepth = d;
        }
      }
      if (!clDepth) return null;

      const columnListPos = $list.before(clDepth);
      const clNode = view.state.doc.nodeAt(columnListPos);
      if (!clNode || colIdx >= clNode.childCount) return null;

      let columnPos = columnListPos + 1;
      for (let i = 0; i < colIdx; i++) columnPos += clNode.child(i).nodeSize;
      const columnNode = clNode.child(colIdx);
      if (!columnNode || columnNode.childCount === 0) return null;

      const pmIdx = Math.min(nearestIdx, columnNode.childCount - 1);
      let blockPos = columnPos + 1;
      for (let i = 0; i < pmIdx; i++) blockPos += columnNode.child(i).nodeSize;
      const blockNode = columnNode.child(pmIdx);

      return {
        blockEl: nearestEl,
        blockPos,
        blockNode,
        columnPos,
        columnListPos,
        columnIndex: colIdx,
      };
    } catch {
      return null;
    }
  }

  function findTarget(view: EditorView, x: number, y: number): Omit<DropTarget, 'zone'> | null {
    const elements = document.elementsFromPoint(x, y);
    const proseMirror = view.dom;

    for (const el of elements) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.classList?.contains('column-drop-indicator') ||
          htmlEl.classList?.contains('canvas-drop-guide')) continue;

      const containingColumn = htmlEl.closest('.canvas-column') as HTMLElement | null;
      if (containingColumn && proseMirror.contains(containingColumn)) {
        const resolvedInColumn = resolveNearestBlockInColumn(view, containingColumn, y);
        if (resolvedInColumn) return resolvedInColumn;
      }

      // Walk up from the hit element to find a block-level element
      // whose parent is a page-container.
      let cur: HTMLElement | null = htmlEl;
      while (cur && cur !== proseMirror) {
        const parent: HTMLElement | null = cur.parentElement;
        if (!parent) break;

        if (isPageContainerDom(cur, proseMirror)) {
          const children = Array.from(cur.children) as HTMLElement[];
          let nearest: HTMLElement | null = null;
          let bestDist = Infinity;
          for (const child of children) {
            if (child.classList?.contains('column-drop-indicator') ||
                child.classList?.contains('canvas-drop-guide')) continue;
            const r = child.getBoundingClientRect();
            const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
            if (dist < bestDist) { bestDist = dist; nearest = child; }
          }
          if (nearest) {
            const resolved = resolveBlockTarget(view, nearest);
            if (resolved) return resolved;
          }
          const resolvedSelf = resolveBlockTarget(view, cur);
          if (resolvedSelf) return resolvedSelf;
        }

        if (isPageContainerDom(parent, proseMirror)) {
          if (parent.classList.contains('canvas-column')) {
            const resolvedInColumn = resolveNearestBlockInColumn(view, parent, y);
            if (resolvedInColumn) return resolvedInColumn;
          }

          const resolved = resolveBlockTarget(view, cur);
          if (resolved) return resolved;
          cur = parent;
          continue;
        }
        cur = parent;
      }
    }

    // Fallback: cursor is in empty space (e.g. below last block or in
    // editor padding).  Find the nearest top-level block by vertical
    // distance so the user can always drop above/below the closest block.
    const topBlocks = Array.from(proseMirror.children) as HTMLElement[];
    let bestEl: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const child of topBlocks) {
      if (child.classList?.contains('column-drop-indicator') ||
          child.classList?.contains('canvas-drop-guide')) continue;
      const r = child.getBoundingClientRect();
      // Vertical distance from cursor to block
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) { bestDist = dist; bestEl = child; }
    }
    if (bestEl && bestDist < 100) {
      try {
        const inner = view.posAtDOM(bestEl, 0);
        const $p = view.state.doc.resolve(inner);
        const blockPos = $p.before(1);
        const blockNode = view.state.doc.nodeAt(blockPos);
        if (blockNode) {
          return { blockEl: bestEl, blockPos, blockNode, columnPos: null, columnListPos: null, columnIndex: 0 };
        }
      } catch { /* fall through */ }
    }

    return null;
  }

  // ── Drop zone detection ──
  // Left/right edges → vertical guide (column create/extend).
  // Centre area → horizontal guide (above/below reorder).
  // columnList targets only allow above/below (Rule 9 nesting prevention).

  function getZone(
    blockEl: HTMLElement,
    x: number,
    y: number,
    isColumnList: boolean,
  ): 'above' | 'below' | 'left' | 'right' {
    const r = blockEl.getBoundingClientRect();
    const rx = x - r.left;   // cursor X relative to block left edge

    // Fixed-pixel edge zones: the leftmost / rightmost portion of the
    // block are column-creation territory (left / right).  Everything
    // else resolves to above / below by Y midpoint.  This matches
    // Notion's behavior — column splits require a deliberate horizontal
    // gesture into a narrow strip at the edge of the target block.
    //
    // For wide blocks (≥150px) use 50px edges; for narrower blocks
    // scale down to 20% of width so side-drop always remains reachable.
    const EDGE = r.width >= 150 ? 50 : Math.max(16, r.width * 0.2);

    // Nesting constraint: columnList targets only allow above/below.
    // Blocks INSIDE columns DO allow left/right — the drop handler
    // inserts a new column into the existing columnList (no nesting).
    const preventLeftRight = isColumnList;

    if (!preventLeftRight) {
      // Only allow left/right when cursor is inside the block bounds
      // (rx < 0 means cursor is on the drag handle, outside the block)
      if (rx >= 0 && rx < EDGE) return 'left';
      if (rx <= r.width && rx > r.width - EDGE) return 'right';
    }

    const ry = y - r.top;
    return ry < r.height / 2 ? 'above' : 'below';
  }

  // ── Plugin ──

  return new Plugin({
    key: pluginKey,

    view: () => ({
      destroy: () => {
        vertIndicator?.remove();
        horzIndicator?.remove();
        vertIndicator = null;
        horzIndicator = null;
      },
    }),

    props: {
      handleDOMEvents: {
        dragover: (view: EditorView, event: DragEvent) => {
          if (!view.dragging) { hideAll(); return false; }

          const x = event.clientX;
          const y = event.clientY;
          let raw = findTarget(view, x, y);
          if (!raw) { hideAll(); return false; }

          if (raw.blockNode.type.name === 'columnList') {
            const over = document.elementsFromPoint(x, y) as HTMLElement[];
            const columnEl = over
              .map((el) => el.closest('.canvas-column') as HTMLElement | null)
              .find((el): el is HTMLElement => !!el && view.dom.contains(el));
            if (columnEl) {
              const resolvedInColumn = resolveNearestBlockInColumn(view, columnEl, y);
              if (resolvedInColumn) raw = resolvedInColumn;
            }
          }

          // Nesting prevention — skip if dragged content is a columnList
          if (view.dragging.slice.content.firstChild?.type.name === 'columnList') {
            hideAll(); return false;
          }

          // Skip if hovering over the source block
          const { from: dF, to: dT } = view.state.selection;
          if (raw.blockPos >= dF && raw.blockPos < dT) {
            hideAll(); return false;
          }

          const isCL = raw.blockNode.type.name === 'columnList';
          const zone = getZone(raw.blockEl, x, y, isCL);
          activeTarget = { ...raw, zone };

          const container = view.dom.parentElement;
          if (!container) { hideAll(); return false; }

          if (zone === 'left' || zone === 'right') {
            showVert(container, raw.blockEl, zone);
          } else {
            showHorz(container, raw.blockEl, zone, view.dom as HTMLElement);
          }

          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
          }
          return false;
        },

        dragleave: (view: EditorView, event: DragEvent) => {
          const rt = event.relatedTarget as HTMLElement | null;
          if (!rt || !view.dom.contains(rt)) hideAll();
          return false;
        },

        drop: (view: EditorView, event: DragEvent) => {
          if (!activeTarget) return false;
          const target = activeTarget;
          hideAll();

          const dragging = view.dragging;
          if (!dragging?.slice) return false;
          const slice = dragging.slice;
          if (slice.openStart > 0 || slice.openEnd > 0) return false;
          if (slice.content.childCount === 0) return false;
          if (slice.content.firstChild?.type.name === 'columnList') return false;

          const { schema } = view.state;
          if (!schema.nodes.column || !schema.nodes.columnList) return false;

          event.preventDefault();
          event.stopPropagation();

          const { from: dragFrom, to: dragTo } = view.state.selection;
          const content = slice.content;
          const { tr } = view.state;
          tr.setMeta('addToHistory', true);

          // Alt+Drag → duplicate (don't delete source)
          const isDuplicate = event.altKey;

          // ── ABOVE / BELOW — reorder block at any level ──
          if (target.zone === 'above' || target.zone === 'below') {
            const insertPos = target.zone === 'above'
              ? target.blockPos
              : target.blockPos + target.blockNode.nodeSize;
            moveBlockAboveBelow(tr, content, insertPos, dragFrom, dragTo, isDuplicate);
            view.dispatch(tr);
            return true;
          }

          // ── LEFT / RIGHT — create or extend columns ──

          if (target.columnPos === null) {
            // Target is a top-level block (4A, 4C) → create new columnList
            const ok = createColumnLayoutFromDrop(
              tr, schema, content,
              target.blockPos, target.blockNode,
              target.zone as 'left' | 'right',
              dragFrom, dragTo, isDuplicate,
            );
            if (!ok) return false;
            view.dispatch(tr);
            return true;
          }

          // Target is inside a column (4B, 4D, 4E, 4F) → add column
          const ok = addColumnToLayoutFromDrop(
            tr, view.state.doc, schema, content,
            target.columnPos, target.columnListPos!,
            target.zone as 'left' | 'right',
            dragFrom, dragTo, isDuplicate,
          );
          if (!ok) return false;

          view.dispatch(tr);
          return true;
        },

        dragend: () => {
          hideAll();
          return false;
        },
      },
    },
  });
}
