// blockTransforms.ts — Block type conversion ("turn into") operations
//
// Functions that change a block's type without changing its position.
// Part of the blockStateRegistry — the single authority for block state
// operations.
//
// ── The generic transform engine ─────────────────────────────────────────────
// Every conversion runs through one decompose → build pipeline:
//
//   decompose(node)  →  BlockParts { inline, plainText, children }
//   build(target)    →  { node, trailing }
//
// `inline` is the block's first line of rich content, `children` is every
// other block it holds.  Targets place the parts where their shape dictates
// (registry TransformShape) — and any child blocks a target cannot hold are
// emitted as `trailing` siblings after it.
//
// INVARIANT: a transform NEVER destroys child blocks.  Content either moves
// into the new block or lands as siblings directly after it — matching
// Notion, where turning a populated callout into a heading re-parents the
// body blocks rather than deleting them.

import type { Editor } from '@tiptap/core';
import {
  getTransformShape,
  turnBlockIntoColumns,
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
}

interface BuiltBlock {
  /** JSON of the converted block. */
  readonly node: Record<string, any>;
  /** Blocks the target could not hold — inserted as siblings after it. */
  readonly trailing: any[];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function turnBlockWithSharedStrategy(
  editor: Editor,
  pos: number,
  node: any,
  targetType: string,
  attrs?: any,
): void {
  const srcType = node.type.name;

  // List rows resolve to their `listItem` / `taskItem`. Those can't be replaced
  // in place (a list may only contain items), so they get list-aware handling:
  // convert the list type directly, or lift the row out to a normal block and
  // then run the standard transform on it.
  if (srcType === 'listItem' || srcType === 'taskItem') {
    turnListItemInto(editor, pos, targetType, attrs);
    return;
  }

  if (targetType === 'columnList') {
    const columnCount = Number(attrs?.columns ?? attrs?.count ?? 2);
    const converted = turnBlockIntoColumns(editor, pos, node, columnCount);
    if (converted) {
      return;
    }
  }

  // Simple textblock → simple target: Tiptap's own commands preserve marks,
  // selection, and list surgery better than a JSON rebuild — use them.
  const srcShape = getTransformShape(srcType);
  if (srcShape.kind === 'textblock' && SIMPLE_COMMAND_TARGETS.has(targetType)) {
    if (runSimpleCommand(editor, pos, targetType, attrs)) return;
  }

  // Container → paragraph is an UNWRAP: the container's blocks keep their own
  // types and land at the container's level (Notion "turn into text").
  if (targetType === 'paragraph' && isUnwrappableShape(srcShape)) {
    unwrapContainer(editor, pos, node, srcShape);
    return;
  }

  // Generic path: decompose to parts, rebuild as the target shape.
  const parts = decomposeBlock(node, srcShape);
  const built = buildBlock(targetType, parts, attrs);
  if (!built) return;

  editor.chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, [built.node, ...built.trailing])
    .focus()
    .run();
}

// ── Simple Tiptap-command path ───────────────────────────────────────────────

const SIMPLE_COMMAND_TARGETS: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock',
]);

function runSimpleCommand(editor: Editor, pos: number, targetType: string, attrs?: any): boolean {
  const chain = editor.chain().setTextSelection(pos + 1);
  switch (targetType) {
    case 'paragraph': return chain.setParagraph().focus().run();
    case 'heading': return chain.setHeading(attrs).focus().run();
    case 'bulletList': return chain.toggleBulletList().focus().run();
    case 'orderedList': return chain.toggleOrderedList().focus().run();
    case 'taskList': return chain.toggleTaskList().focus().run();
    case 'blockquote': return chain.toggleBlockquote().focus().run();
    case 'codeBlock': return chain.toggleCodeBlock().focus().run();
    default: return false;
  }
}

// ── List-row conversions ─────────────────────────────────────────────────────

const LIST_TARGET_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Turn a list row (`listItem` / `taskItem`) into `targetType`.
 *
 * A list row can't be swapped in place (the list schema only permits items),
 * so we reuse Tiptap's list-aware commands, which already own the surgery:
 *   • target is another list type → toggle it (Tiptap rewraps the row);
 *   • any other target → toggle OFF the current list (lifting the row's content
 *     to a normal block), then run the standard transform on that block.
 * Nested sub-lists survive both paths — Tiptap's toggles re-parent them.
 *
 * `pos` is the row's "before" position; `pos + 2` lands inside its first text
 * block (item → paragraph → text), which is what the list commands act on.
 */
function turnListItemInto(
  editor: Editor,
  pos: number,
  targetType: string,
  attrs?: any,
): void {
  const insidePos = pos + 2;
  const currentListType = editor.state.doc.resolve(pos).parent.type.name;

  const toggleList = (chain: any, listType: string): any => {
    if (listType === 'bulletList') return chain.toggleBulletList();
    if (listType === 'orderedList') return chain.toggleOrderedList();
    return chain.toggleTaskList();
  };

  // Convert to another list type — a single toggle rewraps the row.
  if (LIST_TARGET_TYPES.has(targetType)) {
    if (targetType === currentListType) return; // already this type
    toggleList(editor.chain().setTextSelection(insidePos), targetType).focus().run();
    return;
  }

  // Non-list target: lift the row out of its list by toggling the current list
  // off, which converts the row's content into a paragraph at the list's level.
  if (!LIST_TARGET_TYPES.has(currentListType)) return;
  const lifted = toggleList(editor.chain().setTextSelection(insidePos), currentListType).run();
  if (!lifted) return;

  if (targetType === 'paragraph') {
    editor.commands.focus();
    return;
  }

  // Re-resolve the now-lifted paragraph (holds the selection) and run the
  // standard transform on it — this covers headings, quote, code, callout,
  // toggle, math, and columns without duplicating their logic here.
  const $lift = editor.state.selection.$from;
  const liftedPos = $lift.before($lift.depth);
  const liftedNode = editor.state.doc.nodeAt(liftedPos);
  if (!liftedNode || liftedNode.type.name !== 'paragraph') {
    editor.commands.focus();
    return;
  }
  turnBlockWithSharedStrategy(editor, liftedPos, liftedNode, targetType, attrs);
}

// ── Decompose ────────────────────────────────────────────────────────────────

function decomposeBlock(node: any, shape: TransformShape): BlockParts {
  const plainText = node.textContent || '';

  switch (shape.kind) {
    case 'textblock':
      return { inline: node.content?.toJSON() ?? [], plainText, children: [] };

    case 'atom-text': {
      const text = String(node.attrs?.[shape.textAttr] ?? '');
      return {
        inline: text ? [{ type: 'text', text }] : [],
        plainText: text,
        children: [],
      };
    }

    case 'wrapper':
      return decomposeChildSequence(collectChildren(node), plainText);

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
      return { inline, plainText, children };
    }

    case 'list': {
      // First row's first line becomes the inline; everything else — the
      // first row's nested blocks and all remaining rows (rewrapped in the
      // same list type) — is preserved as children.
      const rows = collectChildren(node);
      if (rows.length === 0) return { inline: [], plainText, children: [] };

      const firstRowBlocks: any[] = Array.isArray(rows[0]?.content) ? rows[0].content : [];
      const seq = decomposeChildSequence(firstRowBlocks, plainText);
      const children = [...seq.children];
      if (rows.length > 1) {
        children.push({ type: node.type.name, content: rows.slice(1) });
      }
      return { inline: seq.inline, plainText, children };
    }
  }
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
  if (blocks.length === 0) return { inline: [], plainText, children: [] };
  const first = blocks[0];
  if (isTextblockJson(first)) {
    return {
      inline: Array.isArray(first.content) ? first.content : [],
      plainText,
      children: blocks.slice(1),
    };
  }
  return { inline: [], plainText, children: blocks };
}

function isTextblockJson(blockJson: any): boolean {
  if (!blockJson || typeof blockJson.type !== 'string') return false;
  return getTransformShape(blockJson.type).kind === 'textblock'
    && blockJson.type !== 'codeBlock';
}

// ── Build ────────────────────────────────────────────────────────────────────

function buildBlock(targetType: string, parts: BlockParts, attrs?: any): BuiltBlock | null {
  const shape = getTransformShape(targetType);

  switch (shape.kind) {
    case 'textblock': {
      if (targetType === 'codeBlock') {
        // Code holds plain text only; marks/inline nodes can't survive.
        const node = {
          type: 'codeBlock',
          content: parts.plainText ? [{ type: 'text', text: parts.plainText }] : [],
        };
        return { node, trailing: parts.children };
      }
      const node: Record<string, any> = { type: targetType, content: parts.inline };
      if (attrs) node.attrs = attrs;
      return { node, trailing: parts.children };
    }

    case 'atom-text': {
      const node = { type: targetType, attrs: { ...(attrs ?? {}), [shape.textAttr]: parts.plainText } };
      return { node, trailing: parts.children };
    }

    case 'list': {
      // The row hosts the inline as its paragraph and adopts the child blocks
      // as nested content (listItem content spec: paragraph block*).
      const itemContent: any[] = [{ type: 'paragraph', content: parts.inline }, ...parts.children];
      const item: Record<string, any> = { type: shape.itemType, content: itemContent };
      if (shape.itemAttrs) item.attrs = { ...shape.itemAttrs };
      return { node: { type: targetType, content: [item] }, trailing: [] };
    }

    case 'wrapper': {
      const content: any[] = [{ type: 'paragraph', content: parts.inline }, ...parts.children];
      const node: Record<string, any> = { type: targetType, content };
      const defaultedAttrs = targetType === 'callout'
        ? { emoji: attrs?.emoji || 'lightbulb' }
        : attrs;
      if (defaultedAttrs) node.attrs = defaultedAttrs;
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
      if (targetType === 'toggleHeading') node.attrs = { level: attrs?.level || 1 };
      else if (attrs) node.attrs = attrs;
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
