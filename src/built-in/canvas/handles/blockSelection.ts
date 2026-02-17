// blockSelection.ts — Block selection model
//
// Implements §5.2.2 of CANVAS_STRUCTURAL_MODEL.md:
//   • Click handle → select single block (blue highlight)
//   • Shift+Click handle → extend selection range
//   • Esc → select block at cursor
//   • Selected blocks support group delete / duplicate / move
//
// Selection is position-based and maps to DOM nodes for visual feedback.
// Positions are refreshed on document changes to stay valid.

import type { Editor } from '@tiptap/core';

/** Node types that act as vertical block containers (Pages in the model). */
const PAGE_CONTAINERS = new Set([
  'column', 'callout', 'detailsContent', 'blockquote',
]);

export interface BlockSelectionHost {
  readonly editor: Editor | null;
  readonly container: HTMLElement;
  readonly editorContainer: HTMLElement | null;
}

/**
 * Tracks a set of selected block positions and renders visual indicators.
 *
 * Positions are absolute document positions (the "before" position of a
 * block node). They become invalid on any edit — the controller clears
 * selection on document changes to avoid stale references.
 */
export class BlockSelectionController {
  /** Set of selected block positions (absolute doc positions). */
  private _selected = new Set<number>();
  /** CSS class added to selected DOM nodes. */
  private static readonly _SEL_CLASS = 'block-selected';

  private _editorChangeHandler: (() => void) | null = null;
  private _docClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(private readonly _host: BlockSelectionHost) {}

  // ── Setup / Teardown ──────────────────────────────────────────────────

  setup(): void {
    // Clear selection on any document edit (positions become stale)
    this._editorChangeHandler = () => this.clear();
    this._host.editor?.on('update', this._editorChangeHandler);

    // Clear selection when clicking on empty editor area (deselect)
    this._docClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only clear if clicking on editor background, not on blocks or handles
      if (
        target.classList.contains('canvas-tiptap-editor') ||
        target.classList.contains('ProseMirror')
      ) {
        this.clear();
      }
    };
    this._host.editorContainer?.addEventListener('mousedown', this._docClickHandler);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Whether any blocks are currently selected. */
  get hasSelection(): boolean {
    return this._selected.size > 0;
  }

  /** Number of selected blocks. */
  get count(): number {
    return this._selected.size;
  }

  /** Snapshot of currently selected positions. */
  get positions(): number[] {
    return [...this._selected].sort((a, b) => a - b);
  }

  /**
   * Select a single block, clearing any previous selection.
   * @param pos Absolute document position of the block node.
   */
  select(pos: number): void {
    this.clear();
    this._selected.add(pos);
    this._renderSelection();
  }

  /**
   * Toggle a block's selection (for Shift+Click).
   * If already selected, deselect it. Otherwise add it.
   */
  toggle(pos: number): void {
    if (this._selected.has(pos)) {
      this._selected.delete(pos);
    } else {
      this._selected.add(pos);
    }
    this._renderSelection();
  }

  /**
   * Extend selection from current selection to the given position.
   * Selects all blocks between the anchor (first selected) and pos within
   * the same parent container.
   */
  extendTo(pos: number): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) {
      this.select(pos);
      return;
    }

    // Find the anchor (smallest currently selected position)
    const anchor = Math.min(...this._selected);
    const $anchor = editor.state.doc.resolve(anchor);
    const $target = editor.state.doc.resolve(pos);

    // Find parent container for both positions
    const anchorCtx = findBlockContext($anchor);
    const targetCtx = findBlockContext($target);

    // Only extend within the same parent container
    if (anchorCtx.containerDepth !== targetCtx.containerDepth) {
      this.select(pos);
      return;
    }

    const containerDepth = anchorCtx.containerDepth;
    const container = containerDepth === 0 ? editor.state.doc : $anchor.node(containerDepth);
    const parentPos = containerDepth === 0 ? 0 : $anchor.before(containerDepth);

    // Collect all block positions within the range
    const anchorIndex = $anchor.index(containerDepth);
    const targetIndex = $target.index(containerDepth);
    const fromIndex = Math.min(anchorIndex, targetIndex);
    const toIndex = Math.max(anchorIndex, targetIndex);

    this._selected.clear();
    let offset = parentPos + (containerDepth === 0 ? 0 : 1); // skip container open token
    for (let i = 0; i < container.childCount; i++) {
      if (i >= fromIndex && i <= toIndex) {
        this._selected.add(offset);
      }
      offset += container.child(i).nodeSize;
    }

    this._renderSelection();
  }

  /**
   * Select the block at the current cursor position (for Esc key).
   */
  selectAtCursor(): boolean {
    const editor = this._host.editor;
    if (!editor) return false;

    const { $head } = editor.state.selection;
    const { blockDepth } = findBlockContext($head);

    if ($head.depth < blockDepth) return false;

    const blockPos = $head.before(blockDepth);
    const node = editor.state.doc.nodeAt(blockPos);
    if (!node) return false;

    this.select(blockPos);
    return true;
  }

  /** Clear all selection. */
  clear(): void {
    if (this._selected.size === 0) return;
    this._selected.clear();
    this._clearVisual();
  }

  // ── Group Operations ──────────────────────────────────────────────────

  /**
   * Delete all selected blocks.
   * Processes from last to first to maintain position validity.
   */
  deleteSelected(): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return;

    const positions = this.positions.reverse(); // process from end to start
    const { tr } = editor.state;

    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (node) {
        tr.delete(pos, pos + node.nodeSize);
      }
    }

    editor.view.dispatch(tr);
    this.clear();
  }

  /**
   * Duplicate all selected blocks.
   * Each block's copy is inserted immediately after it.
   * Processes from last to first to maintain position validity.
   */
  duplicateSelected(): void {
    const editor = this._host.editor;
    if (!editor || this._selected.size === 0) return;

    const positions = this.positions.reverse();
    const { tr } = editor.state;

    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (node) {
        const clone = editor.state.schema.nodeFromJSON(node.toJSON());
        tr.insert(pos + node.nodeSize, clone);
      }
    }

    editor.view.dispatch(tr);
    this.clear();
  }

  // ── Visual Rendering ──────────────────────────────────────────────────

  private _renderSelection(): void {
    this._clearVisual();
    const editor = this._host.editor;
    if (!editor) return;

    for (const pos of this._selected) {
      try {
        const domInfo = editor.view.domAtPos(pos);
        // Walk up to find the block-level DOM element
        let el = domInfo.node as HTMLElement;
        if (el.nodeType === Node.TEXT_NODE) {
          el = el.parentElement!;
        }
        // Find the nearest block-level element
        const blockEl = this._findBlockDomElement(el, pos);
        if (blockEl) {
          blockEl.classList.add(BlockSelectionController._SEL_CLASS);
        }
      } catch { /* position may be invalid */ }
    }
  }

  /**
   * Find the DOM element representing the block at the given position.
   * Uses ProseMirror's nodeDOM when available, falls back to closest block.
   */
  private _findBlockDomElement(el: HTMLElement, pos: number): HTMLElement | null {
    const editor = this._host.editor;
    if (!editor) return null;

    try {
      // ProseMirror's nodeDOM returns the outermost DOM element for a node
      const domNode = editor.view.nodeDOM(pos) as HTMLElement | null;
      if (domNode && domNode.nodeType === Node.ELEMENT_NODE) {
        return domNode;
      }
    } catch { /* fall through */ }

    // Fallback: walk up from the domAtPos element
    const proseMirror = this._host.editorContainer?.querySelector('.ProseMirror');
    if (!proseMirror) return null;

    let current: HTMLElement | null = el;
    while (current && current !== proseMirror) {
      if (current.parentElement === proseMirror ||
          current.parentElement?.classList.contains('canvas-column') ||
          current.parentElement?.classList.contains('canvas-callout-content') ||
          current.parentElement?.matches('[data-type=detailsContent]') ||
          current.parentElement?.tagName === 'BLOCKQUOTE') {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private _clearVisual(): void {
    const ec = this._host.editorContainer;
    if (!ec) return;
    const selected = ec.querySelectorAll(`.${BlockSelectionController._SEL_CLASS}`);
    selected.forEach((el) => el.classList.remove(BlockSelectionController._SEL_CLASS));
  }

  // ── Dispose ─────────────────────────────────────────────────────────────

  dispose(): void {
    this.clear();
    if (this._editorChangeHandler) {
      this._host.editor?.off('update', this._editorChangeHandler);
      this._editorChangeHandler = null;
    }
    if (this._docClickHandler) {
      this._host.editorContainer?.removeEventListener('mousedown', this._docClickHandler);
      this._docClickHandler = null;
    }
  }
}

// ── Shared utility ──────────────────────────────────────────────────────────

function findBlockContext($pos: any): { containerDepth: number; blockDepth: number } {
  let containerDepth = 0;
  for (let d = 1; d <= $pos.depth; d++) {
    if (PAGE_CONTAINERS.has($pos.node(d).type.name)) {
      containerDepth = d;
    }
  }
  return { containerDepth, blockDepth: containerDepth + 1 };
}
