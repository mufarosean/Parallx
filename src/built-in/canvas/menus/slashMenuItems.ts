// slashMenuItems.ts — Slash command menu item definitions
//
// Each action receives the editor and the **block range** covering the
// entire paragraph node (including its boundaries).  Actions use
// `insertContentAt(range, nodeJSON)` to atomically REPLACE the paragraph
// with the desired block structure — this is the same pattern TipTap's
// own `setDetails()` command uses internally.  NO deleteRange needed.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { showImageInsertPopup } from './imageInsertPopup.js';
import { showMediaInsertPopup } from './mediaInsertPopup.js';
import { showBookmarkInsertPopup } from './bookmarkInsertPopup.js';

export interface SlashMenuItem {
  label: string;
  icon: string;
  description: string;
  action: (editor: Editor, range: { from: number; to: number }) => void;
}

function replaceBlockWithColumns(editor: Editor, range: { from: number; to: number }, columnCount: number): void {
  const { schema } = editor.state;
  const columnType = schema.nodes.column;
  const columnListType = schema.nodes.columnList;
  const paragraphType = schema.nodes.paragraph;

  if (!columnType || !columnListType || !paragraphType || columnCount < 2) {
    return;
  }

  const columns: any[] = [];
  for (let i = 0; i < columnCount; i++) {
    const paragraph = paragraphType.createAndFill();
    if (!paragraph) return;
    columns.push(columnType.create({ width: null }, [paragraph]));
  }

  const columnList = columnListType.create(null, columns);
  const tr = editor.state.tr.replaceWith(range.from, range.to, columnList);
  const selectionPos = Math.min(range.from + 3, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), 1));
  editor.view.dispatch(tr);
  editor.commands.focus();
}

export const SLASH_MENU_ITEMS: SlashMenuItem[] = [
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
    label: 'Image', icon: 'image', description: 'Upload or embed an image',
    action: (e, range) => {
      showImageInsertPopup(e, range);
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
      replaceBlockWithColumns(e, range, 2);
    },
  },
  {
    label: '3 Columns', icon: 'columns', description: 'Split into 3 columns',
    action: (e, range) => {
      replaceBlockWithColumns(e, range, 3);
    },
  },
  {
    label: '4 Columns', icon: 'columns', description: 'Split into 4 columns',
    action: (e, range) => {
      replaceBlockWithColumns(e, range, 4);
    },
  },
  // ── Toggle Headings ──
  {
    label: 'Toggle Heading 1', icon: 'chevron-right', description: 'Collapsible large heading',
    action: (e, range) => {
      e.chain().insertContentAt(range, {
        type: 'toggleHeading',
        attrs: { level: 1 },
        content: [
          { type: 'toggleHeadingText' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }).run();
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'toggleHeadingText') {
          e.chain().setTextSelection(pos + 1).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  {
    label: 'Toggle Heading 2', icon: 'chevron-right', description: 'Collapsible medium heading',
    action: (e, range) => {
      e.chain().insertContentAt(range, {
        type: 'toggleHeading',
        attrs: { level: 2 },
        content: [
          { type: 'toggleHeadingText' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }).run();
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'toggleHeadingText') {
          e.chain().setTextSelection(pos + 1).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  {
    label: 'Toggle Heading 3', icon: 'chevron-right', description: 'Collapsible small heading',
    action: (e, range) => {
      e.chain().insertContentAt(range, {
        type: 'toggleHeading',
        attrs: { level: 3 },
        content: [
          { type: 'toggleHeadingText' },
          { type: 'detailsContent', content: [{ type: 'paragraph' }] },
        ],
      }).run();
      const { doc } = e.state;
      doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
        if (node.type.name === 'toggleHeadingText') {
          e.chain().setTextSelection(pos + 1).focus().run();
          return false;
        }
        return true;
      });
    },
  },
  // ── Advanced blocks ──
  {
    label: 'Bookmark', icon: 'globe', description: 'Link preview card',
    action: (e, range) => {
      showBookmarkInsertPopup(e, range);
    },
  },
  {
    label: 'Table of Contents', icon: 'toc', description: 'Auto-generated from headings',
    action: (e, range) => {
      e.chain().insertContentAt(range, { type: 'tableOfContents' }).focus().run();
    },
  },
  // ── Media ──
  {
    label: 'Video', icon: 'video', description: 'Embed a video',
    action: (e, range) => {
      showMediaInsertPopup(e, range, 'video');
    },
  },
  {
    label: 'Audio', icon: 'audio', description: 'Embed audio',
    action: (e, range) => {
      showMediaInsertPopup(e, range, 'audio');
    },
  },
  {
    label: 'File', icon: 'file-attachment', description: 'Attach a file',
    action: (e, range) => {
      showMediaInsertPopup(e, range, 'fileAttachment');
    },
  },
];
