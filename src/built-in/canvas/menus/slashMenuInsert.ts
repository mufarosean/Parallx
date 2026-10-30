// slashMenuInsert.ts — Where the slash menu's "/" is, and where its pick goes
//
// The editor side of slashMenuQuery.ts: reads the line before the caret into
// the text the trigger rule reads, and turns a pick into the range the block
// registry's insert action fills.
//
//   - The line holds only the "/query" (start of an empty line): the pick
//     takes the whole line, as it always has.
//   - An inline item (Inline Equation) replaces the "/query" where it stands.
//   - A block item picked mid-line: the "/query" goes, the line keeps the
//     rest of its text, and the block goes in a new line right after it.

import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { findSlashTrigger } from './slashMenuQuery.js';

/** An inline object (a mention, an equation) reads as one non-space character. */
const OBJECT = '￼';

/** An open "/" before the caret, in document positions. */
export interface SlashTriggerRange {
  /** Position of the "/". */
  readonly from: number;
  /** The caret: the end of the typed query. */
  readonly to: number;
  readonly query: string;
}

/** The line's text from its start to the caret, objects as one character each. */
function textBeforeCaret($from: ResolvedPos): string {
  let text = '';
  const end = $from.parentOffset;
  $from.parent.forEach((child, offset) => {
    if (offset >= end) return;
    if (child.isText) text += (child.text ?? '').slice(0, end - offset);
    else text += child.type.name === 'hardBreak' ? '\n' : OBJECT.repeat(child.nodeSize);
  });
  return text;
}

/** The "/" the caret is typing a query after, or null. */
export function slashTriggerAt($from: ResolvedPos): SlashTriggerRange | null {
  if (!$from.parent.isTextblock) return null;
  const trigger = findSlashTrigger(textBeforeCaret($from));
  if (!trigger) return null;
  return { from: $from.start() + trigger.offset, to: $from.pos, query: trigger.query };
}

/**
 * The range a picked item fills. A block item picked mid-line first removes
 * the "/query" and opens an empty line after the current one (dispatched
 * here), so every insert action gets what it always got: an empty line to
 * replace. Null when there is nowhere to put it.
 */
export function slashInsertRange(editor: Editor, item: { readonly nodeName?: string }): { from: number; to: number } | null {
  const { state } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return null;
  const line = $from.parent;
  const linePos = $from.before();
  const wholeLine = { from: linePos, to: linePos + line.nodeSize };

  const trigger = slashTriggerAt($from);
  if (!trigger) return wholeLine;

  const nodeType = item.nodeName ? state.schema.nodes[item.nodeName] : undefined;
  if (nodeType?.isInline) return { from: trigger.from, to: trigger.to };

  const start = $from.start();
  const outside = line.textBetween(0, trigger.from - start, '', OBJECT)
    + line.textBetween(trigger.to - start, line.content.size, '', OBJECT);
  if (!outside.trim()) return wholeLine;

  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return null;
  const tr = state.tr.delete(trigger.from, trigger.to);
  const fits = (pos: number): boolean => {
    const $pos = tr.doc.resolve(pos);
    return $pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph);
  };
  let at = tr.mapping.map(linePos + line.nodeSize);
  if (!fits(at)) {
    // The line's parent takes no paragraph here: go after its outermost block.
    at = tr.mapping.map($from.after(1));
    if (!fits(at)) return null;
  }
  tr.insert(at, paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  editor.view.dispatch(tr);
  return { from: at, to: at + 2 };
}

/** Where an inline equation just inserted at the caret sits, or -1. */
export function inlineMathBeforeCaret(editor: Editor): number {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return sel.node.type.name === 'inlineMath' ? sel.from : -1;
  const before = sel.$from.nodeBefore;
  return before?.type.name === 'inlineMath' ? sel.from - before.nodeSize : -1;
}
