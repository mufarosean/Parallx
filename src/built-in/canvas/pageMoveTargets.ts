// pageMoveTargets.ts — where a page can be moved to (Move To…)
//
// Every page in the tree except the page itself and its own subpages (a page
// cannot go inside itself), and except databases (a page under a database
// would not be one of its rows). Depth-first, so the list reads like the
// sidebar.

export interface MoveTreeNode {
  readonly id: string;
  readonly title: string;
  readonly children: readonly MoveTreeNode[];
}

export interface MoveTarget {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
}

export function pageMoveTargets(
  tree: readonly MoveTreeNode[],
  pageId: string,
  isDatabase: (id: string) => boolean = () => false,
): MoveTarget[] {
  const out: MoveTarget[] = [];
  const walk = (nodes: readonly MoveTreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.id === pageId) continue;          // and its whole subtree
      if (isDatabase(node.id)) continue;         // its rows are not shown either
      out.push({ id: node.id, title: node.title || 'Untitled', depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}
