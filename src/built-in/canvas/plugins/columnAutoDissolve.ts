// columnAutoDissolve.ts — Auto-dissolve plugin for column layouts
//
// After every transaction, scans the document for columnList nodes that have
// been reduced to a single column (e.g. after deleting a column's content or
// dragging a block out). Replaces such columnLists with the remaining column's
// content so the blocks become normal top-level blocks.

import { Plugin, PluginKey } from '@tiptap/pm/state';

export function columnAutoDissolvePlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('columnAutoDissolve'),
    appendTransaction(transactions, _oldState, newState) {
      // Only run if a transaction actually changed the doc
      if (!transactions.some(tr => tr.docChanged)) return null;

      const { tr } = newState;
      let changed = false;

      // Walk the doc in reverse to avoid position shifting issues
      const positions: { pos: number; node: any }[] = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name === 'columnList') {
          positions.push({ pos, node });
          return false; // don't descend into columnList
        }
        return true;
      });

      // Process in reverse order (highest position first)
      for (let i = positions.length - 1; i >= 0; i--) {
        const { pos } = positions[i];
        const mappedPos = tr.mapping.map(pos);
        const liveNode = tr.doc.nodeAt(mappedPos);
        if (!liveNode || liveNode.type.name !== 'columnList') {
          continue;
        }

        // Count actual column children
        const columns: any[] = [];
        liveNode.forEach((child: any) => {
          if (child.type.name === 'column') {
            columns.push(child);
          }
        });

        if (columns.length <= 1 && columns.length > 0) {
          // Dissolve: replace columnList with the single remaining column's content
          const col = columns[0];
          tr.replaceWith(mappedPos, mappedPos + liveNode.nodeSize, col.content);
          changed = true;
          continue;
        }

        if (columns.length === 0) {
          // No columns at all — delete the empty columnList
          tr.delete(mappedPos, mappedPos + liveNode.nodeSize);
          changed = true;
        }
      }

      return changed ? tr : null;
    },
  });
}
