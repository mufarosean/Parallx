// uniqueIdRepair.ts — one block, one id
//
// Block ids address blocks for the AI block tools, comments, links to a block
// and the cross-page move.  Tiptap's UniqueID only compares ids INSIDE the
// changed range, so a copy that carries the original's id passes it: Alt-drag,
// Duplicate (Mod-d, the block menu) and any insert of block JSON produced a
// second block with the same id.
//
// After a transaction that inserted id-carrying content, this gives every
// duplicate a fresh id.  The block that was already on the page keeps its id
// (found by mapping its old position); with no such block, the first keeps it.
// History transactions are skipped so undo restores the document exactly.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

function newBlockId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'b-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sliceCarriesIds(step: any): boolean {
  const slice = step?.slice;
  if (!slice || slice.size === 0) return false;
  let found = false;
  slice.content.descendants((node: any) => {
    if (found) return false;
    if (node.attrs?.id) found = true;
    return !found;
  });
  return found;
}

export function uniqueIdRepairPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('canvasUniqueIdRepair'),
    appendTransaction(transactions, oldState, newState) {
      const relevant = transactions.filter((tr) => tr.docChanged && !tr.getMeta('history$'));
      if (relevant.length === 0) return null;
      if (!relevant.some((tr) => tr.steps.some(sliceCarriesIds))) return null;

      const seen = new Map<string, number[]>();
      newState.doc.descendants((node, pos) => {
        const id = node.attrs?.id;
        if (typeof id === 'string' && id) {
          const list = seen.get(id);
          if (list) list.push(pos); else seen.set(id, [pos]);
        }
        return true;
      });
      const duplicated = [...seen].filter(([, list]) => list.length > 1);
      if (duplicated.length === 0) return null;

      const oldPos = new Map<string, number>();
      oldState.doc.descendants((node, pos) => {
        const id = node.attrs?.id;
        if (typeof id === 'string' && id && !oldPos.has(id)) oldPos.set(id, pos);
        return true;
      });
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);

      const tr = newState.tr;
      for (const [id, list] of duplicated) {
        let keep = 0;
        const before = oldPos.get(id);
        if (before !== undefined) {
          const mapped = mapping.mapResult(before, 1);
          const at = mapped.deleted ? -1 : list.indexOf(mapped.pos);
          if (at >= 0) keep = at;
        }
        list.forEach((pos, i) => {
          if (i !== keep) tr.setNodeAttribute(pos, 'id', newBlockId());
        });
      }
      return tr.docChanged ? tr : null;
    },
  });
}
