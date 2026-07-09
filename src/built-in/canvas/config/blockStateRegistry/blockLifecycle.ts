// blockLifecycle.ts — Block lifecycle operations (create, destroy, restyle)
//
// Functions that create, destroy, or restyle a block without changing its
// position or type.  Part of the blockStateRegistry — the single authority
// for block state operations.
//
// Dispatch pattern: raw `tr` → `view.dispatch(tr)` → `editor.commands.focus()`
// for one undo step per operation and consistent focus.  Exception:
// applyTextColorToBlock uses `editor.chain()` because setColor/unsetColor
// are Tiptap extension commands — raw tr would couple to mark schema internals.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { resolveBlockAncestry } from './blockStateRegistry.js';

// ── Capability predicates ────────────────────────────────────────────────────
// Used by the block action menu (and any future bulk-action consumer) to
// determine whether a given block type can participate in text-color,
// background-color, or turn-into operations.  Notion parity: in a multi-
// block selection, blocks that don't support an action are skipped silently
// rather than causing the action to fail or producing inconsistent state.
//
// The set below is intentionally duplicated from extensions/blockBackground.ts
// (BLOCK_BG_TYPES) — blockLifecycle.ts is gate-isolated to its own folder
// per CANVAS_STRUCTURAL_MODEL §gate-rules. The drift-detection test in
// `tests/unit/canvasCapabilityDrift.test.ts` pins the two lists together.
// Exported only for that test — canvas-internal code MUST go through
// canTakeBackgroundColor() / canTakeTextColor() / canTurnInto() instead.

export const BG_CAPABLE_TYPES: readonly string[] = [
  'paragraph', 'heading', 'blockquote', 'codeBlock',
  'callout', 'details', 'bulletList', 'orderedList', 'taskList',
  // List items hold the colour on their own <li> so it wraps the item + its
  // nested sub-list as one region. Kept in sync with BLOCK_BG_TYPES (extension)
  // by tests/unit/canvasCapabilityDrift.test.ts.
  'listItem', 'taskItem',
];

/**
 * Authoritative set of node-type names whose blocks contain (or wrap) text
 * content that can take a text-color mark.  Mirrors BG_CAPABLE_TYPES plus
 * toggleHeading, which contains a heading title and inner blocks.
 *
 * Excluded: image, divider, bookmark, video, audio, fileAttachment,
 * pageBlock, mathBlock (renders LaTeX, no inline marks), tables, columnList.
 */
const TEXTUAL_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...BG_CAPABLE_TYPES,
  'toggleHeading',
]);

/**
 * List item wrappers. The drag handle resolves a list row to its `listItem` /
 * `taskItem` (so you can drag/move the whole row), which means the block-action
 * menu operates on these node types. They are content-bearing (each wraps a
 * paragraph), so they participate in every content capability — the operations
 * (color, turn-into) target the item's content, not the wrapper. Excluding
 * them silently disabled Turn Into AND colour for every list row.
 */
export const LIST_ITEM_TYPES: ReadonlySet<string> = new Set(['listItem', 'taskItem']);

/** Whether `nodeTypeName` blocks accept a text-color mark on their content. */
export function canTakeTextColor(nodeTypeName: string): boolean {
  return TEXTUAL_BLOCK_TYPES.has(nodeTypeName) || LIST_ITEM_TYPES.has(nodeTypeName);
}

/** Whether `nodeTypeName` blocks accept a `backgroundColor` attribute. */
export function canTakeBackgroundColor(nodeTypeName: string): boolean {
  // listItem/taskItem are members of BG_CAPABLE_TYPES now (they hold the colour
  // on their own <li>), so the list membership already covers them.
  return BG_CAPABLE_TYPES.includes(nodeTypeName);
}

/**
 * Whether `nodeTypeName` blocks can be the SOURCE of a turn-into operation.
 * Textual blocks and list items qualify; image/divider/etc. cannot because
 * turnBlockWithSharedStrategy needs text/inline content to seed the new block.
 */
export function canTurnInto(nodeTypeName: string): boolean {
  return TEXTUAL_BLOCK_TYPES.has(nodeTypeName) || LIST_ITEM_TYPES.has(nodeTypeName);
}

// ── Linked-page block deletion hook ──────────────────────────────────────────
// When a block that owns a child page (pageBlock, databaseInline) is deleted,
// we fire a callback so the canvas system can run the normal page deletion
// process.  This keeps blockLifecycle decoupled from the data service.

type LinkedPageDeletedFn = (pageId: string) => void;
let _onLinkedPageBlockDeleted: LinkedPageDeletedFn | undefined;

/**
 * Register the handler that runs the page deletion process when a
 * page-linked block is removed from editor content.  Called once
 * during canvas activation.
 */
export function setOnLinkedPageBlockDeleted(fn: LinkedPageDeletedFn): void {
  _onLinkedPageBlockDeleted = fn;
}

/**
 * Extract the child page ID from a page-linked node, if any.
 */
function _getLinkedPageId(node: PMNode): string | undefined {
  const typeName: string = node.type.name;
  if (typeName === 'pageBlock') return node.attrs?.pageId as string | undefined;
  if (typeName === 'databaseInline') return node.attrs?.databaseId as string | undefined;
  if (typeName === 'databaseFullPage') return node.attrs?.databaseId as string | undefined;
  return undefined;
}

/**
 * Notify the registered handler about deleted page-linked blocks.
 * Safe to call with any node — non-page-linked nodes are ignored.
 * Used by deleteBlockAt (single) and blockSelection.deleteSelected (batch).
 */
export function notifyLinkedPageBlocksDeleted(nodes: readonly PMNode[]): void {
  if (!_onLinkedPageBlockDeleted) return;
  for (const node of nodes) {
    const pageId = _getLinkedPageId(node);
    if (pageId) {
      _onLinkedPageBlockDeleted(pageId);
    }
  }
}

export function duplicateBlockAt(
  editor: Editor,
  pos: number,
  node: PMNode,
  options?: { setSelectionInsideDuplicate?: boolean },
): number {
  const insertPos = pos + node.nodeSize;
  const { tr } = editor.state;
  const clone = editor.state.schema.nodeFromJSON(node.toJSON());
  tr.insert(insertPos, clone);

  if (options?.setSelectionInsideDuplicate) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
  }

  editor.view.dispatch(tr);
  editor.commands.focus();
  return insertPos;
}

/**
 * Wrapper types that DISSOLVE when their last child is deleted.  Deleting the
 * only row of a list removes the list itself — otherwise ProseMirror's
 * replace-fitting resurrects an empty row and the user sees a ghost bullet
 * that "won't delete".  Required containers (column, callout, detailsContent)
 * are NOT here: they survive with a backfilled empty paragraph instead.
 */
const DISSOLVES_WHEN_EMPTY: ReadonlySet<string> = new Set([
  'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem',
]);

/**
 * Grow a block's deletion range over every ancestor wrapper that the delete
 * would leave empty and that dissolves when emptied.  One uniform policy for
 * every delete path (single action-menu delete, multi-select delete).
 *
 * @param doc — the CURRENT doc the delete will run against (use `tr.doc` when
 *              batching so earlier deletions are visible to the emptiness check).
 * @returns the final range plus the depth of the nearest surviving ancestor.
 */
export function growEmptiedAncestorDeletion(
  doc: PMNode,
  pos: number,
  node: PMNode,
): { from: number; to: number; survivorDepth: number } {
  const $pos = doc.resolve(pos);
  let from = pos;
  let to = pos + node.nodeSize;
  let d = $pos.depth;
  while (d >= 1) {
    const parent = $pos.node(d);
    if (!DISSOLVES_WHEN_EMPTY.has(parent.type.name)) break;
    if (parent.childCount > 1) break; // siblings remain — the wrapper survives
    from = $pos.before(d);
    to = $pos.after(d);
    d--;
  }
  return { from, to, survivorDepth: d };
}

export function deleteBlockAt(editor: Editor, pos: number, node: PMNode): void {
  // If the block owns a child page, trigger the normal page deletion process.
  notifyLinkedPageBlocksDeleted([node]);

  // Resolve column context BEFORE the delete so we know where to backfill.
  const $pos = editor.state.doc.resolve(pos);
  const ancestry = resolveBlockAncestry($pos);
  const columnDepth = ancestry.columnDepth;
  const columnStartPos = columnDepth !== null ? $pos.before(columnDepth) : null;

  // Uniform emptied-wrapper policy: the delete takes any list wrappers it
  // would leave empty down with it (no ghost rows).
  const { from, to } = growEmptiedAncestorDeletion(editor.state.doc, pos, node);

  const { tr } = editor.state;
  tr.delete(from, to);

  // Column schema safety: column content is `(block)+` — one or more children.
  // If the delete emptied the column, insert an empty paragraph to keep the
  // column structurally valid.  This matches Notion: deleting the last block
  // in a column never dissolves the column layout — the user keeps their
  // column structure and can continue typing.
  if (columnStartPos !== null) {
    const mappedColPos = tr.mapping.map(columnStartPos, 1);
    const colNode = tr.doc.nodeAt(mappedColPos);
    if (colNode && colNode.type.name === 'column' && colNode.childCount === 0) {
      const pType = editor.state.schema.nodes.paragraph;
      const emptyParagraph = pType.createAndFill();
      if (emptyParagraph) {
        tr.insert(mappedColPos + 1, emptyParagraph);
      }
    }
  }

  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function applyTextColorToBlock(
  editor: Editor,
  pos: number,
  node: PMNode,
  color: string | null,
): boolean {
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;

  if (from >= to) {
    return false;
  }

  // Uses editor.chain() because setColor/unsetColor are Tiptap extension
  // commands — converting to raw tr.addMark/removeMark would couple to
  // the Color extension's mark schema internals.
  if (color) {
    editor.chain().setTextSelection({ from, to }).setColor(color).focus().run();
  } else {
    editor.chain().setTextSelection({ from, to }).unsetColor().focus().run();
  }

  return true;
}

export function applyBackgroundColorToBlock(
  editor: Editor,
  pos: number,
  node: PMNode,
  color: string | null,
): void {
  // Every bg-capable block — including list ITEMS (listItem/taskItem) — carries
  // the colour as an attribute on its OWN element. For a list item that element
  // is the <li>, which already contains the item's line AND its nested sub-list
  // in the DOM, so the fill wraps the whole subtree as ONE region (Notion-style)
  // instead of striping each child. So this is a single, uniform set-markup for
  // all block kinds — no special list-item child-painting.
  const { tr } = editor.state;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
  editor.view.dispatch(tr);
  editor.commands.focus();
}
