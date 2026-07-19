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
import { TextSelection } from '@tiptap/pm/state';
import {
  COLUMN_CONTENT_EXPRESSION,
  columnResizePlugin,
  columnDropPlugin,
  columnAutoDissolvePlugin,
  duplicateBlockAt,
  indentBlock,
  outdentBlock,
  isColumnEffectivelyEmpty,
  resolveBlockAncestry,
  resolveMovableBlock,
  resolveBlockUnit,
  moveBlockAcrossColumnBoundary,
  moveBlockDownWithinPageFlow,
  moveBlockUpWithinPageFlow,
  normalizeColumnList,
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

        // ── Boundary guard: cursor backing into a columnList ──
        // ProseMirror can't join backward across the isolating columnList
        // boundary, so the base keymap falls through to selectNodeBackward —
        // node-selecting the ENTIRE layout, which the next keystroke then
        // deletes. This walks the same ladder as PM's findCutBefore: from a
        // block-start cursor, climb every level the cursor sits at the start
        // of; if the neighbor across the cut is a columnList, enter its last
        // column instead (Notion). Covers direct siblings AND deep cuts
        // (first block of a callout/list right after a layout). An empty
        // DIRECT-sibling source block is consumed on the way in.
        if ($from.parentOffset === 0 && $from.parent.isTextblock && $from.depth >= 1) {
          for (let i = $from.depth - 1; i >= 0; i--) {
            if ($from.index(i) > 0) {
              const container = i === 0 ? editor.state.doc : $from.node(i);
              const neighbor = container.child($from.index(i) - 1);
              if (neighbor.type.name === 'columnList') {
                const { tr } = editor.state;
                const cutBlockPos = $from.before(i + 1);
                if (i + 1 === $from.depth && $from.parent.content.size === 0) {
                  tr.delete(cutBlockPos, cutBlockPos + $from.parent.nodeSize);
                }
                const entryPos = tr.mapping.map(cutBlockPos);
                tr.setSelection(TextSelection.near(tr.doc.resolve(entryPos), -1));
                editor.view.dispatch(tr);
                return true;
              }
              break; // real neighbor that isn't a layout — PM handles it
            }
            if (i > 0 && $from.node(i).type.spec.isolating) break;
          }
        }

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
            // Remember which sibling to land in. If we're deleting the first
            // column, land in what becomes the new first column; otherwise
            // land in the previous column.
            const columnIndex = $from.index(columnListDepth);
            const targetIndex = columnIndex === 0 ? 0 : columnIndex - 1;
            tr.delete(colPos, colPos + columnNode.nodeSize);
            normalizeColumnList(tr, colListPos);
            // After the delete + normalize, place the cursor inside the
            // surviving target column so the user keeps typing in a sensible
            // spot instead of wherever ProseMirror's default resolution lands.
            try {
              const mappedListPos = tr.mapping.map(colListPos);
              const $listPos = tr.doc.resolve(mappedListPos);
              const listNode = $listPos.nodeAfter;
              if (listNode && listNode.type.name === 'columnList' && listNode.childCount > 0) {
                const safeIndex = Math.min(targetIndex, listNode.childCount - 1);
                let inner = mappedListPos + 1; // enter columnList
                for (let i = 0; i < safeIndex; i++) inner += listNode.child(i).nodeSize;
                inner += 2; // enter target column, then its first child block
                tr.setSelection(TextSelection.near(tr.doc.resolve(inner)));
              }
            } catch {
              /* best-effort cursor placement */
            }
            editor.view.dispatch(tr);
            return true;
          }
        }

        // The first block is empty but the column still has content →
        // delete just that block (Notion). The old handler swallowed the
        // keystroke here, leaving an undeletable empty block at the top of
        // the column.
        if ($from.parent.content.size === 0 && columnNode.childCount > 1) {
          const { tr } = editor.state;
          const blockPos = $from.before($from.depth);
          tr.delete(blockPos, blockPos + $from.parent.nodeSize);
          tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(blockPos)), 1));
          editor.view.dispatch(tr);
          return true;
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

        // ── Boundary guard: cursor deleting forward into a columnList ──
        // Mirror of the Backspace guard: joinForward can't cross the
        // isolating boundary, so the base keymap falls through to
        // selectNodeForward — node-selecting the whole layout. Walk the
        // findCutAfter ladder (covers direct siblings AND deep cuts like the
        // last list row before a layout) and enter the first column instead;
        // an empty DIRECT-sibling source block is consumed.
        if ($from.parentOffset === $from.parent.content.size && $from.parent.isTextblock && $from.depth >= 1) {
          for (let i = $from.depth - 1; i >= 0; i--) {
            const container = i === 0 ? editor.state.doc : $from.node(i);
            if ($from.index(i) + 1 < container.childCount) {
              const neighbor = container.child($from.index(i) + 1);
              if (neighbor.type.name === 'columnList') {
                const { tr } = editor.state;
                if (i + 1 === $from.depth && $from.parent.content.size === 0) {
                  const blockPos = $from.before($from.depth);
                  tr.delete(blockPos, blockPos + $from.parent.nodeSize);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(blockPos)), 1));
                } else {
                  const cutPos = $from.after(i + 1);
                  tr.setSelection(TextSelection.near(tr.doc.resolve(cutPos), 1));
                }
                editor.view.dispatch(tr);
                return true;
              }
              break; // real neighbor that isn't a layout — PM handles it
            }
            if (i > 0 && $from.node(i).type.spec.isolating) break;
          }
        }

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
        const result = moveBlockUpWithinPageFlow(editor);
        if (result.moved) return true;

        const ancestry = resolveBlockAncestry(editor.state.selection.$from);
        if (ancestry.columnDepth !== null) {
          return moveBlockAcrossColumnBoundary(editor, 'up');
        }

        return false;
      },

      // Ctrl/Cmd+Shift+↓ — Move current block down one position in the
      // current page flow. If already at the bottom of a column, move below
      // the columnList.
      'Mod-Shift-ArrowDown': ({ editor }) => {
        const result = moveBlockDownWithinPageFlow(editor);
        if (result.moved) return true;

        const ancestry = resolveBlockAncestry(editor.state.selection.$from);
        if (ancestry.columnDepth !== null) {
          return moveBlockAcrossColumnBoundary(editor, 'down');
        }

        return false;
      },

      // Ctrl/Cmd+D — Duplicate the current block within the current page flow
      'Mod-d': ({ editor }) => {
        const movable = resolveMovableBlock(editor.state.selection.$from);
        if (!movable) return false;

        const blockPos = movable.isListItem && movable.listNode?.childCount === 1 && movable.listPos !== null
          ? movable.listPos
          : movable.pos;
        const blockNode = movable.isListItem && movable.listNode?.childCount === 1
          ? movable.listNode
          : movable.node;
        if (!blockNode) return false;

        duplicateBlockAt(editor, blockPos, blockNode);
        return true;
      },

      // ── Tab Indent/Outdent (block nesting) ──────────────────────────────

      // Tab — indent block into the nearest preceding container sibling.
      // Passes through when inside a list (Tiptap handles list indent).
      // The unit resolver replaces a hand-rolled walk that only knew about
      // columns — Tab inside a callout used to grab the WHOLE callout instead
      // of the paragraph under the cursor.
      'Tab': ({ editor }) => {
        const unit = resolveBlockUnit(editor.state.selection.$from);
        if (!unit) return false;
        if (unit.isListItem) return false; // Tiptap owns list row indentation
        return indentBlock(editor, unit.pos, unit.node);
      },

      // Shift+Tab — outdent block from its current container.
      // Passes through when inside a list (Tiptap handles list outdent).
      'Shift-Tab': ({ editor }) => {
        const unit = resolveBlockUnit(editor.state.selection.$from);
        if (!unit) return false;
        if (unit.isListItem) return false; // Tiptap owns list row outdentation
        return outdentBlock(editor, unit.pos, unit.node);
      },
    };
  },

  addProseMirrorPlugins() {
    return [columnResizePlugin(), columnDropPlugin(), columnAutoDissolvePlugin()];
  },
});
