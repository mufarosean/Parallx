// blockKeyboardShortcuts.ts — Keyboard shortcuts for block operations
//
// Implements the interaction model from CANVAS_STRUCTURAL_MODEL.md §5.4:
//   • Ctrl+Shift+↑   — move block up within parent Page-container
//   • Ctrl+Shift+↓   — move block down within parent Page-container
//   • Ctrl+D         — duplicate block within same parent Page-container
//
// "Page-container" = doc, column, callout, detailsContent, blockquote.
// Block movement is bounded by the container — a block at the top of a
// column stays at the top; it does not jump to the previous container.
// (Cross-container movement is deferred per milestone spec.)

import { Extension } from '@tiptap/core';
import {
  duplicateBlockAt,
  moveBlockDownWithinPageFlow,
  moveBlockUpWithinPageFlow,
} from '../mutations/blockMutations.js';

/** Node types that act as vertical page surfaces in the model. */
const PAGE_SURFACE_NODES = new Set([
  'column', 'callout', 'detailsContent', 'blockquote',
]);

/**
 * Given a resolved position, find the depth of the deepest page surface
 * ancestor (or 0 for the doc root) and the target block depth (surface + 1).
 */
function findBlockContext($pos: any): { containerDepth: number; blockDepth: number } {
  let containerDepth = 0; // doc root
  for (let d = 1; d <= $pos.depth; d++) {
    if (PAGE_SURFACE_NODES.has($pos.node(d).type.name)) {
      containerDepth = d;
    }
  }
  return { containerDepth, blockDepth: containerDepth + 1 };
}

export const BlockKeyboardShortcuts = Extension.create({
  name: 'blockKeyboardShortcuts',

  addStorage() {
    return {
      /** Set by the orchestrator after editor creation.
       *  Used by the Esc shortcut to trigger block selection. */
      selectAtCursor: null as (() => boolean) | null,
    };
  },

  addKeyboardShortcuts() {
    return {
      // ── Esc — Select block at cursor ──
      Escape: () => {
        const fn = this.storage.selectAtCursor;
        if (fn) return fn();
        return false;
      },

      // ── Ctrl+Shift+↑ — Move block up ──
      'Ctrl-Shift-ArrowUp': ({ editor }) => {
        const result = moveBlockUpWithinPageFlow(editor);
        return result.handled;
      },

      // ── Ctrl+Shift+↓ — Move block down ──
      'Ctrl-Shift-ArrowDown': ({ editor }) => {
        const result = moveBlockDownWithinPageFlow(editor);
        return result.handled;
      },

      // ── Ctrl+D — Duplicate block ──
      'Ctrl-d': ({ editor }) => {
        const { state } = editor;
        const { $head } = state.selection;
        const { blockDepth } = findBlockContext($head);

        if ($head.depth < blockDepth) return false;

        const blockPos = $head.before(blockDepth);
        const node = state.doc.nodeAt(blockPos);
        if (!node) return false;

        duplicateBlockAt(editor, blockPos, node, { setSelectionInsideDuplicate: true });
        return true;
      },
    };
  },
});
