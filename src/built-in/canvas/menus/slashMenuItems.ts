// slashMenuItems.ts — Slash command menu item definitions
//
// Each action receives the editor and the **block range** covering the
// entire paragraph node (including its boundaries).  Actions use
// `insertContentAt(range, nodeJSON)` to atomically REPLACE the paragraph
// with the desired block structure — this is the same pattern TipTap's
// own `setDetails()` command uses internally.  NO deleteRange needed.

import type { Editor } from '@tiptap/core';

export interface SlashMenuItem {
  label: string;
  icon: string;
  description: string;
  action: (editor: Editor, range: { from: number; to: number }) => void;
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
