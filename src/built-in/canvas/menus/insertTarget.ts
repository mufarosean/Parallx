// insertTarget.ts — where an insert popup's block lands
//
// The image, media and bookmark popups open over the "/image" paragraph the
// slash menu typed, and insert their block there when the user confirms —
// often seconds later, after a file dialog.  They held the range captured at
// open: any edit in between (the popup's own cancel replacing "/image" with an
// empty paragraph, typing elsewhere, a reload) left it stale, and the insert
// replaced part of whatever block now sat there — the start of the next block
// was eaten (C11).
//
// The target follows the doc through every transaction while the popup is
// open.  An insert replaces the placeholder only if it is still exactly the
// block it was; otherwise the new block is inserted at its place without
// replacing anything.

import type { Editor } from '@tiptap/core';

export interface InsertTarget {
  /** Put `content` where the placeholder is (replacing it while it is intact). */
  insert(content: Record<string, unknown>): void;
  /** Turn an intact placeholder back into an empty paragraph (cancel). */
  clear(): void;
  /** Stop following the doc. */
  dispose(): void;
}

export function trackInsertTarget(editor: Editor, range: { from: number; to: number }): InsertTarget {
  let from = range.from;
  let to = range.to;
  let placeholderGone = false;
  const placeholderType = editor.state.doc.nodeAt(range.from)?.type.name ?? null;

  const onTransaction = ({ transaction }: { transaction: any }) => {
    if (!transaction.docChanged) return;
    // Outward bias: a change to the placeholder node itself (an id or attr
    // stamped on it rewrites its open/close tokens) keeps it inside the range.
    const start = transaction.mapping.mapResult(from, -1);
    const end = transaction.mapping.mapResult(to, 1);
    if (start.deleted && end.deleted) placeholderGone = true;
    from = start.pos;
    to = Math.max(start.pos, end.pos);
  };
  editor.on('transaction', onTransaction);

  const intact = (): boolean => {
    if (placeholderGone) return false;
    const node = editor.state.doc.nodeAt(from);
    return !!node && node.type.name === placeholderType && from + node.nodeSize === to;
  };

  return {
    insert(content) {
      const at = Math.min(from, editor.state.doc.content.size);
      if (intact()) editor.chain().insertContentAt({ from, to }, content).focus().run();
      else editor.chain().insertContentAt(at, content).focus().run();
    },
    clear() {
      if (intact()) editor.chain().insertContentAt({ from, to }, { type: 'paragraph' }).focus().run();
    },
    dispose() {
      editor.off('transaction', onTransaction);
    },
  };
}
