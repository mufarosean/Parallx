// listKeyboardPolicy.ts — Notion-parity Backspace at block-start boundaries
//
// Two ProseMirror defaults are destructive and were never rederived onto the
// canvas block model (the 2026-07-09 rebuild note flagged keyboard-boundary
// editing as un-rederived; user reports 2026-07-18 confirmed both):
//
//   1. Backspace at the start of a list row whose PREVIOUS sibling is another
//      row: joinBackward merges the two rows' textblocks — the row's bullet
//      vanishes and its text glues onto the previous row ("child1child2").
//      Notion instead OUTDENTS the row one level (top-level rows exit the
//      list in place, splitting it). ProseMirror's liftListItem implements
//      exactly those semantics for both nested and top-level rows.
//
//   2. Backspace at the start of a textblock right after an ATOM block
//      (equation, video, …): joinBackward deletes the atom outright. Notion
//      selects the atom first — the second Backspace confirms the delete.
//
// Only these two boundary cases are intercepted; everything else falls
// through to the existing keymaps (columnNodes' columnList guards, Tiptap's
// base chain — including the Notion-consistent paragraph-into-last-row merge
// after a list).

import { Extension } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { resolveMovableBlock } from '../config/blockRegistry.js';

export const ListKeyboardPolicy = Extension.create({
  name: 'listKeyboardPolicy',

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (!selection.empty || !$from.parent.isTextblock || $from.parentOffset !== 0) {
          return false;
        }

        // ── Atom guard: Backspace right after an atom block SELECTS it ──
        const blockDepth = $from.depth;
        const parentDepth = blockDepth - 1;
        const indexInParent = $from.index(parentDepth);
        const parentNode = parentDepth === 0 ? editor.state.doc : $from.node(parentDepth);
        const prevSibling = indexInParent > 0 ? parentNode.child(indexInParent - 1) : null;
        // Join-hostile guard: atoms AND code-bearing blocks (spec.code).
        // PM's joinBackward dissolves a codeBlock into the paragraph below,
        // converting its newlines to hardBreaks — one keystroke silently
        // liquefies the block (fuzzer find, seed 9). Same select-then-
        // confirm contract as atoms.
        if (prevSibling && prevSibling.isBlock && (prevSibling.isAtom || prevSibling.type.spec.code)) {
          const prevPos = $from.before(blockDepth) - prevSibling.nodeSize;
          const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, prevPos));
          editor.view.dispatch(tr);
          return true;
        }

        // ── List rows: outdent instead of merging into the previous row ──
        const unit = resolveMovableBlock($from);
        if (!unit || !unit.isListItem || unit.listPos === null) return false;
        // Only the row's OWN line (its first child) gets list semantics —
        // trailing blocks inside a row keep the default textblock merge.
        if ($from.before(blockDepth) !== unit.pos + 1) return false;
        // The FIRST nested row already lifts correctly via the default
        // chain; intercepting every row keeps the behavior uniform and
        // avoids the merge on middle/last rows.
        return editor.chain().liftListItem(unit.node.type.name as 'listItem' | 'taskItem').run();
      },

      // ── The list-item EXIT rule (Notion parity, M-canvas 2026-07-20) ──
      // A block (equation, image, code…) nested inside a list row leaves
      // the caret in trailing paragraphs INSIDE that row. Without this
      // rule every Enter just stacked more paragraphs into the same row —
      // the user could never reach the next numbered step ("the list
      // broke"; the equation-in-a-step complaint). Notion's contract:
      // Enter on an EMPTY line under a bullet exits to a NEW SIBLING row.
      // Split the row at the empty paragraph, then remove that paragraph
      // from the left half — cursor lands in the new row, numbering
      // continues at the same level.
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from } = selection;
        if (!selection.empty) return false;
        if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) return false;
        const itemDepth = $from.depth - 1;
        if (itemDepth < 1) return false;
        const item = $from.node(itemDepth);
        if (item.type.name !== 'listItem' && item.type.name !== 'taskItem') return false;
        // First child = the row's own line; splitListItem already owns it.
        if ($from.index(itemDepth) === 0) return false;

        const paraPos = $from.before($from.depth);
        try {
          const tr = state.tr.split($from.pos, 2);
          tr.delete(paraPos, paraPos + 2); // drop the emptied paragraph left behind
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        } catch {
          return false; // structure didn't permit the split — fall through
        }
      },

      // Forward mirror of the atom guard: Delete at the end of a textblock
      // right before an atom block deletes the atom outright in PM — select
      // it instead; the second Delete confirms.
      Delete: ({ editor }) => {
        const { selection } = editor.state;
        const { $from } = selection;
        if (!selection.empty || !$from.parent.isTextblock) return false;
        if ($from.parentOffset !== $from.parent.content.size) return false;

        const blockDepth = $from.depth;
        const parentDepth = blockDepth - 1;
        const indexInParent = $from.index(parentDepth);
        const parentNode = parentDepth === 0 ? editor.state.doc : $from.node(parentDepth);
        const nextSibling = indexInParent < parentNode.childCount - 1
          ? parentNode.child(indexInParent + 1)
          : null;
        if (nextSibling && nextSibling.isBlock && (nextSibling.isAtom || nextSibling.type.spec.code)) {
          const nextPos = $from.after(blockDepth);
          const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, nextPos));
          editor.view.dispatch(tr);
          return true;
        }
        return false;
      },
    };
  },
});
