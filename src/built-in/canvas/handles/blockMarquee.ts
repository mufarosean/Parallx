// blockMarquee.ts — Box-drag (marquee / lasso) block selection
//
// Implements Notion-style drag-to-select: mousedown on the ProseMirror
// background starts a selection rectangle.  Blocks overlapping the marquee
// are added to the BlockSelectionController on mouseup.
//
// Gate: handles/ — imports only from handleRegistry.ts.

import type { Editor } from '@tiptap/core';
import { resolveBlockAncestry, PAGE_CONTAINERS } from './handleRegistry.js';
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
    }

    if (!this._active || !this._marqueeEl) return;

    // Calculate marquee rectangle relative to the editor container
    const ecRect = this._host.editorContainer!.getBoundingClientRect();
    const x1 = Math.min(this._origin.x, e.clientX) - ecRect.left;
    const y1 = Math.min(this._origin.y, e.clientY) - ecRect.top;
    const x2 = Math.max(this._origin.x, e.clientX) - ecRect.left;
    const y2 = Math.max(this._origin.y, e.clientY) - ecRect.top;

    this._marqueeEl.style.left = `${x1}px`;
    this._marqueeEl.style.top = `${y1}px`;
    this._marqueeEl.style.width = `${x2 - x1}px`;
    this._marqueeEl.style.height = `${y2 - y1}px`;
    this._marqueeEl.style.display = 'block';
  };

  private readonly _onMouseUp = (e: MouseEvent): void => {
    if (this._active) {
      this._resolveSelection(e);
    }
    this._cleanup();
  };

  // ── Selection Resolution ──────────────────────────────────────────────

  /**
   * Hit-test all top-level blocks against the marquee rectangle and
   * select any that overlap.
   */
  private _resolveSelection(_e: MouseEvent): void {
    const editor = this._host.editor;
    const ec = this._host.editorContainer;
    const marquee = this._marqueeEl;
    if (!editor || !ec || !marquee) return;

    // Get marquee bounds in viewport coordinates
    const marqueeRect = marquee.getBoundingClientRect();
    if (marqueeRect.width < 2 || marqueeRect.height < 2) return;

    // Walk through top-level blocks in the document and check overlap
    const { doc } = editor.state;
    const { view } = editor;
    const positions: number[] = [];

    doc.forEach((node, offset) => {
      // For each top-level child, get its DOM element and check overlap
      try {
        const domNode = view.nodeDOM(offset) as HTMLElement | null;
        if (!domNode || domNode.nodeType !== Node.ELEMENT_NODE) return;

        const blockRect = domNode.getBoundingClientRect();
        if (this._rectsOverlap(marqueeRect, blockRect)) {
          positions.push(offset);
        }
      } catch { /* ignore unmapped nodes */ }
    });

    // Also walk column children if the marquee overlaps columns
    this._resolveColumnChildren(doc, view, marqueeRect, positions);

    // Apply selection
    if (positions.length > 0) {
      // Select the first, then extend to include all others
      this._host.blockSelection.select(positions[0]);
      for (let i = 1; i < positions.length; i++) {
        this._host.blockSelection.toggle(positions[i]);
      }
    }
  }

  /**
   * Walk through column containers and check if their children overlap
   * the marquee. This handles the case where the marquee covers blocks
   * inside columns rather than the columnList itself.
   */
  private _resolveColumnChildren(
    doc: any,
    view: any,
    marqueeRect: DOMRect,
    positions: number[],
  ): void {
    const posSet = new Set(positions);
    doc.forEach((node: any, offset: number) => {
      if (node.type.name !== 'columnList') return;

      // Walk columns inside the columnList
      node.forEach((col: any, colOffset: number) => {
        if (col.type.name !== 'column') return;
        const colAbsPos = offset + 1 + colOffset;

        // Walk blocks inside the column
        col.forEach((block: any, blockOffset: number) => {
          const blockAbsPos = colAbsPos + 1 + blockOffset;
          if (posSet.has(blockAbsPos)) return; // already captured

          try {
            const domNode = view.nodeDOM(blockAbsPos) as HTMLElement | null;
            if (!domNode || domNode.nodeType !== Node.ELEMENT_NODE) return;

            const blockRect = domNode.getBoundingClientRect();
            if (this._rectsOverlap(marqueeRect, blockRect)) {
              positions.push(blockAbsPos);
              posSet.add(blockAbsPos);
            }
          } catch { /* ignore unmapped nodes */ }
        });
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Check whether the mousedown target is a valid marquee start surface. */
  private _isBackgroundTarget(el: HTMLElement): boolean {
    // Direct hits on ProseMirror container or editor container
    if (
      el.classList.contains('ProseMirror') ||
      el.classList.contains('canvas-tiptap-editor')
    ) {
      return true;
    }

    // The ProseMirror element's direct padding area sometimes resolves to
    // the element itself, other times to the first/last child.  Check if
    // the element is the .ProseMirror or is an immediate child that is a
    // structural wrapper (not actual content).
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
