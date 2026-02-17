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
import { columnResizePlugin } from '../plugins/columnResizePlugin.js';
import { columnDropPlugin } from '../plugins/columnDropPlugin.js';
import { columnAutoDissolvePlugin } from '../plugins/columnAutoDissolve.js';

export const Column = Node.create({
  name: 'column',
  content: 'block+',
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
  content: 'column column+',
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

        // Check if column has only one empty paragraph
        const columnNode = $from.node(columnDepth);
        if (columnNode.childCount === 1 && columnNode.firstChild &&
            columnNode.firstChild.type.name === 'paragraph' &&
            columnNode.firstChild.content.size === 0) {
          // Remove this column — dissolve logic will handle the rest
          const columnListDepth = columnDepth - 1;
          const columnListNode = $from.node(columnListDepth);
          if (columnListNode.type.name === 'columnList' && columnListNode.childCount > 2) {
            // More than 2 columns — just remove this one
            const colPos = $from.before(columnDepth);
            const { tr } = editor.state;
            tr.delete(colPos, colPos + columnNode.nodeSize);
            editor.view.dispatch(tr);
            return true;
          }
          if (columnListNode.type.name === 'columnList' && columnListNode.childCount === 2) {
            // Exactly 2 columns — dissolve: extract the OTHER column's content
            const colListPos = $from.before(columnListDepth);
            let otherColumnIndex = -1;
            let colPos = colListPos + 1;
            for (let i = 0; i < columnListNode.childCount; i++) {
              const child = columnListNode.child(i);
              if (colPos === $from.before(columnDepth)) {
                // This is the column we're deleting
              } else {
                otherColumnIndex = i;
              }
              colPos += child.nodeSize;
            }
            if (otherColumnIndex >= 0) {
              const otherCol = columnListNode.child(otherColumnIndex);
              const { tr } = editor.state;
              tr.replaceWith(colListPos, colListPos + columnListNode.nodeSize, otherCol.content);
              editor.view.dispatch(tr);
              return true;
            }
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

      // Ctrl/Cmd+Shift+↑ — Move current block up one position within its
      // container. If already at the top of a column, move above the
      // columnList.
      'Mod-Shift-ArrowUp': ({ editor }) => {
        const { $from } = editor.state.selection;

        // Locate the moveable block — direct child of column or doc
        let blockDepth = -1;
        let insideColumn = false;
        let colDepth = -1;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'column') {
            colDepth = d;
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

        const container = $from.node(blockDepth - 1);
        const indexInParent = $from.index(blockDepth - 1);

        if (indexInParent > 0) {
          // Swap with previous sibling in the same container
          const prevBlock = container.child(indexInParent - 1);
          const prevPos = blockPos - prevBlock.nodeSize;
          const { tr } = editor.state;
          tr.delete(blockPos, blockPos + blockNode.nodeSize);
          const mapped = tr.mapping.map(prevPos);
          tr.insert(mapped, blockNode);
          editor.view.dispatch(tr);
          return true;
        }

        // Already at top of container — cross-container move?
        if (insideColumn) {
          const colNode = $from.node(colDepth);
          const colPos = $from.before(colDepth);
          const clDepth = colDepth - 1;
          const clPos = $from.before(clDepth);
          const clNode = $from.node(clDepth);
          const { tr } = editor.state;

          if (colNode.childCount <= 1 && clNode.childCount === 2) {
            let otherIdx = -1;
            let pos = clPos + 1;
            for (let i = 0; i < clNode.childCount; i++) {
              if (pos !== colPos) otherIdx = i;
              pos += clNode.child(i).nodeSize;
            }
            if (otherIdx >= 0) {
              const nodes: any[] = [blockNode];
              clNode.child(otherIdx).forEach((ch: any) => nodes.push(ch));
              tr.replaceWith(clPos, clPos + clNode.nodeSize, nodes);
              editor.view.dispatch(tr);
              return true;
            }
          } else if (colNode.childCount <= 1 && clNode.childCount > 2) {
            tr.delete(colPos, colPos + colNode.nodeSize);
            const mapped = tr.mapping.map(clPos);
            tr.insert(mapped, blockNode);
            const mCL = tr.mapping.map(clPos);
            const clNow = tr.doc.nodeAt(mCL);
            if (clNow && clNow.type.name === 'columnList') {
              let off = mCL + 1;
              for (let i = 0; i < clNow.childCount; i++) {
                const ch = clNow.child(i);
                if (ch.type.name === 'column' && ch.attrs.width !== null) {
                  tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
                }
                off += ch.nodeSize;
              }
            }
            editor.view.dispatch(tr);
            return true;
          } else {
            tr.delete(blockPos, blockPos + blockNode.nodeSize);
            const mapped = tr.mapping.map(clPos);
            tr.insert(mapped, blockNode);
            editor.view.dispatch(tr);
            return true;
          }
        }

        return false;
      },

      // Ctrl/Cmd+Shift+↓ — Move current block down one position within
      // its container. If already at the bottom of a column, move below
      // the columnList.
      'Mod-Shift-ArrowDown': ({ editor }) => {
        const { $from } = editor.state.selection;

        let blockDepth = -1;
        let insideColumn = false;
        let colDepth = -1;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'column') {
            colDepth = d;
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
          const nextSibling = container.child(indexInParent + 1);
          const afterNextPos = blockPos + blockNode.nodeSize + nextSibling.nodeSize;
          const { tr } = editor.state;
          tr.delete(blockPos, blockPos + blockNode.nodeSize);
          const mapped = tr.mapping.map(afterNextPos);
          tr.insert(mapped, blockNode);
          editor.view.dispatch(tr);
          return true;
        }

        // Already at bottom of container — cross-container move?
        if (insideColumn) {
          const colNode = $from.node(colDepth);
          const colPos = $from.before(colDepth);
          const clDepth = colDepth - 1;
          const clPos = $from.before(clDepth);
          const clNode = $from.node(clDepth);
          const clEnd = clPos + clNode.nodeSize;
          const { tr } = editor.state;

          if (colNode.childCount <= 1 && clNode.childCount === 2) {
            let otherIdx = -1;
            let pos = clPos + 1;
            for (let i = 0; i < clNode.childCount; i++) {
              if (pos !== colPos) otherIdx = i;
              pos += clNode.child(i).nodeSize;
            }
            if (otherIdx >= 0) {
              const nodes: any[] = [];
              clNode.child(otherIdx).forEach((ch: any) => nodes.push(ch));
              nodes.push(blockNode);
              tr.replaceWith(clPos, clPos + clNode.nodeSize, nodes);
              editor.view.dispatch(tr);
              return true;
            }
          } else if (colNode.childCount <= 1 && clNode.childCount > 2) {
            tr.delete(colPos, colPos + colNode.nodeSize);
            const mapped = tr.mapping.map(clEnd);
            tr.insert(mapped, blockNode);
            const mCL = tr.mapping.map(clPos);
            const clNow = tr.doc.nodeAt(mCL);
            if (clNow && clNow.type.name === 'columnList') {
              let off = mCL + 1;
              for (let i = 0; i < clNow.childCount; i++) {
                const ch = clNow.child(i);
                if (ch.type.name === 'column' && ch.attrs.width !== null) {
                  tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
                }
                off += ch.nodeSize;
              }
            }
            editor.view.dispatch(tr);
            return true;
          } else {
            tr.delete(blockPos, blockPos + blockNode.nodeSize);
            const mapped = tr.mapping.map(clEnd);
            tr.insert(mapped, blockNode);
            editor.view.dispatch(tr);
            return true;
          }
        }

        return false;
      },

      // Ctrl/Cmd+D — Duplicate the current block within its container
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

        const endPos = blockPos + blockNode.nodeSize;
        const { tr } = editor.state;
        tr.insert(endPos, blockNode.copy(blockNode.content));
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [columnResizePlugin(), columnDropPlugin(), columnAutoDissolvePlugin()];
  },
});
