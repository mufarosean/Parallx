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
import { Dataview } from '../extensions/dataviewNode.js';
import { structuralInvariantPlugin } from '../plugins/structuralInvariantPlugin.js';
import {
  getNodePlaceholder,
  getBlockExtensions,
} from './blockRegistry.js';
import type { EditorExtensionContext } from './blockRegistry.js';

import type { Extensions } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import {
  hasImageExtension,
  fileUrlToPath,
  readLocalImageAsDataUrl,
} from '../menus/imagePathResolver.js';

/**
 * Every block-level node type that receives a persistent unique ID via
 * `@tiptap/extension-unique-id`.
 *
 * Criteria: all ProseMirror node types that represent user-visible blocks or
 * their structural children (containers, list items, table cells, etc.).
 * Inline-only types (text, inlineMath, hardBreak) are excluded.
 *
 * Exported for the M60 Phase δ T3 C2 contract: stable `blockId` is the
 * substrate behind read_block / edit_block / insert_block_after / link_block.
 * Drift in this list breaks block-level addressing — see
 * `tests/unit/canvasUniqueIdContract.test.ts`.
 */
export const UNIQUE_ID_BLOCK_TYPES: string[] = [
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

  // ── M60 Phase δ — dataview block ──
  'dataview',
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

  const clipboardImagePaste = Extension.create({
    name: 'clipboardImagePaste',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('canvasClipboardImagePaste'),
          props: {
            handlePaste(view, event) {
              const items = Array.from(event.clipboardData?.items ?? []);
              const imageItem = items.find((item) => item.type.startsWith('image/'));
              const file = imageItem?.getAsFile();
              const imageType = view.state.schema.nodes.image;
              if (!file || !imageType) return false;

              event.preventDefault();

              const reader = new FileReader();
              reader.onload = () => {
                const src = typeof reader.result === 'string' ? reader.result : '';
                if (!src) return;

                const { from, to } = view.state.selection;
                const imageNode = imageType.create({ src });
                const tr = view.state.tr.replaceRangeWith(from, to, imageNode);
                const afterImagePos = Math.min(tr.doc.content.size, from + imageNode.nodeSize);
                tr.setSelection(TextSelection.near(tr.doc.resolve(afterImagePos)));
                view.dispatch(tr);
                view.focus();
              };
              reader.readAsDataURL(file);
              return true;
            },
          },
        }),
      ];
    },
  });

  // ── Drop image files / local paths into the editor ─────────────────────
  //
  // Accepts three drag sources:
  //   • OS Explorer files          (event.dataTransfer.files with image MIME)
  //   • Parallx file explorer rows (text/uri-list with `file:///…` URLs)
  //   • Plain text absolute paths  (text/plain with Windows or POSIX path)
  //
  // Local paths are inlined as base64 data URLs because canvas's CSP forbids
  // `file://` in `img-src`. Internal moves (`moved === true`) pass through so
  // the column-drop plugin can handle block reordering.
  const imageFileDrop = Extension.create({
    name: 'imageFileDrop',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey('canvasImageFileDrop'),
          props: {
            handleDrop(view, event, _slice, moved) {
              if (moved) return false;
              const dt = (event as DragEvent).dataTransfer;
              if (!dt) return false;

              // ── Collect candidate paths from uri-list / plain text ──
              const paths: string[] = [];
              const uriList = dt.getData('text/uri-list');
              if (uriList) {
                for (const line of uriList.split(/\r?\n/)) {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith('#')) continue;
                  if (trimmed.startsWith('file://')) {
                    paths.push(fileUrlToPath(trimmed));
                  }
                }
              }
              if (paths.length === 0) {
                const plain = dt.getData('text/plain').trim();
                if (plain && (/^[a-zA-Z]:[\\/]/.test(plain) || plain.startsWith('/'))) {
                  paths.push(plain);
                }
              }

              // ── Native OS files ──
              const files = Array.from(dt.files || []).filter(
                (f) => f.type.startsWith('image/') || hasImageExtension(f.name),
              );

              const imagePaths = paths.filter(hasImageExtension);
              if (imagePaths.length === 0 && files.length === 0) return false;

              event.preventDefault();

              if (!view.state.schema.nodes.image) return true;

              // Capture drop coords now; resolve to a position post-await so
              // we use a fresh view.state (doc may have changed during reads).
              const clientX = (event as DragEvent).clientX;
              const clientY = (event as DragEvent).clientY;

              (async () => {
                const sources: string[] = [];
                for (const p of imagePaths) {
                  const r = await readLocalImageAsDataUrl(p);
                  if (r.dataUrl) sources.push(r.dataUrl);
                  else if (r.error) console.warn('[imageFileDrop]', p, r.error);
                }
                for (const f of files) {
                  // Prefer Electron's `.path` (avoids re-reading via FileReader)
                  const fullPath = (f as File & { path?: string }).path;
                  if (fullPath) {
                    const r = await readLocalImageAsDataUrl(fullPath);
                    if (r.dataUrl) sources.push(r.dataUrl);
                    else if (r.error) console.warn('[imageFileDrop]', fullPath, r.error);
                    continue;
                  }
                  const dataUrl = await new Promise<string>((res) => {
                    const reader = new FileReader();
                    reader.onload = () => res(typeof reader.result === 'string' ? reader.result : '');
                    reader.onerror = () => res('');
                    reader.readAsDataURL(f);
                  });
                  if (dataUrl) sources.push(dataUrl);
                }
                if (sources.length === 0) return;
                if (!editor || editor.isDestroyed) return;

                // Re-resolve drop position against the CURRENT view state.
                const dropPos = view.posAtCoords({ left: clientX, top: clientY });
                const insertAt = dropPos
                  ? dropPos.pos
                  : view.state.selection.from;

                // Use TipTap's chain — handles block-vs-inline schema fit
                // (splits paragraphs, etc.) the same way the slash-menu's
                // Upload tab and Embed link path do.
                const content = sources.map((src) => ({
                  type: 'image' as const,
                  attrs: { src },
                }));
                editor.chain().insertContentAt(insertAt, content).focus().run();
              })().catch((err) => {
                console.error('[imageFileDrop] insert failed:', err);
              });

              return true;
            },
          },
        }),
      ];
    },
  });

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
    clipboardImagePaste,
    imageFileDrop,
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
    Dataview,
  ];
}
