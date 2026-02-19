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
import { BlockKeyboardShortcuts } from '../extensions/blockKeyboardShortcuts.js';
import { StructuralInvariantGuard } from '../extensions/structuralInvariantGuard.js';
import { MathBlock } from '../extensions/mathBlockNode.js';
import { ToggleHeading, ToggleHeadingText } from '../extensions/toggleHeadingNode.js';
import { Bookmark } from '../extensions/bookmarkNode.js';
import { TableOfContents } from '../extensions/tableOfContentsNode.js';
import { Video, Audio, FileAttachment } from '../extensions/mediaNodes.js';
import { PageBlock } from '../extensions/pageBlockNode.js';
import type { CanvasDataService } from '../canvasDataService.js';
import type { OpenEditorFn } from '../canvasEditorProvider.js';
import { DRAG_HANDLE_CUSTOM_NODE_TYPES } from './blockCapabilities.js';

import type { Extensions } from '@tiptap/core';

/**
 * Build the full set of TipTap extensions for a canvas editor instance.
 * @param lowlight - Pre-configured lowlight instance for syntax highlighting
 */
export interface EditorExtensionContext {
  readonly dataService?: CanvasDataService;
  readonly pageId?: string;
  readonly openEditor?: OpenEditorFn;
}

export function createEditorExtensions(lowlight: any, context?: EditorExtensionContext): Extensions {
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
      // Canvas provides its own drag/drop guides via columnDropPlugin.
      // Keep ProseMirror dropcursor disabled to avoid double indicators.
      dropcursor: false,
    }),
    Placeholder.configure({
      placeholder: ({ node, pos, editor, hasAnchor }: { node: any; pos: number; editor: any; hasAnchor: boolean }) => {
        if (node.type.name === 'heading') {
          return `Heading ${node.attrs.level}`;
        }
        if (node.type.name === 'detailsSummary') {
          return 'Toggle title…';
        }
        if (node.type.name === 'toggleHeadingText') {
          return 'Toggle heading';
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
      // columnList intentionally excluded — per Rule 10, columnList has no
      // drag handle. Blocks inside columns are still draggable via their own
      // selectors (p, h1-h6, etc. + .canvas-column > p).
      customNodes: [...DRAG_HANDLE_CUSTOM_NODE_TYPES],
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
    BlockKeyboardShortcuts,
    StructuralInvariantGuard,
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
    // ── Phase 3 blocks ──
    ToggleHeading,
    ToggleHeadingText,
    Bookmark,
    PageBlock.configure({
      dataService: context?.dataService,
      currentPageId: context?.pageId,
      openEditor: context?.openEditor,
    }),
    TableOfContents,
    Video,
    Audio,
    FileAttachment,
  ];
}
