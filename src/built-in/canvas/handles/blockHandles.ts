// blockHandles.ts — Block Handles controller (+ button, drag-handle click, block action menu)
//
// Extracted from canvasEditorProvider.ts monolith.  Encapsulates:
//   • + button creation & positioning alongside the GlobalDragHandle
//   • MutationObserver that tracks drag-handle style/class changes
//   • Block resolution from handle position (DOM → ProseMirror mapping)
//   • Block Action Menu (turn-into, color, duplicate, delete)
//   • Turn-Into submenu with 12 block types
//   • Color submenu (10 text colours + 10 background colours)

import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { BlockSelectionController } from './blockSelection.js';
import { $ } from '../../../ui/dom.js';
import { svgIcon } from '../canvasIcons.js';
import {
  CANVAS_BLOCK_DRAG_MIME,
  clearActiveCanvasDragSession,
  setActiveCanvasDragSession,
} from '../dnd/dragSession.js';
import {
  applyBackgroundColorToBlock,
  applyTextColorToBlock,
  deleteBlockAt,
  duplicateBlockAt,
  turnBlockWithSharedStrategy,
} from '../mutations/blockMutations.js';

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
  private _blockActionMenu: HTMLElement | null = null;
  private _turnIntoSubmenu: HTMLElement | null = null;
  private _colorSubmenu: HTMLElement | null = null;
  private _dragHandleEl: HTMLElement | null = null;

  // Timers
  private _turnIntoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _colorHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _interactionReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  // Observer
  private _handleObserver: MutationObserver | null = null;

  // Action target
  private _actionBlockPos: number = -1;
  private _actionBlockNode: any = null;
  private _lastHoverElement: HTMLElement | null = null;
  private _lastPointerClient: { x: number; y: number } | null = null;
  private _scrollSyncRaf: number | null = null;

  constructor(private readonly _host: BlockHandlesHost) {}

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
          this._hideBlockActionMenu();
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

    // ── Create block action menu (hidden by default) ──
    this._createBlockActionMenu();

    // ── Close menu on outside clicks ──
    document.addEventListener('mousedown', this._onDocClickOutside);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** The block-action-menu element (for outside-click checks). */
  get menu(): HTMLElement | null { return this._blockActionMenu; }

  hide(): void {
    this._hideBlockActionMenu();
  }

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
    if (this._blockActionMenu?.style.display === 'block') {
      this._hideBlockActionMenu();
      return;
    }
    const block = this._resolveBlockFromHandle();
    if (!block) return;
    this._actionBlockPos = block.pos;
    this._actionBlockNode = block.node;

    // Select the block (Shift+Click → extend selection)
    if (e.shiftKey) {
      this._host.blockSelection.extendTo(block.pos);
    } else {
      this._host.blockSelection.select(block.pos);
    }

    this._showBlockActionMenu();
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

  private readonly _onDocClickOutside = (e: MouseEvent): void => {
    if (!this._blockActionMenu || this._blockActionMenu.style.display !== 'block') return;
    if (this._isColumnResizing()) {
      this._hideBlockActionMenu();
      return;
    }
    const target = e.target as HTMLElement;
    if (this._blockActionMenu.contains(target)) return;
    if (this._turnIntoSubmenu?.contains(target)) return;
    if (this._colorSubmenu?.contains(target)) return;
    if (this._dragHandleEl?.contains(target)) return;
    this._hideBlockActionMenu();
  };

  // ── Block Resolution ────────────────────────────────────────────────────

  /** Node types whose children are "blocks" in the Page model. */
  private static readonly _PAGE_CONTAINERS = new Set([
    'column', 'callout', 'detailsContent', 'blockquote',
  ]);

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
      if (BlockHandlesController._PAGE_CONTAINERS.has($pos.node(d).type.name)) {
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

      const nextContainer = this._isContainerBlockType(next.node?.type?.name);
      const currentContainer = this._isContainerBlockType(current.node?.type?.name);
      if (currentContainer && !nextContainer) {
        return true;
      }
    }

    return false;
  }

  private _isContainerBlockType(typeName: string | undefined): boolean {
    if (!typeName) return false;
    return typeName === 'callout' || typeName === 'details' || typeName === 'toggleHeading' || typeName === 'blockquote';
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

  // ── Block Action Menu ───────────────────────────────────────────────────

  private _createBlockActionMenu(): void {
    this._blockActionMenu = $('div.block-action-menu');
    this._blockActionMenu.style.display = 'none';
    this._host.container.appendChild(this._blockActionMenu);
  }

  private _showBlockActionMenu(): void {
    if (!this._blockActionMenu || !this._dragHandleEl || !this._actionBlockNode) return;
    this._blockActionMenu.innerHTML = '';

    // Header — block type label
    const header = $('div.block-action-header');
    header.textContent = this._getBlockLabel(this._actionBlockNode.type.name);
    this._blockActionMenu.appendChild(header);

    // Turn into
    const turnIntoSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 7C13 4.24 10.76 2 8 2C5.24 2 3 4.24 3 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M3 9C3 11.76 5.24 14 8 14C10.76 14 13 11.76 13 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M1 7L3 5L5 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 9L13 11L11 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const turnIntoItem = this._createActionItem('Turn into', turnIntoSvg, true);
    turnIntoItem.addEventListener('mouseenter', () => {
      if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
      this._showTurnIntoSubmenu(turnIntoItem);
    });
    turnIntoItem.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget as HTMLElement;
      if (!this._turnIntoSubmenu?.contains(related)) {
        this._turnIntoHideTimer = setTimeout(() => this._hideTurnIntoSubmenu(), 200);
      }
    });
    this._blockActionMenu.appendChild(turnIntoItem);

    // Color
    const colorSvg = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="3" y="11" font-size="11" font-weight="700" fill="currentColor" font-family="sans-serif">A</text><rect x="2" y="13" width="12" height="2" rx="0.5" fill="currentColor" opacity="0.5"/></svg>';
    const colorItem = this._createActionItem('Color', colorSvg, true);
    colorItem.addEventListener('mouseenter', () => {
      if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
      this._showColorSubmenu(colorItem);
    });
    colorItem.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget as HTMLElement;
      if (!this._colorSubmenu?.contains(related)) {
        this._colorHideTimer = setTimeout(() => this._hideColorSubmenu(), 200);
      }
    });
    this._blockActionMenu.appendChild(colorItem);

    // Separator
    this._blockActionMenu.appendChild($('div.block-action-separator'));

    // Duplicate
    const dupItem = this._createActionItem('Duplicate', svgIcon('duplicate'), false, 'Ctrl+D');
    dupItem.addEventListener('mousedown', (e) => { e.preventDefault(); this._duplicateBlock(); });
    this._blockActionMenu.appendChild(dupItem);

    // Delete
    const delItem = this._createActionItem('Delete', svgIcon('trash'), false, 'Del');
    delItem.classList.add('block-action-item--danger');
    delItem.addEventListener('mousedown', (e) => { e.preventDefault(); this._deleteBlock(); });
    this._blockActionMenu.appendChild(delItem);

    // Position below drag handle
    const rect = this._dragHandleEl.getBoundingClientRect();
    this._blockActionMenu.style.display = 'block';
    this._blockActionMenu.style.left = `${rect.left}px`;
    this._blockActionMenu.style.top = `${rect.bottom + 4}px`;

    // Adjust if off-screen
    requestAnimationFrame(() => {
      if (!this._blockActionMenu) return;
      const mRect = this._blockActionMenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        this._blockActionMenu.style.left = `${window.innerWidth - mRect.width - 8}px`;
      }
      if (mRect.bottom > window.innerHeight - 8) {
        this._blockActionMenu.style.top = `${rect.top - mRect.height - 4}px`;
      }
    });
  }

  private _hideBlockActionMenu(): void {
    if (!this._blockActionMenu) return;
    this._blockActionMenu.style.display = 'none';
    this._hideTurnIntoSubmenu();
    this._hideColorSubmenu();
  }

  private _createActionItem(label: string, iconHtml: string, hasSubmenu: boolean, shortcut?: string): HTMLElement {
    const item = $('div.block-action-item');
    const iconEl = $('span.block-action-icon');
    iconEl.innerHTML = iconHtml;
    const svg = iconEl.querySelector('svg');
    if (svg && !svg.getAttribute('width')) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
    item.appendChild(iconEl);
    const labelEl = $('span.block-action-label');
    labelEl.textContent = label;
    item.appendChild(labelEl);
    if (shortcut) {
      const sc = $('span.block-action-shortcut');
      sc.textContent = shortcut;
      item.appendChild(sc);
    }
    if (hasSubmenu) {
      const arrow = $('span.block-action-arrow');
      arrow.innerHTML = svgIcon('chevron-right');
      const chevSvg = arrow.querySelector('svg');
      if (chevSvg) { chevSvg.setAttribute('width', '12'); chevSvg.setAttribute('height', '12'); }
      item.appendChild(arrow);
    }
    return item;
  }

  // ── Turn Into Submenu ───────────────────────────────────────────────────

  private _showTurnIntoSubmenu(anchor: HTMLElement): void {
    this._hideColorSubmenu();
    if (!this._turnIntoSubmenu) {
      this._turnIntoSubmenu = $('div.block-action-submenu');
      this._turnIntoSubmenu.addEventListener('mouseenter', () => {
        if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
      });
      this._turnIntoSubmenu.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!this._blockActionMenu?.contains(related)) {
          this._turnIntoHideTimer = setTimeout(() => this._hideTurnIntoSubmenu(), 200);
        }
      });
      this._host.container.appendChild(this._turnIntoSubmenu);
    }
    this._turnIntoSubmenu.innerHTML = '';

    const items: { label: string; icon: string; isText?: boolean; type: string; attrs?: any; shortcut?: string }[] = [
      { label: 'Text', icon: 'T', isText: true, type: 'paragraph' },
      { label: 'Heading 1', icon: 'H\u2081', isText: true, type: 'heading', attrs: { level: 1 }, shortcut: '#' },
      { label: 'Heading 2', icon: 'H\u2082', isText: true, type: 'heading', attrs: { level: 2 }, shortcut: '##' },
      { label: 'Heading 3', icon: 'H\u2083', isText: true, type: 'heading', attrs: { level: 3 }, shortcut: '###' },
      { label: 'Bulleted list', icon: 'bullet-list', type: 'bulletList' },
      { label: 'Numbered list', icon: 'numbered-list', type: 'orderedList' },
      { label: 'To-do list', icon: 'checklist', type: 'taskList' },
      { label: 'Toggle list', icon: 'chevron-right', type: 'details' },
      { label: '2 columns', icon: 'columns', type: 'columnList', attrs: { columns: 2 } },
      { label: '3 columns', icon: 'columns', type: 'columnList', attrs: { columns: 3 } },
      { label: '4 columns', icon: 'columns', type: 'columnList', attrs: { columns: 4 } },
      { label: 'Code', icon: 'code', type: 'codeBlock' },
      { label: 'Quote', icon: 'quote', type: 'blockquote' },
      { label: 'Callout', icon: 'lightbulb', type: 'callout' },
      { label: 'Block equation', icon: 'math-block', type: 'mathBlock' },
    ];

    for (const item of items) {
      const row = $('div.block-action-item');
      const iconEl = $('span.block-action-icon');
      if (item.isText) {
        iconEl.textContent = item.icon;
        iconEl.style.fontWeight = '700';
        iconEl.style.fontSize = '14px';
      } else {
        iconEl.innerHTML = svgIcon(item.icon as any);
        const isvg = iconEl.querySelector('svg');
        if (isvg) { isvg.setAttribute('width', '16'); isvg.setAttribute('height', '16'); }
      }
      row.appendChild(iconEl);
      const labelEl = $('span.block-action-label');
      labelEl.textContent = item.label;
      row.appendChild(labelEl);
      if (item.shortcut) {
        const sc = $('span.block-action-shortcut');
        sc.textContent = item.shortcut;
        row.appendChild(sc);
      }
      if (this._isCurrentBlockType(item.type, item.attrs)) {
        const check = $('span.block-action-check');
        check.textContent = '\u2713';
        row.appendChild(check);
      }
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._turnBlockInto(item.type, item.attrs); });
      this._turnIntoSubmenu!.appendChild(row);
    }

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._turnIntoSubmenu.style.display = 'block';
    this._turnIntoSubmenu.style.left = `${rect.right + 2}px`;
    this._turnIntoSubmenu.style.top = `${rect.top}px`;
    requestAnimationFrame(() => {
      if (!this._turnIntoSubmenu) return;
      const mRect = this._turnIntoSubmenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        this._turnIntoSubmenu.style.left = `${rect.left - mRect.width - 2}px`;
      }
      if (mRect.bottom > window.innerHeight - 8) {
        this._turnIntoSubmenu.style.top = `${Math.max(8, window.innerHeight - mRect.height - 8)}px`;
      }
    });
  }

  private _hideTurnIntoSubmenu(): void {
    if (this._turnIntoHideTimer) { clearTimeout(this._turnIntoHideTimer); this._turnIntoHideTimer = null; }
    if (this._turnIntoSubmenu) this._turnIntoSubmenu.style.display = 'none';
  }

  // ── Color Submenu ───────────────────────────────────────────────────────

  private _showColorSubmenu(anchor: HTMLElement): void {
    this._hideTurnIntoSubmenu();
    if (!this._colorSubmenu) {
      this._colorSubmenu = $('div.block-action-submenu.block-color-submenu');
      this._colorSubmenu.addEventListener('mouseenter', () => {
        if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
      });
      this._colorSubmenu.addEventListener('mouseleave', (e) => {
        const related = (e as MouseEvent).relatedTarget as HTMLElement;
        if (!this._blockActionMenu?.contains(related)) {
          this._colorHideTimer = setTimeout(() => this._hideColorSubmenu(), 200);
        }
      });
      this._host.container.appendChild(this._colorSubmenu);
    }
    this._colorSubmenu.innerHTML = '';

    // Text color section
    const textHeader = $('div.block-color-section-header');
    textHeader.textContent = 'Text color';
    this._colorSubmenu.appendChild(textHeader);

    const textColors = [
      { label: 'Default text', value: null, display: 'rgba(255,255,255,0.81)' },
      { label: 'Gray text', value: 'rgb(155,155,155)', display: 'rgb(155,155,155)' },
      { label: 'Brown text', value: 'rgb(186,133,83)', display: 'rgb(186,133,83)' },
      { label: 'Orange text', value: 'rgb(230,150,60)', display: 'rgb(230,150,60)' },
      { label: 'Yellow text', value: 'rgb(223,196,75)', display: 'rgb(223,196,75)' },
      { label: 'Green text', value: 'rgb(80,185,120)', display: 'rgb(80,185,120)' },
      { label: 'Blue text', value: 'rgb(70,160,230)', display: 'rgb(70,160,230)' },
      { label: 'Purple text', value: 'rgb(170,120,210)', display: 'rgb(170,120,210)' },
      { label: 'Pink text', value: 'rgb(220,120,170)', display: 'rgb(220,120,170)' },
      { label: 'Red text', value: 'rgb(220,80,80)', display: 'rgb(220,80,80)' },
    ];

    for (const color of textColors) {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      swatch.textContent = 'A';
      swatch.style.color = color.display;
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._applyBlockTextColor(color.value); });
      this._colorSubmenu!.appendChild(row);
    }

    // Separator
    this._colorSubmenu.appendChild($('div.block-action-separator'));

    // Background color section
    const bgHeader = $('div.block-color-section-header');
    bgHeader.textContent = 'Background color';
    this._colorSubmenu.appendChild(bgHeader);

    const bgColors = [
      { label: 'Default background', value: null, display: 'transparent' },
      { label: 'Gray background', value: 'rgba(155,155,155,0.2)', display: 'rgba(155,155,155,0.35)' },
      { label: 'Brown background', value: 'rgba(186,133,83,0.2)', display: 'rgba(186,133,83,0.35)' },
      { label: 'Orange background', value: 'rgba(230,150,60,0.2)', display: 'rgba(230,150,60,0.35)' },
      { label: 'Yellow background', value: 'rgba(223,196,75,0.2)', display: 'rgba(223,196,75,0.35)' },
      { label: 'Green background', value: 'rgba(80,185,120,0.2)', display: 'rgba(80,185,120,0.35)' },
      { label: 'Blue background', value: 'rgba(70,160,230,0.2)', display: 'rgba(70,160,230,0.35)' },
      { label: 'Purple background', value: 'rgba(170,120,210,0.2)', display: 'rgba(170,120,210,0.35)' },
      { label: 'Pink background', value: 'rgba(220,120,170,0.2)', display: 'rgba(220,120,170,0.35)' },
      { label: 'Red background', value: 'rgba(220,80,80,0.2)', display: 'rgba(220,80,80,0.35)' },
    ];

    for (const color of bgColors) {
      const row = $('div.block-color-item');
      const swatch = $('span.block-color-swatch');
      if (color.value) {
        swatch.style.backgroundColor = color.display;
      } else {
        swatch.style.border = '1px solid rgba(255,255,255,0.2)';
      }
      row.appendChild(swatch);
      const label = $('span.block-action-label');
      label.textContent = color.label;
      row.appendChild(label);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._applyBlockBgColor(color.value); });
      this._colorSubmenu!.appendChild(row);
    }

    // Position to the right of anchor
    const rect = anchor.getBoundingClientRect();
    this._colorSubmenu.style.display = 'block';
    this._colorSubmenu.style.left = `${rect.right + 2}px`;
    this._colorSubmenu.style.top = `${rect.top}px`;
    requestAnimationFrame(() => {
      if (!this._colorSubmenu) return;
      const mRect = this._colorSubmenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        this._colorSubmenu.style.left = `${rect.left - mRect.width - 2}px`;
      }
      if (mRect.bottom > window.innerHeight - 8) {
        this._colorSubmenu.style.top = `${Math.max(8, window.innerHeight - mRect.height - 8)}px`;
      }
    });
  }

  private _hideColorSubmenu(): void {
    if (this._colorHideTimer) { clearTimeout(this._colorHideTimer); this._colorHideTimer = null; }
    if (this._colorSubmenu) this._colorSubmenu.style.display = 'none';
  }

  // ── Block Transform Execution ──────────────────────────────────────────

  private _turnBlockInto(targetType: string, attrs?: any): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    if (this._isCurrentBlockType(targetType, attrs)) return;

    turnBlockWithSharedStrategy(editor, pos, node, targetType, attrs);
  }

  private _isCurrentBlockType(targetType: string, attrs?: any): boolean {
    if (!this._actionBlockNode) return false;
    const node = this._actionBlockNode;
    if (node.type.name !== targetType) return false;
    if (targetType === 'heading' && attrs?.level && node.attrs?.level !== attrs.level) return false;
    return true;
  }

  private _getBlockLabel(typeName: string): string {
    const labels: Record<string, string> = {
      paragraph: 'Text', heading: 'Heading', bulletList: 'Bulleted list',
      orderedList: 'Numbered list', taskList: 'To-do list', taskItem: 'To-do',
      listItem: 'List item', blockquote: 'Quote', codeBlock: 'Code',
      callout: 'Callout', details: 'Toggle list', mathBlock: 'Equation',
      columnList: 'Columns', table: 'Table', image: 'Image',
      horizontalRule: 'Divider',
    };
    return labels[typeName] || typeName;
  }

  // ── Color Application ──────────────────────────────────────────────────

  private _applyBlockTextColor(value: string | null): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    const changed = applyTextColorToBlock(editor, pos, node, value);
    if (!changed) return;
  }

  private _applyBlockBgColor(value: string | null): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    applyBackgroundColorToBlock(editor, pos, node, value);
  }

  // ── Duplicate / Delete ─────────────────────────────────────────────────

  private _duplicateBlock(): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    duplicateBlockAt(editor, pos, node);
    editor.commands.focus();
  }

  private _deleteBlock(): void {
    const editor = this._host.editor;
    if (!editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    deleteBlockAt(editor, pos, node);
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    this._handleObserver?.disconnect();
    this._handleObserver = null;
    document.removeEventListener('mousedown', this._onDocClickOutside);
    this._host.editorContainer?.removeEventListener('mouseout', this._onEditorMouseOut, true);
    this._host.editorContainer?.removeEventListener('mousemove', this._onEditorMouseMove, true);
    this._host.editorContainer?.removeEventListener('mouseleave', this._onEditorMouseLeave, true);
    window.removeEventListener('scroll', this._onScrollSync, true);
    this._dragHandleEl?.removeEventListener('dragstart', this._onDragHandleDragStart, true);
    this._dragHandleEl?.removeEventListener('dragend', this._onDragHandleDragEnd);
    this._dragHandleEl?.removeEventListener('mousedown', this._onDragHandleMouseDown, true);
    document.removeEventListener('mouseup', this._onGlobalMouseUp, true);
    if (this._turnIntoHideTimer) {
      clearTimeout(this._turnIntoHideTimer);
      this._turnIntoHideTimer = null;
    }
    if (this._colorHideTimer) {
      clearTimeout(this._colorHideTimer);
      this._colorHideTimer = null;
    }
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
    if (this._blockActionMenu) { this._blockActionMenu.remove(); this._blockActionMenu = null; }
    if (this._turnIntoSubmenu) { this._turnIntoSubmenu.remove(); this._turnIntoSubmenu = null; }
    if (this._colorSubmenu) { this._colorSubmenu.remove(); this._colorSubmenu = null; }
    this._dragHandleEl = null;
    this._actionBlockNode = null;
    this._lastHoverElement = null;
    this._lastPointerClient = null;
  }
}
