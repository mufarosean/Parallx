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
import type { BlockSelectionController } from './handleRegistry.js';
import type { IBlockActionMenu } from './handleRegistry.js';
import {
  svgIcon,
  CANVAS_BLOCK_DRAG_MIME,
  clearActiveCanvasDragSession,
  setActiveCanvasDragSession,
  PAGE_CONTAINERS,
  isContainerBlockType,
} from './handleRegistry.js';

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
    const editor = this._host.editor;
    if (!editor) return;
    this._lastPointerClient = { x: event.clientX, y: event.clientY };
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!editor.view.dom.contains(target)) return;
    if (this._isIgnoredOverlayElement(target)) return;
    if (!editor.isEditable) return;

    // ── Sticky handle: if the handle is already visible for a block, keep
    // it stable while the mouse is within the block's ownership zone
    // (handle-left → block-right, block-top → block-bottom).  This prevents
    // the handle from jumping or vanishing when the user moves toward it,
    // especially in columns where the path to the handle crosses the column
    // resize boundary zone (which would otherwise trigger _hideHandle). ──
    if (
      this._resolvedBlockPos != null &&
      this._resolvedBlockDom &&
      this._dragHandleEl && !this._dragHandleEl.classList.contains('hide')
    ) {
      const blockRect = this._resolvedBlockDom.getBoundingClientRect();
      const handleLeft = blockRect.left - BlockHandlesController._HANDLE_WIDTH - 22;
      if (
        event.clientX >= handleLeft &&
        event.clientX <= blockRect.right &&
        event.clientY >= blockRect.top &&
        event.clientY <= blockRect.bottom
      ) {
        return; // mouse still in current block's zone — keep handle stable
      }
    }

    if (this._isResizeInteractionActive()) {
      this._hideHandle();
      if (this._isColumnResizing()) this._actionMenu.hide();
      return;
    }

    // ── Resolve block at mouse position ──
    const view = editor.view;
    const resolved = this._resolveBlockAtCoords(view, event.clientX, event.clientY);
    if (!resolved) {
      this._hideHandle();
      return;
    }

    // ── Position handle & + button ──
    this._positionHandleForBlock(resolved.pos, resolved.node, view);
  };

  private readonly _onEditorMouseLeave = (e: MouseEvent): void => {
    const related = e.relatedTarget as HTMLElement | null;
    // Don't hide when moving to the block action menu (may be outside container)
    if (
      related?.classList.contains('block-action-menu') ||
      related?.closest('.block-action-menu') ||
      related?.classList.contains('block-action-submenu') ||
      related?.closest('.block-action-submenu')
    ) {
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

    // Select the block (Shift+Click → extend selection)
    if (e.shiftKey) {
      this._host.blockSelection.extendTo(block.pos);
    } else {
      this._host.blockSelection.select(block.pos);
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


  // ── Block Resolution ────────────────────────────────────────────────────

  // PAGE_CONTAINERS imported from blockRegistry (no local definition).

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
    const hitResult = view.posAtCoords({ left: clientX, top: clientY });
    if (hitResult) {
      // Prefer 'inside' — gives the position of the innermost block node.
      // For atom nodes (mathBlock, bookmark, etc.) 'inside' is -1.
      if (hitResult.inside >= 0) {
        const resolved = this._resolveBlockFromDocPos(view, hitResult.inside);
        if (resolved) return { pos: resolved.pos, node: resolved.node };
      }
      // For atom nodes or boundary positions, use 'pos'.
      const resolved = this._resolveBlockFromDocPos(view, hitResult.pos);
      if (resolved) return { pos: resolved.pos, node: resolved.node };
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
    const excludedTag = dom.matches('ol, ul');
    if (notDraggable || excludedTag) {
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
   * Primary: reads `_resolvedBlockPos` set during the last mousemove.
   * This is the same position used to position the handle visually,
   * guaranteeing click/drag always targets the visible block.
   *
   * Fallback: elementsFromPoint scan for edge cases (scroll sync,
   * programmatic handle show, etc.).
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

    // ── Fallback: scan from handle position via elementsFromPoint ──
    const handleRect = this._dragHandleEl.getBoundingClientRect();
    const handleY = handleRect.top + handleRect.height / 2;
    const scanX = handleRect.right + 50;
    const sampleYs = [
      handleRect.top - 8,
      handleRect.top + 1,
      handleRect.top + 2,
      handleY,
      handleRect.bottom - 2,
    ].map((y) => Math.max(1, Math.min(window.innerHeight - 1, y)));

    let best: { pos: number; node: any; depth: number; distance: number } | null = null;

    for (const sampleY of sampleYs) {
      const hits = document.elementsFromPoint(scanX, sampleY);
      for (const hit of hits) {
        const element = hit as HTMLElement;
        if (!view.dom.contains(element)) continue;
        if (this._isIgnoredOverlayElement(element)) continue;

        const resolved = this._resolveBlockFromDomElement(view, element);
        if (!resolved) continue;

        const distance = this._distanceFromHandleToBlockCenter(handleY, resolved.pos, view);
        if (
          !best ||
          this._shouldPreferCandidate(best, {
            pos: resolved.pos,
            node: resolved.node,
            depth: resolved.depth,
            distance,
          })
        ) {
          best = { ...resolved, distance };
        }
      }
    }

    if (best) {
      return { pos: best.pos, node: best.node };
    }

    return this._resolveBlockFallback(handleY);
  }

  private _resolveBlockFromDomElement(
    view: any,
    element: HTMLElement,
  ): { pos: number; node: any; depth: number } | null {
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

    let containerDepth = 0;
    for (let d = 1; d <= $pos.depth; d++) {
      if (PAGE_CONTAINERS.has($pos.node(d).type.name)) {
        containerDepth = d;
      }
    }

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

  private _shouldPreferCandidate(
    current: { pos: number; node: any; depth: number; distance: number },
    next: { pos: number; node: any; depth: number; distance: number },
  ): boolean {
    const distanceDelta = next.distance - current.distance;

    if (distanceDelta < -1) {
      return true;
    }

    const withinSameLane = Math.abs(distanceDelta) <= 8;
    if (withinSameLane) {
      if (next.depth > current.depth) {
        return true;
      }

      const nextName = next.node?.type?.name ?? '';
      const currentName = current.node?.type?.name ?? '';
      const nextContainer = isContainerBlockType(nextName) || nextName === 'columnList' || nextName === 'column';
      const currentContainer = isContainerBlockType(currentName) || currentName === 'columnList' || currentName === 'column';
      if (currentContainer && !nextContainer) {
        return true;
      }
    }

    return false;
  }

  private _distanceFromHandleToBlockCenter(handleY: number, blockPos: number, view: any): number {
    try {
      const blockDom = view.nodeDOM(blockPos) as HTMLElement | null;
      if (!blockDom) return Number.POSITIVE_INFINITY;
      const rect = blockDom.getBoundingClientRect();
      return Math.abs((rect.top + rect.bottom) / 2 - handleY);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
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

  private _isPageContainerDom(el: HTMLElement | null, proseMirrorRoot: HTMLElement): boolean {
    if (!el) return false;
    if (el === proseMirrorRoot) return true;

    return (
      el.classList.contains('canvas-column') ||
      el.classList.contains('canvas-callout-content') ||
      el.matches?.('[data-type=detailsContent]') ||
      el.tagName === 'BLOCKQUOTE'
    );
  }

  private _collectBlockDomCandidates(view: any): HTMLElement[] {
    const proseMirrorRoot = view.dom as HTMLElement;
    const all = [proseMirrorRoot, ...Array.from(proseMirrorRoot.querySelectorAll('*'))] as HTMLElement[];

    const result: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    for (const element of all) {
      if (this._isIgnoredOverlayElement(element)) continue;
      const parent = element.parentElement;
      if (!this._isPageContainerDom(parent, proseMirrorRoot)) continue;
      if (seen.has(element)) continue;
      seen.add(element);
      result.push(element);
    }

    return result;
  }

  /** Fallback resolution: nearest block candidate by vertical proximity. */
  private _resolveBlockFallback(handleY: number): { pos: number; node: any } | null {
    const editor = this._host.editor;
    if (!editor) return null;
    const view = editor.view;
    const candidates = this._collectBlockDomCandidates(view);
    let best: { pos: number; node: any; depth: number; distance: number } | null = null;

    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const distance = handleY < rect.top
        ? rect.top - handleY
        : handleY > rect.bottom
          ? handleY - rect.bottom
          : 0;

      const resolved = this._resolveBlockFromDomElement(view, candidate);
      if (!resolved) continue;

      if (
        !best ||
        this._shouldPreferCandidate(best, {
          pos: resolved.pos,
          node: resolved.node,
          depth: resolved.depth,
          distance,
        })
      ) {
        best = { ...resolved, distance };
      }
    }

    return best ? { pos: best.pos, node: best.node } : null;
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
    this._setHandleInteractionLock(false);
    if (this._blockAddBtn) { this._blockAddBtn.remove(); this._blockAddBtn = null; }
    if (this._dragHandleEl) { this._dragHandleEl.remove(); this._dragHandleEl = null; }
    this._lastPointerClient = null;
    this._resolvedBlockPos = null;
  }
}
