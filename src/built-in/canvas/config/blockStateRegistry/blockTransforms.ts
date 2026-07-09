// blockTransforms.ts — Block type conversion ("turn into") operations
//
// Functions that change a block's type without changing its position.
// Part of the blockStateRegistry — the single authority for block state
// operations.
//
// ── The generic transform engine ─────────────────────────────────────────────
// EVERY conversion runs through one decompose → build pipeline (no parallel
// Tiptap-command path — one code path means one behavior):
//
//   decompose(node)  →  BlockParts { inline, plainText, children, bg }
//   build(target)    →  { node, trailing }
//
// `inline` is the block's first line of rich content, `children` is every
// other block it holds.  Targets place the parts where their shape dictates
// (registry TransformShape); child blocks a target cannot hold are emitted
// as `trailing` siblings after it.
//
// INVARIANTS (each pinned by tests/unit/canvasTransformBehavior.test.ts):
//   1. A transform NEVER destroys child blocks — they move into the new block
//      or land directly after it.
//   2. A transform NEVER changes the block's position in the tree.  A list
//      row converts IN PLACE: the list splits around it and the converted
//      block takes the row's exact spot — nested rows keep their indent,
//      siblings keep their list type.
//   3. Block styling travels: a coloured block stays coloured after
//      conversion (when the target can carry a background).

import type { Editor } from '@tiptap/core';
import {
  getTransformShape,
  turnBlockIntoColumns,
  canTakeBackgroundColor,
  type TransformShape,
} from './blockStateRegistry.js';

// ── Universal parts ──────────────────────────────────────────────────────────

interface BlockParts {
  /** Inline JSON of the block's first/title line ([] when none). */
  readonly inline: any[];
  /** Full plain text — used by text-attribute targets (codeBlock, mathBlock). */
  readonly plainText: string;
  /** JSON of every other block the node holds.  NEVER dropped. */
  readonly children: any[];
  /** The source block's background colour, carried to the target when it can hold one. */
  readonly backgroundColor: string | null;
}

interface BuiltBlock {
  /** JSON of the converted block. */
  readonly node: Record<string, any>;
  /** Blocks the target could not hold — inserted as siblings after it. */
  readonly trailing: any[];
}

const LIST_TARGET_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

// ── Public API ───────────────────────────────────────────────────────────────

export function turnBlockWithSharedStrategy(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  attrs?: any,
): void {
  const srcType = node.type.name;

  // List rows convert IN PLACE via list-splice surgery (invariant 2).
  if (srcType === 'listItem' || srcType === 'taskItem') {
    spliceListRowInto(editor, pos, node, targetType, attrs);
    return;
  }

  if (targetType === 'columnList') {
    const columnCount = Number(attrs?.columns ?? attrs?.count ?? 2);
    const converted = turnBlockIntoColumns(editor, pos, node, columnCount);
    if (converted) {
      return;
    }
  }

  // Container → paragraph is an UNWRAP: the container's blocks keep their own
  // types and land at the container's level (Notion "turn into text").
  const srcShape = getTransformShape(srcType);
  if (targetType === 'paragraph' && isUnwrappableShape(srcShape)) {
    unwrapContainer(editor, pos, node, srcShape);
    return;
  }

  const parts = decomposeBlock(node, srcShape);
  const built = buildBlock(targetType, parts, attrs);
  if (!built) return;

  editor.chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, [built.node, ...built.trailing])
    .focus()
    .run();
}

// ── List-row conversions: in-place splice ────────────────────────────────────
//
// Converting row R inside list L replaces L with (up to) three nodes AT L's
// POSITION:   [ L(rows before R) ]  converted(R) (+trailing)  [ L(rows after R) ]
//
// One rule at every depth: a nested list lives inside a parent listItem whose
// content spec (`paragraph block*`) accepts any block, so the converted node
// stays exactly where the row was — indent retained, siblings untouched,
// children kept (inside container targets / nested under list targets /
// trailing after leaf targets).  This replaces the old Tiptap toggle-lift
// approach, which ejected nested rows to the top level, silently converted
// sibling rows on list-type changes, detached children, and no-op'd on
// attribute-carrying rows.

function spliceListRowInto(
  editor: Editor,
  rowPos: number,
  rowNode: any,
  targetType: string,
  attrs?: any,
): void {
  const $row = editor.state.doc.resolve(rowPos);
  const list = $row.parent;
  if (!LIST_TARGET_TYPES.has(list.type.name)) return; // defensive: row not in a list
  if (targetType === list.type.name) return;          // already this list type — no-op

  const listPos = $row.before($row.depth);
  const rowIndex = $row.index($row.depth);

  const rowsBefore: any[] = [];
  const rowsAfter: any[] = [];
  list.forEach((child: any, _off: number, i: number) => {
    if (i < rowIndex) rowsBefore.push(child.toJSON());
    else if (i > rowIndex) rowsAfter.push(child.toJSON());
  });

  // Decompose the row: first line + everything else (nested lists, extra blocks).
  const parts = withBg(
    decomposeChildSequence(collectChildren(rowNode), rowNode.textContent || ''),
    rowNode.attrs?.backgroundColor ?? null,
  );

  let converted: any[];
  if (LIST_TARGET_TYPES.has(targetType)) {
    // Row → row of another list type: rebuild just this row, children nested.
    const built = buildBlock(targetType, parts, attrs);
    converted = built ? [built.node, ...built.trailing] : [];
  } else {
    const built = buildBlock(targetType, parts, attrs);
    if (!built) return;
    converted = [built.node, ...built.trailing];
  }
  if (converted.length === 0) return;

  const listJson = (rows: any[]): Record<string, any> => ({
    type: list.type.name,
    ...(hasMeaningfulAttrs(list.attrs) ? { attrs: { ...list.attrs } } : {}),
    content: rows,
  });

  const replacement: any[] = [];
  if (rowsBefore.length > 0) replacement.push(listJson(rowsBefore));
  replacement.push(...converted);
  if (rowsAfter.length > 0) replacement.push(listJson(rowsAfter));

  editor.chain()
    .insertContentAt({ from: listPos, to: listPos + list.nodeSize }, replacement)
    .focus()
    .run();
}

function hasMeaningfulAttrs(attrs: Record<string, any> | null | undefined): boolean {
  if (!attrs) return false;
  return Object.values(attrs).some((v) => v !== null && v !== undefined);
}

// ── Decompose ────────────────────────────────────────────────────────────────

function decomposeBlock(node: any, shape: TransformShape): BlockParts {
  const plainText = node.textContent || '';
  const bg = node.attrs?.backgroundColor ?? null;

  switch (shape.kind) {
    case 'textblock':
      return { inline: node.content?.toJSON() ?? [], plainText, children: [], backgroundColor: bg };

    case 'atom-text': {
      const text = String(node.attrs?.[shape.textAttr] ?? '');
      return {
        inline: text ? [{ type: 'text', text }] : [],
        plainText: text,
        children: [],
        backgroundColor: bg,
      };
    }

    case 'wrapper':
      return withBg(decomposeChildSequence(collectChildren(node), plainText), bg);

    case 'summary-content': {
      let inline: any[] = [];
      let children: any[] = [];
      node.forEach((child: any) => {
        if (child.type.name === shape.summaryType) {
          inline = child.content?.toJSON() ?? [];
        } else if (child.type.name === shape.contentType) {
          children = children.concat(collectChildren(child));
        }
      });
      return { inline, plainText, children, backgroundColor: bg };
    }

    case 'list': {
      // First row's first line becomes the inline; everything else — the
      // first row's nested blocks and all remaining rows (rewrapped in the
      // same list type) — is preserved as children.
      const rows = collectChildren(node);
      if (rows.length === 0) return { inline: [], plainText, children: [], backgroundColor: bg };

      const firstRowBlocks: any[] = Array.isArray(rows[0]?.content) ? rows[0].content : [];
      const seq = decomposeChildSequence(firstRowBlocks, plainText);
      const children = [...seq.children];
      if (rows.length > 1) {
        children.push({ type: node.type.name, content: rows.slice(1) });
      }
      return { inline: seq.inline, plainText, children, backgroundColor: bg };
    }
  }
}

function withBg(parts: BlockParts, bg: string | null): BlockParts {
  return bg === parts.backgroundColor ? parts : { ...parts, backgroundColor: bg };
}

/** JSON of a node's direct children. */
function collectChildren(node: any): any[] {
  const out: any[] = [];
  node.forEach((child: any) => out.push(child.toJSON()));
  return out;
}

/**
 * Split a block sequence into (inline of the first textblock, rest).
 * When the sequence doesn't start with a textblock (e.g. a callout whose
 * first child is an image), everything is children and inline is empty.
 */
function decomposeChildSequence(blocks: any[], plainText: string): BlockParts {
  if (blocks.length === 0) return { inline: [], plainText, children: [], backgroundColor: null };
  const first = blocks[0];
  if (isTextblockJson(first)) {
    return {
      inline: Array.isArray(first.content) ? first.content : [],
      plainText,
      children: blocks.slice(1),
      backgroundColor: null,
    };
  }
  return { inline: [], plainText, children: blocks, backgroundColor: null };
}

function isTextblockJson(blockJson: any): boolean {
  if (!blockJson || typeof blockJson.type !== 'string') return false;
  return getTransformShape(blockJson.type).kind === 'textblock'
    && blockJson.type !== 'codeBlock';
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * Merge the carried background colour into a target's attrs (invariant 3).
 * An explicit caller-supplied backgroundColor wins; targets that can't hold
 * a background (mathBlock, …) drop it.
 */
function mergeAttrs(
  targetType: string,
  attrs: Record<string, any> | undefined,
  parts: BlockParts,
): Record<string, any> | undefined {
  const carryBg = parts.backgroundColor !== null
    && attrs?.backgroundColor === undefined
    && canTakeBackgroundColor(targetType);
  if (!carryBg) return attrs;
  return { ...(attrs ?? {}), backgroundColor: parts.backgroundColor };
}

function buildBlock(targetType: string, parts: BlockParts, attrs?: any): BuiltBlock | null {
  const shape = getTransformShape(targetType);

  switch (shape.kind) {
    case 'textblock': {
      if (targetType === 'codeBlock') {
        // Code holds plain text only; marks/inline nodes can't survive.
        const node: Record<string, any> = {
          type: 'codeBlock',
          content: parts.plainText ? [{ type: 'text', text: parts.plainText }] : [],
        };
        const merged = mergeAttrs(targetType, attrs, parts);
        if (merged) node.attrs = merged;
        return { node, trailing: parts.children };
      }
      const node: Record<string, any> = { type: targetType, content: parts.inline };
      const merged = mergeAttrs(targetType, attrs, parts);
      if (merged) node.attrs = merged;
      return { node, trailing: parts.children };
    }

    case 'atom-text': {
      const node = { type: targetType, attrs: { ...(attrs ?? {}), [shape.textAttr]: parts.plainText } };
      return { node, trailing: parts.children };
    }

    case 'list': {
      // The row hosts the inline as its paragraph and adopts the child blocks
      // as nested content (listItem content spec: paragraph block*).  The
      // carried colour lands on the ROW (list items are the colourable unit).
      const itemContent: any[] = [{ type: 'paragraph', content: parts.inline }, ...parts.children];
      const item: Record<string, any> = { type: shape.itemType, content: itemContent };
      const itemAttrs: Record<string, any> = { ...(shape.itemAttrs ?? {}) };
      if (parts.backgroundColor !== null && canTakeBackgroundColor(shape.itemType)) {
        itemAttrs.backgroundColor = parts.backgroundColor;
      }
      if (Object.keys(itemAttrs).length > 0) item.attrs = itemAttrs;
      return { node: { type: targetType, content: [item] }, trailing: [] };
    }

    case 'wrapper': {
      const content: any[] = [{ type: 'paragraph', content: parts.inline }, ...parts.children];
      const node: Record<string, any> = { type: targetType, content };
      const baseAttrs = targetType === 'callout'
        ? { emoji: attrs?.emoji || 'lightbulb', ...(attrs ?? {}) }
        : attrs;
      const merged = mergeAttrs(targetType, baseAttrs, parts);
      if (merged) node.attrs = merged;
      return { node, trailing: [] };
    }

    case 'summary-content': {
      const body = parts.children.length > 0 ? parts.children : [{ type: 'paragraph' }];
      const node: Record<string, any> = {
        type: targetType,
        content: [
          { type: shape.summaryType, content: parts.inline },
          { type: shape.contentType, content: body },
        ],
      };
      const baseAttrs = targetType === 'toggleHeading' ? { level: attrs?.level || 1 } : attrs;
      const merged = mergeAttrs(targetType, baseAttrs, parts);
      if (merged) node.attrs = merged;
      return { node, trailing: [] };
    }
  }
}

// ── Container unwrap (→ paragraph) ───────────────────────────────────────────

function isUnwrappableShape(shape: TransformShape): boolean {
  return shape.kind === 'wrapper' || shape.kind === 'summary-content';
}

/**
 * "Turn into text" on a container releases its blocks in place, each keeping
 * its own type.  A summary line becomes a paragraph ahead of the body blocks.
 */
function unwrapContainer(editor: Editor, pos: number, node: any, shape: TransformShape): void {
  let blocks: any[];
  if (shape.kind === 'summary-content') {
    const parts = decomposeBlock(node, shape);
    blocks = [{ type: 'paragraph', content: parts.inline }, ...parts.children];
  } else {
    blocks = collectChildren(node);
  }
  if (blocks.length === 0) blocks = [{ type: 'paragraph' }];

  editor.chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, blocks)
    .focus()
    .run();
}
