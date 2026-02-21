// blockLifecycle.ts — Block lifecycle operations (create, destroy, restyle)
//
// Functions that create, destroy, or restyle a block without changing its
// position or type.  Part of the blockStateRegistry — the single authority
// for block state operations.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

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
  return insertPos;
}

export function deleteBlockAt(editor: Editor, pos: number, node: any): void {
  editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).focus().run();
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
  const tr = editor.view.state.tr;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: color });
  editor.view.dispatch(tr);
  editor.commands.focus();
}
