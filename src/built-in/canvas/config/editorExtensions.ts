// editorExtensions.ts — TipTap editor extension configuration
//
// Factory function that returns the fully configured array of TipTap extensions
// for the canvas editor. Mirrors Notion's feature set.

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import GlobalDragHandle from 'tiptap-extension-global-drag-handle';
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CharacterCount from '@tiptap/extension-character-count';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import { InlineMathNode } from '@aarkue/tiptap-math-extension';
import { BlockBackgroundColor } from '../extensions/blockBackground.js';
import { Callout } from '../extensions/calloutNode.js';
import { Column, ColumnList } from '../extensions/columnNodes.js';
import { DetailsEnterHandler } from '../extensions/detailsEnterHandler.js';
import { MathBlock } from '../extensions/mathBlockNode.js';

import type { Extensions } from '@tiptap/core';

/**
 * Build the full set of TipTap extensions for a canvas editor instance.
 * @param lowlight - Pre-configured lowlight instance for syntax highlighting
 */
export function createEditorExtensions(lowlight: any): Extensions {
  return [
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
    }),
    Placeholder.configure({
      placeholder: ({ node, pos, editor, hasAnchor }: { node: any; pos: number; editor: any; hasAnchor: boolean }) => {
        if (node.type.name === 'heading') {
          return `Heading ${node.attrs.level}`;
        }
        if (node.type.name === 'detailsSummary') {
          return 'Toggle title…';
        }
        if (node.type.name !== 'paragraph') {
          return '';
        }
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
        return hasAnchor ? "Type '/' for commands..." : '';
      },
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
  ];
}
