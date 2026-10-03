// linkedPageCardGuard.ts — a page has one card
//
// A pageBlock card IS its child page (the hierarchy is held by the card and
// the page's parent_id together).  A copy of a card — Duplicate, Alt-drag,
// copy and paste, an AI insert — pointed a second card at the same page, and
// deleting either one archived the page the other still showed.
//
// After a transaction that inserted a card, any second card for the same page
// is removed again.  The card that was already on the page stays (found by
// mapping its old position); with none, the first stays.  Moves are untouched:
// a move inserts the card and deletes the original in one transaction, so it
// never leaves two.  History transactions are skipped.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { deleteDraggedRanges } from '../config/blockStateRegistry/blockStateRegistry.js';

const CARD_TYPE = 'pageBlock';

function sliceCarriesCard(step: any): boolean {
  const slice = step?.slice;
  if (!slice || slice.size === 0) return false;
  let found = false;
  slice.content.descendants((node: any) => {
    if (found) return false;
    if (node.type.name === CARD_TYPE) found = true;
    return !found;
  });
  return found;
}

function cardPositions(doc: any): Map<string, Array<{ pos: number; size: number }>> {
  const out = new Map<string, Array<{ pos: number; size: number }>>();
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== CARD_TYPE) return true;
    const pageId = node.attrs?.pageId;
    if (typeof pageId === 'string' && pageId) {
      const list = out.get(pageId) ?? [];
      list.push({ pos, size: node.nodeSize });
      out.set(pageId, list);
    }
    return false;
  });
  return out;
}

export function linkedPageCardGuardPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('canvasLinkedPageCardGuard'),
    appendTransaction(transactions, oldState, newState) {
      const relevant = transactions.filter((tr) => tr.docChanged && !tr.getMeta('history$'));
      if (relevant.length === 0) return null;
      if (!relevant.some((tr) => tr.steps.some(sliceCarriesCard))) return null;

      const now = cardPositions(newState.doc);
      const doubled = [...now].filter(([, list]) => list.length > 1);
      if (doubled.length === 0) return null;

      const before = cardPositions(oldState.doc);
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);

      const remove: Array<{ pos: number; size: number }> = [];
      for (const [pageId, list] of doubled) {
        let keep = 0;
        const old = before.get(pageId)?.[0];
        if (old) {
          const mapped = mapping.mapResult(old.pos, 1);
          const at = mapped.deleted ? -1 : list.findIndex((c) => c.pos === mapped.pos);
          if (at >= 0) keep = at;
        }
        list.forEach((card, i) => { if (i !== keep) remove.push(card); });
      }
      // The drag deletion policy: a column the copy alone filled goes with
      // it (and a layout left with one column dissolves).
      const tr = newState.tr;
      deleteDraggedRanges(tr, remove.map((card) => ({ from: card.pos, to: card.pos + card.size })));
      return tr.docChanged ? tr : null;
    },
  });
}
