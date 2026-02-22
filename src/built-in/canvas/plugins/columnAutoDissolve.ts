// columnAutoDissolve.ts — Safety-net plugin for column layout invariants
//
// After every doc-changing transaction, dissolves orphaned columnLists (0 or 1
// column) that may result from undo, content deletion, or external plugins.
//
// Uses dissolveOrphanedColumnLists — NOT normalizeAllColumnLists — so that
// healthy 2+ column layouts keep their user-set widths and the plugin
// doesn't interfere with focus/selection in newly created columns.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { dissolveOrphanedColumnLists } from '../config/blockStateRegistry/blockStateRegistry.js';

export function columnAutoDissolvePlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('columnAutoDissolve'),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some(tr => tr.docChanged)) return null;

      const { tr } = newState;
      dissolveOrphanedColumnLists(tr);
      return tr.docChanged ? tr : null;
    },
  });
}
