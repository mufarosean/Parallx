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
import { TextSelection } from '@tiptap/pm/state';
import { resolveBlockAncestry, cleanupEmptyColumn } from './blockStateRegistry.js';

export function duplicateBlockAt(
  editor: Editor,
  pos: number,
  node: any,
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

export function deleteBlockAt(editor: Editor, pos: number, node: any): void {
  // Resolve column context BEFORE the delete so we know where to clean up.
  const $pos = editor.state.doc.resolve(pos);
  const ancestry = resolveBlockAncestry($pos);
  const columnPos = ancestry.columnDepth !== null ? $pos.before(ancestry.columnDepth) : null;
  const columnListPos = ancestry.columnListDepth !== null ? $pos.before(ancestry.columnListDepth) : null;

  const { tr } = editor.state;
  tr.delete(pos, pos + node.nodeSize);

  // Synchronous column cleanup — if the block was in a column and leaving
  // it empty, dissolve the column and normalize the parent columnList in
  // the same transaction.  Without this the auto-dissolve plugin would
  // catch it on the next tick, but the 1-tick empty-column flash is visible.
  if (columnPos !== null && columnListPos !== null) {
    const mappedColPos = tr.mapping.map(columnPos, 1);
    cleanupEmptyColumn(tr, mappedColPos, columnListPos);
  }

  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function applyTextColorToBlock(
  editor: Editor,
  pos: number,
  node: any,
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
  node: any,
  color: string | null,
): void {
  const { tr } = editor.state;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
  editor.view.dispatch(tr);
  editor.commands.focus();
}
