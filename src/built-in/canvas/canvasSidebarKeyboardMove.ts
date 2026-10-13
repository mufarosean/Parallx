// canvasSidebarKeyboardMove.ts — the keyboard's drag in the page tree.
//
// With a page selected in the sidebar: Ctrl+Shift+Up and Down move it among
// its siblings; Ctrl+Shift+Right puts it inside the page above it (last
// child); Ctrl+Shift+Left takes it out to sit after its parent. The same
// moves a drag makes, through the same movePageWithBlocks.
// docs/ACCESSIBILITY.md, section 6.

import type { IPageSummaryTreeNode } from './canvasTypes.js';

export interface IPageMove {
  readonly newParentId: string | null;
  /** Place after this sibling; undefined puts it first. */
  readonly afterSiblingId: string | undefined;
}

/** Where a Ctrl+Shift+arrow key moves the page, or null when the key is not one or it cannot go. */
export function pageMoveForKey(tree: readonly IPageSummaryTreeNode[], pageId: string, e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): IPageMove | null {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return null;
  const found = locate(tree, pageId, null);
  if (!found) return null;
  const { siblings, index, parent } = found;
  switch (e.key) {
    case 'ArrowUp':
      return index > 0 ? { newParentId: parent?.id ?? null, afterSiblingId: index > 1 ? siblings[index - 2]!.id : undefined } : null;
    case 'ArrowDown':
      return index < siblings.length - 1 ? { newParentId: parent?.id ?? null, afterSiblingId: siblings[index + 1]!.id } : null;
    case 'ArrowRight': {
      const above = siblings[index - 1];
      return above ? { newParentId: above.id, afterSiblingId: above.children[above.children.length - 1]?.id } : null;
    }
    case 'ArrowLeft': {
      if (!parent) return null;
      const outer = locate(tree, parent.id, null);
      return outer ? { newParentId: outer.parent?.id ?? null, afterSiblingId: parent.id } : null;
    }
    default:
      return null;
  }
}

function locate(nodes: readonly IPageSummaryTreeNode[], id: string, parent: IPageSummaryTreeNode | null): { siblings: readonly IPageSummaryTreeNode[]; index: number; parent: IPageSummaryTreeNode | null } | null {
  const index = nodes.findIndex((n) => n.id === id);
  if (index >= 0) return { siblings: nodes, index, parent };
  for (const n of nodes) {
    const inner = locate(n.children, id, n);
    if (inner) return inner;
  }
  return null;
}
