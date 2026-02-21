// columnNodes.ts — Column + ColumnList node definitions
//
// Columns are spatial partitions, NOT blocks. Users interact with the blocks
// inside columns, never with the column/columnList containers themselves.
// Columns have no drag handles, no action menus, no block identity.
// Two nodes:
//   • ColumnList — invisible flex wrapper, group 'block', content 'column column+' (min 2)
//   • Column — individual spatial partition, content 'block+'
//
// Keyboard shortcuts (Mod-a, Backspace, Delete, Mod-Shift-ArrowUp/Down, Mod-d)
// are defined on the ColumnList extension.
//
// ProseMirror plugins (resize, drop, auto-dissolve) are wired from the
// plugins/ directory.

import { Node, mergeAttributes } from '@tiptap/core';
import {
  COLUMN_CONTENT_EXPRESSION,
  columnResizePlugin,
  columnDropPlugin,
  columnAutoDissolvePlugin,
  duplicateBlockAt,
  isColumnEffectivelyEmpty,
  moveBlockAcrossColumnBoundary,
  moveBlockDownWithinPageFlow,
  moveBlockUpWithinPageFlow,
  normalizeColumnListAfterMutation,
} from '../config/blockRegistry.js';

export const Column = Node.create({
  name: 'column',
  // Includes nested columnList to allow split-within-split layouts.
  // The allowed node set is centralized in config/blockRegistry.ts.
  //
  // Function form (not a bare value) is required here. blockRegistry.ts imports
  // Column/ColumnList AND computes COLUMN_CONTENT_EXPRESSION from its definitions
  // array. That creates a module cycle. In esbuild's IIFE bundle, columnNodes.ts
  // evaluates first, so a bare `content: COLUMN_CONTENT_EXPRESSION` would capture
  // `undefined`. Tiptap calls `callOrReturn()` on `content` at schema-build time
  // (inside `new Editor()`), when all modules are fully initialized.
  content() {
    return COLUMN_CONTENT_EXPRESSION;
  },
  isolating: true,
  defining: true,

  addAttributes() {
    return {
      width: {
        default: null, // null = equal width (flex: 1)
        parseHTML: (element: HTMLElement) => {
          const w = element.style.width;
          if (w && w.endsWith('%')) return parseFloat(w);
          return null;
        },
        renderHTML: (attributes: Record<string, any>) => {
          if (attributes.width != null) {
            return { style: `width: ${attributes.width}%` };
          }
          return {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column',
        class: 'canvas-column',
      }),
      0,
    ];
  },
});

export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column+',
  isolating: true,
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columnList"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'columnList',
        class: 'canvas-column-list',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Cmd/Ctrl+A inside a column → select column content, not entire doc
      'Mod-a': ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === 'column') {
            const start = $from.start(depth);
            const end = $from.end(depth);
            editor.chain().setTextSelection({ from: start, to: end }).run();
            return true;
          }
        }
        return false;
      },

      // Backspace at start of first block in a column → prevent destroying
      // column structure. If column has only one empty paragraph, remove
      // the column and dissolve columnList if only one column remains.
      'Backspace': ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (!selection.empty) return false;

        // Find if we're inside a column
        let columnDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'column') { columnDepth = d; break; }
        }
        if (columnDepth < 0) return false;

        // Only intercept if cursor is at the very start of the column's
        // first content block.
        const columnStart = $from.start(columnDepth);
        const textblockStart = $from.start($from.depth);
        // Cursor must be at start of its textblock
        if ($from.pos !== textblockStart) return false;
        // That textblock must be the first child of the column
        if (textblockStart !== columnStart + 1) return false;

        // Check if column is effectively empty (placeholder-only counts as empty)
        const columnNode = $from.node(columnDepth);
        if (isColumnEffectivelyEmpty(columnNode)) {
          // Remove this column — dissolve logic will handle the rest
          const columnListDepth = columnDepth - 1;
          const columnListNode = $from.node(columnListDepth);
          if (columnListNode.type.name === 'columnList' && columnListNode.childCount >= 2) {
            const colPos = $from.before(columnDepth);
            const colListPos = $from.before(columnListDepth);
            const { tr } = editor.state;
            tr.delete(colPos, colPos + columnNode.nodeSize);
            normalizeColumnListAfterMutation(tr, colListPos);
            editor.view.dispatch(tr);
            return true;
          }
        }

        // At start of column but content exists — just prevent destruction
        return true;
      },

      // Delete at end of last block in a column → prevent merging with
      // the next column or breaking column structure
      'Delete': ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (!selection.empty) return false;

        let columnDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'column') { columnDepth = d; break; }
        }
        if (columnDepth < 0) return false;

        // Only intercept if cursor is at the very end of the column
        const columnEnd = $from.end(columnDepth);
        if ($from.pos !== columnEnd) return false;

        // Prevent deletion across column boundary
        return true;
      },

      // ── Keyboard Block Movement (Rule 6) ──────────────────────────────

      // Ctrl/Cmd+Shift+↑ — Move current block up one position in the current
      // page flow. If already at the top of a column, move above the
      // columnList.
      'Mod-Shift-ArrowUp': ({ editor }) => {
        const { $from } = editor.state.selection;

        // Locate the moveable block — direct child of column or doc
        let blockDepth = -1;
        let insideColumn = false;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'column') {
            blockDepth = d + 1;
            insideColumn = true;
            break;
          }
        }
        if (blockDepth < 0) blockDepth = 1; // top-level
        if (blockDepth > $from.depth) return false;

        const blockPos = $from.before(blockDepth);
        const blockNode = editor.state.doc.nodeAt(blockPos);
        if (!blockNode) return false;

        const indexInParent = $from.index(blockDepth - 1);

        if (indexInParent > 0) {
          moveBlockUpWithinPageFlow(editor);
          return true;
        }

        // Already at top of page flow — cross-flow move?
        if (insideColumn) {
          return moveBlockAcrossColumnBoundary(editor, 'up');
        }

        return false;
      },

      // Ctrl/Cmd+Shift+↓ — Move current block down one position in the
      // current page flow. If already at the bottom of a column, move below
      // the columnList.
      'Mod-Shift-ArrowDown': ({ editor }) => {
        const { $from } = editor.state.selection;

        let blockDepth = -1;
        let insideColumn = false;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'column') {
            blockDepth = d + 1;
            insideColumn = true;
            break;
          }
        }
        if (blockDepth < 0) blockDepth = 1;
        if (blockDepth > $from.depth) return false;

        const blockPos = $from.before(blockDepth);
        const blockNode = editor.state.doc.nodeAt(blockPos);
        if (!blockNode) return false;

        const container = $from.node(blockDepth - 1);
        const indexInParent = $from.index(blockDepth - 1);

        if (indexInParent < container.childCount - 1) {
          moveBlockDownWithinPageFlow(editor);
          return true;
        }

        // Already at bottom of page flow — cross-flow move?
        if (insideColumn) {
          return moveBlockAcrossColumnBoundary(editor, 'down');
        }

        return false;
      },

      // Ctrl/Cmd+D — Duplicate the current block within the current page flow
      'Mod-d': ({ editor }) => {
        const { $from } = editor.state.selection;

        let blockDepth = -1;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'column') { blockDepth = d + 1; break; }
        }
        if (blockDepth < 0) blockDepth = 1;
        if (blockDepth > $from.depth) return false;

        const blockPos = $from.before(blockDepth);
        const blockNode = editor.state.doc.nodeAt(blockPos);
        if (!blockNode) return false;

        duplicateBlockAt(editor, blockPos, blockNode);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [columnResizePlugin(), columnDropPlugin(), columnAutoDissolvePlugin()];
  },
});
