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
import { resolveBlockAncestry } from './blockStateRegistry.js';

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
  // Resolve column context BEFORE the delete so we know where to backfill.
  const $pos = editor.state.doc.resolve(pos);
  const ancestry = resolveBlockAncestry($pos);
  const columnDepth = ancestry.columnDepth;
  const columnStartPos = columnDepth !== null ? $pos.before(columnDepth) : null;

  const { tr } = editor.state;
  tr.delete(pos, pos + node.nodeSize);

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
