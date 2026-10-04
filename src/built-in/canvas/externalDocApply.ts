// externalDocApply.ts — put another writer's doc into an open editor
//
// When an external writer (an AI tool, a sidebar op, another window) changed a
// page, the open editor must not be rebuilt: that resets cursor, scroll and
// selection and flickers.  The top-level blocks are diffed by content and
// UniqueID, and only the changed span is replaced, in ONE history-free
// transaction that maps the user's selection through it.
//
// Focused-block protection: when the user's caret is INSIDE the changed span
// and the editor has focus, their block is kept verbatim as long as the
// incoming doc still has it (by id); everything around it still updates.  A
// block the incoming doc no longer has is replaced like any other: unsaved
// typing in it was already carried into the incoming doc by the reload merge
// (reloadMerge.ts), so a missing block is meant to be gone.  Keeping it used
// to show a block storage no longer had, and the next save wrote it back.
//
// Throws on a schema mismatch; the caller falls back to a full setContent.

import type { EditorView } from '@tiptap/pm/view';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { diffTopLevel, computeReplaceRange } from './canvasDocDiff.js';

/** Returns true when the doc now matches (or already did). */
export function applyExternalDoc(view: EditorView, newDocJson: { type: string; content?: unknown[] }): boolean {
  const state = view.state;
  const oldChildren = ((state.doc.toJSON() as { content?: unknown[] }).content ?? []);
  const newChildren = (newDocJson.content ?? []);
  if (newChildren.length === 0) return false; // empty doc → let setContent normalize

  const diff = diffTopLevel(oldChildren, newChildren);
  if (!diff) return true; // identical — nothing to apply

  const schema = state.schema;
  const buildNodes = (jsons: readonly unknown[]) => jsons.map((j) => schema.nodeFromJSON(j));

  // Block-index → doc-position helper (top-level children start at 0).
  const posOf = (index: number): number => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
    return pos;
  };

  // Focused-block protection — only when the user is actually in the span.
  const sel = state.selection;
  const cursorBlock = sel.$from.depth > 0 ? sel.$from.index(0) : -1;
  const userInSpan = view.hasFocus() && cursorBlock >= diff.start && cursorBlock < diff.oldEnd;

  // Locate the user's block in the incoming span by its stable id.
  let ni = -1;
  if (userInSpan) {
    const curId = (state.doc.child(cursorBlock).attrs as { id?: string } | null)?.id;
    if (typeof curId === 'string' && curId) {
      for (let i = diff.start; i < diff.newEnd; i++) {
        const attrs = (newChildren[i] as { attrs?: { id?: string } })?.attrs;
        if (attrs?.id === curId) { ni = i; break; }
      }
    }
  }

  const tr = state.tr;
  // Keep the user's block only while the incoming doc still has it. One
  // the other writer removed or replaced goes: unsaved typing in it was
  // already carried into the incoming doc by the reload merge, so a block
  // missing there is meant to be gone (keeping it showed a block storage
  // no longer had, and the next save wrote it back).
  if (userInSpan && ni >= 0) {
    // Keep the user's block verbatim; update everything around it. Apply
    // the LATER range first so the earlier range's positions stay valid.
    const before = buildNodes(newChildren.slice(diff.start, ni));
    const after = buildNodes(newChildren.slice(ni + 1, diff.newEnd));
    const pStart = posOf(diff.start);
    const pCur = posOf(cursorBlock);
    const pCurEnd = pCur + state.doc.child(cursorBlock).nodeSize;
    const pOldEnd = posOf(diff.oldEnd);
    if (pCurEnd < pOldEnd || after.length > 0) tr.replaceWith(pCurEnd, pOldEnd, after);
    if (pStart < pCur || before.length > 0) tr.replaceWith(pStart, pCur, before);
  } else {
    const { from, to } = computeReplaceRange(state.doc, diff);
    tr.replaceWith(from, to, buildNodes(newChildren.slice(diff.start, diff.newEnd)));
  }
  if (!tr.docChanged) return true;

  tr.setMeta('addToHistory', false).setMeta('canvasExternalApply', true);
  // A caret whose block went lands in the nearest text, never on a block
  // like a sub-page card, where the next keystroke would replace it.
  let next = sel.map(tr.doc, tr.mapping);
  if (sel instanceof TextSelection && !(next instanceof TextSelection)) {
    const $pos = tr.doc.resolve(next.from);
    next = Selection.findFrom($pos, -1, true) ?? Selection.findFrom($pos, 1, true) ?? next;
  }
  tr.setSelection(next);
  view.dispatch(tr);
  return true;
}
