// canvasEditorProvider.ts — Canvas editor pane with Tiptap rich text editor
//
// Provides the editor provider registered via api.editors.registerEditorProvider.
// Each editor pane hosts a Tiptap instance, loads page content from
// CanvasDataService, and auto-saves content changes.
//
// Extensions loaded (Notion-parity):
//
// Tier 1 (core Notion feel):
//   • StarterKit (headings, bold, italic, strike, code, blockquote, lists,
//     hr, link, underline — all bundled in StarterKit v3)
//   • Placeholder, TaskList, TaskItem
//   • TextStyle, Color, Highlight, Image
//   • GlobalDragHandle (block drag-reorder)
//   • Custom BubbleMenu (floating toolbar on text selection)
//
// Tier 2 (power-user Notion features):
//   • Callout — custom Node.create() with emoji + colored background
//   • Details / DetailsContent / DetailsSummary (toggle list / collapsible)
//   • TableKit (Table + TableRow + TableCell + TableHeader, resizable)
//   • CodeBlockLowlight (syntax-highlighted code blocks via lowlight/highlight.js)
//   • CharacterCount (word/char counter)
//   • AutoJoiner (companion to drag handle — joins same-type adjacent blocks)
//   • MathExtension + InlineMathNode (@aarkue/tiptap-math-extension — inline LaTeX via $...$)
//   • MathBlock (custom block-level equation node with click-to-edit + KaTeX)
//   • Column + ColumnList (spatial partitions — not blocks; created via slash menu or drag-and-drop)
//   • ColumnDrop plugin (drag block to side of another to create/modify columns)

import type { IDisposable } from '../../platform/lifecycle.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import type { CanvasDataService } from './canvasDataService.js';
import type { IPage } from './canvasTypes.js';
import { Editor, Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
// Link and Underline are included in StarterKit v3 — configure via StarterKit options
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
// Tier 2 extensions
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CharacterCount from '@tiptap/extension-character-count';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { common, createLowlight } from 'lowlight';
import { InlineMathNode } from '@aarkue/tiptap-math-extension';
import katex from 'katex';
import { $ } from '../../ui/dom.js';
import { tiptapJsonToMarkdown } from './markdownExport.js';
import { createIconElement, resolvePageIcon, svgIcon, PAGE_ICON_IDS } from './canvasIcons.js';

// ─── TipTap Command Augmentation ────────────────────────────────────────────
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
      toggleCallout: (attrs?: { emoji?: string }) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

// Create lowlight instance with common language set (JS, TS, CSS, HTML, Python, etc.)
const lowlight = createLowlight(common);

// ─── Block-level Background Color Extension ────────────────────────────────
// Adds a `backgroundColor` attribute to all block-level nodes (paragraph,
// heading, blockquote, codeBlock, callout, details, lists, etc.).
// Renders as inline `style="background-color: <value>"` on the block element.
// Mirror of Notion's block-color feature which paints the whole block, not text.

const BLOCK_BG_TYPES = [
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'callout', 'details', 'bulletList', 'orderedList', 'taskList',
];

const BlockBackgroundColor = Extension.create({
  name: 'blockBackgroundColor',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_BG_TYPES,
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.backgroundColor) return {};
              return { style: `background-color: ${attributes.backgroundColor}` };
            },
          },
        },
      },
    ];
  },
});

// ─── Custom Callout Node ────────────────────────────────────────────────────
// Notion-style callout: a colored info box with an SVG icon and rich content.
// Rendered as <div data-type="callout"> with a non-editable icon and editable content area.

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: 'lightbulb',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-emoji') || 'lightbulb',
        renderHTML: (attributes: Record<string, any>) => ({ 'data-emoji': attributes.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: 'canvas-callout',
      }),
      [
        'span',
        {
          class: 'canvas-callout-emoji',
          contenteditable: 'false',
          'data-icon': HTMLAttributes['data-emoji'] || 'lightbulb',
        },
        '',
      ],
      ['div', { class: 'canvas-callout-content' }, 0],
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-callout');
      dom.setAttribute('data-type', 'callout');

      const applyBg = (attrs: any) => {
        if (attrs.backgroundColor) {
          dom.style.backgroundColor = attrs.backgroundColor;
        } else {
          dom.style.backgroundColor = '';
        }
      };

      applyBg(node.attrs);

      const iconSpan = document.createElement('span');
      iconSpan.classList.add('canvas-callout-emoji');
      iconSpan.contentEditable = 'false';

      const renderIcon = (emoji: string) => {
        const iconId = resolvePageIcon(emoji);
        iconSpan.innerHTML = svgIcon(iconId);
        const svg = iconSpan.querySelector('svg');
        if (svg) { svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); }
      };

      renderIcon(node.attrs.emoji);
      dom.appendChild(iconSpan);

      const contentDOM = document.createElement('div');
      contentDOM.classList.add('canvas-callout-content');
      dom.appendChild(contentDOM);

      return {
        dom,
        contentDOM,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'callout') return false;
          renderIcon(updatedNode.attrs.emoji);
          applyBg(updatedNode.attrs);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      setCallout:
        (attrs?: { emoji?: string }) =>
        ({ commands }: any) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs?: { emoji?: string }) =>
        ({ commands }: any) =>
          commands.toggleWrap(this.name, attrs),
      unsetCallout:
        () =>
        ({ commands }: any) =>
          commands.lift(this.name),
    };
  },
});

// ─── Column Layout Nodes ────────────────────────────────────────────────────
// Columns are spatial partitions, NOT blocks. Users interact with the blocks
// inside columns, never with the column/columnList containers themselves.
// Columns have no drag handles, no action menus, no block identity.
// Two nodes:
//   • ColumnList — invisible flex wrapper, group 'block', content 'column column+' (min 2)
//   • Column — individual spatial partition, content 'block+'
// Column structures are created via slash menu or drag-and-drop, and dissolve
// automatically when ≤1 column remains (see columnAutoDissolvePlugin).
// See docs/BLOCK_INTERACTION_RULES.md for the complete deterministic ruleset.

const Column = Node.create({
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

const ColumnList = Node.create({
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
      // column structure.  If column has only one empty paragraph, remove
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
        // first content block.  $from.start($from.depth) is the start of
        // the current textblock; compare with start of column content.
        const columnStart = $from.start(columnDepth);
        const textblockStart = $from.start($from.depth);
        // Cursor must be at start of its textblock
        if ($from.pos !== textblockStart) return false;
        // That textblock must be the first child of the column
        // (column content position + 0 offset = first child)
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
            // to replace the entire columnList
            const colListPos = $from.before(columnListDepth);
            let otherColumnIndex = -1;
            // Find which column index we are
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
      // container.  If already at the top of a column, move above the
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
            // Only block in column, 2-column layout → dissolve entire
            // columnList.  Replace it with [blockNode, ...otherCol.content].
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
            // Only block in column, 3+ columns → delete column, insert
            // block above columnList, redistribute widths.
            tr.delete(colPos, colPos + colNode.nodeSize);
            const mapped = tr.mapping.map(clPos);
            tr.insert(mapped, blockNode);
            // Reset widths
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
            // Multiple blocks in column → move block above columnList
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
      // its container.  If already at the bottom of a column, move below
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
          // Swap with next sibling — insert after next, then delete source
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
            // Only block in column, 2-column layout → dissolve entire
            // columnList.  Replace with [...otherCol.content, blockNode].
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
            // Only block in column, 3+ columns → delete column, insert
            // block below columnList, redistribute widths.
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
            // Multiple blocks in column → move block below columnList
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

        // Find the moveable block
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

// ─── Column Auto-Dissolve Plugin ────────────────────────────────────────────
// After every transaction, scan the document for columnList nodes that have
// been reduced to a single column (e.g. after deleting a column's content or
// dragging a block out).  Replace such columnLists with the remaining column's
// content so the blocks become normal top-level blocks.

function columnAutoDissolvePlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('columnAutoDissolve'),
    appendTransaction(transactions, _oldState, newState) {
      // Only run if a transaction actually changed the doc
      if (!transactions.some(tr => tr.docChanged)) return null;

      const { tr } = newState;
      let changed = false;

      // Walk the doc in reverse to avoid position shifting issues
      const positions: { pos: number; node: any }[] = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name === 'columnList') {
          positions.push({ pos, node });
          return false; // don't descend into columnList
        }
        return true;
      });

      // Process in reverse order (highest position first)
      for (let i = positions.length - 1; i >= 0; i--) {
        const { pos, node } = positions[i];
        // Count actual column children
        let columnCount = 0;
        const columns: any[] = [];
        node.forEach((child: any) => {
          if (child.type.name === 'column') {
            columnCount++;
            columns.push(child);
          }
        });

        if (columnCount <= 1 && columns.length > 0) {
          // Dissolve: replace columnList with the single column's content
          const col = columns[0];
          const mappedPos = tr.mapping.map(pos);
          tr.replaceWith(mappedPos, mappedPos + node.nodeSize, col.content);
          changed = true;
        } else if (columnCount === 0) {
          // No columns at all — delete the empty columnList
          const mappedPos = tr.mapping.map(pos);
          tr.delete(mappedPos, mappedPos + node.nodeSize);
          changed = true;
        }
      }

      return changed ? tr : null;
    },
  });
}

// ─── Column Resize ProseMirror Plugin ───────────────────────────────────────
// Scans all .canvas-column-list elements by coordinate (not event.target) to
// detect column boundaries.  Positions are resolved by walking the ProseMirror
// document tree at commit time, avoiding stale-position bugs.  Cursor is
// managed via CSS class on document.body for reliable override.

function columnResizePlugin(): Plugin {
  const pluginKey = new PluginKey('columnResize');

  interface DragState {
    startX: number;
    leftStartWidth: number;  // percentage at drag start
    rightStartWidth: number; // percentage at drag start
    listEl: HTMLElement;     // the columnList container DOM
    leftIndex: number;       // 0-based child index in columnList
    rightIndex: number;
    lastLeftW?: number;      // last width set during drag (for final commit)
    lastRightW?: number;
  }

  let dragging: DragState | null = null;

  /**
   * Find column boundary nearest to (x, y) by scanning ALL column lists in
   * the editor DOM.  Does NOT use event.target — works even when hovering over
   * drag-handle overlays or pseudo-elements.
   */
  function findBoundary(
    view: EditorView,
    x: number,
    y: number,
    tolerance: number,
  ): {
    leftCol: HTMLElement;
    rightCol: HTMLElement;
    listEl: HTMLElement;
    leftIndex: number;
    rightIndex: number;
  } | null {
    const lists = view.dom.querySelectorAll('.canvas-column-list');
    for (const list of lists) {
      const listRect = list.getBoundingClientRect();
      if (y < listRect.top || y > listRect.bottom) continue;

      const columns = Array.from(list.children).filter(
        el => (el as HTMLElement).classList.contains('canvas-column'),
      ) as HTMLElement[];

      for (let i = 0; i < columns.length - 1; i++) {
        const leftRect = columns[i].getBoundingClientRect();
        const rightRect = columns[i + 1].getBoundingClientRect();
        const boundaryX = (leftRect.right + rightRect.left) / 2;
        if (Math.abs(x - boundaryX) <= tolerance) {
          return {
            leftCol: columns[i],
            rightCol: columns[i + 1],
            listEl: list as HTMLElement,
            leftIndex: i,
            rightIndex: i + 1,
          };
        }
      }
    }
    return null;
  }

  /** Percentage width of a column relative to its container. */
  function colPercent(col: HTMLElement, container: HTMLElement): number {
    return (col.getBoundingClientRect().width / container.getBoundingClientRect().width) * 100;
  }

  /**
   * Resolve the ProseMirror position of the Nth column inside a columnList by
   * walking the document tree.  Uses posAtDOM only to locate the columnList
   * ancestor, then iterates children by index.
   */
  function findColumnPos(
    view: EditorView,
    listEl: HTMLElement,
    columnIndex: number,
  ): number | null {
    const insidePos = view.posAtDOM(listEl, 0);
    const $pos = view.state.doc.resolve(insidePos);
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === 'columnList') {
        const listNodePos = $pos.before(d);
        const listNode = view.state.doc.nodeAt(listNodePos);
        if (!listNode) return null;
        let offset = listNodePos + 1;
        for (let i = 0; i < listNode.childCount; i++) {
          if (i === columnIndex) return offset;
          offset += listNode.child(i).nodeSize;
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Dispatch a ProseMirror transaction that updates two column widths.
   * When skipHistory is true, the transaction won't create an undo step
   * (used during drag — only the final mouseup commits to history).
   */
  function applyColumnWidths(
    view: EditorView,
    listEl: HTMLElement,
    leftIndex: number,
    rightIndex: number,
    leftW: number | null,
    rightW: number | null,
    skipHistory = false,
  ): boolean {
    const leftPos = findColumnPos(view, listEl, leftIndex);
    const rightPos = findColumnPos(view, listEl, rightIndex);
    if (leftPos === null || rightPos === null) return false;

    const leftNode = view.state.doc.nodeAt(leftPos);
    const rightNode = view.state.doc.nodeAt(rightPos);
    if (!leftNode || !rightNode) return false;

    const { tr } = view.state;
    if (skipHistory) tr.setMeta('addToHistory', false);
    tr.setNodeMarkup(leftPos, undefined, { ...leftNode.attrs, width: leftW });
    tr.setNodeMarkup(rightPos, undefined, { ...rightNode.attrs, width: rightW });
    view.dispatch(tr);
    return true;
  }

  return new Plugin({
    key: pluginKey,

    props: {
      handleDOMEvents: {
        mousemove: (view: EditorView, event: MouseEvent) => {
          if (dragging) {
            // Dispatch a real ProseMirror transaction on each frame so the
            // DOM update is handled natively by PM — no DOMObserver conflicts.
            // Skip history for intermediate steps — only mouseup commits.
            const delta = event.clientX - dragging.startX;
            const containerWidth = dragging.listEl.getBoundingClientRect().width;
            if (containerWidth === 0) return true;
            const deltaPercent = (delta / containerWidth) * 100;
            const newLeft = Math.max(10, Math.min(90, dragging.leftStartWidth + deltaPercent));
            const newRight = Math.max(10, Math.min(90, dragging.rightStartWidth - deltaPercent));
            const leftW = Math.round(newLeft * 10) / 10;
            const rightW = Math.round(newRight * 10) / 10;

            // Track last widths for the final history-enabled commit
            dragging.lastLeftW = leftW;
            dragging.lastRightW = rightW;

            applyColumnWidths(
              view, dragging.listEl,
              dragging.leftIndex, dragging.rightIndex,
              leftW, rightW,
              true, // skipHistory — don't flood undo stack
            );

            event.preventDefault();
            return true;
          }

          // Not dragging — show/hide resize cursor near column boundaries
          const boundary = findBoundary(view, event.clientX, event.clientY, 12);
          if (boundary) {
            document.body.classList.add('column-resize-hover');
          } else {
            document.body.classList.remove('column-resize-hover');
          }
          return false;
        },

        mousedown: (view: EditorView, event: MouseEvent) => {
          const boundary = findBoundary(view, event.clientX, event.clientY, 12);
          if (!boundary) return false;

          event.preventDefault();
          const { leftCol, rightCol, listEl, leftIndex, rightIndex } = boundary;

          dragging = {
            startX: event.clientX,
            leftStartWidth: colPercent(leftCol, listEl),
            rightStartWidth: colPercent(rightCol, listEl),
            listEl,
            leftIndex,
            rightIndex,
          };

          document.body.classList.add('column-resizing');

          const finish = () => {
            window.removeEventListener('mouseup', finish);
            // Commit final widths as a single undoable transaction.
            // All intermediate mousemove transactions were skipHistory.
            if (dragging && dragging.lastLeftW != null && dragging.lastRightW != null) {
              applyColumnWidths(
                view, dragging.listEl,
                dragging.leftIndex, dragging.rightIndex,
                dragging.lastLeftW, dragging.lastRightW,
                false, // commit to history
              );
            }
            dragging = null;
            document.body.classList.remove('column-resizing');
            // NOTE: column-resize-hover is NOT removed here — it's managed
            // exclusively by the mousemove handler.  Removing it here would
            // re-enable the drag handle between the two clicks of a dblclick,
            // preventing the dblclick from reaching the resize zone.
          };

          window.addEventListener('mouseup', finish);
          return true;
        },

        dblclick: (view: EditorView, event: MouseEvent) => {
          const boundary = findBoundary(view, event.clientX, event.clientY, 12);
          if (!boundary) return false;
          event.preventDefault();
          applyColumnWidths(
            view, boundary.listEl,
            boundary.leftIndex, boundary.rightIndex,
            null, null,
          );
          return true;
        },
      },
    },
  });
}

// ─── Column Drop ProseMirror Plugin ─────────────────────────────────────────
// Full drag-and-drop engine per docs/BLOCK_INTERACTION_RULES.md Rules 3-4.
//
// Two guide types:
//   • Horizontal (above/below) — reorder blocks at any level
//   • Vertical (left/right)    — create or extend column layouts
//
// Supports ALL drop scenarios:
//   4A  top-level → top-level          (reorder or new columnList)
//   4B  top-level → block in column    (insert into column or add column)
//   4C  column → top-level             (extract or new columnList)
//   4D  column → same column           (reorder or split column)
//   4E  column → different column      (transfer or add column)
//   4F  column → different columnList  (same as 4B from source)
//
// Empty-column cleanup is delegated to columnAutoDissolvePlugin.
// Width redistribution is handled inline when columns are added/removed.

function columnDropPlugin(): Plugin {
  const pluginKey = new PluginKey('columnDrop');

  // ── Indicator elements ──
  let vertIndicator: HTMLElement | null = null;
  let horzIndicator: HTMLElement | null = null;

  interface DropTarget {
    zone: 'above' | 'below' | 'left' | 'right';
    blockEl: HTMLElement;
    blockPos: number;
    blockNode: any;
    // Column context (null = top-level block)
    columnPos: number | null;
    columnListPos: number | null;
    columnIndex: number;
  }

  let activeTarget: DropTarget | null = null;

  // ── Indicator helpers ──

  function ensureVert(container: HTMLElement): HTMLElement {
    if (!vertIndicator) {
      vertIndicator = document.createElement('div');
      vertIndicator.className = 'column-drop-indicator';
    }
    if (vertIndicator.parentElement !== container) {
      container.style.position = 'relative';
      container.appendChild(vertIndicator);
    }
    return vertIndicator;
  }

  function ensureHorz(container: HTMLElement): HTMLElement {
    if (!horzIndicator) {
      horzIndicator = document.createElement('div');
      horzIndicator.className = 'canvas-drop-guide';
    }
    if (horzIndicator.parentElement !== container) {
      container.style.position = 'relative';
      container.appendChild(horzIndicator);
    }
    return horzIndicator;
  }

  function hideAll() {
    if (vertIndicator) vertIndicator.style.display = 'none';
    if (horzIndicator) horzIndicator.style.display = 'none';
    activeTarget = null;
  }

  function showVert(container: HTMLElement, blockEl: HTMLElement, side: 'left' | 'right') {
    const el = ensureVert(container);
    const bRect = blockEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    el.style.top = `${bRect.top - cRect.top}px`;
    el.style.height = `${bRect.height}px`;
    el.style.left = side === 'left'
      ? `${bRect.left - cRect.left - 2}px`
      : `${bRect.right - cRect.left}px`;
    el.style.display = 'block';
    if (horzIndicator) horzIndicator.style.display = 'none';
  }

  function showHorz(container: HTMLElement, blockEl: HTMLElement, pos: 'above' | 'below') {
    const el = ensureHorz(container);
    const bRect = blockEl.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    el.style.top = pos === 'above'
      ? `${bRect.top - cRect.top - 1}px`
      : `${bRect.bottom - cRect.top + 1}px`;
    el.style.left = `${bRect.left - cRect.left}px`;
    el.style.width = `${bRect.width}px`;
    el.style.display = 'block';
    if (vertIndicator) vertIndicator.style.display = 'none';
  }

  // ── Target detection ──
  // Walk up from elementsFromPoint hits to find the block-level element.
  // Priority: blocks inside columns first (more specific), then top-level.

  function findTarget(view: EditorView, x: number, y: number): Omit<DropTarget, 'zone'> | null {
    const elements = document.elementsFromPoint(x, y);

    // Pass 1 — blocks inside columns
    for (const el of elements) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.classList?.contains('column-drop-indicator') ||
          htmlEl.classList?.contains('canvas-drop-guide')) continue;

      let cur: HTMLElement | null = htmlEl;
      while (cur && cur !== view.dom) {
        const parent: HTMLElement | null = cur.parentElement;
        if (!parent) break;
        if (parent.classList.contains('canvas-column') &&
            parent.parentElement?.classList.contains('canvas-column-list') &&
            parent.parentElement.parentElement === view.dom) {
          try {
            const inner = view.posAtDOM(cur, 0);
            const $p = view.state.doc.resolve(inner);
            let colD = -1;
            for (let d = $p.depth; d >= 1; d--) {
              if ($p.node(d).type.name === 'column') { colD = d; break; }
            }
            if (colD < 0) break;
            const blkD = colD + 1;
            if (blkD > $p.depth) break;
            const blockPos = $p.before(blkD);
            const blockNode = view.state.doc.nodeAt(blockPos);
            if (!blockNode) break;
            const columnPos = $p.before(colD);
            const columnListPos = $p.before(colD - 1);
            const clNode = view.state.doc.nodeAt(columnListPos);
            let colIdx = 0;
            if (clNode) {
              let off = columnListPos + 1;
              for (let i = 0; i < clNode.childCount; i++) {
                if (off === columnPos) { colIdx = i; break; }
                off += clNode.child(i).nodeSize;
              }
            }
            return { blockEl: cur, blockPos, blockNode, columnPos, columnListPos, columnIndex: colIdx };
          } catch { break; }
        }
        cur = parent;
      }
    }

    // Pass 2 — top-level blocks
    for (const el of elements) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.classList?.contains('column-drop-indicator') ||
          htmlEl.classList?.contains('canvas-drop-guide')) continue;

      let cur: HTMLElement | null = htmlEl;
      while (cur && cur !== view.dom) {
        if (cur.parentElement === view.dom) {
          try {
            const inner = view.posAtDOM(cur, 0);
            const $p = view.state.doc.resolve(inner);
            const blockPos = $p.before(Math.min($p.depth, 1));
            const blockNode = view.state.doc.nodeAt(blockPos);
            if (!blockNode) break;
            return { blockEl: cur, blockPos, blockNode, columnPos: null, columnListPos: null, columnIndex: 0 };
          } catch { break; }
        }
        cur = cur.parentElement;
      }
    }

    return null;
  }

  // ── Drop zone detection ──
  // Left/right edges → vertical guide (column create/extend).
  // Centre area → horizontal guide (above/below reorder).
  // columnList targets only allow above/below (Rule 9 nesting prevention).

  function getZone(
    blockEl: HTMLElement,
    x: number,
    y: number,
    isColumnList: boolean,
  ): 'above' | 'below' | 'left' | 'right' {
    const r = blockEl.getBoundingClientRect();
    const rx = x - r.left;
    const ry = y - r.top;
    const edge = Math.min(r.width * 0.2, 60);
    if (!isColumnList) {
      if (rx < edge) return 'left';
      if (rx > r.width - edge) return 'right';
    }
    return ry < r.height / 2 ? 'above' : 'below';
  }

  // ── Source deletion helper ──
  // Checks the source block's context in the CURRENT transaction doc
  // (after any earlier inserts).  If the source is the last block in a
  // column, deletes the entire column and redistributes widths.

  function deleteSrc(tr: any, dragFrom: number, dragTo: number): void {
    const mFrom = tr.mapping.map(dragFrom);
    const mTo = tr.mapping.map(dragTo);
    const $src = tr.doc.resolve(mFrom);

    let colD = -1;
    for (let d = $src.depth; d >= 1; d--) {
      if ($src.node(d).type.name === 'column') { colD = d; break; }
    }

    if (colD >= 0) {
      const colNode = $src.node(colD);
      if (colNode.childCount <= 1) {
        // Last block in column — delete the entire column.
        // columnAutoDissolvePlugin will dissolve if ≤1 column remains.
        const colStart = $src.before(colD);
        const clPos = $src.before(colD - 1);
        tr.delete(colStart, colStart + colNode.nodeSize);

        // Redistribute widths in remaining columns to equal
        const clNow = tr.doc.nodeAt(clPos);
        if (clNow && clNow.type.name === 'columnList') {
          let off = clPos + 1;
          for (let i = 0; i < clNow.childCount; i++) {
            const ch = clNow.child(i);
            if (ch.type.name === 'column' && ch.attrs.width !== null) {
              tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
            }
            off += ch.nodeSize;
          }
        }
        return;
      }
    }

    // Normal delete — block has siblings in its container
    if (mTo > mFrom) tr.delete(mFrom, mTo);
  }

  // ── Width redistribution helper ──
  // Resets all columns in a columnList to equal widths (null = flex: 1).

  function resetWidths(tr: any, columnListPos: number): void {
    const mPos = tr.mapping.map(columnListPos);
    const cl = tr.doc.nodeAt(mPos);
    if (!cl || cl.type.name !== 'columnList') return;
    let off = mPos + 1;
    for (let i = 0; i < cl.childCount; i++) {
      const ch = cl.child(i);
      if (ch.type.name === 'column' && ch.attrs.width !== null) {
        tr.setNodeMarkup(off, undefined, { ...ch.attrs, width: null });
      }
      off += ch.nodeSize;
    }
  }

  // ── Plugin ──

  return new Plugin({
    key: pluginKey,

    view: () => ({
      destroy: () => {
        vertIndicator?.remove();
        horzIndicator?.remove();
        vertIndicator = null;
        horzIndicator = null;
      },
    }),

    props: {
      handleDOMEvents: {
        dragover: (view: EditorView, event: DragEvent) => {
          if (!view.dragging) { hideAll(); return false; }

          const x = event.clientX;
          const y = event.clientY;
          const raw = findTarget(view, x, y);
          if (!raw) { hideAll(); return false; }

          // Nesting prevention — skip if dragged content is a columnList
          if (view.dragging.slice.content.firstChild?.type.name === 'columnList') {
            hideAll(); return false;
          }

          // Skip if hovering over the source block
          const { from: dF, to: dT } = view.state.selection;
          if (raw.blockPos >= dF && raw.blockPos < dT) {
            hideAll(); return false;
          }

          const isCL = raw.blockNode.type.name === 'columnList';
          const zone = getZone(raw.blockEl, x, y, isCL);
          activeTarget = { ...raw, zone };

          const container = view.dom.parentElement;
          if (!container) { hideAll(); return false; }

          if (zone === 'left' || zone === 'right') {
            showVert(container, raw.blockEl, zone);
          } else {
            showHorz(container, raw.blockEl, zone);
          }

          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          return false;
        },

        dragleave: (view: EditorView, event: DragEvent) => {
          const rt = event.relatedTarget as HTMLElement | null;
          if (!rt || !view.dom.contains(rt)) hideAll();
          return false;
        },

        drop: (view: EditorView, event: DragEvent) => {
          if (!activeTarget) return false;
          const target = activeTarget;
          hideAll();

          const dragging = view.dragging;
          if (!dragging?.slice) return false;
          const slice = dragging.slice;
          if (slice.openStart > 0 || slice.openEnd > 0) return false;
          if (slice.content.childCount === 0) return false;
          if (slice.content.firstChild?.type.name === 'columnList') return false;

          const { schema } = view.state;
          const columnType = schema.nodes.column;
          const columnListType = schema.nodes.columnList;
          if (!columnType || !columnListType) return false;

          event.preventDefault();
          event.stopPropagation();

          const { from: dragFrom, to: dragTo } = view.state.selection;
          const content = slice.content;
          const { tr } = view.state;

          // ── ABOVE / BELOW — reorder block at any level ──
          if (target.zone === 'above' || target.zone === 'below') {
            const insertPos = target.zone === 'above'
              ? target.blockPos
              : target.blockPos + target.blockNode.nodeSize;
            tr.insert(insertPos, content);
            deleteSrc(tr, dragFrom, dragTo);
            view.dispatch(tr);
            return true;
          }

          // ── LEFT / RIGHT — create or extend columns ──

          if (target.columnPos === null) {
            // Target is a top-level block (4A, 4C) → create new columnList
            const tNode = target.blockNode;
            let tCol: any, dCol: any;
            try {
              tCol = columnType.create(null, Fragment.from(tNode));
              dCol = columnType.create(null, content);
            } catch { return false; }

            const cols = target.zone === 'left'
              ? Fragment.from([dCol, tCol])
              : Fragment.from([tCol, dCol]);
            let cl: any;
            try { cl = columnListType.create(null, cols); } catch { return false; }

            tr.replaceWith(target.blockPos, target.blockPos + tNode.nodeSize, cl);
            deleteSrc(tr, dragFrom, dragTo);
            view.dispatch(tr);
            return true;
          }

          // Target is inside a column (4B, 4D, 4E, 4F) → add column to
          // the existing columnList
          const targetColNode = view.state.doc.nodeAt(target.columnPos);
          if (!targetColNode) return false;

          let newCol: any;
          try { newCol = columnType.create(null, content); } catch { return false; }

          const insertColPos = target.zone === 'left'
            ? target.columnPos
            : target.columnPos + targetColNode.nodeSize;

          tr.insert(insertColPos, newCol);
          deleteSrc(tr, dragFrom, dragTo);

          // Reset all column widths to equal after adding a column
          resetWidths(tr, target.columnListPos!);
          view.dispatch(tr);
          return true;
        },

        dragend: () => {
          hideAll();
          return false;
        },
      },
    },
  });
}

// ─── Enter on Collapsed Toggle → New Toggle ────────────────────────────────
// TipTap's built-in Details Enter handler creates a plain paragraph when the
// toggle is collapsed.  This extension intercepts Enter FIRST (priority 200)
// and inserts a new details block below instead, matching Notion behaviour.

const DetailsEnterHandler = Extension.create({
  name: 'detailsEnterHandler',
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection, schema } = state;
        const { $head, empty } = selection;

        // Only act when cursor is inside a detailsSummary
        if (!empty || $head.parent.type !== schema.nodes.detailsSummary) {
          return false;
        }

        // Check if the detailsContent is hidden (collapsed)
        const detailsContentPos = $head.after() + 1;
        const domNode = editor.view.domAtPos(detailsContentPos).node as HTMLElement;
        const isVisible = domNode.offsetParent !== null;

        if (isVisible) {
          // Open toggle → let the built-in handler deal with it
          return false;
        }

        // Collapsed → insert a new details block below the current one
        const detailsDepth = $head.depth - 1;  // detailsSummary is 1 level inside details
        const afterDetails = $head.after(detailsDepth);

        editor.chain()
          .insertContentAt(afterDetails, {
            type: 'details',
            content: [
              { type: 'detailsSummary' },
              { type: 'detailsContent', content: [{ type: 'paragraph' }] },
            ],
          })
          .focus(afterDetails + 2)  // inside the new detailsSummary
          .run();

        return true;
      },
    };
  },
});

// ─── Math Block Node ────────────────────────────────────────────────────────
// Block-level equation rendered via KaTeX in display mode.
// Notion calls this "Block equation" — full-width, standalone math.
// Click-to-edit: shows raw LaTeX input, live KaTeX preview, Enter to confirm.

const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,      // non-editable via ProseMirror — uses NodeView
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') || '',
        renderHTML: (attributes: Record<string, any>) => ({ 'data-latex': attributes.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mathBlock"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mathBlock', class: 'canvas-math-block' }),
      // No content hole (0) — atom nodes are leaf nodes with no PM-managed content.
      // The NodeView handles all rendering via its own DOM.
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }: any) => {
      // ── Container ──
      const dom = document.createElement('div');
      dom.classList.add('canvas-math-block');
      dom.setAttribute('data-type', 'mathBlock');

      // ── Rendered KaTeX output (always visible) ──
      const renderArea = document.createElement('div');
      renderArea.classList.add('canvas-math-block-render');
      dom.appendChild(renderArea);

      // ── Floating editor popup (hidden by default) ──
      const editorArea = document.createElement('div');
      editorArea.classList.add('canvas-math-block-editor');
      editorArea.style.display = 'none';

      const input = document.createElement('textarea');
      input.classList.add('canvas-math-block-input');
      input.placeholder = 'Type LaTeX…';
      input.spellcheck = false;
      input.rows = 1;

      const doneBtn = document.createElement('button');
      doneBtn.classList.add('canvas-math-block-done');
      doneBtn.innerHTML = 'Done <span class="canvas-math-block-done-key">↵</span>';

      editorArea.appendChild(input);
      editorArea.appendChild(doneBtn);
      dom.appendChild(editorArea);

      let editing = false;
      let currentLatex = node.attrs.latex || '';

      const renderKatex = (latex: string, target: HTMLElement, displayMode = true) => {
        if (!latex) {
          target.innerHTML = '<span class="canvas-math-block-empty">Click to add equation</span>';
          return;
        }
        try {
          katex.render(latex, target, { displayMode, throwOnError: false });
        } catch {
          target.textContent = latex;
        }
      };

      const updateLatex = (newLatex: string) => {
        if (typeof getPos === 'function') {
          currentLatex = newLatex;
          editor.chain()
            .command(({ tr }: any) => {
              tr.setNodeAttribute(getPos(), 'latex', newLatex);
              return true;
            })
            .run();
        }
        renderKatex(newLatex, renderArea);
      };

      const commitEdit = () => {
        if (!editing) return;
        editing = false;
        const newLatex = input.value.trim();
        editorArea.style.display = 'none';
        dom.classList.remove('canvas-math-block--editing');

        if (newLatex !== currentLatex) {
          updateLatex(newLatex);
        }
      };

      const startEdit = () => {
        if (editing || !editor.isEditable) return;
        editing = true;
        input.value = currentLatex;
        dom.classList.add('canvas-math-block--editing');
        editorArea.style.display = 'flex';
        autoResize();
        setTimeout(() => { input.focus(); input.select(); }, 0);
      };

      const autoResize = () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
      };

      // ── Events ──
      dom.addEventListener('click', (e) => {
        if (editorArea.contains(e.target as HTMLElement)) return;
        e.stopPropagation();
        if (!editing) startEdit();
      });

      input.addEventListener('input', () => {
        // Live-update the rendered equation above
        renderKatex(input.value || '', renderArea);
        autoResize();
      });

      doneBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commitEdit();
        // Move cursor after the math block
        if (typeof getPos === 'function') {
          const pos = getPos() + 1;
          editor.chain().setTextSelection(pos).focus().run();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
          if (typeof getPos === 'function') {
            const pos = getPos() + 1;
            editor.chain().setTextSelection(pos).focus().run();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          input.value = currentLatex;
          renderKatex(currentLatex, renderArea);
          editing = false;
          editorArea.style.display = 'none';
          dom.classList.remove('canvas-math-block--editing');
        }
        e.stopPropagation();
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (!editorArea.contains(document.activeElement)) {
            commitEdit();
          }
        }, 100);
      });

      // Initial render
      renderKatex(currentLatex, renderArea);

      // If empty, start in edit mode
      if (!currentLatex) {
        setTimeout(() => startEdit(), 50);
      }

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'mathBlock') return false;
          currentLatex = updatedNode.attrs.latex || '';
          if (!editing) {
            renderKatex(currentLatex, renderArea);
          }
          return true;
        },
        stopEvent(_event: Event) {
          // Let all events inside the math block be handled by our NodeView
          if (editing) return true;
          return false;
        },
        ignoreMutation() {
          return true;
        },
      };
    };
  },
});

// ─── Slash Command Types ────────────────────────────────────────────────────

interface SlashMenuItem {
  label: string;
  icon: string;
  description: string;
  /**
   * Each action receives the editor and the **block range** covering the
   * entire paragraph node (including its boundaries).  Actions use
   * `insertContentAt(range, nodeJSON)` to atomically REPLACE the paragraph
   * with the desired block structure — this is the same pattern TipTap's
   * own `setDetails()` command uses internally.  NO deleteRange needed.
   *
   * Why: complex commands like toggleTaskList, toggleCallout, and setDetails
   * read from `state` (the original editor state) inside a chain, NOT from
   * `tr` (the accumulated transaction).  So chaining them after deleteRange
   * causes them to read stale positions and fail silently.
   */
  action: (editor: Editor, range: { from: number; to: number }) => void;
}

const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  // ── Basic blocks ──
  {
    label: 'Heading 1', icon: 'H1', description: 'Large heading',
    action: (e, range) => e.chain().insertContentAt(range, { type: 'heading', attrs: { level: 1 } }).focus().run(),
  },
  {
    label: 'Heading 2', icon: 'H2', description: 'Medium heading',
    action: (e, range) => e.chain().insertContentAt(range, { type: 'heading', attrs: { level: 2 } }).focus().run(),
  },
  {
    label: 'Heading 3', icon: 'H3', description: 'Small heading',
    action: (e, range) => e.chain().insertContentAt(range, { type: 'heading', attrs: { level: 3 } }).focus().run(),
  },
  // ── Lists ──
  {
    label: 'Bullet List', icon: 'bullet-list', description: 'Unordered list',
    action: (e, range) => e.chain().insertContentAt(range, {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    }).focus().run(),
  },
  {
    label: 'Numbered List', icon: 'numbered-list', description: 'Ordered list',
    action: (e, range) => e.chain().insertContentAt(range, {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    }).focus().run(),
  },
  {
    label: 'To-Do List', icon: 'checklist', description: 'Task list with checkboxes',
    action: (e, range) => e.chain().insertContentAt(range, {
      type: 'taskList',
      content: [{
        type: 'taskItem',
        attrs: { checked: false },
        content: [{ type: 'paragraph' }],
      }],
    }).focus().run(),
  },
  // ── Rich blocks ──
  {
    label: 'Quote', icon: 'quote', description: 'Block quote',
    action: (e, range) => e.chain().insertContentAt(range, {
      type: 'blockquote',
      content: [{ type: 'paragraph' }],
    }).focus().run(),
  },
  {
    label: 'Code Block', icon: 'code', description: 'Code with syntax highlighting',
    action: (e, range) => e.chain().insertContentAt(range, { type: 'codeBlock' }).focus().run(),
  },
  {
    label: 'Divider', icon: 'divider', description: 'Horizontal rule',
    action: (e, range) => e.chain().insertContentAt(range, { type: 'horizontalRule' }).focus().run(),
  },
  {
    label: 'Callout', icon: 'lightbulb', description: 'Highlighted info box',
    action: (e, range) => {
      e.chain().insertContentAt(range, {
        type: 'callout',
        attrs: { emoji: 'lightbulb' },
        content: [{ type: 'paragraph' }],
      }).run();
      // Place cursor inside the callout's paragraph
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'callout') {
          // First paragraph inside callout content
          e.chain().setTextSelection(pos + 2).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  {
    label: 'Toggle List', icon: 'chevron-right', description: 'Collapsible content',
    action: (e, range) => {
      e.chain().insertContentAt(range, {
        type: 'details',
        content: [
          { type: 'detailsSummary' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }).run();
      // Place cursor inside the detailsSummary so the user types the title
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'detailsSummary') {
          e.chain().setTextSelection(pos + 1).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  {
    label: 'Table', icon: 'grid', description: 'Insert a table',
    action: (e, range) => {
      const headerCells = Array.from({ length: 3 }, () => ({ type: 'tableHeader', content: [{ type: 'paragraph' }] }));
      const bodyRow = () => ({ type: 'tableRow', content: Array.from({ length: 3 }, () => ({ type: 'tableCell', content: [{ type: 'paragraph' }] })) });
      e.chain().insertContentAt(range, {
        type: 'table',
        content: [{ type: 'tableRow', content: headerCells }, bodyRow(), bodyRow()],
      }).focus().run();
    },
  },
  // ── Media ──
  {
    label: 'Image', icon: 'image', description: 'Embed an image from URL',
    action: (e, range) => {
      const url = prompt('Enter image URL:');
      if (url) e.chain().insertContentAt(range, { type: 'image', attrs: { src: url } }).focus().run();
    },
  },
  // ── Math / Equations ──
  {
    label: 'Block Equation', icon: 'math-block', description: 'Full-width math equation',
    action: (e, range) => {
      e.chain().insertContentAt(range, { type: 'mathBlock', attrs: { latex: '' } }).focus().run();
    },
  },
  {
    label: 'Inline Equation', icon: 'math', description: 'Inline math within text',
    action: (e, range) => {
      e.chain().insertContentAt(range, { type: 'inlineMath', attrs: { latex: 'f(x)', display: 'no' } }).focus().run();
    },
  },
  // ── Layout ──
  {
    label: '2 Columns', icon: 'columns', description: 'Split into 2 columns',
    action: (e, range) => {
      // Prevent nesting columns inside columns
      const { $from } = e.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'column') return;
      }
      e.chain().insertContentAt(range, {
        type: 'columnList',
        content: [
          { type: 'column', content: [{ type: 'paragraph' }] },
          { type: 'column', content: [{ type: 'paragraph' }] },
        ],
      }).focus().run();
      // Place cursor in the first column's paragraph
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'column') {
          e.chain().setTextSelection(pos + 2).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  {
    label: '3 Columns', icon: 'columns', description: 'Split into 3 columns',
    action: (e, range) => {
      const { $from } = e.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'column') return;
      }
      e.chain().insertContentAt(range, {
        type: 'columnList',
        content: [
          { type: 'column', content: [{ type: 'paragraph' }] },
          { type: 'column', content: [{ type: 'paragraph' }] },
          { type: 'column', content: [{ type: 'paragraph' }] },
        ],
      }).focus().run();
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'column') {
          e.chain().setTextSelection(pos + 2).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  {
    label: '4 Columns', icon: 'columns', description: 'Split into 4 columns',
    action: (e, range) => {
      const { $from } = e.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'column') return;
      }
      e.chain().insertContentAt(range, {
        type: 'columnList',
        content: [
          { type: 'column', content: [{ type: 'paragraph' }] },
          { type: 'column', content: [{ type: 'paragraph' }] },
          { type: 'column', content: [{ type: 'paragraph' }] },
          { type: 'column', content: [{ type: 'paragraph' }] },
        ],
      }).focus().run();
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'column') {
          e.chain().setTextSelection(pos + 2).focus().run();
          return false;
        }
        return true;
      });
    },
  },
];

// ─── Canvas Editor Provider ─────────────────────────────────────────────────

export type OpenEditorFn = (options: { typeId: string; title: string; icon?: string; instanceId?: string }) => Promise<void>;

export class CanvasEditorProvider {
  private _openEditor: OpenEditorFn | undefined;

  constructor(private readonly _dataService: CanvasDataService) {}

  /**
   * Set the openEditor callback so panes can navigate to other pages.
   */
  setOpenEditor(fn: OpenEditorFn): void {
    this._openEditor = fn;
  }

  /**
   * Create an editor pane for a Canvas page.
   *
   * @param container — DOM element to render into
   * @param input — the ToolEditorInput (input.id === pageId)
   */
  createEditorPane(container: HTMLElement, input?: IEditorInput): IDisposable {
    const pageId = input?.id ?? '';
    const pane = new CanvasEditorPane(container, pageId, this._dataService, input, this._openEditor);
    pane.init();
    return pane;
  }
}

// ─── Canvas Editor Pane ─────────────────────────────────────────────────────

class CanvasEditorPane implements IDisposable {
  private _editor: Editor | null = null;
  private _editorContainer: HTMLElement | null = null;
  private _slashMenu: HTMLElement | null = null;
  private _bubbleMenu: HTMLElement | null = null;
  private _linkInput: HTMLElement | null = null;
  private _inlineMathPopup: HTMLElement | null = null;
  private _inlineMathInput: HTMLInputElement | null = null;
  private _inlineMathPreview: HTMLElement | null = null;
  private _inlineMathPos: number = -1;
  private _slashMenuVisible = false;
  private _slashFilterText = '';
  private _slashSelectedIndex = 0;
  private _disposed = false;
  private _suppressUpdate = false;
  private readonly _saveDisposables: IDisposable[] = [];

  // ── Page header elements (Cap 7/8/9) ──
  private _topRibbon: HTMLElement | null = null;
  private _ribbonFavoriteBtn: HTMLElement | null = null;
  private _ribbonEditedLabel: HTMLElement | null = null;
  private _pageHeader: HTMLElement | null = null;
  private _coverEl: HTMLElement | null = null;
  private _coverControls: HTMLElement | null = null;
  private _breadcrumbsEl: HTMLElement | null = null;
  private _breadcrumbCurrentText: HTMLElement | null = null;
  private _iconEl: HTMLElement | null = null;
  private _titleEl: HTMLElement | null = null;
  private _hoverAffordances: HTMLElement | null = null;
  private _pageMenuBtn: HTMLElement | null = null;
  private _pageMenuDropdown: HTMLElement | null = null;
  private _emojiPicker: HTMLElement | null = null;
  private _iconPicker: HTMLElement | null = null;
  private _coverPicker: HTMLElement | null = null;

  // ── Page state ──
  private _currentPage: IPage | null = null;
  private _titleSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Block handles (+ button, action menu) ──
  private _blockAddBtn: HTMLElement | null = null;
  private _blockActionMenu: HTMLElement | null = null;
  private _turnIntoSubmenu: HTMLElement | null = null;
  private _colorSubmenu: HTMLElement | null = null;
  private _turnIntoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _colorHideTimer: ReturnType<typeof setTimeout> | null = null;
  private _dragHandleEl: HTMLElement | null = null;
  private _handleObserver: MutationObserver | null = null;
  private _actionBlockPos: number = -1;
  private _actionBlockNode: any = null;

  constructor(
    private readonly _container: HTMLElement,
    private readonly _pageId: string,
    private readonly _dataService: CanvasDataService,
    private readonly _input: IEditorInput | undefined,
    private readonly _openEditor: OpenEditorFn | undefined,
  ) {}

  async init(): Promise<void> {
    // Create editor wrapper
    this._editorContainer = $('div.canvas-editor-wrapper');
    this._container.appendChild(this._editorContainer);

    // ── Load page data for header rendering ──
    try {
      this._currentPage = await this._dataService.getPage(this._pageId) ?? null;
    } catch {
      this._currentPage = null;
    }

    // ── Apply page display settings CSS classes ──
    this._applyPageSettings();

    // ── Top ribbon: breadcrumbs, edited timestamp, favorite star, ⋯ menu ──
    this._createTopRibbon();

    // ── Cover image (Cap 8) ──
    this._createCover();

    // ── Page header: icon, title, hover affordances ──
    this._createPageHeader();

    // Create Tiptap editor with Notion-parity extensions
    // Link and Underline are part of StarterKit v3 — configure via StarterKit options
    this._editor = new Editor({
      element: this._editorContainer,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: false,  // Replaced by CodeBlockLowlight
          link: {
            openOnClick: false,
            HTMLAttributes: {
              class: 'canvas-link',
            },
          },
          dropcursor: {
            color: 'rgba(45, 170, 219, 0.4)',
            width: 3,
          },
          // underline: enabled by default via StarterKit, no extra config needed
        }),
        Placeholder.configure({
          placeholder: ({ node, pos, editor, hasAnchor }: { node: any; pos: number; editor: any; hasAnchor: boolean }) => {
            if (node.type.name === 'heading') {
              return `Heading ${node.attrs.level}`;
            }
            // DetailsSummary has content:'text*' (no paragraphs), so handle it
            // explicitly — it's an inline-text container that needs its own hint.
            if (node.type.name === 'detailsSummary') {
              return 'Toggle title…';
            }
            // Wrapper block nodes (details, callout, taskList, taskItem, etc.)
            // always get empty placeholder — prevents overlay on UI elements.
            if (node.type.name !== 'paragraph') {
              return '';
            }
            // For paragraphs, check if nested inside a wrapper block —
            // these get STABLE placeholders (always visible, not just when focused)
            const $pos = editor.state.doc.resolve(pos);
            for (let d = $pos.depth; d > 0; d--) {
              const ancestor = $pos.node(d);
              const name = ancestor.type.name;
              if (name === 'callout') return 'Type something…';
              if (name === 'taskItem') return 'To-do';
              if (name === 'detailsContent') return 'Hidden content…';
              if (name === 'blockquote') return '';
              if (name === 'column') return hasAnchor ? "Type '/' for commands..." : '';
            }
            // Top-level paragraph: only show slash hint when cursor is here
            return hasAnchor ? "Type '/' for commands..." : '';
          },
          // showOnlyCurrent:false ensures ALL empty nodes always get decorated,
          // preventing layout shift when clicking in/out of wrapper blocks.
          showOnlyCurrent: false,
          includeChildren: true,
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        TextStyle,
        Color,
        Highlight.configure({
          multicolor: true,
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
        }),
        GlobalDragHandle.configure({
          dragHandleWidth: 24,
          scrollTreshold: 100,
          customNodes: ['mathBlock', 'columnList'],
        }),
        // ── Tier 2 extensions ──
        Callout,
        Details.configure({
          persist: true,
          HTMLAttributes: { class: 'canvas-details' },
        }),
        DetailsSummary,
        DetailsContent,
        TableKit.configure({
          table: {
            resizable: true,
            HTMLAttributes: { class: 'canvas-table' },
          },
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: 'plaintext',
          HTMLAttributes: { class: 'canvas-code-block' },
        }),
        CharacterCount,
        AutoJoiner,
        DetailsEnterHandler,
        // ── Math / KaTeX ──
        InlineMathNode.configure({
          evaluation: false,
          katexOptions: { throwOnError: false },
          delimiters: 'dollar',
        }),
        MathBlock,
        // ── Columns ──
        Column,
        ColumnList,
        // ── Block-level background color ──
        BlockBackgroundColor,
      ],
      content: '',
      editorProps: {
        attributes: {
          class: 'canvas-tiptap-editor',
        },
        handleKeyDown: (_view, event) => {
          // Prevent Parallx keybinding system from capturing editor shortcuts
          if (event.ctrlKey || event.metaKey || event.altKey) {
            event.stopPropagation();
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        if (this._suppressUpdate) return;
        const json = JSON.stringify(editor.getJSON());
        this._dataService.scheduleContentSave(this._pageId, json);

        // Check for slash command trigger
        this._checkSlashTrigger(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        this._updateBubbleMenu(editor);
      },
      onBlur: () => {
        // Small delay so clicking bubble menu buttons doesn't dismiss it
        setTimeout(() => {
          if (
            !this._bubbleMenu?.contains(document.activeElement) &&
            !this._inlineMathPopup?.contains(document.activeElement)
          ) {
            this._hideBubbleMenu();
          }
        }, 150);
      },
    });

    // Load content (skip corrupted content gracefully)
    try {
      await this._loadContent();
    } catch (err) {
      console.warn('[CanvasEditorPane] Content loading failed, starting with empty editor:', err);
    }

    // Expose editor for E2E tests (test mode only)
    if ((window as any).parallxElectron?.testMode) {
      (window as any).__tiptapEditor = this._editor;
    }

    // Create slash menu (hidden by default)
    this._createSlashMenu();

    // Create bubble menu (hidden by default)
    this._createBubbleMenu();

    // Create inline math editor popup (hidden by default)
    this._createInlineMathEditor();

    // Setup block handles (+ button, drag-handle click menu)
    this._setupBlockHandles();

    // ── Click handler for inline math nodes (click-to-edit) ──
    this._editorContainer.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.tiptap-math.latex');
      if (!target || !this._editor) return;
      e.preventDefault();
      e.stopPropagation();
      // Find ProseMirror position of the clicked node
      const pos = this._editor.view.posAtDOM(target, 0);
      const node = this._editor.state.doc.nodeAt(pos);
      if (node && node.type.name === 'inlineMath') {
        this._showInlineMathEditor(pos, node.attrs.latex || '', target as HTMLElement);
      }
    });

    // Subscribe to save completion (Task 6.1)
    this._saveDisposables.push(
      this._dataService.onDidSavePage((savedPageId) => {
        if (savedPageId === this._pageId) {
          // Auto-save completed — no dirty tracking needed for canvas
        }
      }),
    );

    // Subscribe to page changes for bidirectional sync (Task 7.2)
    this._saveDisposables.push(
      this._dataService.onDidChangePage((event) => {
        if (event.pageId !== this._pageId || !event.page) return;
        this._currentPage = event.page;

        // Update title if changed externally (e.g. sidebar rename)
        // Skip if user is actively editing the title to avoid race condition
        const titleHasFocus = this._titleEl === document.activeElement;
        if (this._titleEl && !titleHasFocus && event.page.title !== this._titleEl.textContent) {
          // Show empty for 'Untitled' so placeholder displays
          this._titleEl.textContent = (event.page.title && event.page.title !== 'Untitled') ? event.page.title : '';
        }
        // Always sync the tab label to match the page title
        if (this._input && typeof (this._input as any).setName === 'function') {
          (this._input as any).setName(event.page.title || 'Untitled');
        }
        // Sync breadcrumb current-page text
        if (this._breadcrumbCurrentText) {
          this._breadcrumbCurrentText.textContent = event.page.title || 'Untitled';
        }

        // Update icon (SVG)
        if (this._iconEl) {
          if (event.page.icon) {
            const iconId = resolvePageIcon(event.page.icon);
            this._iconEl.innerHTML = svgIcon(iconId);
            const svg = this._iconEl.querySelector('svg');
            if (svg) { svg.setAttribute('width', '40'); svg.setAttribute('height', '40'); }
            this._iconEl.style.display = '';
          } else {
            this._iconEl.innerHTML = '';
            this._iconEl.style.display = 'none';
          }
        }

        // Update cover
        this._refreshCover();

        // Update ribbon (timestamp + favorite state)
        this._refreshRibbon();

        // Update display settings
        this._applyPageSettings();
      }),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Top Ribbon — Breadcrumbs, Edited timestamp, Favorite, Page menu
  // ══════════════════════════════════════════════════════════════════════════

  private _createTopRibbon(): void {
    if (!this._editorContainer) return;

    this._topRibbon = $('div.canvas-top-ribbon');

    // ── Left: breadcrumbs ──
    const ribbonLeft = $('div.canvas-top-ribbon-left');
    this._breadcrumbsEl = $('div.canvas-breadcrumbs');
    ribbonLeft.appendChild(this._breadcrumbsEl);
    this._loadBreadcrumbs();
    this._topRibbon.appendChild(ribbonLeft);

    // ── Right: edited timestamp, favorite star, ⋯ menu ──
    const ribbonRight = $('div.canvas-top-ribbon-right');

    // Edited timestamp
    this._ribbonEditedLabel = $('span.canvas-top-ribbon-edited');
    this._ribbonEditedLabel.textContent = this._formatRelativeTime(this._currentPage?.updatedAt);
    ribbonRight.appendChild(this._ribbonEditedLabel);

    // Favorite star toggle
    this._ribbonFavoriteBtn = $('button.canvas-top-ribbon-btn.canvas-top-ribbon-favorite');
    this._ribbonFavoriteBtn.title = 'Add to Favorites';
    this._updateFavoriteIcon();
    this._ribbonFavoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dataService.toggleFavorite(this._pageId);
    });
    ribbonRight.appendChild(this._ribbonFavoriteBtn);

    // ⋯ Page menu button
    this._pageMenuBtn = $('button.canvas-top-ribbon-btn.canvas-top-ribbon-menu');
    this._pageMenuBtn.innerHTML = svgIcon('ellipsis');
    const menuSvg = this._pageMenuBtn.querySelector('svg');
    if (menuSvg) { menuSvg.setAttribute('width', '16'); menuSvg.setAttribute('height', '16'); }
    this._pageMenuBtn.title = 'Page settings';
    this._pageMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showPageMenu();
    });
    ribbonRight.appendChild(this._pageMenuBtn);

    this._topRibbon.appendChild(ribbonRight);
    this._editorContainer.prepend(this._topRibbon);
  }

  private _updateFavoriteIcon(): void {
    if (!this._ribbonFavoriteBtn) return;
    const isFav = !!this._currentPage?.isFavorited;
    const iconId = isFav ? 'star-filled' : 'star';
    this._ribbonFavoriteBtn.innerHTML = svgIcon(iconId);
    const svg = this._ribbonFavoriteBtn.querySelector('svg');
    if (svg) { svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); }
    this._ribbonFavoriteBtn.classList.toggle('canvas-top-ribbon-favorite--active', isFav);
    this._ribbonFavoriteBtn.title = isFav ? 'Remove from Favorites' : 'Add to Favorites';
  }

  private _refreshRibbon(): void {
    // Update edited timestamp
    if (this._ribbonEditedLabel) {
      this._ribbonEditedLabel.textContent = this._formatRelativeTime(this._currentPage?.updatedAt);
    }
    // Update favorite icon
    this._updateFavoriteIcon();
  }

  private _formatRelativeTime(isoStr?: string | null): string {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'Edited just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Edited ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Edited ${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Edited ${days}d ago`;
    const months = Math.floor(days / 30);
    return `Edited ${months}mo ago`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Header — Title, Icon (Cap 7)
  // ══════════════════════════════════════════════════════════════════════════

  private _createPageHeader(): void {
    if (!this._editorContainer) return;

    this._pageHeader = $('div.canvas-page-header');

    // ── Icon (large, clickable — SVG) ──
    this._iconEl = $('span.canvas-page-icon');
    const pageIconId = resolvePageIcon(this._currentPage?.icon);
    if (this._currentPage?.icon) {
      this._iconEl.innerHTML = svgIcon(pageIconId);
      const svg = this._iconEl.querySelector('svg');
      if (svg) { svg.setAttribute('width', '40'); svg.setAttribute('height', '40'); }
      this._iconEl.style.display = '';
    } else {
      this._iconEl.style.display = 'none';
    }
    this._iconEl.title = 'Change icon';
    this._iconEl.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent TipTap focus handling from swallowing the click
    });
    this._iconEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showIconPicker();
    });
    this._pageHeader.appendChild(this._iconEl);

    // ── Hover affordances (Add icon / Add cover) ──
    this._hoverAffordances = $('div.canvas-page-affordances');

    if (!this._currentPage?.icon) {
      const addIconBtn = $('button.canvas-affordance-btn');
      addIconBtn.dataset.action = 'add-icon';
      addIconBtn.appendChild(createIconElement('smile', 14));
      const lbl = $('span'); lbl.textContent = 'Add icon';
      addIconBtn.appendChild(lbl);
      addIconBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showIconPicker();
      });
      this._hoverAffordances.appendChild(addIconBtn);
    }

    if (!this._currentPage?.coverUrl) {
      const addCoverBtn = $('button.canvas-affordance-btn');
      addCoverBtn.dataset.action = 'add-cover';
      addCoverBtn.appendChild(createIconElement('image', 14));
      const lbl2 = $('span'); lbl2.textContent = 'Add cover';
      addCoverBtn.appendChild(lbl2);
      addCoverBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addCoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCoverPicker();
      });
      this._hoverAffordances.appendChild(addCoverBtn);
    }

    this._pageHeader.appendChild(this._hoverAffordances);

    // ── Title (contenteditable) ──
    this._titleEl = $('div.canvas-page-title');
    this._titleEl.contentEditable = 'true';
    this._titleEl.spellcheck = false;
    this._titleEl.setAttribute('data-placeholder', 'Untitled');
    // Show empty (use CSS placeholder) if title is the default 'Untitled'
    const displayTitle = this._currentPage?.title;
    this._titleEl.textContent = (displayTitle && displayTitle !== 'Untitled') ? displayTitle : '';

    // Title input → debounced save + immediate tab label + breadcrumb sync
    this._titleEl.addEventListener('input', () => {
      const newTitle = this._titleEl?.textContent?.trim() || 'Untitled';
      // Update tab label immediately (no flicker)
      if (this._input && typeof (this._input as any).setName === 'function') {
        (this._input as any).setName(newTitle);
      }
      // Update breadcrumb current-page text
      if (this._breadcrumbCurrentText) {
        this._breadcrumbCurrentText.textContent = newTitle;
      }
      if (this._titleSaveTimer) clearTimeout(this._titleSaveTimer);
      this._titleSaveTimer = setTimeout(() => {
        this._dataService.updatePage(this._pageId, { title: newTitle });
      }, 300);
    });

    // Enter → move focus to editor, prevent newline
    this._titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._editor?.commands.focus('start');
      }
    });

    // Paste → strip to plain text, prevent newlines
    this._titleEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain')?.replace(/[\r\n]+/g, ' ') || '';
      document.execCommand('insertText', false, text);
    });

    this._pageHeader.appendChild(this._titleEl);

    // Insert header AFTER the cover element so DOM order is: cover → header → editor
    if (this._coverEl) {
      this._coverEl.after(this._pageHeader);
    } else {
      this._editorContainer.prepend(this._pageHeader);
    }
  }

  private async _loadBreadcrumbs(): Promise<void> {
    if (!this._breadcrumbsEl || !this._pageId) return;
    try {
      const ancestors = await this._dataService.getAncestors(this._pageId);
      this._breadcrumbsEl.style.display = '';
      this._breadcrumbsEl.innerHTML = '';

      // Show ancestor pages as clickable crumbs
      for (let i = 0; i < ancestors.length; i++) {
        const crumb = $('span.canvas-breadcrumb');
        const crumbIcon = createIconElement(resolvePageIcon(ancestors[i].icon), 14);
        crumb.appendChild(crumbIcon);
        const crumbText = $('span');
        crumbText.textContent = ancestors[i].title;
        crumb.appendChild(crumbText);
        crumb.addEventListener('click', () => {
          this._openEditor?.({
            typeId: 'canvas',
            title: ancestors[i].title,
            icon: ancestors[i].icon ?? undefined,
            instanceId: ancestors[i].id,
          });
        });
        this._breadcrumbsEl.appendChild(crumb);

        const sep = $('span.canvas-breadcrumb-sep');
        sep.textContent = '›';
        this._breadcrumbsEl.appendChild(sep);
      }

      // Always show current page as the last breadcrumb (non-clickable)
      const currentCrumb = $('span.canvas-breadcrumb.canvas-breadcrumb--current');
      const currentIcon = createIconElement(resolvePageIcon(this._currentPage?.icon), 14);
      currentCrumb.appendChild(currentIcon);
      this._breadcrumbCurrentText = $('span');
      this._breadcrumbCurrentText.textContent = this._currentPage?.title || 'Untitled';
      currentCrumb.appendChild(this._breadcrumbCurrentText);
      this._breadcrumbsEl.appendChild(currentCrumb);
    } catch {
      this._breadcrumbsEl.style.display = 'none';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cover Image (Cap 8)
  // ══════════════════════════════════════════════════════════════════════════

  private _createCover(): void {
    if (!this._editorContainer) return;

    this._coverEl = $('div.canvas-page-cover');
    this._coverControls = $('div.canvas-cover-controls');

    const repositionBtn = $('button.canvas-cover-btn.canvas-cover-reposition-btn');
    repositionBtn.textContent = 'Reposition';
    repositionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._startCoverReposition();
    });

    const changeBtn = $('button.canvas-cover-btn');
    changeBtn.textContent = 'Change cover';
    changeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showCoverPicker();
    });

    const removeBtn = $('button.canvas-cover-btn');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dataService.updatePage(this._pageId, { coverUrl: null });
    });

    this._coverControls.appendChild(repositionBtn);
    this._coverControls.appendChild(changeBtn);
    this._coverControls.appendChild(removeBtn);
    this._coverEl.appendChild(this._coverControls);

    // Insert cover after the top ribbon (DOM order: ribbon → cover → header → editor)
    if (this._topRibbon) {
      this._topRibbon.after(this._coverEl);
    } else {
      this._editorContainer.prepend(this._coverEl);
    }
    this._refreshCover();
  }

  private _refreshCover(): void {
    if (!this._coverEl || !this._coverControls) return;
    const url = this._currentPage?.coverUrl;
    if (!url) {
      this._coverEl.style.display = 'none';
      // Update hover affordances so "Add cover" reappears
      this._refreshHoverAffordances();
      return;
    }
    this._coverEl.style.display = '';
    const yPct = ((this._currentPage?.coverYOffset ?? 0.5) * 100).toFixed(1);

    const isGradient = url.startsWith('linear-gradient') || url.startsWith('radial-gradient');
    if (isGradient) {
      this._coverEl.style.backgroundImage = url;
      this._coverEl.style.backgroundPosition = '';
      this._coverEl.style.backgroundSize = '';
    } else {
      this._coverEl.style.backgroundImage = `url(${url})`;
      this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      this._coverEl.style.backgroundSize = 'cover';
    }

    // Update hover affordances
    this._refreshHoverAffordances();
  }

  private _refreshHoverAffordances(): void {
    if (!this._hoverAffordances) return;
    // Remove existing buttons and rebuild
    this._hoverAffordances.innerHTML = '';

    if (!this._currentPage?.icon) {
      const addIconBtn = $('button.canvas-affordance-btn');
      addIconBtn.dataset.action = 'add-icon';
      addIconBtn.appendChild(createIconElement('smile', 14));
      const lbl = $('span'); lbl.textContent = 'Add icon';
      addIconBtn.appendChild(lbl);
      addIconBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addIconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showIconPicker();
      });
      this._hoverAffordances.appendChild(addIconBtn);
    }

    if (!this._currentPage?.coverUrl) {
      const addCoverBtn = $('button.canvas-affordance-btn');
      addCoverBtn.dataset.action = 'add-cover';
      addCoverBtn.appendChild(createIconElement('image', 14));
      const lbl2 = $('span'); lbl2.textContent = 'Add cover';
      addCoverBtn.appendChild(lbl2);
      addCoverBtn.addEventListener('mousedown', (e) => { e.preventDefault(); });
      addCoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCoverPicker();
      });
      this._hoverAffordances.appendChild(addCoverBtn);
    }
  }

  private _isRepositioning = false;

  private _startCoverReposition(): void {
    if (!this._coverEl || !this._currentPage?.coverUrl || this._isRepositioning) return;

    this._isRepositioning = true;

    const overlay = $('div.canvas-cover-reposition-overlay');
    overlay.textContent = 'Drag image to reposition';
    this._coverEl.appendChild(overlay);
    this._coverEl.classList.add('canvas-cover--repositioning');

    // Hide the normal cover controls while repositioning
    if (this._coverControls) {
      this._coverControls.style.display = 'none';
    }

    let startY = 0;
    let startOffset = this._currentPage?.coverYOffset ?? 0.5;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault(); // Prevent text selection during drag
      startY = e.clientY;
      startOffset = this._currentPage?.coverYOffset ?? 0.5;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = (startY - e.clientY) / (this._coverEl?.offsetHeight ?? 200);
      const newOffset = Math.max(0, Math.min(1, startOffset + delta));
      const yPct = (newOffset * 100).toFixed(1);
      if (this._coverEl) {
        this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      }
      // Store temporarily
      if (this._currentPage) {
        (this._currentPage as any).coverYOffset = newOffset;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const finalOffset = this._currentPage?.coverYOffset ?? 0.5;
      this._dataService.updatePage(this._pageId, { coverYOffset: finalOffset });
    };

    // Save the original offset so Cancel can revert
    const originalOffset = this._currentPage?.coverYOffset ?? 0.5;

    overlay.addEventListener('mousedown', onMouseDown);

    // Button container for Save / Cancel
    const actionBar = $('div.canvas-cover-reposition-actions');

    const cancelBtn = $('button.canvas-cover-btn');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Revert to original offset
      if (this._currentPage) {
        (this._currentPage as any).coverYOffset = originalOffset;
      }
      const yPct = (originalOffset * 100).toFixed(1);
      if (this._coverEl) {
        this._coverEl.style.backgroundPosition = `center ${yPct}%`;
      }
      overlay.remove();
      actionBar.remove();
      this._coverEl?.classList.remove('canvas-cover--repositioning');
      if (this._coverControls) {
        this._coverControls.style.display = '';
      }
      this._isRepositioning = false;
    });
    actionBar.appendChild(cancelBtn);

    const saveBtn = $('button.canvas-cover-btn.canvas-cover-btn--primary');
    saveBtn.textContent = 'Save position';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      overlay.remove();
      actionBar.remove();
      this._coverEl?.classList.remove('canvas-cover--repositioning');
      if (this._coverControls) {
        this._coverControls.style.display = '';
      }
      this._isRepositioning = false;
      const finalOffset = this._currentPage?.coverYOffset ?? 0.5;
      this._dataService.updatePage(this._pageId, { coverYOffset: finalOffset });
    });
    actionBar.appendChild(saveBtn);

    this._coverEl.appendChild(actionBar);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Cover Picker Popup (Cap 8)
  // ══════════════════════════════════════════════════════════════════════════

  private _showCoverPicker(): void {
    if (this._coverPicker) { this._dismissPopups(); return; }
    this._dismissPopups();

    this._coverPicker = $('div.canvas-cover-picker');

    // ── Tab bar ──
    const tabs = $('div.canvas-cover-picker-tabs');
    const tabGallery = $('button.canvas-cover-picker-tab.canvas-cover-picker-tab--active');
    tabGallery.textContent = 'Gallery';
    const tabUpload = $('button.canvas-cover-picker-tab');
    tabUpload.textContent = 'Upload';
    const tabLink = $('button.canvas-cover-picker-tab');
    tabLink.textContent = 'Link';
    tabs.appendChild(tabGallery);
    tabs.appendChild(tabUpload);
    tabs.appendChild(tabLink);
    this._coverPicker.appendChild(tabs);

    // ── Content area ──
    const content = $('div.canvas-cover-picker-content');
    this._coverPicker.appendChild(content);

    // Gallery (default view)
    const GRADIENTS = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      'linear-gradient(135deg, #667eea 0%, #f093fb 100%)',
      'linear-gradient(180deg, #2c3e50 0%, #3498db 100%)',
      'linear-gradient(180deg, #141e30 0%, #243b55 100%)',
      'linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)',
      'linear-gradient(180deg, #232526 0%, #414345 100%)',
    ];

    const renderGallery = () => {
      content.innerHTML = '';
      const grid = $('div.canvas-cover-gallery');
      for (const grad of GRADIENTS) {
        const swatch = $('div.canvas-cover-swatch');
        swatch.style.background = grad;
        swatch.addEventListener('click', () => {
          this._dataService.updatePage(this._pageId, { coverUrl: grad });
          this._dismissPopups();
        });
        grid.appendChild(swatch);
      }
      content.appendChild(grid);
    };

    const renderUpload = () => {
      content.innerHTML = '';
      const uploadBtn = $('button.canvas-cover-upload-btn');
      uploadBtn.textContent = 'Choose an image';
      uploadBtn.addEventListener('click', async () => {
        try {
          const electron = (window as any).parallxElectron;
          if (!electron?.dialog?.openFile) return;
          const filePaths = await electron.dialog.openFile({
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
            properties: ['openFile'],
          });
          if (filePaths?.[0]) {
            const filePath = filePaths[0];
            // Read file — binary files auto-return as base64
            const result = await electron.fs.readFile(filePath);
            if (result?.content && result?.encoding === 'base64') {
              const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
              const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
              const dataUrl = `data:${mime};base64,${result.content}`;
              // Check rough size (2MB limit for base64)
              if (result.content.length > 2 * 1024 * 1024 * 1.37) {
                alert('Image is too large (max 2MB). Please choose a smaller image.');
                return;
              }
              this._dataService.updatePage(this._pageId, { coverUrl: dataUrl });
              this._dismissPopups();
            }
          }
        } catch (err) {
          console.error('[CanvasEditorPane] Cover upload failed:', err);
        }
      });
      content.appendChild(uploadBtn);
      const hint = $('div.canvas-cover-upload-hint');
      hint.textContent = 'Recommended: 1500×600px or wider. Max 2MB.';
      content.appendChild(hint);
    };

    const renderLink = () => {
      content.innerHTML = '';
      const row = $('div.canvas-cover-link-row');
      const input = $('input.canvas-cover-link-input') as HTMLInputElement;
      input.type = 'url';
      input.placeholder = 'Paste image URL…';
      const applyBtn = $('button.canvas-cover-link-apply');
      applyBtn.textContent = 'Apply';
      applyBtn.addEventListener('click', () => {
        const url = input.value.trim();
        if (url) {
          this._dataService.updatePage(this._pageId, { coverUrl: url });
          this._dismissPopups();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyBtn.click();
        if (e.key === 'Escape') this._dismissPopups();
      });
      row.appendChild(input);
      row.appendChild(applyBtn);
      content.appendChild(row);
    };

    renderGallery();

    // Tab switching
    const allTabs = [tabGallery, tabUpload, tabLink];
    const renderers = [renderGallery, renderUpload, renderLink];
    allTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        allTabs.forEach(t => t.classList.remove('canvas-cover-picker-tab--active'));
        tab.classList.add('canvas-cover-picker-tab--active');
        renderers[i]();
      });
    });

    this._container.appendChild(this._coverPicker);

    // Position: fixed, horizontally centered in editor area
    const wrapperRect = (this._editorContainer ?? this._container).getBoundingClientRect();
    const pickerWidth = 420;
    const left = wrapperRect.left + (wrapperRect.width - pickerWidth) / 2;

    // Anchor below cover if visible, otherwise below the page header
    let top: number;
    const coverVisible = this._coverEl && this._coverEl.style.display !== 'none';
    if (coverVisible) {
      top = this._coverEl!.getBoundingClientRect().bottom + 4;
    } else if (this._pageHeader) {
      top = this._pageHeader.getBoundingClientRect().top;
    } else {
      top = wrapperRect.top + 60;
    }

    // Clamp so picker doesn't overflow the viewport bottom
    const pickerHeight = 280; // approximate
    top = Math.min(top, window.innerHeight - pickerHeight - 8);
    top = Math.max(top, 8);

    this._coverPicker.style.top = `${top}px`;
    this._coverPicker.style.left = `${Math.max(8, left)}px`;

    // Dismiss on click outside
    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    // Dismiss on Escape
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Icon Picker (SVG icons — replaces emoji picker)
  // ══════════════════════════════════════════════════════════════════════════

  private _showIconPicker(): void {
    if (this._iconPicker) { this._dismissPopups(); return; }
    this._dismissPopups();

    this._iconPicker = $('div.canvas-icon-picker');

    // Search
    const searchInput = $('input.canvas-icon-search') as HTMLInputElement;
    searchInput.type = 'text';
    searchInput.placeholder = 'Search icons…';
    this._iconPicker.appendChild(searchInput);

    // Remove button (if icon is set)
    if (this._currentPage?.icon) {
      const removeBtn = $('button.canvas-icon-remove');
      removeBtn.appendChild(createIconElement('close', 12));
      const removeLbl = $('span');
      removeLbl.textContent = ' Remove icon';
      removeBtn.appendChild(removeLbl);
      removeBtn.addEventListener('click', () => {
        this._dataService.updatePage(this._pageId, { icon: null as any });
        this._dismissPopups();
      });
      this._iconPicker.appendChild(removeBtn);
    }

    // Icon grid
    const contentArea = $('div.canvas-icon-content');

    const renderIcons = (filter?: string) => {
      contentArea.innerHTML = '';
      const grid = $('div.canvas-icon-grid');
      const ids = filter
        ? PAGE_ICON_IDS.filter(id => id.includes(filter.toLowerCase()))
        : PAGE_ICON_IDS;
      for (const id of ids) {
        const btn = $('button.canvas-icon-btn');
        btn.title = id;
        btn.innerHTML = svgIcon(id);
        const svg = btn.querySelector('svg');
        if (svg) { svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); }
        btn.addEventListener('click', () => {
          this._dataService.updatePage(this._pageId, { icon: id });
          this._dismissPopups();
        });
        grid.appendChild(btn);
      }
      if (ids.length === 0) {
        const empty = $('div.canvas-icon-empty');
        empty.textContent = 'No matching icons';
        grid.appendChild(empty);
      }
      contentArea.appendChild(grid);
    };

    renderIcons();

    // Search handler
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      renderIcons(q || undefined);
    });

    this._iconPicker.appendChild(contentArea);
    this._container.appendChild(this._iconPicker);

    // Position near icon
    if (this._iconEl || this._pageHeader) {
      const target = this._iconEl?.style.display !== 'none' ? this._iconEl : this._pageHeader;
      const rect = target?.getBoundingClientRect();
      if (rect) {
        this._iconPicker.style.left = `${rect.left}px`;
        this._iconPicker.style.top = `${rect.bottom + 4}px`;
      }
    }

    // Focus search
    setTimeout(() => searchInput.focus(), 50);

    // Dismiss
    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Menu — "⋯" dropdown (Cap 9)
  // ══════════════════════════════════════════════════════════════════════════

  private _showPageMenu(): void {
    if (this._pageMenuDropdown) { this._dismissPopups(); return; }
    this._dismissPopups();

    this._pageMenuDropdown = $('div.canvas-page-menu');
    const page = this._currentPage;

    // ── Font selection ──
    const fontLabel = $('div.canvas-page-menu-label');
    fontLabel.textContent = 'Font';
    this._pageMenuDropdown.appendChild(fontLabel);

    const fonts: { id: 'default' | 'serif' | 'mono'; label: string }[] = [
      { id: 'default', label: 'Default' },
      { id: 'serif', label: 'Serif' },
      { id: 'mono', label: 'Mono' },
    ];

    const fontGroup = $('div.canvas-page-menu-font-group');
    for (const font of fonts) {
      const btn = $('button.canvas-page-menu-font-btn');
      btn.classList.add(`canvas-font-preview-${font.id}`);
      btn.textContent = font.label;
      if (page?.fontFamily === font.id) btn.classList.add('canvas-page-menu-font-btn--active');
      btn.addEventListener('click', () => {
        this._dataService.updatePage(this._pageId, { fontFamily: font.id });
        fontGroup.querySelectorAll('.canvas-page-menu-font-btn').forEach(b => b.classList.remove('canvas-page-menu-font-btn--active'));
        btn.classList.add('canvas-page-menu-font-btn--active');
      });
      fontGroup.appendChild(btn);
    }
    this._pageMenuDropdown.appendChild(fontGroup);

    // ── Toggles ──
    const toggles: { label: string; key: 'fullWidth' | 'smallText' | 'isLocked'; iconId: string }[] = [
      { label: 'Full width', key: 'fullWidth', iconId: 'expand-width' },
      { label: 'Small text', key: 'smallText', iconId: 'text-size' },
      { label: 'Lock page', key: 'isLocked', iconId: 'lock' },
    ];

    for (const toggle of toggles) {
      const row = $('div.canvas-page-menu-toggle');
      const label = $('span.canvas-page-menu-toggle-label');
      label.appendChild(createIconElement(toggle.iconId as any, 14));
      const labelText = $('span');
      labelText.textContent = ` ${toggle.label}`;
      label.appendChild(labelText);
      const switchEl = $('div.canvas-page-menu-switch');
      const isOn = !!(page as any)?.[toggle.key];
      if (isOn) switchEl.classList.add('canvas-page-menu-switch--on');

      row.appendChild(label);
      row.appendChild(switchEl);
      row.addEventListener('click', () => {
        const current = !!(this._currentPage as any)?.[toggle.key];
        this._dataService.updatePage(this._pageId, { [toggle.key]: !current } as any);
        switchEl.classList.toggle('canvas-page-menu-switch--on');
      });
      this._pageMenuDropdown.appendChild(row);
    }

    // ── Divider ──
    this._pageMenuDropdown.appendChild($('div.canvas-page-menu-divider'));

    // ── Action buttons ──
    const actions: { label: string; iconId: string; action: () => void; danger?: boolean }[] = [
      {
        label: 'Favorite',
        iconId: 'star',
        action: () => {
          this._dataService.toggleFavorite(this._pageId);
          this._dismissPopups();
        },
      },
      {
        label: 'Duplicate',
        iconId: 'duplicate',
        action: async () => {
          try {
            const newPage = await this._dataService.duplicatePage(this._pageId);
            // Open the duplicated page
            const input = this._input as any;
            if (input?._api?.editors) {
              input._api.editors.openEditor({
                typeId: 'canvas',
                title: newPage.title,
                icon: newPage.icon ?? undefined,
                instanceId: newPage.id,
              });
            }
          } catch (err) {
            console.error('[Canvas] Duplicate failed:', err);
          }
          this._dismissPopups();
        },
      },
      {
        label: 'Export Markdown',
        iconId: 'export',
        action: async () => {
          try {
            await this._exportMarkdown();
          } catch (err) {
            console.error('[Canvas] Export failed:', err);
          }
          this._dismissPopups();
        },
      },
      {
        label: 'Delete',
        iconId: 'trash',
        action: () => {
          this._dataService.archivePage(this._pageId);
          this._dismissPopups();
        },
        danger: true,
      },
    ];

    // Update favorite label based on current state
    if (page?.isFavorited) {
      actions[0].label = 'Remove from Favorites';
      actions[0].iconId = 'star-filled';
    }

    for (const act of actions) {
      const btn = $('button.canvas-page-menu-action');
      btn.appendChild(createIconElement(act.iconId as any, 14));
      const actLabel = $('span');
      actLabel.textContent = ` ${act.label}`;
      btn.appendChild(actLabel);
      if (act.danger) btn.classList.add('canvas-page-menu-action--danger');
      btn.addEventListener('click', act.action);
      this._pageMenuDropdown.appendChild(btn);
    }

    this._container.appendChild(this._pageMenuDropdown);

    // Position below menu button
    if (this._pageMenuBtn) {
      const rect = this._pageMenuBtn.getBoundingClientRect();
      this._pageMenuDropdown.style.top = `${rect.bottom + 4}px`;
      this._pageMenuDropdown.style.right = `${window.innerWidth - rect.right}px`;
    }

    setTimeout(() => {
      document.addEventListener('mousedown', this._handlePopupOutsideClick);
    }, 0);
    document.addEventListener('keydown', this._handlePopupEscape);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Display Settings (Cap 9)
  // ══════════════════════════════════════════════════════════════════════════

  private _applyPageSettings(): void {
    if (!this._editorContainer) return;
    const page = this._currentPage;

    // Font family
    this._editorContainer.classList.remove('canvas-font-default', 'canvas-font-serif', 'canvas-font-mono');
    this._editorContainer.classList.add(`canvas-font-${page?.fontFamily || 'default'}`);

    // Full width
    this._editorContainer.classList.toggle('canvas-full-width', !!page?.fullWidth);

    // Small text
    this._editorContainer.classList.toggle('canvas-small-text', !!page?.smallText);

    // Lock page
    if (this._editor) {
      this._editor.setEditable(!page?.isLocked);
    }
    if (this._titleEl) {
      this._titleEl.contentEditable = page?.isLocked ? 'false' : 'true';
    }
    this._editorContainer.classList.toggle('canvas-locked', !!page?.isLocked);

    // Cover presence affects header padding
    this._editorContainer.classList.toggle('canvas-has-cover', !!page?.coverUrl);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Markdown Export (Cap 10 — Task 10.6)
  // ══════════════════════════════════════════════════════════════════════════

  private async _exportMarkdown(): Promise<void> {
    if (!this._editor || !this._currentPage) return;

    const doc = this._editor.getJSON();
    const title = this._currentPage.title || 'Untitled';
    const markdown = tiptapJsonToMarkdown(doc, title);

    // Sanitize filename
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100).trim() || 'Untitled';

    const electron = (window as any).parallxElectron;
    if (!electron?.dialog?.saveFile || !electron?.fs?.writeFile) {
      console.error('[Canvas] Electron file dialog not available');
      return;
    }

    const filePath = await electron.dialog.saveFile({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultName: `${safeName}.md`,
    });

    if (!filePath) return; // User cancelled

    await electron.fs.writeFile(filePath, markdown, 'utf-8');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Popup dismiss helpers
  // ══════════════════════════════════════════════════════════════════════════

  private _dismissPopups(): void {
    if (this._emojiPicker) {
      this._emojiPicker.remove();
      this._emojiPicker = null;
    }
    if (this._iconPicker) {
      this._iconPicker.remove();
      this._iconPicker = null;
    }
    if (this._coverPicker) {
      this._coverPicker.remove();
      this._coverPicker = null;
    }
    if (this._pageMenuDropdown) {
      this._pageMenuDropdown.remove();
      this._pageMenuDropdown = null;
    }
    document.removeEventListener('mousedown', this._handlePopupOutsideClick);
    document.removeEventListener('keydown', this._handlePopupEscape);
  }

  private readonly _handlePopupOutsideClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (
      this._emojiPicker?.contains(target) ||
      this._iconPicker?.contains(target) ||
      this._coverPicker?.contains(target) ||
      this._pageMenuDropdown?.contains(target) ||
      this._pageMenuBtn?.contains(target) ||
      this._iconEl?.contains(target) ||
      this._hoverAffordances?.contains(target) ||
      this._coverControls?.contains(target)
    ) return;
    this._dismissPopups();
  };

  private readonly _handlePopupEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this._dismissPopups();
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Content Loading
  // ══════════════════════════════════════════════════════════════════════════

  private async _loadContent(): Promise<void> {
    if (!this._editor || !this._pageId) return;

    try {
      const page = await this._dataService.getPage(this._pageId);
      if (page && page.content) {
        this._suppressUpdate = true;
        try {
          const parsed = JSON.parse(page.content);
          // Validate that parsed content has a valid TipTap document structure
          if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) {
            // Filter out nodes with undefined/missing type (corrupted data)
            parsed.content = parsed.content.filter(
              (node: any) => node && typeof node.type === 'string',
            );
            // Only set content if there are valid nodes remaining
            if (parsed.content.length > 0) {
              this._editor.commands.setContent(parsed);
            }
          } else if (typeof parsed === 'string') {
            // Plain text content — set as paragraph
            this._editor.commands.setContent(`<p>${parsed}</p>`);
          }
          // If parsed is empty or invalid, editor keeps its default empty state
        } catch {
          // Content is not valid JSON or has incompatible nodes — start fresh
          console.warn(`[CanvasEditorPane] Invalid content for page "${this._pageId}", starting fresh`);
          this._editor.commands.clearContent();
        }
        this._suppressUpdate = false;
      }
    } catch (err) {
      console.error(`[CanvasEditorPane] Failed to load page "${this._pageId}":`, err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Inline Math Editor Popup (click-to-edit for inline equations)
  // ══════════════════════════════════════════════════════════════════════════

  private _createInlineMathEditor(): void {
    this._inlineMathPopup = $('div.canvas-inline-math-editor');
    this._inlineMathPopup.style.display = 'none';

    // Input field
    this._inlineMathInput = $('input.canvas-inline-math-input') as HTMLInputElement;
    this._inlineMathInput.type = 'text';
    this._inlineMathInput.placeholder = 'Type LaTeX…';
    this._inlineMathInput.spellcheck = false;

    // Live preview
    this._inlineMathPreview = $('div.canvas-inline-math-preview');

    // Hint
    const hint = $('div.canvas-inline-math-hint');
    hint.textContent = 'Enter to confirm · Escape to cancel';

    this._inlineMathPopup.appendChild(this._inlineMathInput);
    this._inlineMathPopup.appendChild(this._inlineMathPreview);
    this._inlineMathPopup.appendChild(hint);
    this._container.appendChild(this._inlineMathPopup);

    // ── Events ──
    this._inlineMathInput.addEventListener('input', () => {
      if (!this._inlineMathPreview || !this._inlineMathInput) return;
      const val = this._inlineMathInput.value;
      if (!val) {
        this._inlineMathPreview.innerHTML = '<span class="canvas-inline-math-preview-empty">Preview</span>';
      } else {
        try {
          katex.render(val, this._inlineMathPreview, { displayMode: false, throwOnError: false });
        } catch {
          this._inlineMathPreview.textContent = val;
        }
      }
    });

    this._inlineMathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commitInlineMathEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._hideInlineMathEditor();
        // Re-focus editor
        this._editor?.commands.focus();
      }
      // Stop propagation to prevent TipTap/Parallx from handling these keys
      e.stopPropagation();
    });

    this._inlineMathInput.addEventListener('blur', () => {
      // Commit on blur (clicking outside)
      setTimeout(() => {
        if (!this._inlineMathPopup?.contains(document.activeElement)) {
          this._commitInlineMathEdit();
        }
      }, 100);
    });
  }

  private _showInlineMathEditor(pos: number, latex: string, anchorEl: HTMLElement): void {
    if (!this._inlineMathPopup || !this._inlineMathInput || !this._inlineMathPreview) return;

    this._inlineMathPos = pos;
    this._inlineMathInput.value = latex;

    // Render preview
    if (latex) {
      try {
        katex.render(latex, this._inlineMathPreview, { displayMode: false, throwOnError: false });
      } catch {
        this._inlineMathPreview.textContent = latex;
      }
    } else {
      this._inlineMathPreview.innerHTML = '<span class="canvas-inline-math-preview-empty">Preview</span>';
    }

    // Position below the anchor element
    const rect = anchorEl.getBoundingClientRect();
    const containerRect = this._container.getBoundingClientRect();
    this._inlineMathPopup.style.display = 'flex';

    requestAnimationFrame(() => {
      if (!this._inlineMathPopup) return;
      const popupWidth = this._inlineMathPopup.offsetWidth;
      const left = Math.max(8, rect.left - containerRect.left + rect.width / 2 - popupWidth / 2);
      this._inlineMathPopup.style.left = `${left}px`;
      this._inlineMathPopup.style.top = `${rect.bottom - containerRect.top + 6}px`;
    });

    // Focus the input and select all
    setTimeout(() => {
      this._inlineMathInput?.focus();
      this._inlineMathInput?.select();
    }, 10);
  }

  private _commitInlineMathEdit(): void {
    if (!this._editor || this._inlineMathPos < 0 || !this._inlineMathInput) return;

    const newLatex = this._inlineMathInput.value.trim();
    const node = this._editor.state.doc.nodeAt(this._inlineMathPos);

    if (node && node.type.name === 'inlineMath' && newLatex !== node.attrs.latex) {
      if (newLatex) {
        this._editor.chain()
          .command(({ tr }) => {
            tr.setNodeAttribute(this._inlineMathPos, 'latex', newLatex);
            return true;
          })
          .run();
      } else {
        // Empty latex — remove the node
        this._editor.chain()
          .command(({ tr }) => {
            tr.delete(this._inlineMathPos, this._inlineMathPos + 1);
            return true;
          })
          .run();
      }
    }

    this._hideInlineMathEditor();
  }

  private _hideInlineMathEditor(): void {
    if (!this._inlineMathPopup) return;
    this._inlineMathPopup.style.display = 'none';
    this._inlineMathPos = -1;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Floating Bubble Menu (formatting toolbar on text selection)
  // ══════════════════════════════════════════════════════════════════════════

  private _createBubbleMenu(): void {
    this._bubbleMenu = $('div.canvas-bubble-menu');
    this._bubbleMenu.style.display = 'none';

    // ── Formatting buttons ──
    const buttons: { label: string; title: string; command: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
      {
        label: '<b>B</b>', title: 'Bold (Ctrl+B)',
        command: (e) => e.chain().focus().toggleBold().run(),
        active: (e) => e.isActive('bold'),
      },
      {
        label: '<i>I</i>', title: 'Italic (Ctrl+I)',
        command: (e) => e.chain().focus().toggleItalic().run(),
        active: (e) => e.isActive('italic'),
      },
      {
        label: '<u>U</u>', title: 'Underline (Ctrl+U)',
        command: (e) => e.chain().focus().toggleUnderline().run(),
        active: (e) => e.isActive('underline'),
      },
      {
        label: '<s>S</s>', title: 'Strikethrough',
        command: (e) => e.chain().focus().toggleStrike().run(),
        active: (e) => e.isActive('strike'),
      },
      {
        label: '<code>&lt;/&gt;</code>', title: 'Inline code',
        command: (e) => e.chain().focus().toggleCode().run(),
        active: (e) => e.isActive('code'),
      },
      {
        label: svgIcon('link'), title: 'Link',
        command: () => this._toggleLinkInput(),
        active: (e) => e.isActive('link'),
      },
      {
        label: '<span class="canvas-bubble-highlight-icon">H</span>', title: 'Highlight',
        command: (e) => e.chain().focus().toggleHighlight({ color: '#fef08a' }).run(),
        active: (e) => e.isActive('highlight'),
      },
      {
        label: svgIcon('math'), title: 'Inline equation',
        command: (e) => {
          const { from, to } = e.state.selection;
          const selectedText = e.state.doc.textBetween(from, to);
          const latex = selectedText || 'x';
          e.chain()
            .focus()
            .command(({ tr }) => {
              const mathNode = e.schema.nodes.inlineMath.create({ latex, display: 'no' });
              tr.replaceWith(from, to, mathNode);
              return true;
            })
            .run();
          // Open inline math editor for the newly created node
          this._hideBubbleMenu();
          setTimeout(() => {
            if (!this._editor) return;
            const mathEl = this._editor.view.nodeDOM(from) as HTMLElement | null;
            if (mathEl) {
              this._showInlineMathEditor(from, latex, mathEl);
            } else {
              // Fallback: find via DOM query
              const allMath = this._editorContainer?.querySelectorAll('.tiptap-math.latex');
              if (allMath && allMath.length > 0) {
                const lastMath = allMath[allMath.length - 1] as HTMLElement;
                const pos = this._editor!.view.posAtDOM(lastMath, 0);
                const node = this._editor!.state.doc.nodeAt(pos);
                if (node && node.type.name === 'inlineMath') {
                  this._showInlineMathEditor(pos, node.attrs.latex || '', lastMath);
                }
              }
            }
          }, 50);
        },
        active: (_e) => false,  // inline math is a node, not a mark — never "active"
      },
    ];

    for (const btn of buttons) {
      const el = $('button.canvas-bubble-btn');
      el.innerHTML = btn.label;
      el.title = btn.title;
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();  // prevent editor blur
        if (this._editor) btn.command(this._editor);
        // Refresh active states
        setTimeout(() => { if (this._editor) this._refreshBubbleActiveStates(); }, 10);
      });
      el.dataset.action = btn.title;
      this._bubbleMenu.appendChild(el);
    }

    // ── Link input row (hidden by default) ──
    this._linkInput = $('div.canvas-bubble-link-input');
    this._linkInput.style.display = 'none';
    const linkField = $('input.canvas-bubble-link-field') as HTMLInputElement;
    linkField.type = 'url';
    linkField.placeholder = 'Paste link…';
    const linkApply = $('button.canvas-bubble-link-apply');
    linkApply.textContent = '✓';
    linkApply.title = 'Apply link';
    const linkRemove = $('button.canvas-bubble-link-remove');
    linkRemove.innerHTML = svgIcon('close');
    const lrSvg = linkRemove.querySelector('svg');
    if (lrSvg) { lrSvg.setAttribute('width', '12'); lrSvg.setAttribute('height', '12'); }
    linkRemove.title = 'Remove link';

    linkApply.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const url = linkField.value.trim();
      if (url && this._editor) {
        this._editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
      this._linkInput!.style.display = 'none';
    });

    linkRemove.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      if (this._editor) {
        this._editor.chain().focus().extendMarkRange('link').unsetLink().run();
      }
      this._linkInput!.style.display = 'none';
      linkField.value = '';
    });

    linkField.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        linkApply.click();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this._linkInput!.style.display = 'none';
      }
    });

    this._linkInput.appendChild(linkField);
    this._linkInput.appendChild(linkApply);
    this._linkInput.appendChild(linkRemove);
    this._bubbleMenu.appendChild(this._linkInput);

    this._container.appendChild(this._bubbleMenu);
  }

  private _toggleLinkInput(): void {
    if (!this._linkInput || !this._editor) return;
    const visible = this._linkInput.style.display !== 'none';
    if (visible) {
      this._linkInput.style.display = 'none';
    } else {
      this._linkInput.style.display = 'flex';
      const field = this._linkInput.querySelector('input') as HTMLInputElement;
      // Pre-fill with existing link href
      const attrs = this._editor.getAttributes('link');
      field.value = attrs.href ?? '';
      field.focus();
      field.select();
    }
  }

  private _updateBubbleMenu(editor: Editor): void {
    if (!this._bubbleMenu) return;

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      this._hideBubbleMenu();
      return;
    }

    // Don't show for code blocks or node selections
    const { $from } = editor.state.selection;
    if ($from.parent.type.name === 'codeBlock') {
      this._hideBubbleMenu();
      return;
    }

    // Position above selection
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const midX = (start.left + end.left) / 2;
    const topY = Math.min(start.top, end.top);

    this._bubbleMenu.style.display = 'flex';

    // Wait for layout to get accurate width
    requestAnimationFrame(() => {
      if (!this._bubbleMenu) return;
      const menuWidth = this._bubbleMenu.offsetWidth;
      this._bubbleMenu.style.left = `${Math.max(8, midX - menuWidth / 2)}px`;
      this._bubbleMenu.style.top = `${topY - this._bubbleMenu.offsetHeight - 8}px`;
    });

    this._refreshBubbleActiveStates();
    // Hide link input when selection changes
    if (this._linkInput) this._linkInput.style.display = 'none';
  }

  private _refreshBubbleActiveStates(): void {
    if (!this._bubbleMenu || !this._editor) return;
    const buttons = this._bubbleMenu.querySelectorAll('.canvas-bubble-btn');
    const activeChecks = [
      (e: Editor) => e.isActive('bold'),
      (e: Editor) => e.isActive('italic'),
      (e: Editor) => e.isActive('underline'),
      (e: Editor) => e.isActive('strike'),
      (e: Editor) => e.isActive('code'),
      (e: Editor) => e.isActive('link'),
      (e: Editor) => e.isActive('highlight'),
      (_e: Editor) => false,  // inline equation — node, never "active" as toggle
    ];
    buttons.forEach((btn, i) => {
      if (i < activeChecks.length) {
        btn.classList.toggle('canvas-bubble-btn--active', activeChecks[i](this._editor!));
      }
    });
  }

  private _hideBubbleMenu(): void {
    if (!this._bubbleMenu) return;
    this._bubbleMenu.style.display = 'none';
    if (this._linkInput) this._linkInput.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Slash Command Menu (Task 5.4)
  // ══════════════════════════════════════════════════════════════════════════

  private _createSlashMenu(): void {
    this._slashMenu = $('div.canvas-slash-menu');
    this._slashMenu.style.display = 'none';
    this._container.appendChild(this._slashMenu);
  }

  private _checkSlashTrigger(editor: Editor): void {
    const { state } = editor;
    const { $from } = state.selection;

    // Only trigger at the start of an empty or text-only paragraph
    if (!$from.parent.isTextblock) {
      this._hideSlashMenu();
      return;
    }

    const text = $from.parent.textContent;

    // Look for '/' at the start of the line
    if (text.startsWith('/')) {
      this._slashFilterText = text.slice(1).toLowerCase();
      this._showSlashMenu(editor);
    } else {
      this._hideSlashMenu();
    }
  }

  private _showSlashMenu(editor: Editor): void {
    if (!this._slashMenu) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) {
      this._hideSlashMenu();
      return;
    }

    this._slashSelectedIndex = 0;
    this._slashMenuVisible = true;
    this._renderSlashMenuItems(filtered, editor);

    // Position below cursor
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    this._slashMenu.style.display = 'block';
    this._slashMenu.style.left = `${coords.left}px`;
    this._slashMenu.style.top = `${coords.bottom + 4}px`;

    // Keyboard handler for menu
    if (!this._slashMenu.dataset.listening) {
      this._slashMenu.dataset.listening = '1';
      editor.view.dom.addEventListener('keydown', this._handleSlashKeydown);
    }
  }

  private _hideSlashMenu(): void {
    if (!this._slashMenu || !this._slashMenuVisible) return;
    this._slashMenu.style.display = 'none';
    this._slashMenuVisible = false;
    this._slashFilterText = '';
    if (this._editor) {
      this._editor.view.dom.removeEventListener('keydown', this._handleSlashKeydown);
      delete this._slashMenu.dataset.listening;
    }
  }

  private _getFilteredItems(): SlashMenuItem[] {
    let items = SLASH_MENU_ITEMS;

    // Hide column items when already inside a column (prevent nesting)
    if (this._editor) {
      const { $from } = this._editor.state.selection;
      let insideColumn = false;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'column') { insideColumn = true; break; }
      }
      if (insideColumn) {
        items = items.filter(i => !i.label.includes('Columns'));
      }
    }

    if (!this._slashFilterText) return items;
    const q = this._slashFilterText.replace(/[^a-z0-9]/g, '');
    return items.filter(item => {
      const label = item.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      const desc = item.description.toLowerCase().replace(/[^a-z0-9]/g, '');
      return label.includes(q) || desc.includes(q);
    });
  }

  private _renderSlashMenuItems(items: SlashMenuItem[], editor: Editor): void {
    if (!this._slashMenu) return;
    this._slashMenu.innerHTML = '';

    items.forEach((item, index) => {
      const row = $('div.canvas-slash-item');
      if (index === this._slashSelectedIndex) {
        row.classList.add('canvas-slash-item--selected');
      }

      const iconEl = $('span.canvas-slash-icon');
      // Render SVG icon if available, otherwise use text
      const knownIcons = ['checklist','quote','code','divider','lightbulb','chevron-right','grid','image','bullet-list','numbered-list','math','math-block'];
      if (knownIcons.includes(item.icon)) {
        iconEl.innerHTML = svgIcon(item.icon as any);
        const svg = iconEl.querySelector('svg');
        if (svg) { svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); }
      } else {
        iconEl.textContent = item.icon;
      }
      row.appendChild(iconEl);

      const textEl = $('div.canvas-slash-text');
      const labelEl = $('div.canvas-slash-label');
      labelEl.textContent = item.label;
      const descEl = $('div.canvas-slash-desc');
      descEl.textContent = item.description;
      textEl.appendChild(labelEl);
      textEl.appendChild(descEl);
      row.appendChild(textEl);

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._executeSlashItem(item, editor);
      });

      row.addEventListener('mouseenter', () => {
        this._slashSelectedIndex = index;
        // Update selection highlight without rebuilding DOM
        const rows = this._slashMenu!.querySelectorAll('.canvas-slash-item');
        rows.forEach((r, i) => {
          r.classList.toggle('canvas-slash-item--selected', i === index);
        });
      });

      this._slashMenu!.appendChild(row);
    });
  }

  private readonly _handleSlashKeydown = (e: KeyboardEvent): void => {
    if (!this._slashMenuVisible || !this._editor) return;

    const filtered = this._getFilteredItems();
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._slashSelectedIndex = (this._slashSelectedIndex + 1) % filtered.length;
      this._renderSlashMenuItems(filtered, this._editor);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._slashSelectedIndex = (this._slashSelectedIndex - 1 + filtered.length) % filtered.length;
      this._renderSlashMenuItems(filtered, this._editor);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._executeSlashItem(filtered[this._slashSelectedIndex], this._editor);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._hideSlashMenu();
    }
  };

  private _executeSlashItem(item: SlashMenuItem, editor: Editor): void {
    // Suppress onUpdate to prevent _checkSlashTrigger from firing mid-execution
    this._suppressUpdate = true;

    try {
      // Compute the BLOCK-LEVEL range covering the entire paragraph node
      // (the one containing the '/filter' text).  Each action uses
      // insertContentAt(range, nodeJSON) to atomically REPLACE the paragraph.
      // This is the same pattern TipTap's own setDetails() uses internally.
      const { $from, $to } = editor.state.selection;
      const blockRange = $from.blockRange($to);
      if (!blockRange) return;

      item.action(editor, { from: blockRange.start, to: blockRange.end });
    } finally {
      this._suppressUpdate = false;
    }

    // Manually schedule save since onUpdate was suppressed
    const json = JSON.stringify(editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);

    this._hideSlashMenu();

    // Auto-open inline math editor if an inline equation was just inserted
    if (item.label === 'Inline Equation') {
      setTimeout(() => {
        if (!this._editor) return;
        const allMath = this._editorContainer?.querySelectorAll('.tiptap-math.latex');
        if (allMath && allMath.length > 0) {
          const lastMath = allMath[allMath.length - 1] as HTMLElement;
          const pos = this._editor.view.posAtDOM(lastMath, 0);
          const node = this._editor.state.doc.nodeAt(pos);
          if (node && node.type.name === 'inlineMath') {
            this._showInlineMathEditor(pos, node.attrs.latex || '', lastMath);
          }
        }
      }, 80);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Block Handles — Plus Button (+) and Block Action Menu
  // ══════════════════════════════════════════════════════════════════════════

  private _setupBlockHandles(): void {
    if (!this._editorContainer || !this._editor) return;

    // Find the drag handle element created by GlobalDragHandle
    this._dragHandleEl = this._editorContainer.querySelector('.drag-handle') as HTMLElement;
    if (!this._dragHandleEl) return;

    // ── Create + button ──
    this._blockAddBtn = document.createElement('div');
    this._blockAddBtn.className = 'block-add-btn hide';
    this._blockAddBtn.innerHTML = svgIcon('plus');
    const svg = this._blockAddBtn.querySelector('svg');
    if (svg) { svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); }
    this._blockAddBtn.title = 'Click to add below\nAlt-click to add a block above';
    this._editorContainer.appendChild(this._blockAddBtn);

    // ── Position + button alongside drag handle via MutationObserver ──
    this._handleObserver = new MutationObserver(() => {
      if (!this._dragHandleEl || !this._blockAddBtn) return;
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

    // ── Prevent drag handle from hiding when mouse moves to the + button ──
    // The library's `hideHandleOnEditorOut` listens for `mouseout` on the
    // editor wrapper and hides the drag handle when relatedTarget isn't
    // `.tiptap` or `.drag-handle`. We intercept that event in the
    // capture phase so the + button is treated as part of the editor.
    this._editorContainer.addEventListener('mouseout', this._onEditorMouseOut, true);

    // ── Create block action menu (hidden by default) ──
    this._createBlockActionMenu();

    // ── Close menu on outside clicks ──
    document.addEventListener('mousedown', this._onDocClickOutside);
  }

  /** Intercept mouseout on the editor wrapper so the drag handle library
   *  doesn't hide the handle when the mouse moves to the + button. */
  private readonly _onEditorMouseOut = (event: MouseEvent): void => {
    const related = event.relatedTarget as HTMLElement | null;
    if (
      related &&
      (related.classList.contains('block-add-btn') || related.closest('.block-add-btn'))
    ) {
      event.stopPropagation();
    }
  };

  /**
   * Find the block the drag handle is currently next to.
   *
   * Replicates the library's `nodeDOMAtCoords` logic to find which DOM
   * element the handle was positioned for, then maps that to a ProseMirror
   * position.  Handles BOTH:
   *  • Top-level blocks (resolved to depth 1)
   *  • Blocks inside columns (resolved to direct child of the column)
   *  • The columnList itself (when the library matched [data-type=columnList])
   */
  private _resolveBlockFromHandle(): { pos: number; node: any } | null {
    if (!this._editor || !this._dragHandleEl) return null;
    const view = this._editor.view;

    const handleRect = this._dragHandleEl.getBoundingClientRect();
    const handleY = handleRect.top + handleRect.height / 2;

    // Replicate the library's coordinate scan.
    // The library scans at (event.clientX + 50 + dragHandleWidth, event.clientY).
    // The handle's left = foundNode.left − dragHandleWidth.
    // So foundNode.left ≈ handleRect.left + dragHandleWidth.
    // Scan at foundNode.left + 50 + dragHandleWidth ≈ handleRect.left + 2×24 + 50.
    // Simplified: just probe well into the content area past the handle.
    const scanX = handleRect.right + 50;

    // Match the same selectors the library uses (including our patch).
    const selectors = [
      'li', 'p:not(:first-child)', '.canvas-column > p',
      'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      '[data-type=mathBlock]', '[data-type=columnList]',
      '[data-type=callout]',
    ].join(', ');

    const matchedEl = document.elementsFromPoint(scanX, handleY)
      .find((el: Element) =>
        el.parentElement?.matches?.('.ProseMirror') ||
        el.matches(selectors),
      );

    if (!matchedEl) {
      // Fallback: walk direct children of .ProseMirror.
      return this._resolveBlockFallback(handleY);
    }

    try {
      const domPos = view.posAtDOM(matchedEl, 0);
      const $pos = view.state.doc.resolve(domPos);

      // CASE 1: Matched element is a direct child of .ProseMirror
      // → this is a top-level block. Resolve to depth 1.
      // SPECIAL: if the resolved node is a columnList, drill into the
      //   first block of the first column — because a columnList is an
      //   invisible spatial container, NOT a block the user interacts with.
      if (matchedEl.parentElement?.matches?.('.ProseMirror')) {
        const blockPos = $pos.depth >= 1 ? $pos.before(1) : domPos;
        const node = view.state.doc.nodeAt(blockPos);
        if (!node) return null;
        if (node.type.name === 'columnList') {
          // Drill: columnList → first column → first block
          const firstCol = node.firstChild;
          if (firstCol && firstCol.type.name === 'column' && firstCol.childCount > 0) {
            const innerPos = blockPos + 1 /* enter columnList */ + 1 /* enter column */;
            const innerNode = view.state.doc.nodeAt(innerPos);
            return innerNode ? { pos: innerPos, node: innerNode } : { pos: blockPos, node };
          }
        }
        return { pos: blockPos, node };
      }

      // CASE 2: Matched element is inside a column
      // → resolve to the direct child of the column.
      const columnEl = matchedEl.closest('.canvas-column');
      if (columnEl) {
        for (let d = $pos.depth; d >= 1; d--) {
          if ($pos.node(d).type.name === 'column') {
            const targetDepth = d + 1;
            if ($pos.depth >= targetDepth) {
              const blockPos = $pos.before(targetDepth);
              const node = view.state.doc.nodeAt(blockPos);
              return node ? { pos: blockPos, node } : null;
            }
            break;
          }
        }
      }

      // CASE 3: Other matched element — resolve to depth 1.
      const blockPos = $pos.depth >= 1 ? $pos.before(1) : domPos;
      const node = view.state.doc.nodeAt(blockPos);
      return node ? { pos: blockPos, node } : null;
    } catch {
      return this._resolveBlockFallback(handleY);
    }
  }

  /** Fallback resolution: walk direct children of .ProseMirror by Y position. */
  private _resolveBlockFallback(handleY: number): { pos: number; node: any } | null {
    if (!this._editor) return null;
    const view = this._editor.view;
    const editorEl = view.dom;
    for (let i = 0; i < editorEl.children.length; i++) {
      const child = editorEl.children[i];
      const rect = child.getBoundingClientRect();
      if (handleY >= rect.top && handleY <= rect.bottom) {
        try {
          const domPos = view.posAtDOM(child, 0);
          const $pos = view.state.doc.resolve(domPos);
          const blockPos = $pos.depth >= 1 ? $pos.before(1) : domPos;
          const node = view.state.doc.nodeAt(blockPos);
          return node ? { pos: blockPos, node } : null;
        } catch { continue; }
      }
    }
    return null;
  }

  // ── Plus Button Click ──

  private readonly _onBlockAddClick = (e: MouseEvent): void => {
    if (!this._editor) return;
    const block = this._resolveBlockFromHandle();
    if (!block) return;
    const { pos, node } = block;
    const isAbove = e.altKey;
    const insertPos = isAbove ? pos : pos + node.nodeSize;
    // Insert paragraph with '/' to trigger slash menu
    this._editor.chain()
      .insertContentAt(insertPos, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
      .setTextSelection(insertPos + 2)
      .focus()
      .run();
  };

  // ── Drag Handle Click → Block Action Menu ──

  private readonly _onDragHandleClick = (_e: MouseEvent): void => {
    if (!this._editor) return;
    if (this._blockActionMenu?.style.display === 'block') {
      this._hideBlockActionMenu();
      return;
    }
    const block = this._resolveBlockFromHandle();
    if (!block) return;
    this._actionBlockPos = block.pos;
    this._actionBlockNode = block.node;
    this._showBlockActionMenu();
  };

  private readonly _onDocClickOutside = (e: MouseEvent): void => {
    if (!this._blockActionMenu || this._blockActionMenu.style.display !== 'block') return;
    const target = e.target as HTMLElement;
    if (this._blockActionMenu.contains(target)) return;
    if (this._turnIntoSubmenu?.contains(target)) return;
    if (this._colorSubmenu?.contains(target)) return;
    if (this._dragHandleEl?.contains(target)) return;
    this._hideBlockActionMenu();
  };

  // ── Block Action Menu ──

  private _createBlockActionMenu(): void {
    this._blockActionMenu = $('div.block-action-menu');
    this._blockActionMenu.style.display = 'none';
    this._container.appendChild(this._blockActionMenu);
  }

  private _showBlockActionMenu(): void {
    if (!this._blockActionMenu || !this._dragHandleEl || !this._actionBlockNode) return;
    this._blockActionMenu.innerHTML = '';

    // Header — block type label
    const header = $('div.block-action-header');
    header.textContent = this._getBlockLabel(this._actionBlockNode.type.name);
    this._blockActionMenu.appendChild(header);

    // Turn into — available for all blocks (blocks are blocks regardless of location)
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

  // ── Turn Into Submenu ──

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
      this._container.appendChild(this._turnIntoSubmenu);
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

  // ── Color Submenu ──

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
      this._container.appendChild(this._colorSubmenu);
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

  // ── Block Transform Execution ──

  private _turnBlockInto(targetType: string, attrs?: any): void {
    if (!this._editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const editor = this._editor;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    const srcType = node.type.name;
    this._hideBlockActionMenu();
    if (this._isCurrentBlockType(targetType, attrs)) return;

    // For simple text blocks (paragraph, heading) → simple targets, use TipTap commands
    const simpleTextBlock = ['paragraph', 'heading'].includes(srcType);
    const simpleTarget = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock'].includes(targetType);

    if (simpleTextBlock && simpleTarget) {
      try {
        editor.chain().setTextSelection(pos + 1).run();
        switch (targetType) {
          case 'paragraph': editor.chain().setParagraph().focus().run(); break;
          case 'heading': editor.chain().setHeading(attrs).focus().run(); break;
          case 'bulletList': editor.chain().toggleBulletList().focus().run(); break;
          case 'orderedList': editor.chain().toggleOrderedList().focus().run(); break;
          case 'taskList': editor.chain().toggleTaskList().focus().run(); break;
          case 'blockquote': editor.chain().toggleBlockquote().focus().run(); break;
          case 'codeBlock': editor.chain().toggleCodeBlock().focus().run(); break;
        }
      } catch {
        this._turnBlockViaReplace(pos, node, targetType, attrs);
      }
    } else {
      this._turnBlockViaReplace(pos, node, targetType, attrs);
    }

    const json = JSON.stringify(editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);
  }

  private _turnBlockViaReplace(pos: number, node: any, targetType: string, attrs?: any): void {
    if (!this._editor) return;
    const content = this._extractBlockContent(node);
    const textContent = node.textContent || '';
    let newBlock: any;
    switch (targetType) {
      case 'paragraph':
        newBlock = { type: 'paragraph', content };
        break;
      case 'heading':
        newBlock = { type: 'heading', attrs, content };
        break;
      case 'bulletList':
        newBlock = { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content }] }] };
        break;
      case 'orderedList':
        newBlock = { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content }] }] };
        break;
      case 'taskList':
        newBlock = { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content }] }] };
        break;
      case 'blockquote':
        newBlock = { type: 'blockquote', content: [{ type: 'paragraph', content }] };
        break;
      case 'codeBlock':
        newBlock = { type: 'codeBlock', content: textContent ? [{ type: 'text', text: textContent }] : [] };
        break;
      case 'callout':
        newBlock = { type: 'callout', attrs: { emoji: 'lightbulb' }, content: [{ type: 'paragraph', content }] };
        break;
      case 'details':
        newBlock = { type: 'details', content: [
          { type: 'detailsSummary', content },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ]};
        break;
      case 'mathBlock':
        newBlock = { type: 'mathBlock', attrs: { latex: textContent } };
        break;
      default: return;
    }
    this._editor.chain()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, newBlock)
      .focus()
      .run();
  }

  /** Extract inline content (text + marks) from the first textblock inside a node. */
  private _extractBlockContent(node: any): any[] {
    if (node.isTextblock) return node.content.toJSON() || [];
    let result: any[] = [];
    node.descendants((child: any) => {
      if (child.isTextblock && result.length === 0) {
        result = child.content.toJSON() || [];
        return false;
      }
      return true;
    });
    if (result.length === 0 && node.textContent) {
      result = [{ type: 'text', text: node.textContent }];
    }
    return result;
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

  // ── Color Application ──

  private _applyBlockTextColor(value: string | null): void {
    if (!this._editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (from >= to) return;
    if (value) {
      this._editor.chain().setTextSelection({ from, to }).setColor(value).focus().run();
    } else {
      this._editor.chain().setTextSelection({ from, to }).unsetColor().focus().run();
    }
    const json = JSON.stringify(this._editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);
  }

  private _applyBlockBgColor(value: string | null): void {
    if (!this._editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    // Set block-level backgroundColor attribute (not text highlight).
    // This paints the entire block DOM element — matching Notion's behavior.
    const tr = this._editor.view.state.tr;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: value });
    this._editor.view.dispatch(tr);
    this._editor.commands.focus();
    const json = JSON.stringify(this._editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);
  }

  // ── Duplicate / Delete ──

  private _duplicateBlock(): void {
    if (!this._editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    const json = node.toJSON();
    this._editor.chain().insertContentAt(pos + node.nodeSize, json).focus().run();
    const docJson = JSON.stringify(this._editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, docJson);
  }

  private _deleteBlock(): void {
    if (!this._editor || this._actionBlockPos < 0 || !this._actionBlockNode) return;
    const pos = this._actionBlockPos;
    const node = this._actionBlockNode;
    this._hideBlockActionMenu();
    this._editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).focus().run();
    const json = JSON.stringify(this._editor.getJSON());
    this._dataService.scheduleContentSave(this._pageId, json);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Dispose
  // ══════════════════════════════════════════════════════════════════════════

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._hideSlashMenu();
    this._hideBubbleMenu();
    this._hideBlockActionMenu();
    this._dismissPopups();

    // Block handles cleanup
    this._handleObserver?.disconnect();
    this._handleObserver = null;
    document.removeEventListener('mousedown', this._onDocClickOutside);
    this._editorContainer?.removeEventListener('mouseout', this._onEditorMouseOut, true);
    if (this._blockAddBtn) { this._blockAddBtn.remove(); this._blockAddBtn = null; }
    if (this._blockActionMenu) { this._blockActionMenu.remove(); this._blockActionMenu = null; }
    if (this._turnIntoSubmenu) { this._turnIntoSubmenu.remove(); this._turnIntoSubmenu = null; }
    if (this._colorSubmenu) { this._colorSubmenu.remove(); this._colorSubmenu = null; }
    this._dragHandleEl = null;
    this._actionBlockNode = null;

    // Cancel pending title save
    if (this._titleSaveTimer) clearTimeout(this._titleSaveTimer);

    // Dispose save-state subscriptions
    for (const d of this._saveDisposables) d.dispose();
    this._saveDisposables.length = 0;

    if (this._editor) {
      this._editor.destroy();
      this._editor = null;
    }

    if (this._editorContainer) {
      this._editorContainer.remove();
      this._editorContainer = null;
    }

    if (this._slashMenu) {
      this._slashMenu.remove();
      this._slashMenu = null;
    }

    if (this._bubbleMenu) {
      this._bubbleMenu.remove();
      this._bubbleMenu = null;
    }

    if (this._inlineMathPopup) {
      this._inlineMathPopup.remove();
      this._inlineMathPopup = null;
    }
    this._inlineMathInput = null;
    this._inlineMathPreview = null;

    this._topRibbon = null;
    this._ribbonFavoriteBtn = null;
    this._ribbonEditedLabel = null;
    this._pageHeader = null;
    this._coverEl = null;
    this._coverControls = null;
    this._breadcrumbsEl = null;
    this._iconEl = null;
    this._titleEl = null;
    this._hoverAffordances = null;
    this._pageMenuBtn = null;
    this._currentPage = null;
  }
}
