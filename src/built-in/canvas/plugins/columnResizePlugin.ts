// columnResizePlugin.ts — Pointer-based column resize plugin
//
// Scans all .canvas-column-list elements by coordinate (not event.target) to
// detect column boundaries. Positions are resolved by walking the ProseMirror
// document tree at commit time, avoiding stale-position bugs. Cursor is
// managed via CSS class on document.body for reliable override.
//
// Boundary detection is done via a container-level mousemove listener (not
// ProseMirror's handleDOMEvents) because the GlobalDragHandle's drag-handle
// div (position: fixed, z-index: 50) can sit directly on top of column
// boundaries. When that happens, ProseMirror never receives the mousemove
// and the `column-resize-hover` CSS class never gets set. The container
// listener catches events that bubble up from the drag handle.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export function columnResizePlugin(): Plugin {
  const pluginKey = new PluginKey('columnResize');

  interface DragState {
    startX: number;
    leftStartWidth: number;  // percentage at drag start
    rightStartWidth: number; // percentage at drag start
    listEl: HTMLElement;     // the columnList container DOM
    leftIndex: number;       // 0-based child index in columnList
    rightIndex: number;
    lastLeftW?: number;      // last width set during drag (for final commit)
    lastRightW?: number;
  }

  let dragging: DragState | null = null;
  let lastPointerClient: { x: number; y: number } | null = null;
  let hoverSyncRaf: number | null = null;

  /**
   * Find column boundary nearest to (x, y) by scanning ALL column lists in
   * the editor DOM. Does NOT use event.target — works even when hovering over
   * drag-handle overlays or pseudo-elements.
   */
  function findBoundary(
    view: EditorView,
    x: number,
    y: number,
    tolerance: number,
  ): {
    leftCol: HTMLElement;
    rightCol: HTMLElement;
    listEl: HTMLElement;
    leftIndex: number;
    rightIndex: number;
  } | null {
    const lists = view.dom.querySelectorAll('.canvas-column-list');
    for (const list of lists) {
      const listRect = list.getBoundingClientRect();
      if (y < listRect.top || y > listRect.bottom) continue;

      const columns = Array.from(list.children).filter(
        el => (el as HTMLElement).classList.contains('canvas-column'),
      ) as HTMLElement[];

      for (let i = 0; i < columns.length - 1; i++) {
        const leftRect = columns[i].getBoundingClientRect();
        const rightRect = columns[i + 1].getBoundingClientRect();
        const boundaryX = (leftRect.right + rightRect.left) / 2;
        if (Math.abs(x - boundaryX) <= tolerance) {
          return {
            leftCol: columns[i],
            rightCol: columns[i + 1],
            listEl: list as HTMLElement,
            leftIndex: i,
            rightIndex: i + 1,
          };
        }
      }
    }
    return null;
  }

  /** Percentage width of a column relative to its container. */
  function colPercent(col: HTMLElement, container: HTMLElement): number {
    return (col.getBoundingClientRect().width / container.getBoundingClientRect().width) * 100;
  }

  /**
   * Resolve the ProseMirror position of the Nth column inside a columnList by
   * walking the document tree. Uses posAtDOM only to locate the columnList
   * ancestor, then iterates children by index.
   */
  function findColumnPos(
    view: EditorView,
    listEl: HTMLElement,
    columnIndex: number,
  ): number | null {
    const insidePos = view.posAtDOM(listEl, 0);
    const $pos = view.state.doc.resolve(insidePos);
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === 'columnList') {
        const listNodePos = $pos.before(d);
        const listNode = view.state.doc.nodeAt(listNodePos);
        if (!listNode) return null;
        let offset = listNodePos + 1;
        for (let i = 0; i < listNode.childCount; i++) {
          if (i === columnIndex) return offset;
          offset += listNode.child(i).nodeSize;
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Dispatch a ProseMirror transaction that updates two column widths.
   * When skipHistory is true, the transaction won't create an undo step
   * (used during drag — only the final mouseup commits to history).
   */
  function applyColumnWidths(
    view: EditorView,
    listEl: HTMLElement,
    leftIndex: number,
    rightIndex: number,
    leftW: number | null,
    rightW: number | null,
    skipHistory = false,
  ): boolean {
    const leftPos = findColumnPos(view, listEl, leftIndex);
    const rightPos = findColumnPos(view, listEl, rightIndex);
    if (leftPos === null || rightPos === null) return false;

    const leftNode = view.state.doc.nodeAt(leftPos);
    const rightNode = view.state.doc.nodeAt(rightPos);
    if (!leftNode || !rightNode) return false;

    const { tr } = view.state;
    if (skipHistory) tr.setMeta('addToHistory', false);
    tr.setNodeMarkup(leftPos, undefined, { ...leftNode.attrs, width: leftW });
    tr.setNodeMarkup(rightPos, undefined, { ...rightNode.attrs, width: rightW });
    view.dispatch(tr);
    return true;
  }

  let resizeIndicator: HTMLElement | null = null;

  return new Plugin({
    key: pluginKey,

    // Container-level boundary detection — works even when the drag handle
    // (z-index: 50, position: fixed) sits directly over the column boundary
    // and intercepts events that would otherwise reach ProseMirror's DOM.
    // Events on the drag handle bubble up to the container, so this listener
    // always fires regardless of what element is topmost.
    view: (editorView: EditorView) => {
      const container = editorView.dom.parentElement;

      // Standalone resize indicator line — lives outside ProseMirror's
      // DOM control so it can't be stripped by view updates.
      resizeIndicator = document.createElement('div');
      resizeIndicator.className = 'column-resize-indicator';
      document.body.appendChild(resizeIndicator);

      const showIndicator = (leftCol: HTMLElement) => {
        if (!resizeIndicator) return;
        const colRect = leftCol.getBoundingClientRect();
        resizeIndicator.style.left = `${colRect.right + 7}px`;
        resizeIndicator.style.top = `${colRect.top}px`;
        resizeIndicator.style.height = `${colRect.height}px`;
        resizeIndicator.style.display = 'block';
      };

      const hideIndicator = () => {
        if (resizeIndicator) resizeIndicator.style.display = 'none';
      };

      const refreshHoverState = (x: number, y: number) => {
        if (dragging) return;
        const boundary = findBoundary(editorView, x, y, 12);
        if (boundary) {
          document.body.classList.add('column-resize-hover');
          showIndicator(boundary.leftCol);
        } else {
          document.body.classList.remove('column-resize-hover');
          hideIndicator();
        }
      };

      const onContainerMousemove = (event: MouseEvent) => {
        lastPointerClient = { x: event.clientX, y: event.clientY };
        refreshHoverState(event.clientX, event.clientY);
      };

      const onViewportGeometryChange = () => {
        if (hoverSyncRaf != null) return;
        hoverSyncRaf = window.requestAnimationFrame(() => {
          hoverSyncRaf = null;
          if (!lastPointerClient) return;
          refreshHoverState(lastPointerClient.x, lastPointerClient.y);
        });
      };

      container?.addEventListener('mousemove', onContainerMousemove);
      window.addEventListener('scroll', onViewportGeometryChange, true);
      window.addEventListener('resize', onViewportGeometryChange);

      return {
        destroy: () => {
          container?.removeEventListener('mousemove', onContainerMousemove);
          window.removeEventListener('scroll', onViewportGeometryChange, true);
          window.removeEventListener('resize', onViewportGeometryChange);
          if (hoverSyncRaf != null) {
            window.cancelAnimationFrame(hoverSyncRaf);
            hoverSyncRaf = null;
          }
          lastPointerClient = null;
          resizeIndicator?.remove();
          resizeIndicator = null;
          document.body.classList.remove('column-resize-hover');
          document.body.classList.remove('column-resizing');
        },
      };
    },

    props: {
      handleDOMEvents: {
        mousemove: (view: EditorView, event: MouseEvent) => {
          if (dragging) {
            // Dispatch a real ProseMirror transaction on each frame so the
            // DOM update is handled natively by PM — no DOMObserver conflicts.
            // Skip history for intermediate steps — only mouseup commits.
            const delta = event.clientX - dragging.startX;
            const containerWidth = dragging.listEl.getBoundingClientRect().width;
            if (containerWidth === 0) return true;
            const deltaPercent = (delta / containerWidth) * 100;

            // Clamp drag delta once so the boundary hard-stops when either
            // side reaches min width. This preserves the pair sum and avoids
            // pushing the non-dragged outer edge.
            const minDelta = 10 - dragging.leftStartWidth;
            const maxDelta = dragging.rightStartWidth - 10;
            const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaPercent));

            const newLeft = dragging.leftStartWidth + clampedDelta;
            const newRight = dragging.rightStartWidth - clampedDelta;
            const leftW = Math.round(newLeft * 10) / 10;
            const rightW = Math.round(newRight * 10) / 10;

            // Track last widths for the final history-enabled commit
            dragging.lastLeftW = leftW;
            dragging.lastRightW = rightW;

            applyColumnWidths(
              view, dragging.listEl,
              dragging.leftIndex, dragging.rightIndex,
              leftW, rightW,
              true, // skipHistory — don't flood undo stack
            );

            event.preventDefault();
            return true;
          }

          // Boundary detection is handled by the container-level listener
          // (see view() above). Nothing to do here when not dragging.
          return false;
        },

        mousedown: (view: EditorView, event: MouseEvent) => {
          const boundary = findBoundary(view, event.clientX, event.clientY, 12);
          if (!boundary) return false;

          event.preventDefault();
          const { leftCol, rightCol, listEl, leftIndex, rightIndex } = boundary;

          dragging = {
            startX: event.clientX,
            leftStartWidth: colPercent(leftCol, listEl),
            rightStartWidth: colPercent(rightCol, listEl),
            listEl,
            leftIndex,
            rightIndex,
          };

          document.body.classList.add('column-resizing');
          // Hide the hover indicator during active resize
          if (resizeIndicator) resizeIndicator.style.display = 'none';

          const finish = () => {
            window.removeEventListener('mouseup', finish);
            // Commit final widths as a single undoable transaction.
            // All intermediate mousemove transactions were skipHistory.
            if (dragging && dragging.lastLeftW != null && dragging.lastRightW != null) {
              applyColumnWidths(
                view, dragging.listEl,
                dragging.leftIndex, dragging.rightIndex,
                dragging.lastLeftW, dragging.lastRightW,
                false, // commit to history
              );
            }
            dragging = null;
            document.body.classList.remove('column-resizing');
            // NOTE: column-resize-hover is NOT removed here — it's managed
            // exclusively by the mousemove handler. Removing it here would
            // re-enable the drag handle between the two clicks of a dblclick,
            // preventing the dblclick from reaching the resize zone.
          };

          window.addEventListener('mouseup', finish);
          return true;
        },

        dblclick: (view: EditorView, event: MouseEvent) => {
          const boundary = findBoundary(view, event.clientX, event.clientY, 12);
          if (!boundary) return false;
          event.preventDefault();
          applyColumnWidths(
            view, boundary.listEl,
            boundary.leftIndex, boundary.rightIndex,
            null, null,
          );
          return true;
        },
      },
    },
  });
}
