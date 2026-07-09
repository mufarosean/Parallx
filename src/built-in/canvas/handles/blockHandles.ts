// blockHandles.ts — Block Handles controller (+ button, drag handle, block resolution)
//
// Owns the full drag-handle lifecycle:
//   • Handle element creation & positioning (replaces GlobalDragHandle library)
//   • + button creation & positioning alongside the drag handle
//   • Block resolution from mouse position (ProseMirror posAtCoords → doc tree)
//   • Drag lifecycle (dragstart, dragend, interaction lock)
//
// Single resolution path: block is resolved once at mousemove time (stored as
// _resolvedBlockPos), and reused on click/drag — no dual-system disagreement.
//
// The Block Action Menu (turn-into, color, duplicate, delete) lives in
// menus/blockActionMenu.ts — this controller delegates to it via show/hide.

import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { rafThrottle } from '../../../platform/rafThrottle.js';
import type { BlockSelectionController } from './handleRegistry.js';
import type { IBlockActionMenu } from './handleRegistry.js';
import {
  svgIcon,
  CANVAS_BLOCK_DRAG_MIME,
  clearActiveCanvasDragSession,
  setActiveCanvasDragSession,
  resolveBlockAncestry,
  resolveMovableBlock,
  resolveBlockUnitFromDOM,
  listItemContentElement,
  isContainerBlockType,
} from './handleRegistry.js';
import { pickBandIndex, pickListItemAtY, descendToRowAtY } from './handleGeometry.js';

// ── Host Interface ──────────────────────────────────────────────────────────

export interface BlockHandlesHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly pageId: string;
  readonly blockSelection: BlockSelectionController;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class BlockHandlesController {
  // DOM elements
  private _blockAddBtn: HTMLElement | null = null;
  private _dragHandleEl: HTMLElement | null = null;

  // Timers
  private _interactionReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private _handleAreaLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Pointer tracking
  private _lastPointerClient: { x: number; y: number } | null = null;
  private _lastMoveTarget: HTMLElement | null = null;
  private _scrollSyncRaf: number | null = null;

  // Block resolution — set during mousemove, read on click/drag.
  // Single source of truth: resolved once at handle-positioning time,
  // reused without re-resolution on interaction.
  private _resolvedBlockPos: number | null = null;

  // The DOM element for the currently-resolved block, cached so the
  // sticky-handle check can read its bounding rect without re-resolving.
  private _resolvedBlockDom: HTMLElement | null = null;

  // Handle positioning constant — must match GlobalDragHandle's original value
  private static readonly _HANDLE_WIDTH = 24;

  // Drag-vs-click recovery
  // On `draggable="true"` elements the browser fires dragstart after ~2-4 px
  // of mouse movement (hand tremor).  Once dragstart fires, the browser
  // suppresses the click event entirely — so our _onDragHandleClick never
  // runs.  We record the mousedown origin so that dragend can detect these
  // tremor-drags (short time + short distance) and synthetically invoke the
  // click logic that the browser ate.
  private _dragMouseDownPos: { x: number; y: number } | null = null;
  private _dragMouseDownTime = 0;
  private static readonly _CLICK_TIME_MS = 200;   // ms — clicks are faster
  private static readonly _CLICK_DIST_PX = 8;     // px — tremor is small

  constructor(
    private readonly _host: BlockHandlesHost,
    private readonly _actionMenu: IBlockActionMenu,
  ) {}

  // ── Setup ───────────────────────────────────────────────────────────────

  setup(): void {
    const ec = this._host.editorContainer;
    const editor = this._host.editor;
    if (!ec || !editor) return;

    // ── Create drag handle element (replaces GlobalDragHandle library) ──
    this._dragHandleEl = document.createElement('div');
    this._dragHandleEl.draggable = true;
    this._dragHandleEl.dataset.dragHandle = '';
    this._dragHandleEl.classList.add('drag-handle', 'hide');
    ec.appendChild(this._dragHandleEl);

    // ── Create + button ──
    this._blockAddBtn = document.createElement('div');
    this._blockAddBtn.className = 'block-add-btn hide';
    this._blockAddBtn.innerHTML = svgIcon('plus');
    const svg = this._blockAddBtn.querySelector('svg');
    if (svg) { svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); }
    this._blockAddBtn.title = 'Click to add below\nAlt-click to add a block above';
    ec.appendChild(this._blockAddBtn);

    // ── Handle-area hover (keep both + and ⠿ visible together) ──
    this._blockAddBtn.addEventListener('mouseenter', this._onHandleAreaEnter);
    this._blockAddBtn.addEventListener('mouseleave', this._onHandleAreaLeave);
    this._dragHandleEl.addEventListener('mouseenter', this._onHandleAreaEnter);
    this._dragHandleEl.addEventListener('mouseleave', this._onHandleAreaLeave);

    // ── Event handlers ──
    this._blockAddBtn.addEventListener('click', this._onBlockAddClick);
    this._blockAddBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    this._dragHandleEl.addEventListener('click', this._onDragHandleClick);
    this._dragHandleEl.addEventListener('mousedown', this._onDragHandleMouseDown, true);
    document.addEventListener('mouseup', this._onGlobalMouseUp, true);

    // ── Canvas-owned drag lifecycle ──
    this._dragHandleEl.addEventListener('dragstart', this._onDragHandleDragStart);
    this._dragHandleEl.addEventListener('dragend', this._onDragHandleDragEnd);

    // ── Editor-level event interception ──
    ec.addEventListener('mouseout', this._onEditorMouseOut, true);
    ec.addEventListener('mousemove', this._onEditorMouseMove, true);
    ec.addEventListener('mouseleave', this._onEditorMouseLeave);
    window.addEventListener('scroll', this._onScrollSync, true);

    // ── Hide handle on keydown/wheel (replaces library's ProseMirror plugin) ──
    editor.view.dom.addEventListener('keydown', this._onEditorKeyDown, true);
    editor.view.dom.addEventListener('wheel', this._onEditorWheel, true);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The block-action-menu element (for outside-click checks). */
  get menu(): HTMLElement | null { return this._actionMenu.menu; }

  hide(): void {
    this._actionMenu.hide();
  }

  /**
   * Called by canvasEditorProvider when a doc-changing transaction fires.
   * Clears the cached block position — the node may have been deleted,
   * moved, or resized, so the stored position is no longer trustworthy.
   */
  notifyDocChanged(): void {
    this._resolvedBlockPos = null;
    this._resolvedBlockDom = null;
  }

  // ── Handle-area hover (keep + and ⠿ visible together) ──────────────────

  private readonly _onHandleAreaEnter = (): void => {
    if (this._handleAreaLeaveTimer) {
      clearTimeout(this._handleAreaLeaveTimer);
      this._handleAreaLeaveTimer = null;
    }
    this._host.editorContainer?.classList.add('handle-area-hovered');
  };

  private readonly _onHandleAreaLeave = (e: MouseEvent): void => {
    const related = e.relatedTarget as HTMLElement | null;
    // Moving between + and ⠿ — stay hovered
    if (
      related === this._blockAddBtn ||
      related === this._dragHandleEl ||
      this._blockAddBtn?.contains(related) ||
      this._dragHandleEl?.contains(related)
    ) {
      return;
    }
    this._handleAreaLeaveTimer = setTimeout(() => {
      this._handleAreaLeaveTimer = null;
      this._host.editorContainer?.classList.remove('handle-area-hovered');
    }, 100);
  };

  // ── Event Handlers (arrow functions to preserve `this`) ─────────────────

  /** Intercept mouseout on the editor wrapper so the drag handle library
   *  doesn't hide the handle when the mouse moves to handle-adjacent UI. */
  private readonly _onEditorMouseOut = (event: MouseEvent): void => {
    const related = event.relatedTarget as HTMLElement | null;
    if (!related) return;

    // Any transition that stays within the editor surface should not trigger
    // handle-hide behavior. This keeps drag-handle clickability stable across
    // all block types (image, code, callout, math, etc.) whose DOM may include
    // nested wrappers/overlays.
    if (this._host.editorContainer?.contains(related)) {
      event.stopPropagation();
      return;
    }

    if (
      related.classList.contains('block-add-btn') ||
      !!related.closest('.block-add-btn') ||
      related.classList.contains('drag-handle') ||
      !!related.closest('.drag-handle') ||
      related.classList.contains('block-action-menu') ||
      !!related.closest('.block-action-menu') ||
      related.classList.contains('block-action-submenu') ||
      !!related.closest('.block-action-submenu')
    ) {
      event.stopPropagation();
    }
  };

  private readonly _onEditorMouseMove = (event: MouseEvent): void => {
    // Only cheap bookkeeping runs per event. The expensive resolve + reposition
    // (posAtCoords + getBoundingClientRect + getComputedStyle — all forced
    // layout) is coalesced to one run per animation frame, since mousemove
    // fires far more often than the display refreshes.
    this._lastPointerClient = { x: event.clientX, y: event.clientY };
    this._lastMoveTarget = event.target as HTMLElement | null;
    this._processMoveThrottled();
  };

  /** rAF-coalesced body of the mousemove handler — see `_onEditorMouseMove`. */
  private readonly _processMoveThrottled = rafThrottle((): void => this._processMove());

  private _processMove(): void {
    const editor = this._host.editor;
    if (!editor) return;
    const view = editor.view;
    const pt = this._lastPointerClient;
    const target = this._lastMoveTarget;
    if (!pt || !target) return;
    if (!view.dom.contains(target)) return;
    if (this._isIgnoredOverlayElement(target)) return;
    if (!editor.isEditable) return;

    if (
      this._isPointerWithinStickyHandleZone(pt.x, pt.y) &&
      !this._shouldRefreshStickyContainerTarget(view, pt.x, pt.y)
    ) {
      return;
    }

    if (this._isResizeInteractionActive()) {
      this._hideHandle();
      if (this._isColumnResizing()) this._actionMenu.hide();
      return;
    }

    // ── Resolve block at mouse position ──
    const resolved = this._resolveBlockAtCoords(view, pt.x, pt.y);
    if (!resolved) {
      this._hideHandle();
      return;
    }

    // ── Position handle & + button ──
    this._positionHandleForBlock(resolved.pos, resolved.node, view);
  }

  private readonly _onEditorMouseLeave = (e: MouseEvent): void => {
    const related = e.relatedTarget as HTMLElement | null;
    if (this._isHandleRelatedElement(related)) {
      return;
    }
    this._hideHandle();
  };

  private readonly _onEditorKeyDown = (): void => {
    this._hideHandle();
  };

  private readonly _onEditorWheel = (): void => {
    this._hideHandle();
  };

  private readonly _onScrollSync = (): void => {
    if (this._scrollSyncRaf != null) return;

    this._scrollSyncRaf = window.requestAnimationFrame(() => {
      this._scrollSyncRaf = null;

      const editor = this._host.editor;
      const pointer = this._lastPointerClient;
      if (!editor || !pointer) return;

      const { x, y } = pointer;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;

      const hovered = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!hovered || !editor.view.dom.contains(hovered)) return;

      const syncMove = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: false,
        clientX: x,
        clientY: y,
      });
      hovered.dispatchEvent(syncMove);
    });
  };

  // ── Plus Button Click ──

  private readonly _onBlockAddClick = (e: MouseEvent): void => {
    const editor = this._host.editor;
    if (!editor) return;
    const block = this._resolveBlockFromHandle();
    if (!block) return;
    const { pos, node } = block;
    const isAbove = e.altKey;
    const insertPos = isAbove ? pos : pos + node.nodeSize;
    // Insert paragraph with '/' to trigger slash menu
    editor.chain()
      .insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
      .setTextSelection(insertPos + 2)
      .focus()
      .run();
  };

  // ── Drag Handle Click → Block Action Menu ──

  private readonly _onDragHandleClick = (e: MouseEvent): void => {
    this._handleClickAction(e);
  };

  /**
   * Core click logic shared by _onDragHandleClick (native click event) and
   * _onDragHandleDragEnd (click recovery after tremor-drag).
   */
  private _handleClickAction(e: { shiftKey: boolean }): void {
    const editor = this._host.editor;
    if (!editor) return;
    if (this._isResizeInteractionActive()) return;
    if (this._actionMenu.visible) {
      this._actionMenu.hide();
      return;
    }
    const block = this._resolveBlockFromHandle();
    if (!block) return;

    // Select the block (Shift+Click → extend selection).
    //
    // If the user has an active multi-block selection and clicks the handle
    // of a block that is already part of it, preserve the selection — this
    // is what opens the action menu in "batch mode" (Notion-parity: bulk
    // Turn-Into / colors / delete / duplicate across all highlighted blocks).
    // Replacing the selection here would silently downgrade the operation
    // to single-block before the menu's action handlers even run.
    //
    // Plain click on a handle OUTSIDE the current selection → replace with
    // single-block (existing behavior, matches Notion).
    const sel = this._host.blockSelection;
    if (e.shiftKey) {
      sel.extendTo(block.pos);
    } else if (sel.hasSelection && sel.count > 1 && sel.positions.includes(block.pos)) {
      // Preserve existing multi-selection — no-op on the selection model.
    } else {
      sel.select(block.pos);
    }

    const handleRect = this._dragHandleEl!.getBoundingClientRect();
    this._actionMenu.show(block.pos, block.node, handleRect, this._dragHandleEl!);
  }

  // ── Drag Handle Drag Lifecycle (single owner) ──

  private readonly _onDragHandleDragStart = (event: DragEvent): void => {
    const editor = this._host.editor;
    if (!editor) return;
    if (this._isResizeInteractionActive()) {
      event.preventDefault();
      return;
    }


    const { view } = editor;

    this._setHandleInteractionLock(true);

    // Prevent parallel dragstart handling from external extension listeners.
    event.stopImmediatePropagation();

    const block = this._resolveBlockFromHandle();
    if (!block) {
      event.preventDefault();
      return;
    }
    const movable = resolveMovableBlock(view.state.doc.resolve(block.pos));
    const draggedListType = movable?.isListItem ? movable.listType ?? undefined : undefined;

    // ── Multi-block drag: if the hovered block is part of a multi-selection,
    // drag all selected blocks together. ──
    const sel = this._host.blockSelection;
    const isMultiDrag = sel.hasSelection && sel.count > 1 && sel.positions.includes(block.pos);

    if (isMultiDrag) {
      // Build a fragment from all selected blocks (sorted by position)
      const positions = sel.positions; // already sorted asc
      const nodes: any[] = [];
      const jsonNodes: any[] = [];
      for (const p of positions) {
        const n = view.state.doc.nodeAt(p);
        if (n) {
          nodes.push(n);
          jsonNodes.push(n.toJSON());
        }
      }

      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }

      const fragment = Fragment.from(nodes);
      const slice = new Slice(fragment, 0, 0);

      // Use the contiguous range from first to last selected block
      const firstPos = positions[0];
      const lastPos = positions[positions.length - 1];
      const lastNode = view.state.doc.nodeAt(lastPos);
      const rangeTo = lastNode ? lastPos + lastNode.nodeSize : lastPos;

      if (event.dataTransfer) {
        try {
          event.dataTransfer.effectAllowed = 'copyMove';
          event.dataTransfer.setData('text/plain', 'parallx-canvas-block-drag');
          event.dataTransfer.setData(CANVAS_BLOCK_DRAG_MIME, JSON.stringify({
            sourcePageId: this._host.pageId,
            from: firstPos,
            to: rangeTo,
            nodes: jsonNodes,
            listType: draggedListType,
            startedAt: Date.now(),
          }));
        } catch { /* Best-effort */ }
      }

      // Set ProseMirror selection to span the contiguous range
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, firstPos, rangeTo));
      view.dispatch(tr);

      view.dragging = { slice, move: true, from: firstPos, to: rangeTo } as any;

      setActiveCanvasDragSession({
        sourcePageId: this._host.pageId,
        from: firstPos,
        to: rangeTo,
        nodes: jsonNodes,
        listType: draggedListType,
        startedAt: Date.now(),
      });

      // Visual: mark all selected blocks as drag sources
      for (const p of positions) {
        try {
          const domNode = view.nodeDOM(p) as HTMLElement | null;
          if (domNode) domNode.classList.add('block-drag-source');
        } catch { /* ignore */ }
      }

      view.dom.classList.add('dragging');
      return;
    }

    // ── Single-block drag (existing behavior) ──
    const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos));
    view.dispatch(tr);

    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData('text/plain', 'parallx-canvas-block-drag');
        event.dataTransfer.setData(CANVAS_BLOCK_DRAG_MIME, JSON.stringify({
          sourcePageId: this._host.pageId,
          from: block.pos,
          to: block.pos + block.node.nodeSize,
          nodes: [block.node.toJSON()],
          listType: draggedListType,
          startedAt: Date.now(),
        }));
      } catch {
        // Best-effort: drag payload setup is browser-dependent.
      }
    }

    view.dragging = {
      slice: view.state.selection.content(),
      move: true,
      from: block.pos,
      to: block.pos + block.node.nodeSize,
    } as any;

    setActiveCanvasDragSession({
      sourcePageId: this._host.pageId,
      from: block.pos,
      to: block.pos + block.node.nodeSize,
      nodes: [block.node.toJSON()],
      listType: draggedListType,
      startedAt: Date.now(),
    });

    view.dom.classList.add('dragging');
  };

  private readonly _onDragHandleDragEnd = (event: DragEvent): void => {
    const editor = this._host.editor;
    if (!editor) return;

    // ── Click recovery for tremor-drags ──
    // If the entire drag cycle (mousedown → dragstart → dragend) was short
    // in both time and distance, the user intended a click.  The browser
    // suppressed the click event because dragstart fired, so we invoke the
    // click logic ourselves.
    if (this._dragMouseDownPos) {
      const elapsed = Date.now() - this._dragMouseDownTime;
      const dx = event.clientX - this._dragMouseDownPos.x;
      const dy = event.clientY - this._dragMouseDownPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (elapsed < BlockHandlesController._CLICK_TIME_MS &&
          dist < BlockHandlesController._CLICK_DIST_PX) {
        // Clean up drag state first
        editor.view.dragging = null as any;
        editor.view.dom.classList.remove('dragging');
        const sources = editor.view.dom.querySelectorAll('.block-drag-source');
        sources.forEach((el) => el.classList.remove('block-drag-source'));
        clearActiveCanvasDragSession();
        this._scheduleHandleInteractionUnlock();
        this._dragMouseDownPos = null;
        this._dragMouseDownTime = 0;
        // Now do what the click handler would have done
        this._handleClickAction(event);
        return;
      }
    }

    editor.view.dragging = null as any;
    editor.view.dom.classList.remove('dragging');

    // Remove drag-source visual from all blocks
    const sources = editor.view.dom.querySelectorAll('.block-drag-source');
    sources.forEach((el) => el.classList.remove('block-drag-source'));

    setTimeout(() => {
      clearActiveCanvasDragSession();
    }, 0);
    this._scheduleHandleInteractionUnlock();
  };

  private readonly _onDragHandleMouseDown = (e: MouseEvent): void => {
    if (this._isResizeInteractionActive()) return;
    // Set interaction lock so the blur-hide timer and outside-click handler
    // skip hideAll() while we're interacting with the drag handle.
    // We intentionally do NOT call e.preventDefault() here — in some
    // Electron/Chromium builds, preventDefault on mousedown suppresses
    // the subsequent dragstart on draggable="true" elements.
    this._setHandleInteractionLock(true);
    this._dragMouseDownPos = { x: e.clientX, y: e.clientY };
    this._dragMouseDownTime = Date.now();
  };

  private readonly _onGlobalMouseUp = (): void => {
    this._dragMouseDownPos = null;
    this._dragMouseDownTime = 0;
    this._scheduleHandleInteractionUnlock();
  };

  private _setHandleInteractionLock(locked: boolean): void {
    if (locked) {
      if (this._interactionReleaseTimer) {
        clearTimeout(this._interactionReleaseTimer);
        this._interactionReleaseTimer = null;
      }
      document.body.classList.add('block-handle-interacting');
      return;
    }
    document.body.classList.remove('block-handle-interacting');
  }

  private _scheduleHandleInteractionUnlock(): void {
    if (this._interactionReleaseTimer) {
      clearTimeout(this._interactionReleaseTimer);
    }
    this._interactionReleaseTimer = setTimeout(() => {
      this._interactionReleaseTimer = null;
      this._setHandleInteractionLock(false);
    }, 120);
  }

  private _isHandleRelatedElement(element: HTMLElement | null): boolean {
    if (!element) return false;

    return (
      element.classList.contains('block-add-btn') ||
      !!element.closest('.block-add-btn') ||
      element.classList.contains('drag-handle') ||
      !!element.closest('.drag-handle') ||
      element.classList.contains('block-action-menu') ||
      !!element.closest('.block-action-menu') ||
      element.classList.contains('block-action-submenu') ||
      !!element.closest('.block-action-submenu')
    );
  }

  private _isPointerWithinStickyHandleZone(clientX: number, clientY: number): boolean {
    if (
      this._resolvedBlockPos == null ||
      !this._resolvedBlockDom ||
      !this._dragHandleEl ||
      this._dragHandleEl.classList.contains('hide')
    ) {
      return false;
    }

    // The sticky zone protects the handle / + button gutter so the user
    // can transit from the block's content into the handle without the
    // handle moving away under their cursor. Previously we also included
    // the block's full DOM rect in this zone — which for container
    // blocks (toggle / callout / blockquote) covers ALL nested content
    // and locked the handle to the container's top row even when the
    // cursor moved over deeply nested blocks. Removing the block-body
    // from the sticky zone makes the handle ALWAYS follow the cursor.
    // The handle / + button rects themselves are still sticky so the
    // user can click them without them dodging away.
    const rects: DOMRect[] = [this._dragHandleEl.getBoundingClientRect()];

    if (this._blockAddBtn && !this._blockAddBtn.classList.contains('hide')) {
      rects.push(this._blockAddBtn.getBoundingClientRect());
    }

    // Also include a thin horizontal corridor from the current handle to
    // the block's left edge, so the user can move their cursor sideways
    // OUT of the block toward the handle without the handle re-anchoring
    // mid-transit. This is the actual "approach corridor" — a horizontal
    // strip aligned with the current handle's vertical band, bridging
    // the gutter to the resolved block.
    const blockRect = this._resolvedBlockDom.getBoundingClientRect();
    const handleRect = this._dragHandleEl.getBoundingClientRect();
    const corridorTop = handleRect.top - 4;
    const corridorBottom = handleRect.bottom + 4;
    rects.push(new DOMRect(
      handleRect.left,
      corridorTop,
      Math.max(0, blockRect.left - handleRect.left + 4),
      corridorBottom - corridorTop,
    ));

    const left = Math.min(...rects.map((rect) => rect.left));
    const right = Math.max(...rects.map((rect) => rect.right));
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));

    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
  }

  /**
   * Sticky handles keep the +/drag affordances clickable while the pointer
   * moves toward them.  For page-container blocks (callout/details/quote),
   * the full container rectangle can cover nested child blocks, so a resolved
   * callout handle would otherwise mask the paragraph handles inside it.
   */
  private _shouldRefreshStickyContainerTarget(
    view: any,
    clientX: number,
    clientY: number,
  ): boolean {
    if (this._resolvedBlockPos == null || !this._resolvedBlockDom) {
      return false;
    }

    const currentNode = view.state.doc.nodeAt(this._resolvedBlockPos);
    if (!currentNode || !isContainerBlockType(currentNode.type?.name)) {
      return false;
    }

    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!hit || !this._resolvedBlockDom.contains(hit)) {
      return false;
    }
    if (this._isIgnoredOverlayElement(hit)) {
      return false;
    }

    // When the cursor lands directly on the container wrapper (in its
    // padding or in a gap between child blocks), elementFromPoint returns
    // the container itself rather than a descendant block, which would
    // lock the handle to the container's anchor row (the "Road Safety"
    // toggle bug).  _reanchorContainerToCursor already owns the "which
    // descendant is the cursor Y actually over" walk — reuse it instead
    // of a parallel scan.
    if (hit === this._resolvedBlockDom) {
      const current = { pos: this._resolvedBlockPos, node: currentNode, depth: 0 };
      const reanchored = this._reanchorContainerToCursor(view, current, clientY);
      return reanchored.pos !== this._resolvedBlockPos;
    }

    const nested = this._resolveBlockFromDomElement(view, hit);
    return !!nested && nested.pos !== this._resolvedBlockPos;
  }


  // ── Block Resolution ────────────────────────────────────────────────────

  /**
   * Resolve the block at screen coordinates using ProseMirror's native
   * coordinate mapping.  Used by the mousemove handler to determine which
   * block the handle should be positioned next to.
   */
  private _resolveBlockAtCoords(
    view: any,
    clientX: number,
    clientY: number,
  ): { pos: number; node: any } | null {
    // Atom blocks (mathBlock) render non-ProseMirror DOM (KaTeX), which
    // posAtCoords cannot map back to a document position. Inside a column the
    // generic resolution then collapses onto the column wrapper (resolved to
    // null → no handle), so a moved-into-a-column equation loses its handle.
    // Resolve such atoms straight from their NodeView root, which IS PM-mapped,
    // so they get a handle in ANY container (top level, column, callout, …).
    const atomTarget = this._resolveAtomBlockAtCoords(view, clientX, clientY);
    if (atomTarget) return atomTarget;

    const isListWrapper = (node: any): boolean => {
      const name = node?.type?.name;
      return name === 'bulletList' || name === 'orderedList' || name === 'taskList';
    };

    const hitResult = view.posAtCoords({ left: clientX, top: clientY });
    if (hitResult) {
      // Prefer 'inside' — gives the position of the innermost block node.
      // For atom nodes (mathBlock, bookmark, etc.) 'inside' is -1.
      if (hitResult.inside >= 0) {
        const resolved = this._resolveBlockFromDocPos(view, hitResult.inside);
        if (resolved && !isListWrapper(resolved.node)) {
          const c1 = this._reanchorListItemToCursor(view, resolved, clientY);
          const c2 = this._reanchorContainerToCursor(view, c1, clientY);
          return { pos: c2.pos, node: c2.node };
        }
      }
      // For atom nodes or boundary positions, use 'pos'.
      const resolved = this._resolveBlockFromDocPos(view, hitResult.pos);
      if (resolved && !isListWrapper(resolved.node)) {
        const c1 = this._reanchorListItemToCursor(view, resolved, clientY);
        const c2 = this._reanchorContainerToCursor(view, c1, clientY);
        return { pos: c2.pos, node: c2.node };
      }
    }

    // Fallback: elementFromPoint → DOM walk → posAtDOM
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (element && view.dom.contains(element) && !this._isIgnoredOverlayElement(element)) {
      const resolved = this._resolveBlockFromDomElement(view, element);
      if (resolved) return { pos: resolved.pos, node: resolved.node };
    }

    return null;
  }

  /**
   * Resolve an atom block (currently mathBlock — a leaf node whose NodeView
   * renders non-PM DOM) directly from the element under the cursor. Atom
   * NodeView roots ARE mapped by ProseMirror, so posAtDOM gives a reliable
   * position even when posAtCoords over the inner KaTeX DOM does not, and even
   * when the atom is nested inside a column/callout. Returns null when the
   * cursor isn't over such an atom, so the caller falls back to generic
   * resolution.
   */
  private _resolveAtomBlockAtCoords(
    view: any,
    clientX: number,
    clientY: number,
  ): { pos: number; node: any } | null {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return null;
    // Canonical DOM resolution (blockUnit) — handles every registry atom
    // (mathBlock, image, bookmark, …), not just mathBlock.  Only atom results
    // short-circuit; anything else falls through to the generic hover logic.
    const unit = resolveBlockUnitFromDOM(view, el);
    if (unit && unit.node?.isAtom) {
      return { pos: unit.pos, node: unit.node };
    }
    return null;
  }

  /**
   * Position the drag handle and + button next to the given block.
   * Stores `_resolvedBlockPos` for subsequent click/drag interactions.
   *
   * Replicates the exact positioning formula used by GlobalDragHandle
   * to ensure identical visual placement.
   */
  private _positionHandleForBlock(pos: number, _node: any, view: any): void {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || dom.nodeType !== Node.ELEMENT_NODE || !this._dragHandleEl || !this._blockAddBtn) {
      this._hideHandle();
      return;
    }

    // Exclude certain block types from showing a handle
    const notDraggable = dom.closest('.not-draggable');
    if (notDraggable) {
      this._hideHandle();
      return;
    }

    const compStyle = window.getComputedStyle(dom);
    const parsedLineHeight = parseInt(compStyle.lineHeight, 10);
    const lineHeight = isNaN(parsedLineHeight)
      ? parseInt(compStyle.fontSize, 10) * 1.2
      : parsedLineHeight;
    const paddingTop = parseInt(compStyle.paddingTop, 10) || 0;

    const rect = dom.getBoundingClientRect();
    const hw = BlockHandlesController._HANDLE_WIDTH;

    // Convert viewport-relative getBoundingClientRect() to container-relative
    // coordinates for position:absolute. The handles are children of
    // editorContainer (.canvas-editor-wrapper, position:relative, overflow-y:auto).
    // We must subtract the container's viewport offset and add its scrollTop
    // so that the handle stays aligned with the block even when scrolled.
    const ec = this._host.editorContainer!;
    const ecRect = ec.getBoundingClientRect();

    let top = (rect.top - ecRect.top) + ec.scrollTop + (lineHeight - 24) / 2 + paddingTop;
    let left = (rect.left - ecRect.left) - hw;

    // Li markers — shift left to clear the bullet/number
    if (dom.matches('ul:not([data-type=taskList]) li, ol li')) {
      left -= hw;
    }

    this._dragHandleEl.style.left = `${left}px`;
    this._dragHandleEl.style.top = `${top}px`;
    this._dragHandleEl.classList.remove('hide');

    this._blockAddBtn.style.left = `${left - 22}px`;
    this._blockAddBtn.style.top = `${top}px`;
    this._blockAddBtn.classList.remove('hide');

    this._resolvedBlockPos = pos;
    this._resolvedBlockDom = dom;
  }

  /** Hide both handle and + button, clear stored block position. */
  private _hideHandle(): void {
    if (this._dragHandleEl) this._dragHandleEl.classList.add('hide');
    if (this._blockAddBtn) this._blockAddBtn.classList.add('hide');
    this._resolvedBlockPos = null;
    this._resolvedBlockDom = null;
  }

  /**
   * Find the block the drag handle is currently next to.
   *
   * Primary: reads `_resolvedBlockPos` set during the last mousemove —
   * the same position used to position the handle visually, guaranteeing
   * click/drag always targets the visible block.
   *
   * Fallback (stale/cleared position — scroll sync edge cases): re-run the
   * SAME resolution pipeline the hover path uses, aimed at the block area
   * right of the handle.  Sharing the pipeline means the click target can
   * never disagree with what hovering at that spot would have resolved —
   * the previous bespoke elementsFromPoint scan with its own scoring could.
   */
  private _resolveBlockFromHandle(): { pos: number; node: any } | null {
    const editor = this._host.editor;
    if (!editor || !this._dragHandleEl) return null;
    const view = editor.view;

    // ── Primary: use stored position from mousemove ──
    if (this._resolvedBlockPos != null) {
      const node = view.state.doc.nodeAt(this._resolvedBlockPos);
      if (node) return { pos: this._resolvedBlockPos, node };
    }

    // ── Fallback: hover pipeline aimed just right of the handle ──
    const handleRect = this._dragHandleEl.getBoundingClientRect();
    const handleY = handleRect.top + handleRect.height / 2;
    const scanXs = [handleRect.right + 50, handleRect.right + 8];
    for (const x of scanXs) {
      const resolved = this._resolveBlockAtCoords(view, Math.min(x, window.innerWidth - 1), handleY);
      if (resolved) return resolved;
    }
    return null;
  }

  /**
   * When ProseMirror's `posAtCoords` resolves to a `listItem`/`taskItem`,
   * verify the cursor Y is on THAT row's OWN LINE — never its full <li> box,
   * which spans every nested descendant row.  Two correction cases:
   *
   * • Cursor over a NESTED row: the parent's full rect contains the cursor,
   *   so the old full-rect check kept the PARENT and the handle appeared on
   *   the wrong (outer) row.  descendToRowAtY walks into the nested lists
   *   and picks the row whose line band holds the cursor.
   * • Cursor in the list's left marker gutter, outside every <li> rect
   *   (bullet/numbered only — taskList has no gutter padding): pick the
   *   sibling row nearest by Y.  M81 P13.
   *
   * All band math lives in handleGeometry — the ONE implementation.
   */
  private _reanchorListItemToCursor(
    view: any,
    resolved: { pos: number; node: any; depth: number },
    clientY: number,
  ): { pos: number; node: any; depth: number } {
    const name = resolved.node?.type?.name;
    if (name !== 'listItem' && name !== 'taskItem') return resolved;
    const dom = view.nodeDOM(resolved.pos) as HTMLElement | null;
    if (!dom) return resolved;

    let targetEl: HTMLElement | null = null;
    const r = dom.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) {
      // Inside the row's subtree box — land on the row whose OWN line holds Y.
      targetEl = descendToRowAtY(dom, clientY);
    } else {
      // Outside the row entirely (marker gutter / row gap) — nearest sibling,
      // then refine into ITS subtree the same way.
      const listEl = dom.parentElement;
      if (!listEl || (listEl.tagName !== 'UL' && listEl.tagName !== 'OL')) return resolved;
      const sibling = pickListItemAtY(listEl, clientY);
      if (sibling) targetEl = descendToRowAtY(sibling, clientY);
    }
    if (!targetEl || targetEl === dom) return resolved;

    try {
      const domPos = view.posAtDOM(listItemContentElement(targetEl), 0);
      const r2 = this._resolveBlockFromDocPos(view, domPos);
      if (r2) return r2;
    } catch { /* fall through */ }
    return resolved;
  }

  /**
   * Mirror of `_reanchorListItemToCursor` for container blocks (toggle /
   * callout / blockquote / column). When ProseMirror resolves to a
   * container — typically because the cursor landed in the container's
   * padding, in its summary/title row, or right at a boundary — and the
   * actual cursor Y is over a descendant block inside the container,
   * we re-anchor the handle to that descendant. Otherwise the handle
   * locks to the container's anchor row (the title) even when the user
   * is hovering deep inside the body (M81 P13b — toggle bug).
   *
   * Special-case for details: if the cursor Y is within the SUMMARY
   * row, KEEP the resolution at the details container — that's where
   * the user expects the handle to live for the "drag the whole toggle"
   * gesture.
   */
  private _reanchorContainerToCursor(
    view: any,
    resolved: { pos: number; node: any; depth: number },
    clientY: number,
  ): { pos: number; node: any; depth: number } {
    const name = resolved.node?.type?.name;
    if (!isContainerBlockType(name)) return resolved;
    const dom = view.nodeDOM(resolved.pos) as HTMLElement | null;
    if (!dom) return resolved;

    // If the cursor isn't actually inside the container's vertical range,
    // do NOT redirect to a descendant. Otherwise hovering ABOVE a toggle
    // anchors the handle on its first child (Spare Tire below "Road
    // Safety"), and hovering BELOW would anchor on its last child. Above /
    // below the container belongs to whichever sibling block the cursor
    // is over — leave the resolved container target as-is and let the
    // upstream resolver pick the correct neighbour.
    const containerRect = dom.getBoundingClientRect();
    if (clientY < containerRect.top || clientY > containerRect.bottom) {
      return resolved;
    }

    // For details, keep the container target whenever the cursor is in
    // the "title row" — defined as everything from the container's top
    // edge down through the end of the <summary>. That includes the
    // small strip of padding/border ABOVE the summary text, which would
    // otherwise fall through to "find descendant by Y" and incorrectly
    // pick the first taskItem (the Road Safety / Spare Tire bug).
    if (name === 'details') {
      const summary = dom.querySelector(':scope > div > summary, :scope > summary') as HTMLElement | null;
      if (summary) {
        const sr = summary.getBoundingClientRect();
        if (clientY <= sr.bottom) return resolved;
      }
    }

    // Pick the direct child block of the container's content area whose Y
    // band holds the cursor (shared band math — handleGeometry).
    const contentRoot: HTMLElement = (() => {
      if (name === 'details') {
        return (dom.querySelector(':scope [data-type="detailsContent"]') as HTMLElement | null) ?? dom;
      }
      return dom;
    })();
    const candidates = Array.from(contentRoot.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );
    const idx = pickBandIndex(candidates.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }), clientY);
    if (idx === null) return resolved;

    try {
      // Resolve the picked element back to a doc position.  List wrappers
      // drill to the row (and nested row) whose own line holds the cursor.
      let probe: HTMLElement = candidates[idx];
      if (probe.tagName === 'UL' || probe.tagName === 'OL') {
        const row = pickListItemAtY(probe, clientY);
        if (row) probe = descendToRowAtY(row, clientY);
      }
      const probeContent = probe.tagName === 'LI' ? listItemContentElement(probe) : probe;
      const domPos = view.posAtDOM(probeContent, 0);
      const r2 = this._resolveBlockFromDocPos(view, domPos);
      if (r2 && r2.pos !== resolved.pos) return r2;
    } catch { /* fall through */ }
    return resolved;
  }

  private _resolveBlockFromDomElement(
    view: any,
    element: HTMLElement,
  ): { pos: number; node: any; depth: number } | null {
    const listItem = element.closest('li') as HTMLElement | null;
    if (listItem && view.dom.contains(listItem)) {
      try {
        // Canonical row→content mapping (blockUnit.listItemContentElement).
        const domPos = view.posAtDOM(listItemContentElement(listItem), 0);
        const resolved = this._resolveBlockFromDocPos(view, domPos);
        if (resolved) return resolved;
      } catch {
        // Fall through to the generic ancestor walk.
      }
    }

    // Cursor lands in a list wrapper (`<ul>` / `<ol>` / taskList) but NOT
    // inside any specific `<li>` — typical when the pointer is in a row
    // gap or in the list's left padding. posAtDOM(ul, 0) would always
    // resolve to the FIRST item, so pick the row (and nested row) whose
    // vertical band holds the cursor instead. M81 P13 — shared band math
    // in handleGeometry.
    const listEl = element.closest('ul, ol') as HTMLElement | null;
    const pointerY = this._lastPointerClient?.y;
    if (listEl && view.dom.contains(listEl) && pointerY != null) {
      const row = pickListItemAtY(listEl, pointerY);
      if (row) {
        try {
          const target = descendToRowAtY(row, pointerY);
          const domPos = view.posAtDOM(listItemContentElement(target), 0);
          const resolved = this._resolveBlockFromDocPos(view, domPos);
          if (resolved) return resolved;
        } catch {
          // Fall through to the generic ancestor walk.
        }
      }
    }

    let current: HTMLElement | null = element;

    while (current && current !== view.dom) {
      try {
        const domPos = view.posAtDOM(current, 0);
        const resolved = this._resolveBlockFromDocPos(view, domPos);
        if (resolved) return resolved;
      } catch {
        // Keep walking upward until a mappable DOM node is found.
      }
      current = current.parentElement;
    }

    return null;
  }

  private _resolveBlockFromDocPos(view: any, docPos: number): { pos: number; node: any; depth: number } | null {
    const $pos = view.state.doc.resolve(docPos);

    const movable = resolveMovableBlock($pos);
    if (movable && movable.node.type.name !== 'column' && movable.node.type.name !== 'columnList') {
      return { pos: movable.pos, node: movable.node, depth: movable.depth };
    }

    // Canonical container walk (blockUnit/columnInvariants) — no local copy.
    const containerDepth = resolveBlockAncestry($pos).containerDepth;
    const targetDepth = containerDepth + 1;
    let blockPos: number;

    if ($pos.depth >= targetDepth) {
      blockPos = $pos.before(targetDepth);
    } else if ($pos.depth === containerDepth) {
      // Position sits at a block boundary inside a page-container (column,
      // callout, etc.).  Common for atom/node-view blocks (mathBlock,
      // bookmark, ToC, media) which have no "inside" — ProseMirror resolves
      // to the parent container depth rather than the child block depth.
      // Use nodeAfter/nodeBefore to find the actual block at this boundary.
      const after = $pos.nodeAfter;
      if (after && after.type.name !== 'column' && after.type.name !== 'columnList') {
        blockPos = $pos.pos;
      } else {
        const before = $pos.nodeBefore;
        if (before && before.type.name !== 'column' && before.type.name !== 'columnList') {
          blockPos = $pos.pos - before.nodeSize;
        } else {
          blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : docPos;
        }
      }
    } else {
      blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : docPos;
    }

    const node = view.state.doc.nodeAt(blockPos);
    if (!node) return null;

    // Column layout nodes are structural wrappers — never valid handle targets.
    // If resolution lands on a columnList, drill into the first block inside it;
    // if that fails, return null rather than exposing the layout node.
    if (node.type.name === 'columnList') {
      return this._resolveFirstBlockInsideColumnList(view, blockPos, node, targetDepth + 1);
    }
    if (node.type.name === 'column') {
      return null;
    }

    return { pos: blockPos, node, depth: targetDepth };
  }

  private _resolveFirstBlockInsideColumnList(
    view: any,
    columnListPos: number,
    columnListNode: any,
    startDepth: number,
  ): { pos: number; node: any; depth: number } | null {
    let currentPos = columnListPos;
    let currentNode = columnListNode;
    let depth = startDepth;

    for (let guard = 0; guard < 16; guard++) {
      if (!currentNode || currentNode.type.name !== 'columnList') return null;
      if (currentNode.childCount === 0) return null;

      const firstColumn = currentNode.child(0);
      if (!firstColumn || firstColumn.type.name !== 'column' || firstColumn.childCount === 0) {
        return null;
      }

      const firstBlockPos = currentPos + 2;
      const firstBlockNode = view.state.doc.nodeAt(firstBlockPos);
      if (!firstBlockNode) return null;

      if (firstBlockNode.type.name !== 'columnList') {
        return { pos: firstBlockPos, node: firstBlockNode, depth };
      }

      currentPos = firstBlockPos;
      currentNode = firstBlockNode;
      depth += 2;
    }

    return null;
  }

  private _isIgnoredOverlayElement(element: HTMLElement): boolean {
    return (
      element.classList.contains('drag-handle') ||
      element.classList.contains('block-add-btn') ||
      element.classList.contains('block-action-menu') ||
      element.classList.contains('block-action-submenu') ||
      element.classList.contains('column-drop-indicator') ||
      element.classList.contains('canvas-drop-guide') ||
      element.classList.contains('column-resize-handle') ||
      element.classList.contains('column-resize-indicator') ||
      !!element.closest('.block-action-menu') ||
      !!element.closest('.block-action-submenu')
    );
  }

  private _isResizeInteractionActive(): boolean {
    const body = document.body;
    return body.classList.contains('column-resize-hover') || body.classList.contains('column-resizing');
  }

  private _isColumnResizing(): boolean {
    return document.body.classList.contains('column-resizing');
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    const editor = this._host.editor;
    if (editor) {
      editor.view.dom.removeEventListener('keydown', this._onEditorKeyDown, true);
      editor.view.dom.removeEventListener('wheel', this._onEditorWheel, true);
    }
    this._host.editorContainer?.removeEventListener('mouseout', this._onEditorMouseOut, true);
    this._host.editorContainer?.removeEventListener('mousemove', this._onEditorMouseMove, true);
    this._host.editorContainer?.removeEventListener('mouseleave', this._onEditorMouseLeave);
    window.removeEventListener('scroll', this._onScrollSync, true);
    this._dragHandleEl?.removeEventListener('dragstart', this._onDragHandleDragStart);
    this._dragHandleEl?.removeEventListener('dragend', this._onDragHandleDragEnd);
    this._dragHandleEl?.removeEventListener('mousedown', this._onDragHandleMouseDown, true);
    document.removeEventListener('mouseup', this._onGlobalMouseUp, true);
    this._blockAddBtn?.removeEventListener('mouseenter', this._onHandleAreaEnter);
    this._blockAddBtn?.removeEventListener('mouseleave', this._onHandleAreaLeave);
    this._dragHandleEl?.removeEventListener('mouseenter', this._onHandleAreaEnter);
    this._dragHandleEl?.removeEventListener('mouseleave', this._onHandleAreaLeave);
    if (this._handleAreaLeaveTimer) {
      clearTimeout(this._handleAreaLeaveTimer);
      this._handleAreaLeaveTimer = null;
    }
    this._host.editorContainer?.classList.remove('handle-area-hovered');
    if (this._interactionReleaseTimer) {
      clearTimeout(this._interactionReleaseTimer);
      this._interactionReleaseTimer = null;
    }
    if (this._scrollSyncRaf != null) {
      window.cancelAnimationFrame(this._scrollSyncRaf);
      this._scrollSyncRaf = null;
    }
    this._processMoveThrottled.dispose();
    this._setHandleInteractionLock(false);
    if (this._blockAddBtn) { this._blockAddBtn.remove(); this._blockAddBtn = null; }
    if (this._dragHandleEl) { this._dragHandleEl.remove(); this._dragHandleEl = null; }
    this._lastPointerClient = null;
    this._lastMoveTarget = null;
    this._resolvedBlockPos = null;
  }
}
