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
import UniqueID from '@tiptap/extension-unique-id';
import { BlockBackgroundColor } from '../extensions/blockBackground.js';
import { DetailsEnterHandler } from '../extensions/detailsEnterHandler.js';
import { BlockKeyboardShortcuts } from '../extensions/blockKeyboardShortcuts.js';
import { ListKeyboardPolicy } from '../extensions/listKeyboardPolicy.js';
import { TableKeyboardPolicy } from '../extensions/tableKeyboardPolicy.js';
import { Dataview } from '../extensions/dataviewNode.js';
import { structuralInvariantPlugin } from '../plugins/structuralInvariantPlugin.js';
import { structuralRepairPlugin } from '../plugins/structuralRepair.js';
import {
  getNodePlaceholder,
  getBlockExtensions,
  BLOCK_BG_TYPES,
} from './blockRegistry.js';
import type { EditorExtensionContext } from './blockRegistry.js';

import type { Extensions } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
 * History-aware replacement for StarterKit's TrailingNode (M-canvas
 * determinism, 2026-07-20). Identical contract — keep an empty paragraph
 * after a non-paragraph document tail so there is always a place to click —
 * with ONE difference: it never fires on undo/redo transactions. The
 * bundled version re-appended its paragraph on the undo transaction itself,
 * so undo could not restore the pre-edit document (ghost empty line +
 * phantom-dirty page). Rule of the house: appendTransaction plugins MUST
 * exempt history transactions unless they exist to enforce schema validity
 * (structuralRepair is the sanctioned exception).
 */
/**
 * History-aware replacement for tiptap-extension-auto-joiner (M-canvas
 * determinism, 2026-07-20). Same product contract — adjacent same-type
 * lists merge into one — but NEVER on undo/redo. The original joined lists
 * on the undo transaction itself, and the join transaction then cascaded
 * into UniqueID stamping the merged node: two originally-separate lists
 * came back MERGED with fresh ids after a full undo (found by the rule
 * fuzzer, seeds 2/5). Third violator of the house rule; see
 * HistoryAwareTrailingNode below for the rule statement.
 */
const HistoryAwareAutoJoiner = Extension.create({
  name: 'autoJoiner',
  addProseMirrorPlugins() {
    const key = new PluginKey('canvasAutoJoiner');
    const JOINABLE = new Set(['bulletList', 'orderedList', 'taskList']);
    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _oldState, state) => {
          if (transactions.some((tr) => tr.getMeta('history$'))) return undefined;
          if (!transactions.some((tr) => tr.docChanged)) return undefined;
          const tr = state.tr;
          let joined = false;
          // Join adjacent same-type list siblings, deepest-last so earlier
          // positions stay valid; repeat until stable (a join can create a
          // new adjacency at the parent level).
          for (let pass = 0; pass < 5; pass++) {
            const joins: number[] = [];
            const walk = (node: import('@tiptap/pm/model').Node, base: number): void => {
              let offset = 0;
              let prev: import('@tiptap/pm/model').Node | null = null;
              node.forEach((child, childOffset) => {
                if (prev && JOINABLE.has(child.type.name) && prev.type === child.type) {
                  joins.push(base + childOffset);
                }
                prev = child;
                offset = childOffset;
              });
              void offset;
              node.forEach((child, childOffset) => {
                if (!child.isTextblock && child.childCount > 0) walk(child, base + childOffset + 1);
              });
            };
            walk(tr.doc, 0);
            if (joins.length === 0) break;
            for (const pos of joins.sort((a, b) => b - a)) {
              try { tr.join(pos); joined = true; } catch { /* boundary moved — skip */ }
            }
          }
          return joined ? tr : undefined;
        },
      }),
    ];
  },
});

/**
 * AI-handoff shimmer (M89 S3 — presence). When the assistant writes into an
 * OPEN page, the doc-diff apply path stamps its transactions with
 * `canvasExternalApply`; this decoration-only plugin marks the touched
 * top-level blocks with `.canvas-ai-shimmer` for a moment so the handoff is
 * visible (Notion-school presence cue). Decorations never modify the doc —
 * no history/undo interaction by construction. Reduced-motion collapses the
 * animation globally (px-motion.css).
 */
const AiPresenceShimmer = Extension.create({
  name: 'aiPresenceShimmer',
  addProseMirrorPlugins() {
    interface ShimmerState { ranges: Array<[number, number]> }
    const key = new PluginKey<ShimmerState>('canvasAiShimmer');
    const SHIMMER_MS = 1400;
    return [
      new Plugin<ShimmerState>({
        key,
        state: {
          init: () => ({ ranges: [] }),
          apply: (tr, value) => {
            if (tr.getMeta('canvasAiShimmerClear')) return { ranges: [] };
            // Positions (not decorations) are stored: follow-up transactions
            // like UniqueID id-stamping REPLACE the touched node
            // (setNodeMarkup), which kills node decorations — plain ranges
            // map through unharmed and the decorations rebuild lazily.
            let ranges = value.ranges.map(([f, t]): [number, number] =>
              [tr.mapping.map(f, -1), tr.mapping.map(t, 1)]);
            if (tr.getMeta('canvasExternalApply') && tr.docChanged) {
              tr.mapping.maps.forEach((map, i) => {
                map.forEach((_os, _oe, ns, ne) => {
                  const rest = tr.mapping.slice(i + 1);
                  ranges.push([rest.map(ns, -1), rest.map(ne, 1)]);
                });
              });
            }
            if (ranges.length > 200) ranges = ranges.slice(-200);
            return { ranges };
          },
        },
        props: {
          decorations(state) {
            const st = key.getState(state);
            if (!st || st.ranges.length === 0) return null;
            const decos: Decoration[] = [];
            state.doc.forEach((child, offset) => {
              const start = offset;
              const end = offset + child.nodeSize;
              if (st.ranges.some(([f, t]) => f < end && t > start)) {
                decos.push(Decoration.node(start, end, { class: 'canvas-ai-shimmer' }));
              }
            });
            return decos.length > 0 ? DecorationSet.create(state.doc, decos) : null;
          },
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          return {
            update(v, prevState) {
              const now = key.getState(v.state);
              const prev = key.getState(prevState);
              if (now && now.ranges.length > 0 && now !== prev) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                  timer = null;
                  if (view.isDestroyed) return;
                  view.dispatch(view.state.tr.setMeta('canvasAiShimmerClear', true).setMeta('addToHistory', false));
                }, SHIMMER_MS);
              }
            },
            destroy() { if (timer) clearTimeout(timer); },
          };
        },
      }),
    ];
  },
});

const HistoryAwareTrailingNode = Extension.create({
  name: 'trailingNode',
  addProseMirrorPlugins() {
    const key = new PluginKey('canvasTrailingNode');
    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _oldState, state) => {
          if (transactions.some((tr) => tr.getMeta('history$'))) return undefined;
          if (!transactions.some((tr) => tr.docChanged)) return undefined;
          const last = state.doc.lastChild;
          if (last && last.type.name === 'paragraph') return undefined;
          const paragraph = state.schema.nodes.paragraph;
          if (!paragraph) return undefined;
          return state.tr.insert(state.doc.content.size, paragraph.create());
        },
      }),
    ];
  },
});

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
      // Replaced by HistoryAwareTrailingNode below: the bundled TrailingNode
      // re-appends its paragraph ON THE UNDO TRANSACTION (no history
      // exclusion), so any edit+undo in a doc ending with a list/equation/
      // table left a ghost empty paragraph and a phantom-dirty page — the
      // same undo-identity defect class as the UniqueID id-restamp bug.
      trailingNode: false,
    }),
    HistoryAwareTrailingNode,
    AiPresenceShimmer,

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
    HistoryAwareAutoJoiner,
    clipboardImagePaste,
    imageFileDrop,
    UniqueID.configure({
      types: UNIQUE_ID_BLOCK_TYPES,
      // attributeName defaults to 'id', rendered as data-id in HTML.
      // generateID defaults to uuid v4 — globally unique, collision-safe.
      //
      // Undo/redo must restore the document EXACTLY — ids included. The
      // extension's appendTransaction has no history exclusion, so on pages
      // holding pre-migration null-id blocks it re-stamped a FRESH id onto
      // the very transaction undo produced: undo(edit) could never return
      // to the stored doc and the page was left phantom-dirty (found by the
      // real-data battery on the Exam 7 workspace, Enter@1 on an untouched
      // "Untitled" page). Skipping history transactions lets undo restore
      // the original attrs; redo replays the recorded stamp steps verbatim.
      filterTransaction: (tr) => !tr.getMeta('history$'),
    }),
    DetailsEnterHandler,
    BlockKeyboardShortcuts,
    ListKeyboardPolicy,
    // Above both of the above (priority 300): a caret inside a table cell
    // gets table-scoped meaning for the keys the block layer would otherwise
    // aim at the whole table.
    TableKeyboardPolicy,
    Extension.create({
      name: 'structuralInvariantGuard',
      priority: 1000,
      addProseMirrorPlugins() {
        // Repair runs first (production: heals malformed composite blocks),
        // then the dev-only detector asserts on whatever's left.
        return [structuralRepairPlugin(), structuralInvariantPlugin()];
      },
    }),
    // Registry-fed: blockRegistry.BLOCK_BG_TYPES is the single source for
    // which types carry the backgroundColor attribute.
    BlockBackgroundColor.configure({ types: [...BLOCK_BG_TYPES] }),
    Dataview,
  ];
}
