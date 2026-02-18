// columnDropPlugin.ts — Full drag-and-drop engine for column layouts
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
// Empty-column cleanup is delegated to columnAutoDissolvePlugin.
// Width redistribution is handled inline when columns are added/removed.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

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

  function showHorz(container: HTMLElement, blockEl: HTMLElement, pos: 'above' | 'below') {
    const el = ensureHorz(container);
    const bRect = blockEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const sT = container.scrollTop;
    const sL = container.scrollLeft;
    el.style.top = pos === 'above'
      ? `${bRect.top - cRect.top + sT - 1}px`
      : `${bRect.bottom - cRect.top + sT + 1}px`;
    el.style.left = `${bRect.left - cRect.left + sL}px`;
    el.style.width = `${bRect.width}px`;
    el.style.display = 'block';
    if (vertIndicator) vertIndicator.style.display = 'none';
  }

  // ── Target detection ──
  // Walk up from elementsFromPoint hits to find the nearest block-level
  // element that is a direct child of a Page-container (doc, column,
  // callout, detailsContent, blockquote).  Works at any nesting depth.

  /** Node types that act as vertical block containers (Pages in the model). */
  const PAGE_CONTAINERS = new Set([
    'column', 'callout', 'detailsContent', 'blockquote',
  ]);

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

  function findTarget(view: EditorView, x: number, y: number): Omit<DropTarget, 'zone'> | null {
    const elements = document.elementsFromPoint(x, y);
    const proseMirror = view.dom;

    for (const el of elements) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.classList?.contains('column-drop-indicator') ||
          htmlEl.classList?.contains('canvas-drop-guide')) continue;

      // Walk up from the hit element to find a block-level element
      // whose parent is a page-container.
      let cur: HTMLElement | null = htmlEl;
      while (cur && cur !== proseMirror) {
        const parent: HTMLElement | null = cur.parentElement;
        if (!parent) break;

        if (isPageContainerDom(parent, proseMirror)) {
          // `cur` is a direct child of a page-container — it's a block element
          try {
            const inner = view.posAtDOM(cur, 0);
            const $p = view.state.doc.resolve(inner);

            // Find the deepest page-container ancestor in ProseMirror
            let containerDepth = 0;
            for (let d = 1; d <= $p.depth; d++) {
              if (PAGE_CONTAINERS.has($p.node(d).type.name)) {
                containerDepth = d;
              }
            }

            const blockDepth = containerDepth + 1;
            if (blockDepth > $p.depth) { cur = parent; continue; }

            const blockPos = $p.before(blockDepth);
            const blockNode = view.state.doc.nodeAt(blockPos);
            if (!blockNode) { cur = parent; continue; }

            // Determine column context
            let columnPos: number | null = null;
            let columnListPos: number | null = null;
            let colIdx = 0;

            if (containerDepth > 0 && $p.node(containerDepth).type.name === 'column') {
              columnPos = $p.before(containerDepth);
              columnListPos = $p.before(containerDepth - 1);
              const clNode = view.state.doc.nodeAt(columnListPos);
              if (clNode) {
                let off = columnListPos + 1;
                for (let i = 0; i < clNode.childCount; i++) {
                  if (off === columnPos) { colIdx = i; break; }
                  off += clNode.child(i).nodeSize;
                }
              }
            }

            return { blockEl: cur, blockPos, blockNode, columnPos, columnListPos, columnIndex: colIdx };
          } catch { break; }
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

    // Fixed-pixel edge zones: the leftmost / rightmost 50 px of the
    // block are column-creation territory (left / right).  Everything
    // else resolves to above / below by Y midpoint.  This matches
    // Notion's behavior — column splits require a deliberate horizontal
    // gesture into a narrow strip at the edge of the target block.
    const EDGE = 50; // px

    // Nesting constraint: columnList targets only allow above/below.
    // Blocks INSIDE columns DO allow left/right — the drop handler
    // inserts a new column into the existing columnList (no nesting).
    const preventLeftRight = isColumnList;

    if (!preventLeftRight && r.width > EDGE * 3) {
      // Only allow left/right when cursor is inside the block bounds
      // (rx < 0 means cursor is on the drag handle, outside the block)
      if (rx >= 0 && rx < EDGE) return 'left';
      if (rx <= r.width && rx > r.width - EDGE) return 'right';
    }

    const ry = y - r.top;
    return ry < r.height / 2 ? 'above' : 'below';
  }

  // ── Source deletion helper ──
  // Checks the source block's context in the CURRENT transaction doc
  // (after any earlier inserts). If the source is the last block in a
  // column, deletes the entire column and redistributes widths.

  function deleteSrc(tr: any, dragFrom: number, dragTo: number): void {
    const mFrom = tr.mapping.map(dragFrom);
    const mTo = tr.mapping.map(dragTo);
    const $src = tr.doc.resolve(mFrom);

    let colD = -1;
    for (let d = $src.depth; d >= 1; d--) {
      if ($src.node(d).type.name === 'column') { colD = d; break; }
    }

    if (colD >= 0) {
      const colNode = $src.node(colD);
      if (colNode.childCount <= 1) {
        // Last block in column — delete the entire column.
        // columnAutoDissolvePlugin will dissolve if ≤1 column remains.
        const colStart = $src.before(colD);
        const clPos = $src.before(colD - 1);
        tr.delete(colStart, colStart + colNode.nodeSize);

        // Redistribute widths in remaining columns to equal
        const clNow = tr.doc.nodeAt(clPos);
        if (clNow && clNow.type.name === 'columnList') {
          let off = clPos + 1;
          for (let i = 0; i < clNow.childCount; i++) {
            const ch = clNow.child(i);
            if (ch.type.name === 'column' && ch.attrs.width !== null) {
              tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
            }
            off += ch.nodeSize;
          }
        }
        return;
      }
    }

    // Normal delete — block has siblings in its container
    if (mTo > mFrom) tr.delete(mFrom, mTo);
  }

  // ── Width redistribution helper ──
  // Resets all columns in a columnList to equal widths (null = flex: 1).

  function resetWidths(tr: any, columnListPos: number): void {
    const mPos = tr.mapping.map(columnListPos);
    const cl = tr.doc.nodeAt(mPos);
    if (!cl || cl.type.name !== 'columnList') return;
    let off = mPos + 1;
    for (let i = 0; i < cl.childCount; i++) {
      const ch = cl.child(i);
      if (ch.type.name === 'column' && ch.attrs.width !== null) {
        tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
      }
      off += ch.nodeSize;
    }
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
          const raw = findTarget(view, x, y);
          if (!raw) { hideAll(); return false; }

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
            showHorz(container, raw.blockEl, zone);
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
          const columnType = schema.nodes.column;
          const columnListType = schema.nodes.columnList;
          if (!columnType || !columnListType) return false;

          event.preventDefault();
          event.stopPropagation();

          const { from: dragFrom, to: dragTo } = view.state.selection;
          const content = slice.content;
          const { tr } = view.state;

          // Alt+Drag → duplicate (don't delete source)
          const isDuplicate = event.altKey;

          // ── ABOVE / BELOW — reorder block at any level ──
          if (target.zone === 'above' || target.zone === 'below') {
            const insertPos = target.zone === 'above'
              ? target.blockPos
              : target.blockPos + target.blockNode.nodeSize;
            tr.insert(insertPos, content);
            if (!isDuplicate) deleteSrc(tr, dragFrom, dragTo);
            view.dispatch(tr);
            return true;
          }

          // ── LEFT / RIGHT — create or extend columns ──

          if (target.columnPos === null) {
            // Target is a top-level block (4A, 4C) → create new columnList
            const tNode = target.blockNode;
            let tCol: any, dCol: any;
            try {
              tCol = columnType.create(null, Fragment.from(tNode));
              dCol = columnType.create(null, content);
            } catch { return false; }

            const cols = target.zone === 'left'
              ? Fragment.from([dCol, tCol])
              : Fragment.from([tCol, dCol]);
            let cl: any;
            try { cl = columnListType.create(null, cols); } catch { return false; }

            tr.replaceWith(target.blockPos, target.blockPos + tNode.nodeSize, cl);
            if (!isDuplicate) deleteSrc(tr, dragFrom, dragTo);
            view.dispatch(tr);
            return true;
          }

          // Target is inside a column (4B, 4D, 4E, 4F) → add column to
          // the existing columnList
          const targetColNode = view.state.doc.nodeAt(target.columnPos);
          if (!targetColNode) return false;

          let newCol: any;
          try { newCol = columnType.create(null, content); } catch { return false; }

          const insertColPos = target.zone === 'left'
            ? target.columnPos
            : target.columnPos + targetColNode.nodeSize;

          tr.insert(insertColPos, newCol);
          if (!isDuplicate) deleteSrc(tr, dragFrom, dragTo);

          // Reset all column widths to equal after adding a column
          resetWidths(tr, target.columnListPos!);
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
