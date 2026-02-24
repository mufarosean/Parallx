// tiptapExtensions.ts — Tiptap extension assembly
//
// Factory function that returns the fully configured array of Tiptap extensions
// for the canvas editor. Block extensions are loaded from the block registry
// (single entry point). Infrastructure extensions (marks, plugins, utilities)
// are loaded directly here.

import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import CharacterCount from '@tiptap/extension-character-count';
import AutoJoiner from 'tiptap-extension-auto-joiner';
import UniqueID from '@tiptap/extension-unique-id';
import { BlockBackgroundColor } from '../extensions/blockBackground.js';
import { DetailsEnterHandler } from '../extensions/detailsEnterHandler.js';
import { BlockKeyboardShortcuts } from '../extensions/blockKeyboardShortcuts.js';
import { structuralInvariantPlugin } from '../plugins/structuralInvariantPlugin.js';
import {
  getNodePlaceholder,
  getBlockExtensions,
} from './blockRegistry.js';
import type { EditorExtensionContext } from './blockRegistry.js';

import type { Extensions } from '@tiptap/core';
import { Extension } from '@tiptap/core';

/**
 * Every block-level node type that receives a persistent unique ID via
 * `@tiptap/extension-unique-id`.
 *
 * Criteria: all ProseMirror node types that represent user-visible blocks or
 * their structural children (containers, list items, table cells, etc.).
 * Inline-only types (text, inlineMath, hardBreak) are excluded.
 */
const UNIQUE_ID_BLOCK_TYPES: string[] = [
  // ── StarterKit blocks ──
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',

  // ── Content blocks (registry) ──
  'codeBlock',
  'image',
  'taskList',
  'taskItem',
  'callout',
  'mathBlock',
  'toggleHeading',
  'toggleHeadingText',
  'details',
  'detailsSummary',
  'detailsContent',
  'bookmark',
  'pageBlock',
  'tableOfContents',
  'video',
  'audio',
  'fileAttachment',

  // ── Table nodes ──
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',

  // ── Column nodes ──
  'columnList',
  'column',
];

/**
 * Build the full set of TipTap extensions for a canvas editor instance.
 *
 * Extension sources:
 *   1. StarterKit         — bundled blocks (paragraph, heading, lists, etc.)
 *   2. Block registry      — all non-StarterKit block extensions via factories
 *   3. Infrastructure      — marks, plugins, utilities (Placeholder, DragHandle, etc.)
 *
 * @param lowlight - Pre-configured lowlight instance for syntax highlighting
 */
export function createEditorExtensions(lowlight: any, context?: EditorExtensionContext): Extensions {
  const registryContext: EditorExtensionContext = { lowlight, ...context };

  return [
    // ── 1. StarterKit (bundled blocks) ──
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,  // Replaced by CodeBlockLowlight via registry
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

    // ── 2. Block extensions from registry ──
    ...getBlockExtensions(registryContext),

    // ── 3. Infrastructure (marks, plugins, utilities) ──
    Placeholder.configure({
      placeholder: ({ node, pos, editor, hasAnchor }: { node: any; pos: number; editor: any; hasAnchor: boolean }) => {
        // Check registry for a direct node placeholder (heading, detailsSummary, toggleHeadingText, etc.).
        const registryPlaceholder = getNodePlaceholder(node.type.name, node.attrs);
        if (registryPlaceholder !== undefined) return registryPlaceholder;

        // Non-paragraph nodes without a registry entry get no placeholder.
        if (node.type.name !== 'paragraph') return '';

        // Paragraph — walk ancestors for context-dependent placeholder.
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
    TextStyle,
    Color,
    Highlight.configure({
      multicolor: true,
    }),
    // GlobalDragHandle removed — block handle positioning is now owned by
    // BlockHandlesController (handles/blockHandles.ts), which resolves blocks
    // via posAtCoords and positions the handle directly in its mousemove handler.
    CharacterCount,
    AutoJoiner,
    UniqueID.configure({
      types: UNIQUE_ID_BLOCK_TYPES,
      // attributeName defaults to 'id', rendered as data-id in HTML.
      // generateID defaults to uuid v4 — globally unique, collision-safe.
    }),
    DetailsEnterHandler,
    BlockKeyboardShortcuts,
    Extension.create({
      name: 'structuralInvariantGuard',
      priority: 1000,
      addProseMirrorPlugins() {
        return [structuralInvariantPlugin()];
      },
    }),
    BlockBackgroundColor,
  ];
}
