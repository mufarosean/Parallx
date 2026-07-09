// blockMarquee.ts — Box-drag (marquee / lasso) block selection
//
// Implements Notion-style drag-to-select: mousedown on the ProseMirror
// background starts a selection rectangle.  Blocks overlapping the marquee
// are added to the BlockSelectionController on mouseup.
//
// Gate: handles/ — imports only from handleRegistry.ts.

import type { Editor } from '@tiptap/core';
import { enumerateBlockUnits } from './handleRegistry.js';
import type { BlockSelectionController } from './handleRegistry.js';

// ── Host Interface ──────────────────────────────────────────────────────────

export interface BlockMarqueeHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
  readonly blockSelection: BlockSelectionController;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum drag distance (px) before the marquee becomes visible. */
const ACTIVATION_THRESHOLD = 5;

/** CSS class applied to the marquee overlay element. */
const MARQUEE_CLASS = 'block-marquee';

/** CSS class added to the editor container while a marquee drag is active. */
const MARQUEE_ACTIVE_CLASS = 'block-marquee-active';

// ── Controller ──────────────────────────────────────────────────────────────

export class BlockMarqueeController {
  private _marqueeEl: HTMLElement | null = null;
  private _origin: { x: number; y: number } | null = null;
  private _active = false;

  constructor(private readonly _host: BlockMarqueeHost) {}

  // ── Setup / Teardown ──────────────────────────────────────────────────

  setup(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;

    // Create marquee overlay (hidden by default)
    this._marqueeEl = document.createElement('div');
    this._marqueeEl.className = MARQUEE_CLASS;
    ec.appendChild(this._marqueeEl);

    // Listen on the editor container for mousedown
    ec.addEventListener('mousedown', this._onMouseDown);
  }

  dispose(): void {
    const ec = this._host.editorContainer;
    if (ec) {
      ec.removeEventListener('mousedown', this._onMouseDown);
    }
    this._cleanup();
    if (this._marqueeEl?.parentElement) {
      this._marqueeEl.parentElement.removeChild(this._marqueeEl);
    }
    this._marqueeEl = null;
  }

  // ── Event Handlers ────────────────────────────────────────────────────

  private readonly _onMouseDown = (e: MouseEvent): void => {
    // Only trigger on left-click, no modifier keys (Shift+Click is range-extend)
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target as HTMLElement;

    // Only start marquee on the ProseMirror background or the editor container
    // itself — not on block content, handles, or menus.
    if (!this._isBackgroundTarget(target)) return;

    this._origin = { x: e.clientX, y: e.clientY };
    this._active = false;

    // Attach global listeners for drag tracking
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  };

  private readonly _onMouseMove = (e: MouseEvent): void => {
    if (!this._origin) return;

    const dx = e.clientX - this._origin.x;
    const dy = e.clientY - this._origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!this._active && dist >= ACTIVATION_THRESHOLD) {
      this._active = true;
      // Clear existing selection when marquee starts
      this._host.blockSelection.clear();
      this._host.editorContainer?.classList.add(MARQUEE_ACTIVE_CLASS);
      // Clear native text selection that ProseMirror may have started
      // from the (un-prevented) mousedown on the editor background.
      window.getSelection()?.removeAllRanges();
    }

    if (!this._active || !this._marqueeEl) return;

    // Suppress native text-selection growth while the marquee is active.
    e.preventDefault();

    // Calculate marquee rectangle relative to the editor container's
    // *scroll-content* coordinate space.  The wrapper has overflow-y: auto,
    // so we must add scrollTop / scrollLeft to the viewport-relative offset
    // so the marquee overlay tracks the cursor correctly even when scrolled.
    const ec = this._host.editorContainer!;
    const ecRect = ec.getBoundingClientRect();
    const scrollX = ec.scrollLeft;
    const scrollY = ec.scrollTop;
    const x1 = Math.min(this._origin.x, e.clientX) - ecRect.left + scrollX;
    const y1 = Math.min(this._origin.y, e.clientY) - ecRect.top + scrollY;
    const x2 = Math.max(this._origin.x, e.clientX) - ecRect.left + scrollX;
    const y2 = Math.max(this._origin.y, e.clientY) - ecRect.top + scrollY;

    this._marqueeEl.style.left = `${x1}px`;
    this._marqueeEl.style.top = `${y1}px`;
    this._marqueeEl.style.width = `${x2 - x1}px`;
    this._marqueeEl.style.height = `${y2 - y1}px`;
    this._marqueeEl.style.display = 'block';
  };

  private readonly _onMouseUp = (e: MouseEvent): void => {
    if (this._active) {
      // Prevent ProseMirror from finalizing a text selection that
      // would trigger a transaction and re-render DOM nodes.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      this._resolveSelection(e);
    }
    this._cleanup();
  };

  // ── Selection Resolution ──────────────────────────────────────────────

  /**
   * Hit-test blocks against the marquee rectangle.
   *
   * Uses a single recursive walk over the PM document tree:
   *  - `columnList` / `column` are structural wrappers — recurse into them,
   *    never select them.
   *  - Everything else is a selectable leaf block — hit-test its DOM rect.
   */
  private _resolveSelection(_e: MouseEvent): void {
    const editor = this._host.editor;
    const marquee = this._marqueeEl;
    if (!editor || !marquee) return;

    const marqueeRect = marquee.getBoundingClientRect();
    if (marqueeRect.width < 2 || marqueeRect.height < 2) return;

    // The MODEL decides what the units are (enumerateBlockUnits — the same
    // definition the drag handle and action menu use); this controller only
    // owns the GEOMETRY: hit-testing each unit's visual extent against the
    // marquee.  List rows are hit-tested on their OWN line, not the full
    // <li> rect — the <li> spans all nested descendants, so testing it would
    // grab the parent whenever the marquee covers any nested row.
    const positions: number[] = [];
    const view = editor.view;
    for (const unit of enumerateBlockUnits(editor.state.doc)) {
      const rect = unit.isListItem
        ? this._listItemLineRect(view, unit.pos, unit.node)
        : this._blockRect(view, unit.pos);
      if (rect && this._rectsOverlap(marqueeRect, rect)) {
        positions.push(unit.pos);
      }
    }

    if (positions.length > 0) {
      this._host.blockSelection.selectMultiple(positions);
      editor.commands.blur();
    }
  }

  /** The DOM bounding rect of a non-list unit, or null when unmapped. */
  private _blockRect(view: any, pos: number): DOMRect | null {
    try {
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      if (!dom || dom.nodeType !== Node.ELEMENT_NODE) return null;
      return dom.getBoundingClientRect();
    } catch {
      return null;
    }
  }

  /**
   * The bounding rect of a list item's OWN line — the DOM rect of its first
   * child block (the item's paragraph/heading), which excludes any nested
   * sub-list beneath it. Falls back to the first line-height band of the whole
   * item if the child DOM can't be resolved.
   */
  private _listItemLineRect(view: any, itemPos: number, itemNode: any): DOMRect | null {
    if (itemNode.childCount > 0) {
      try {
        const firstChildDom = view.nodeDOM(itemPos + 1) as HTMLElement | null;
        if (firstChildDom && firstChildDom.nodeType === Node.ELEMENT_NODE) {
          return firstChildDom.getBoundingClientRect();
        }
      } catch { /* fall through */ }
    }
    try {
      const liDom = view.nodeDOM(itemPos) as HTMLElement | null;
      if (liDom && liDom.nodeType === Node.ELEMENT_NODE) {
        const r = liDom.getBoundingClientRect();
        const lineH = parseFloat(window.getComputedStyle(liDom).lineHeight) || r.height;
        return new DOMRect(r.left, r.top, r.width, Math.min(lineH, r.height));
      }
    } catch { /* unmapped — skip */ }
    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Check whether the mousedown target is a valid marquee start surface. */
  private _isBackgroundTarget(el: HTMLElement): boolean {
    const ec = this._host.editorContainer;

    // Direct hit on the editor-container wrapper (gutter area outside the
    // centred 860 px content column — the most common drag-select origin).
    if (ec && el === ec) return true;

    // Direct hits on ProseMirror container (padding area, gap between
    // blocks, or space below the last block).
    if (
      el.classList.contains('ProseMirror') ||
      el.classList.contains('canvas-tiptap-editor')
    ) {
      return true;
    }

    return false;
  }

  /** AABB overlap test for two DOMRects. */
  private _rectsOverlap(a: DOMRect, b: DOMRect): boolean {
    return !(
      a.right < b.left ||
      a.left > b.right ||
      a.bottom < b.top ||
      a.top > b.bottom
    );
  }

  /** Remove global listeners and hide the marquee element. */
  private _cleanup(): void {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    this._origin = null;
    this._active = false;
    if (this._marqueeEl) {
      this._marqueeEl.style.display = 'none';
    }
    this._host.editorContainer?.classList.remove(MARQUEE_ACTIVE_CLASS);
  }
}
