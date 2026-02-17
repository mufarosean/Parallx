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
import { TextSelection } from '@tiptap/pm/state';

/** Node types that act as vertical block containers (Pages in the model). */
const PAGE_CONTAINERS = new Set([
  'column', 'callout', 'detailsContent', 'blockquote',
]);

/**
 * Given a resolved position, find the depth of the deepest Page-container
 * ancestor (or 0 for the doc root) and the target block depth (container + 1).
 */
function findBlockContext($pos: any): { containerDepth: number; blockDepth: number } {
  let containerDepth = 0; // doc root
  for (let d = 1; d <= $pos.depth; d++) {
    if (PAGE_CONTAINERS.has($pos.node(d).type.name)) {
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
        const { state } = editor;
        const { $head } = state.selection;
        const { containerDepth, blockDepth } = findBlockContext($head);

        if ($head.depth < blockDepth) return false;

        const blockPos = $head.before(blockDepth);
        const node = state.doc.nodeAt(blockPos);
        if (!node) return false;

        // Find the index of this block within its parent container
        const container = containerDepth === 0 ? state.doc : $head.node(containerDepth);
        const $blockStart = state.doc.resolve(blockPos);
        const index = $blockStart.index(containerDepth);

        // Already at top → can't move further within this container
        if (index <= 0) return true; // handled but no-op

        // Find position of the block above by walking container's children
        const parentPos = containerDepth === 0 ? 0 : $head.before(containerDepth);
        let offset = 0;
        for (let i = 0; i < index - 1; i++) {
          const child = container.child(i);
          offset += child.nodeSize;
        }
        const targetPos = parentPos + (containerDepth === 0 ? 0 : 1) + offset;

        // Swap: cut the current block, insert before the previous block
        const { tr } = state;
        const nodeJson = node.toJSON();
        tr.delete(blockPos, blockPos + node.nodeSize);
        tr.insert(targetPos, state.schema.nodeFromJSON(nodeJson));
        // Set cursor inside the moved block
        const newBlockPos = targetPos;
        tr.setSelection(TextSelection.near(tr.doc.resolve(newBlockPos + 1)));
        editor.view.dispatch(tr);
        return true;
      },

      // ── Ctrl+Shift+↓ — Move block down ──
      'Ctrl-Shift-ArrowDown': ({ editor }) => {
        const { state } = editor;
        const { $head } = state.selection;
        const { containerDepth, blockDepth } = findBlockContext($head);

        if ($head.depth < blockDepth) return false;

        const blockPos = $head.before(blockDepth);
        const node = state.doc.nodeAt(blockPos);
        if (!node) return false;

        const container = containerDepth === 0 ? state.doc : $head.node(containerDepth);
        const $blockStart = state.doc.resolve(blockPos);
        const index = $blockStart.index(containerDepth);

        // Already at bottom → can't move further within this container
        if (index >= container.childCount - 1) return true; // handled but no-op

        // Insert a copy after the next sibling, then delete the original
        const nextSibling = container.child(index + 1);
        const afterNextPos = blockPos + node.nodeSize + nextSibling.nodeSize;

        const { tr } = state;
        const nodeJson = node.toJSON();
        // Insert after the next sibling first (positions shift after delete)
        tr.insert(afterNextPos, state.schema.nodeFromJSON(nodeJson));
        // Delete the original (which is still at the same position)
        tr.delete(blockPos, blockPos + node.nodeSize);

        // Set cursor inside the moved block (it's now where the next sibling was)
        const newBlockPos = blockPos + nextSibling.nodeSize;
        tr.setSelection(TextSelection.near(tr.doc.resolve(newBlockPos + 1)));
        editor.view.dispatch(tr);
        return true;
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

        // Insert a copy immediately after the current block
        const afterPos = blockPos + node.nodeSize;
        const { tr } = state;
        const clone = state.schema.nodeFromJSON(node.toJSON());
        tr.insert(afterPos, clone);
        // Place cursor inside the duplicate
        tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos + 1)));
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
