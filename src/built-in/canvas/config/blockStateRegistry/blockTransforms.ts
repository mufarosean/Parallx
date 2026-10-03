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
    // Columns are a layout, not a block shape: when the layout can't be
    // made (already columns, bad count) the turn-into is a no-op.  Falling
    // through built a `columnList` holding inline text — a schema-invalid
    // node that threw.
    turnBlockIntoColumns(editor, pos, node, columnCount);
    return;
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

  const built = targetType === 'columnList'
    ? buildRowColumns(list, rowNode, attrs)
    : buildBlock(targetType, parts, attrs);
  if (!built) return;
  let converted: any[] = [built.node, ...built.trailing];
  if (converted.length === 0) return;

  // Replacement range — may grow to absorb adjacent same-type lists below.
  let from = listPos;
  let to = listPos + list.nodeSize;

  // List-type targets: absorb ADJACENT sibling lists of the target type into
  // the converted list instead of leaving them for AutoJoiner.  Two reasons:
  // it's the correct end state anyway (consecutive same-type lists merge),
  // and AutoJoiner's appended join step trips UniqueID's
  // combineTransactionSteps ("TransformError: Inconsistent open depths"),
  // which killed batch turn-into after the first row (only the bottom row of
  // a box-selection converted).
  if (LIST_TARGET_TYPES.has(targetType) && built.node?.type === targetType) {
    const $list = editor.state.doc.resolve(listPos);
    const parentNode = $list.parent;
    const listIndex = $list.index($list.depth);
    const convertedRows: any[] = Array.isArray(built.node.content) ? built.node.content : [];

    if (rowsAfter.length === 0 && listIndex + 1 < parentNode.childCount) {
      const nextSibling = parentNode.child(listIndex + 1);
      if (nextSibling.type.name === targetType) {
        nextSibling.forEach((row: any) => convertedRows.push(row.toJSON()));
        to += nextSibling.nodeSize;
      }
    }
    if (rowsBefore.length === 0 && listIndex > 0) {
      const prevSibling = parentNode.child(listIndex - 1);
      if (prevSibling.type.name === targetType) {
        const prevRows: any[] = [];
        prevSibling.forEach((row: any) => prevRows.push(row.toJSON()));
        convertedRows.unshift(...prevRows);
        from -= prevSibling.nodeSize;
      }
    }
    built.node.content = convertedRows;
    converted = [built.node, ...built.trailing];
  }

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
    .insertContentAt({ from, to }, replacement)
    .focus()
    .run();
}

/**
 * A list row turned into columns: the row itself (its nested rows with it)
 * becomes a one-row list of the same type in the first column, and the
 * other columns start with an empty paragraph.  The row keeps its type and
 * checkbox — columns are a layout around it, not a new block type.
 */
function buildRowColumns(list: any, rowNode: any, attrs?: any): BuiltBlock | null {
  const count = Number(attrs?.columns ?? attrs?.count ?? 2);
  if (!Number.isFinite(count) || count < 2) return null;
  const rowList: Record<string, any> = { type: list.type.name, content: [rowNode.toJSON()] };
  if (hasMeaningfulAttrs(list.attrs)) rowList.attrs = { ...list.attrs };
  const columns: any[] = [{ type: 'column', content: [rowList] }];
  for (let i = 1; i < count; i++) columns.push({ type: 'column', content: [{ type: 'paragraph' }] });
  return { node: { type: 'columnList', content: columns }, trailing: [] };
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
      if (node.type.name === 'codeBlock') {
        // Code lines become hard breaks, so a rich target keeps the lines.
        return { inline: plainTextToInline(plainText), plainText, children: [], backgroundColor: bg };
      }
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
        // Code holds plain text only.  It takes the block's own line (the
        // inline), never the whole subtree's text: the child blocks already
        // trail after it, so using the full text showed them twice.
        const text = inlineToPlainText(parts.inline);
        const node: Record<string, any> = {
          type: 'codeBlock',
          content: text ? [{ type: 'text', text }] : [],
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
      // Same rule as code: the block's own line, children trail.
      const node = { type: targetType, attrs: { ...(attrs ?? {}), [shape.textAttr]: inlineToPlainText(parts.inline, true) } };
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
          { type: shape.summaryType, content: summaryInline(shape.summaryType, parts.inline) },
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

// ── Inline conversions ───────────────────────────────────────────────────────

/**
 * Plain text of inline JSON for text-only targets (code, equation).  Line
 * breaks stay line breaks and an inline equation keeps its LaTeX as `$…$`,
 * so nothing in the line disappears (textContent drops both).  An equation
 * target takes an inline equation's LaTeX bare, without the dollars.
 */
function inlineToPlainText(inline: any[], bareMath = false): string {
  let out = '';
  for (const n of inline ?? []) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') out += n.text ?? '';
    else if (n.type === 'hardBreak') out += '\n';
    else if (n.type === 'inlineMath') out += bareMath ? (n.attrs?.latex ?? '') : `$${n.attrs?.latex ?? ''}$`;
    else if (Array.isArray(n.content)) out += inlineToPlainText(n.content, bareMath);
  }
  return out;
}

/** Code text back into inline JSON: lines joined by hard breaks. */
function plainTextToInline(text: string): any[] {
  const out: any[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (line) out.push({ type: 'text', text: line });
  });
  return out;
}

/**
 * A toggle's summary (`detailsSummary`) holds text only.  Inline nodes it
 * can't hold become text instead of making the conversion throw: a line
 * break becomes a space and an inline equation its `$…$` source.  Marks
 * stay.  Other summaries (toggleHeadingText is `inline*`) take the line as is.
 */
function summaryInline(summaryType: string, inline: any[]): any[] {
  if (summaryType !== 'detailsSummary') return inline;
  const out: any[] = [];
  for (const n of inline ?? []) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') { out.push(n); continue; }
    const text = n.type === 'hardBreak' ? ' ' : inlineToPlainText([n]);
    if (text) out.push({ type: 'text', text });
  }
  return out;
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
