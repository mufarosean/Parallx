// blockHandles.ts — Block Handles controller (+ button, drag handle, block resolution)
//
// Extracted from canvasEditorProvider.ts monolith.  Encapsulates:
//   • + button creation & positioning alongside the GlobalDragHandle
//   • MutationObserver that tracks drag-handle style/class changes
//   • Block resolution from handle position (DOM → ProseMirror mapping)
//   • Drag lifecycle (dragstart, dragend, interaction lock)
//
// The Block Action Menu (turn-into, color, duplicate, delete) lives in
// menus/blockActionMenu.ts — this controller delegates to it via show/hide.

import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { BlockSelectionController } from './blockSelection.js';
import type { BlockActionMenuController } from '../menus/blockActionMenu.js';
import { svgIcon } from '../canvasIcons.js';
import {
  CANVAS_BLOCK_DRAG_MIME,
  clearActiveCanvasDragSession,
  setActiveCanvasDragSession,
} from '../dnd/dragSession.js';
import { PAGE_CONTAINERS, isContainerBlockType } from '../config/blockRegistry.js';

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

  // Observer
  private _handleObserver: MutationObserver | null = null;

  // Pointer tracking
  private _lastHoverElement: HTMLElement | null = null;
  private _lastPointerClient: { x: number; y: number } | null = null;
  private _scrollSyncRaf: number | null = null;

  constructor(
    private readonly _host: BlockHandlesHost,
    private readonly _actionMenu: BlockActionMenuController,
  ) {}

  // ── Setup ───────────────────────────────────────────────────────────────

  setup(): void {
    const ec = this._host.editorContainer;
    const editor = this._host.editor;
    if (!ec || !editor) return;

    // Find the drag handle element created by GlobalDragHandle
    this._dragHandleEl = ec.querySelector('.drag-handle') as HTMLElement;
    if (!this._dragHandleEl) return;

    // ── Create + button ──
    this._blockAddBtn = document.createElement('div');
    this._blockAddBtn.className = 'block-add-btn hide';
    this._blockAddBtn.innerHTML = svgIcon('plus');
    const svg = this._blockAddBtn.querySelector('svg');
    if (svg) { svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); }
    this._blockAddBtn.title = 'Click to add below\nAlt-click to add a block above';
    ec.appendChild(this._blockAddBtn);

    // ── Position + button alongside drag handle via MutationObserver ──
    this._handleObserver = new MutationObserver(() => {
      if (!this._dragHandleEl || !this._blockAddBtn) return;
      if (this._isResizeInteractionActive()) {
        this._blockAddBtn.classList.add('hide');
        if (this._isColumnResizing()) {
          this._actionMenu.hide();
        }
        return;
      }
      const isHidden = this._dragHandleEl.classList.contains('hide');
      if (isHidden) {
        this._blockAddBtn.classList.add('hide');
        return;
      }
      this._blockAddBtn.classList.remove('hide');
      this._blockAddBtn.style.top = this._dragHandleEl.style.top;
      const handleLeft = parseFloat(this._dragHandleEl.style.left);
      if (!isNaN(handleLeft)) {
        this._blockAddBtn.style.left = `${handleLeft - 22}px`;
      }
    });
    this._handleObserver.observe(this._dragHandleEl, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

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
    // Single source of truth for dragstart/dragend on the block handle.
    // We capture dragstart so the external extension does not mutate selection
    // or drag payload in parallel.
    this._dragHandleEl.addEventListener('dragstart', this._onDragHandleDragStart, true);
    this._dragHandleEl.addEventListener('dragend', this._onDragHandleDragEnd);

    // ── Prevent drag handle from hiding when mouse moves to the + button ──
    ec.addEventListener('mouseout', this._onEditorMouseOut, true);
    ec.addEventListener('mousemove', this._onEditorMouseMove, true);
    ec.addEventListener('mouseleave', this._onEditorMouseLeave, true);
    window.addEventListener('scroll', this._onScrollSync, true);


  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The block-action-menu element (for outside-click checks). */
  get menu(): HTMLElement | null { return this._actionMenu.menu; }

  hide(): void {
    this._actionMenu.hide();
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
    this._lastHoverElement = target;
  };

  private readonly _onEditorMouseLeave = (): void => {
    this._lastHoverElement = null;
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

      this._lastHoverElement = hovered;

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
  };

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

  private readonly _onDragHandleDragEnd = (): void => {
    const editor = this._host.editor;
    if (!editor) return;
    editor.view.dragging = null as any;
    editor.view.dom.classList.remove('dragging');
    setTimeout(() => {
      clearActiveCanvasDragSession();
    }, 0);
    this._scheduleHandleInteractionUnlock();
  };

  private readonly _onDragHandleMouseDown = (): void => {
    if (this._isResizeInteractionActive()) return;
    this._setHandleInteractionLock(true);
  };

  private readonly _onGlobalMouseUp = (): void => {
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
   * Find the block the drag handle is currently next to.
   *
   * Uses the "Everything is a Page" structural model: every vertical
   * container of blocks (doc, column, callout, detailsContent, blockquote)
   * is a Page-container.  The handle always resolves to the **direct child**
   * of the deepest Page-container at the resolved position.
   *
   * This works at arbitrary nesting depth — callout-inside-column,
   * toggle-inside-callout, etc. — without hardcoded special cases.
   */
  private _resolveBlockFromHandle(): { pos: number; node: any } | null {
    const editor = this._host.editor;
    if (!editor || !this._dragHandleEl) return null;
    const view = editor.view;

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

    const hoverResolved = this._lastHoverElement
      ? this._resolveBlockFromDomElement(view, this._lastHoverElement)
      : null;
    if (hoverResolved) {
      const distance = this._distanceFromHandleToBlockCenter(handleY, hoverResolved.pos, view);
      if (distance <= 180) {
        return { pos: hoverResolved.pos, node: hoverResolved.node };
      }
    }
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
    } else {
      blockPos = $pos.depth >= 1 ? $pos.before($pos.depth) : docPos;
    }

    const node = view.state.doc.nodeAt(blockPos);
    if (!node) return null;

    if (node.type.name === 'columnList') {
      return this._resolveFirstBlockInsideColumnList(view, blockPos, node, targetDepth + 1) ?? { pos: blockPos, node, depth: targetDepth };
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

      const nextContainer = isContainerBlockType(next.node?.type?.name ?? '');
      const currentContainer = isContainerBlockType(current.node?.type?.name ?? '');
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
    this._handleObserver?.disconnect();
    this._handleObserver = null;
    this._host.editorContainer?.removeEventListener('mouseout', this._onEditorMouseOut, true);
    this._host.editorContainer?.removeEventListener('mousemove', this._onEditorMouseMove, true);
    this._host.editorContainer?.removeEventListener('mouseleave', this._onEditorMouseLeave, true);
    window.removeEventListener('scroll', this._onScrollSync, true);
    this._dragHandleEl?.removeEventListener('dragstart', this._onDragHandleDragStart, true);
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
    this._dragHandleEl = null;
    this._lastHoverElement = null;
    this._lastPointerClient = null;
  }
}
