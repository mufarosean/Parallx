// grid.ts — core grid splitting/resizing logic

import { Disposable, DisposableStore, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { startDrag, endDrag } from '../ui/dom.js';
import { Orientation, SizingMode, SashState } from './layoutTypes.js';
import { IGridView } from './gridView.js';
import { GridBranchNode, GridLeafNode, GridNode, GridNodeType } from './gridNode.js';
import {
  SerializedGrid,
  SerializedBranchNode,
  SerializedNodeType,
} from './layoutModel.js';

/**
 * Event data for grid structural changes.
 */
interface GridChangeEvent {
  readonly type: 'add' | 'remove' | 'resize' | 'structure';
  readonly viewId?: string;
}

/**
 * Constraint-based grid system.
 *
 * Supports:
 * - Adding/removing views in any direction (split horizontal/vertical)
 * - Size constraint enforcement (min/max width/height)
 * - Proportional resizing when container resizes
 * - Nested grids (grids within grid cells)
 * - Serialization to/from JSON
 * - Sash (resize handle) rendering between cells
 * - Events for structural changes
 */
export class Grid extends Disposable {
  private _root: GridBranchNode;
  private _width: number;
  private _height: number;
  private readonly _views = new Map<string, GridLeafNode>();
  private readonly _disposables = this._register(new DisposableStore());
  private _sashDragState: SashDragState | null = null;

  // ── Events ──

  private readonly _onDidChange = this._register(new Emitter<GridChangeEvent>());
  readonly onDidChange: Event<GridChangeEvent> = this._onDidChange.event;

  private readonly _onDidSashReset = this._register(new Emitter<{ branch: GridBranchNode; sashIndex: number }>());
  /** Fires when the user double-clicks a sash to request a size reset. */
  readonly onDidSashReset: Event<{ branch: GridBranchNode; sashIndex: number }> = this._onDidSashReset.event;

  private readonly _onDidSashSnap = this._register(new Emitter<{ viewId: string }>());
  /**
   * Fires when the user drags a sash past a snap threshold, requesting
   * that the adjacent snappable view be hidden.
   *
   * VS Code ref: `SplitView.onDidSashChange` → snap detection.
   * The consumer (layout.ts) maps `viewId` to the appropriate toggle method.
   */
  readonly onDidSashSnap: Event<{ viewId: string }> = this._onDidSashSnap.event;

  constructor(rootOrientation: Orientation, width: number, height: number) {
    super();
    this._width = width;
    this._height = height;
    this._root = this._register(new GridBranchNode(rootOrientation));
  }

  // ── Public API ──

  get root(): GridBranchNode {
    return this._root;
  }

  get element(): HTMLElement {
    return this._root.element;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get orientation(): Orientation {
    return this._root.orientation;
  }

  get viewCount(): number {
    return this._views.size;
  }

  /**
   * Get a view by its ID.
   */
  getView(viewId: string): IGridView | undefined {
    return this._views.get(viewId)?.view;
  }

  /**
   * Check if a view is in the grid.
   */
  hasView(viewId: string): boolean {
    return this._views.has(viewId);
  }

  /**
   * Get a view's current size along the parent branch's orientation.
   * Returns `undefined` if the view is not in the grid.
   */
  getViewSize(viewId: string): number | undefined {
    const leaf = this._views.get(viewId);
    if (!leaf) return undefined;
    return this._getNodeSize(leaf);
  }

  /**
   * Add a view as a child of the root node.
   */
  addView(view: IGridView, size: number, index?: number): void {
    const leaf = new GridLeafNode(view, SizingMode.Pixel);
    leaf.cachedSize = size;
    this._views.set(view.id, leaf);
    this._root.addChild(leaf, index);
    this._onDidChange.fire({ type: 'add', viewId: view.id });
  }

  /**
   * Split an existing view, inserting a new view beside it.
   *
   * @param existingViewId - The view to split
   * @param newView - The new view to insert
   * @param size - Size to give the new view
   * @param splitOrientation - Direction of the split
   * @param insertBefore - If true, insert before the existing view
   */
  splitView(
    existingViewId: string,
    newView: IGridView,
    size: number,
    splitOrientation: Orientation,
    insertBefore = false
  ): void {
    const existingNode = this._views.get(existingViewId);
    if (!existingNode) {
      throw new Error(`View not found: ${existingViewId}`);
    }

    const newLeaf = new GridLeafNode(newView, SizingMode.Pixel);
    newLeaf.cachedSize = size;
    this._views.set(newView.id, newLeaf);

    this._insertLeafBeside(newLeaf, existingNode, size, splitOrientation, insertBefore);
    this._onDidChange.fire({ type: 'structure', viewId: newView.id });
  }

  /**
   * Place `leaf` next to `existingNode`, taking space from it.
   *
   * Shared by splitView (leaf is brand new) and moveView (leaf was just
   * detached from elsewhere in the tree). Keeping one implementation matters:
   * the size clamping and the cross-orientation wrap are the subtle parts, and
   * a second copy would drift from this one the first time either is touched.
   *
   * `leaf` must already be registered in `_views` and must NOT currently be
   * attached to a parent.
   */
  private _insertLeafBeside(
    leaf: GridLeafNode,
    existingNode: GridNode,
    size: number | undefined,
    splitOrientation: Orientation,
    insertBefore: boolean,
  ): void {
    const parent = this._findParent(existingNode);
    if (!parent) {
      throw new Error('Orphaned target node');
    }

    const existingIndex = parent.indexOfChild(existingNode);

    if (parent.orientation === splitOrientation) {
      // Same orientation — add as sibling, splitting the existing view's space.
      // VS Code parity: with no meaningful hint the new view gets half the
      // existing view's current size. A hint is still clamped for correctness.
      const insertIndex = insertBefore ? existingIndex : existingIndex + 1;
      const existingSize = this._getNodeSize(existingNode);
      const minExisting = this._getMinSizeAlongOrientation(existingNode, splitOrientation);
      const minNew = this._getMinSizeAlongOrientation(leaf, splitOrientation);

      // Ensure the split is at most what the existing view can give
      const hint = size ?? Math.floor(existingSize / 2);
      const clampedSize = Math.min(hint, existingSize - minExisting);
      const actualNewSize = Math.max(clampedSize, minNew);
      const actualExistingSize = Math.max(existingSize - actualNewSize, minExisting);

      this._setNodeSize(existingNode, actualExistingSize);
      leaf.cachedSize = actualNewSize;
      parent.addChild(leaf, insertIndex);
    } else {
      // Different orientation — wrap existing in a new branch
      parent.removeChild(existingIndex);

      const existingSize = this._getNodeSize(existingNode);
      const wrapper = new GridBranchNode(splitOrientation, existingSize, SizingMode.Pixel);
      const halfSize = Math.floor(existingSize / 2);
      this._setNodeSize(existingNode, halfSize);
      leaf.cachedSize = halfSize;

      if (insertBefore) {
        wrapper.addChild(leaf);
        wrapper.addChild(existingNode);
      } else {
        wrapper.addChild(existingNode);
        wrapper.addChild(leaf);
      }

      parent.addChild(wrapper, existingIndex);
    }
  }

  /**
   * Detach a leaf from its parent WITHOUT disposing it or its view.
   *
   * `removeView` cannot be reused for a move: it disposes the leaf, which
   * tears down the live view the move exists to preserve. Returns the leaf so
   * the caller can re-attach it.
   */
  private _detachLeaf(leaf: GridLeafNode): void {
    const parent = this._findParent(leaf);
    if (!parent) {
      throw new Error(`Orphaned view: ${leaf.view.id}`);
    }
    parent.removeChild(parent.indexOfChild(leaf));
    // A branch left holding one child is no longer a split. Collapsing here
    // (not after re-insertion) keeps the tree canonical at every moment, so
    // the target's parent lookup below sees the final shape.
    if (parent !== this._root) {
      if (parent.childCount === 0) {
        // Only reachable from an already non-canonical tree, but degrade
        // sanely: an empty branch is not a layout element. Remove it, and
        // collapse the grandparent if that removal leaves it a one-child
        // branch in turn.
        const grand = this._findParent(parent);
        if (grand) {
          grand.removeChild(grand.indexOfChild(parent));
          parent.dispose();
          if (grand.childCount === 1 && grand !== this._root) {
            this._collapseNode(grand);
          }
        }
      } else if (parent.childCount === 1) {
        this._collapseNode(parent);
      }
    }
  }

  /**
   * Move an existing view next to another one, preserving the live view.
   *
   * This is what makes a surface relocatable: the instance keeps running —
   * same session, same scroll, same in-flight work — and only its position in
   * the tree changes. Remove-then-add would destroy it, which is why
   * `removeView` (it disposes) cannot be used here.
   *
   * No-ops when the view is already the target, or when the move is
   * meaningless (a single-view grid has nowhere to move to).
   */
  moveView(
    viewId: string,
    targetViewId: string,
    splitOrientation: Orientation,
    insertBefore = false,
  ): void {
    if (viewId === targetViewId) return;

    const leaf = this._views.get(viewId);
    if (!leaf) throw new Error(`View not found: ${viewId}`);
    const target = this._views.get(targetViewId);
    if (!target) throw new Error(`View not found: ${targetViewId}`);

    // cachedSize is measured along the SOURCE parent's axis. It only means
    // anything as a split size when the split runs the same way; a 1000px
    // width fed into a vertical split would crush the target to its minimum.
    const sourceParent = this._findParent(leaf);
    const size = sourceParent?.orientation === splitOrientation && leaf.cachedSize > 0
      ? leaf.cachedSize
      : undefined;
    this._detachLeaf(leaf);
    // The target's parent is resolved AFTER the detach: collapsing the old
    // parent can reparent the target, and a lookup from before would insert
    // into a branch that is no longer in the tree.
    this._insertLeafBeside(leaf, target, size, splitOrientation, insertBefore);

    this._onDidChange.fire({ type: 'structure', viewId });
  }

  /**
   * Move an existing view to an outer edge of the grid, preserving the live
   * view. This is the drop-on-the-edge case, where the target is the whole
   * layout rather than a neighbouring view.
   */
  moveViewToEdge(
    viewId: string,
    edgeOrientation: Orientation,
    insertBefore = false,
    size?: number,
  ): void {
    const leaf = this._views.get(viewId);
    if (!leaf) throw new Error(`View not found: ${viewId}`);
    // Nothing to move relative to, and detaching would empty the grid.
    if (this._views.size < 2) return;

    // As in moveView: the detached cachedSize only means anything along the
    // axis it was measured on. An explicit size wins; otherwise fall back to
    // a quarter of the edge's axis when the old measure ran the other way.
    const axisTotal = edgeOrientation === Orientation.Horizontal ? this._width : this._height;
    const sourceParent = this._findParent(leaf);
    const share = size
      ?? (sourceParent?.orientation === edgeOrientation && leaf.cachedSize > 0
        ? leaf.cachedSize
        : Math.max(Math.floor(axisTotal / 4), 0) || leaf.cachedSize);
    this._detachLeaf(leaf);

    if (this._root.orientation === edgeOrientation) {
      leaf.cachedSize = share;
      this._root.addChild(leaf, insertBefore ? 0 : this._root.childCount);
    } else {
      // The root runs the other way, so the whole existing layout becomes
      // the moved leaf's sibling along the turned root.
      const restShare = Math.max(axisTotal - share, 0);
      const existingChildren: GridNode[] = [];
      while (this._root.childCount > 0) {
        const child = this._root.getChild(0);
        this._root.removeChild(0);
        existingChildren.push(child);
      }
      this._root.orientation = edgeOrientation;

      const rest: GridNode[] = [];
      if (existingChildren.length === 1) {
        // No wrapper around a single child — a one-child branch is not a
        // split, and leaving one mounted is exactly the non-canonical shape
        // _detachLeaf guards against. A lone BRANCH child sat perpendicular
        // to the old root, which makes it parallel to the turned one, so its
        // children are hoisted rather than nested same-orientation.
        const only = existingChildren[0];
        if (only.type === GridNodeType.Branch) {
          while (only.childCount > 0) {
            rest.push(only.getChild(0));
            only.removeChild(0);
          }
          only.dispose();
        } else {
          only.cachedSize = restShare;
          rest.push(only);
        }
      } else {
        const inner = new GridBranchNode(
          edgeOrientation === Orientation.Horizontal ? Orientation.Vertical : Orientation.Horizontal,
          restShare,
        );
        for (const child of existingChildren) inner.addChild(child);
        rest.push(inner);
      }

      leaf.cachedSize = share;
      if (insertBefore) {
        this._root.addChild(leaf);
        for (const node of rest) this._root.addChild(node);
      } else {
        for (const node of rest) this._root.addChild(node);
        this._root.addChild(leaf);
      }
    }

    this._onDidChange.fire({ type: 'structure', viewId });
  }

  /**
   * Remove a view from the grid.
   */
  removeView(viewId: string): IGridView | undefined {
    const leaf = this._views.get(viewId);
    if (!leaf) {
      return undefined;
    }

    const parent = this._findParent(leaf);
    if (!parent) {
      return undefined;
    }

    const index = parent.indexOfChild(leaf);
    parent.removeChild(index);
    this._views.delete(viewId);

    // If parent has only one child, collapse it into grandparent
    if (parent.childCount === 1 && parent !== this._root) {
      this._collapseNode(parent);
    }

    // Clean up empty root
    if (this._root.childCount === 0) {
      // Grid is empty — that's fine
    }

    this._onDidChange.fire({ type: 'remove', viewId });
    leaf.dispose();
    return leaf.view;
  }

  /**
   * Resize the entire grid (e.g., when the window resizes).
   */
  resize(width: number, height: number): void {
    const oldWidth = this._width;
    const oldHeight = this._height;
    this._width = width;
    this._height = height;

    // Proportionally redistribute sizes
    if (oldWidth > 0 && oldHeight > 0) {
      this._redistributeSizes(this._root, width, height, oldWidth, oldHeight);
    }

    this._layoutNode(this._root, width, height);
    this._updateSashStates();
    this._onDidChange.fire({ type: 'resize' });
  }

  /**
   * Resize the grid while keeping specific views at their current pixel
   * sizes.  The size delta is absorbed entirely by a designated flexible
   * view (typically the editor column).  Views not in `fixedViewIds` and
   * not equal to `flexViewId` are also kept at their current sizes.
   *
   * This mirrors VS Code behaviour where the sidebar, panel, and
   * auxiliary bar keep their widths/heights on window resize and only the
   * editor area grows or shrinks.
   */
  resizeWithFixedViews(
    width: number,
    height: number,
    flexViewId: string,
  ): void {
    this._width = width;
    this._height = height;

    // Walk the root branch and assign sizes: keep every child at its
    // current size except the flex view, which gets the remainder.
    this._distributeWithFlex(this._root, flexViewId);

    // Sizes are already correct from _distributeWithFlex — use direct
    // layout that skips _distributeSizes to avoid rounding re-scale jitter.
    this._layoutNodeDirect(this._root, width, height);
    this._onDidChange.fire({ type: 'resize' });
  }

  /**
   * For a branch node, keep all non-flex children at their current sizes
   * and assign the remaining space to the flex child.
   */
  private _distributeWithFlex(
    branch: GridBranchNode,
    flexViewId: string,
  ): void {
    const isHorizontal = branch.orientation === Orientation.Horizontal;
    const totalAvailable = isHorizontal ? this._width : this._height;

    let fixedTotal = 0;
    let flexChild: GridNode | null = null;

    for (const child of branch.children) {
      // Check if this child (or any descendant) contains the flex view
      if (this._nodeContainsView(child, flexViewId)) {
        flexChild = child;
      } else {
        fixedTotal += this._getNodeSize(child);
      }
    }

    if (flexChild) {
      const min = this._getMinSizeAlongOrientation(flexChild, branch.orientation);
      const flexSize = Math.max(min, totalAvailable - fixedTotal);
      this._setNodeSize(flexChild, flexSize);

      // Recurse into flex child if it's a branch (e.g. editorColumnAdapter
      // wrapping vGrid doesn't need this, but future-proofs the logic)
      if (flexChild.type === GridNodeType.Branch) {
        this._distributeWithFlex(flexChild, flexViewId);
      }
    }
  }

  /**
   * Check whether a grid node (leaf or branch) contains a view with the
   * given ID.
   */
  private _nodeContainsView(node: GridNode, viewId: string): boolean {
    if (node.type === GridNodeType.Leaf) {
      return node.view.id === viewId;
    }
    for (const child of node.children) {
      if (this._nodeContainsView(child, viewId)) return true;
    }
    return false;
  }

  /**
   * Resize a specific sash between two children.
   *
   * @param parentNode - The branch containing the sash
   * @param sashIndex - Index of the sash (between child[sashIndex] and child[sashIndex+1])
   * @param delta - Pixels to move the sash (positive = increase first child)
   */
  resizeSash(parentNode: GridBranchNode, sashIndex: number, delta: number): number {
    const childA = parentNode.getChild(sashIndex);
    const childB = parentNode.getChild(sashIndex + 1);

    if (!childA || !childB) {
      return 0;
    }

    const sizeA = this._getNodeSize(childA);
    const sizeB = this._getNodeSize(childB);

    // Enforce constraints while preserving the total (zero-sum).
    // Two-pass clamping: first clamp A, then B, then re-clamp A against
    // the remainder so the pair total never changes.
    const total = sizeA + sizeB;
    const minA = this._getMinSizeAlongOrientation(childA, parentNode.orientation);
    const maxA = this._getMaxSizeAlongOrientation(childA, parentNode.orientation);
    const minB = this._getMinSizeAlongOrientation(childB, parentNode.orientation);
    const maxB = this._getMaxSizeAlongOrientation(childB, parentNode.orientation);

    let newSizeA = Math.min(maxA, Math.max(minA, sizeA + delta));
    let newSizeB = Math.min(maxB, Math.max(minB, total - newSizeA));
    // Re-clamp A to absorb any remainder from B's clamping
    newSizeA = Math.min(maxA, Math.max(minA, total - newSizeB));

    // Compute the actual applied delta (may differ from requested due to clamping)
    const appliedDelta = newSizeA - sizeA;

    this._setNodeSize(childA, newSizeA);
    this._setNodeSize(childB, newSizeB);

    // Re-layout only the two affected children so that sibling views
    // (e.g. the sidebar) are never touched by _distributeSizes.
    const isHorizontal = parentNode.orientation === Orientation.Horizontal;
    const crossSize = isHorizontal
      ? this._getNodeHeight(parentNode)
      : this._getNodeWidth(parentNode);

    if (isHorizontal) {
      this._setNodeDimensions(childA, newSizeA, crossSize);
      this._layoutNode(childA, newSizeA, crossSize);
      this._setNodeDimensions(childB, newSizeB, crossSize);
      this._layoutNode(childB, newSizeB, crossSize);
    } else {
      this._setNodeDimensions(childA, crossSize, newSizeA);
      this._layoutNode(childA, crossSize, newSizeA);
      this._setNodeDimensions(childB, crossSize, newSizeB);
      this._layoutNode(childB, crossSize, newSizeB);
    }

    // Update sash enablement state after resize
    this._updateSashStates();

    this._onDidChange.fire({ type: 'resize' });
    return appliedDelta;
  }

  /**
   * Layout the entire grid tree, distributing space to all nodes.
   */
  layout(): void {
    this._layoutNode(this._root, this._width, this._height);
    this._updateSashStates();
  }

  /**
   * Serialize the entire grid to a JSON-compatible structure.
   */
  serialize(): SerializedGrid {
    return {
      root: this._root.serialize(),
      orientation: this._root.orientation,
      width: this._width,
      height: this._height,
    };
  }

  /**
   * Deserialize a grid from saved state, using a view factory to create views.
   */
  static deserialize(
    state: SerializedGrid,
    viewFactory: (viewId: string) => IGridView
  ): Grid {
    const grid = new Grid(state.orientation, state.width, state.height);
    grid._deserializeNode(grid._root, state.root, viewFactory);
    grid.layout();
    return grid;
  }

  /**
   * Replace this grid's contents in place from serialized state.
   *
   * `deserialize` builds a NEW grid, and with it a new root element, which
   * forces whoever mounted the old one to re-mount. Restoring in place keeps
   * the mounted element stable, so switching layouts is a content change
   * rather than DOM surgery.
   *
   * Views still in the tree are removed through the normal path first; as
   * everywhere else in the grid, view LIFETIME stays the caller's business —
   * removal detaches, it does not dispose. The state's width/height are
   * ignored in favour of the grid's current ones: the window did not change
   * size just because the layout did.
   */
  restoreFrom(state: SerializedGrid, viewFactory: (viewId: string) => IGridView): void {
    for (const id of [...this._views.keys()]) {
      this.removeView(id);
    }
    this._root.orientation = state.orientation;
    this._deserializeNode(this._root, state.root, viewFactory);
    this.layout();
  }

  /**
   * Initialize sash drag handling on this grid's DOM.
   * Call after the grid element is mounted in the document.
   */
  initializeSashDrag(): void {
    this._root.element.addEventListener('mousedown', this._onSashMouseDown);
    this._disposables.add(toDisposable(() => {
      this._root.element.removeEventListener('mousedown', this._onSashMouseDown);
    }));

    // Double-click on sash fires onDidSashReset (VS Code parity: Sash.onDidReset)
    const onDblClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('grid-sash')) return;
      e.preventDefault();
      const sashIndex = parseInt(target.dataset.sashIndex ?? '0', 10);
      const parent = target.parentElement;
      if (!parent) return;
      const branch = this._findBranchByElement(parent);
      if (!branch) return;
      this._onDidSashReset.fire({ branch, sashIndex });
    };
    this._root.element.addEventListener('dblclick', onDblClick);
    this._disposables.add(toDisposable(() => {
      this._root.element.removeEventListener('dblclick', onDblClick);
    }));
  }

  // ── Private: Layout ──

  /**
   * Recursively layout all nodes in the tree, distributing available space.
   */
  private _layoutNode(node: GridNode, width: number, height: number): void {
    if (node.type === GridNodeType.Leaf) {
      node.cachedSize =
        node.view.element.parentElement && this._getParentOrientation(node) === Orientation.Horizontal
          ? width
          : height;
      node.view.layout(width, height, this._getParentOrientation(node) ?? this._root.orientation);
      return;
    }

    // Branch node: distribute space among children
    const branch = node;
    const isHorizontal = branch.orientation === Orientation.Horizontal;
    const totalAvailable = isHorizontal ? width : height;
    // Sashes use negative margins (−2 px each side) so they overlay
    // adjacent children and consume zero net flex space.
    const availableForChildren = totalAvailable;

    const sizes = this._distributeSizes(branch, availableForChildren);

    for (let i = 0; i < branch.childCount; i++) {
      const child = branch.getChild(i);
      const childSize = sizes[i];

      if (isHorizontal) {
        const childWidth = childSize;
        const childHeight = height;
        this._setNodeSize(child, childWidth);
        this._setNodeDimensions(child, childWidth, childHeight);
        this._layoutNode(child, childWidth, childHeight);
      } else {
        const childWidth = width;
        const childHeight = childSize;
        this._setNodeSize(child, childHeight);
        this._setNodeDimensions(child, childWidth, childHeight);
        this._layoutNode(child, childWidth, childHeight);
      }
    }
  }

  /**
   * Layout nodes using their already-set cached sizes (skip _distributeSizes).
   * Used by resizeWithFixedViews where _distributeWithFlex has already computed
   * the correct sizes — avoids proportional re-scaling jitter from rounding.
   */
  private _layoutNodeDirect(node: GridNode, width: number, height: number): void {
    if (node.type === GridNodeType.Leaf) {
      node.cachedSize =
        node.view.element.parentElement && this._getParentOrientation(node) === Orientation.Horizontal
          ? width
          : height;
      node.view.layout(width, height, this._getParentOrientation(node) ?? this._root.orientation);
      return;
    }

    // Branch: use existing cached sizes directly
    const branch = node;
    const isHorizontal = branch.orientation === Orientation.Horizontal;

    for (let i = 0; i < branch.childCount; i++) {
      const child = branch.getChild(i);
      const childSize = this._getNodeSize(child);

      if (isHorizontal) {
        this._setNodeDimensions(child, childSize, height);
        this._layoutNodeDirect(child, childSize, height);
      } else {
        this._setNodeDimensions(child, width, childSize);
        this._layoutNodeDirect(child, width, childSize);
      }
    }
  }

  /**
   * Distribute available space among children, respecting constraints.
   */
  private _distributeSizes(branch: GridBranchNode, available: number): number[] {
    const children = branch.children;
    if (children.length === 0) return [];

    const sizes: number[] = [];
    let totalFixed = 0;

    // First pass: collect current sizes
    for (const child of children) {
      const currentSize = this._getNodeSize(child);
      sizes.push(currentSize);
      totalFixed += currentSize;
    }

    // Scale proportionally to fit available space
    if (totalFixed > 0 && Math.abs(totalFixed - available) > 1) {
      const scale = available / totalFixed;
      let remaining = available;

      for (let i = 0; i < sizes.length - 1; i++) {
        const min = this._getMinSizeAlongOrientation(children[i], branch.orientation);
        const max = this._getMaxSizeAlongOrientation(children[i], branch.orientation);
        sizes[i] = Math.round(Math.min(max, Math.max(min, sizes[i] * scale)));
        remaining -= sizes[i];
      }

      // Last child gets remainder to avoid rounding errors
      if (sizes.length > 0) {
        const lastIdx = sizes.length - 1;
        const min = this._getMinSizeAlongOrientation(children[lastIdx], branch.orientation);
        const max = this._getMaxSizeAlongOrientation(children[lastIdx], branch.orientation);
        sizes[lastIdx] = Math.min(max, Math.max(min, remaining));
      }
    }

    return sizes;
  }

  /**
   * Proportionally redistribute sizes when the grid container resizes.
   */
  private _redistributeSizes(
    node: GridBranchNode,
    newWidth: number,
    newHeight: number,
    oldWidth: number,
    oldHeight: number
  ): void {
    const isHorizontal = node.orientation === Orientation.Horizontal;
    const scale = isHorizontal
      ? oldWidth > 0 ? newWidth / oldWidth : 1
      : oldHeight > 0 ? newHeight / oldHeight : 1;

    for (const child of node.children) {
      const size = this._getNodeSize(child);
      this._setNodeSize(child, Math.round(size * scale));

      if (child.type === GridNodeType.Branch) {
        this._redistributeSizes(child, newWidth, newHeight, oldWidth, oldHeight);
      }
    }
  }

  // ── Private: Sash Drag ──

  private _onSashMouseDown = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('grid-sash')) {
      return;
    }

    e.preventDefault();
    const sashIndex = parseInt(target.dataset.sashIndex ?? '0', 10);
    const parent = target.parentElement;
    if (!parent) return;

    // Find the branch node owning this sash
    const branch = this._findBranchByElement(parent);
    if (!branch) return;

    const isHorizontal = branch.orientation === Orientation.Horizontal;
    const startPos = isHorizontal ? e.clientX : e.clientY;

    // ── Compute snap thresholds ──
    // VS Code ref: SplitView.onSashStart — computes snapBefore/snapAfter.
    // Threshold = floor(viewMinimumSize / 2). If the view is dragged past
    // its minimum by more than this threshold, it snaps shut (auto-hide).
    const childA = branch.getChild(sashIndex);
    const childB = branch.getChild(sashIndex + 1);
    let snapBeforeThreshold = 0;
    let snapBeforeViewId: string | null = null;
    let snapAfterThreshold = 0;
    let snapAfterViewId: string | null = null;

    if (childA?.type === GridNodeType.Leaf && childA.snap) {
      const minA = this._getMinSizeAlongOrientation(childA, branch.orientation);
      snapBeforeThreshold = Math.floor(minA / 2);
      snapBeforeViewId = childA.id;
    }
    if (childB?.type === GridNodeType.Leaf && childB.snap) {
      const minB = this._getMinSizeAlongOrientation(childB, branch.orientation);
      snapAfterThreshold = Math.floor(minB / 2);
      snapAfterViewId = childB.id;
    }

    this._sashDragState = {
      branch, sashIndex, startPos, isHorizontal,
      snapBeforeThreshold, snapBeforeViewId,
      snapAfterThreshold, snapAfterViewId,
    };

    // Visual feedback: add active class to sash during drag
    target.classList.add('active');

    // Use rAF-throttling so layout runs at most once per frame
    let rafId = 0;
    let pendingDelta = 0;
    let didSnap = false;

    const applyResize = () => {
      rafId = 0;
      if (!this._sashDragState || pendingDelta === 0 || didSnap) return;
      const appliedDelta = this.resizeSash(this._sashDragState.branch, this._sashDragState.sashIndex, pendingDelta);
      // Only advance startPos by the actually applied delta so the cursor
      // stays in sync with the sash position (VS Code parity).
      this._sashDragState.startPos += appliedDelta;

      // ── Snap detection ──
      // Once the sash pins at a constraint (appliedDelta ≈ 0), startPos
      // freezes at the constraint boundary.  From that point, each
      // frame's `pendingDelta` already equals the total distance from
      // the constraint (currentPos − frozenStartPos).  `overshoot` is
      // the per-frame difference between what the user wants and what
      // the grid allowed — which IS the total overshoot because startPos
      // didn't move.  No accumulation needed.
      //
      // Negative overshoot = user is shrinking childA (sash moves left/up)
      // Positive overshoot = user is shrinking childB (sash moves right/down)
      //
      // VS Code ref: SplitView.onSashChange — snap triggers when the
      // drag overshoot exceeds floor(viewMinimumSize / 2).
      const overshoot = pendingDelta - appliedDelta;
      pendingDelta = 0;

      const state = this._sashDragState;
      if (state.snapBeforeThreshold > 0 && overshoot < -state.snapBeforeThreshold) {
        didSnap = true;
        // Abort the drag before firing snap — toggleSidebar/togglePanel
        // will remove the view from the grid, invalidating the sash and
        // branch that this drag handler references.
        cleanupDrag();
        this._onDidSashSnap.fire({ viewId: state.snapBeforeViewId! });
        return;
      }
      if (state.snapAfterThreshold > 0 && overshoot > state.snapAfterThreshold) {
        didSnap = true;
        cleanupDrag();
        this._onDidSashSnap.fire({ viewId: state.snapAfterViewId! });
        return;
      }
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!this._sashDragState || didSnap) return;
      const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - this._sashDragState.startPos;
      if (Math.abs(delta) < 1) return;

      pendingDelta = delta;
      if (!rafId) {
        rafId = requestAnimationFrame(applyResize);
      }
    };

    /** Clean up drag state, listeners, and visual feedback. */
    const cleanupDrag = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      target.classList.remove('active');
      this._sashDragState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      endDrag();
    };

    const onMouseUp = () => {
      // Flush any pending resize before cleanup
      if (didSnap) return; // Already cleaned up by snap handler
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (pendingDelta !== 0) {
        applyResize();
      }
      if (!didSnap) {
        cleanupDrag();
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    startDrag(isHorizontal ? 'col-resize' : 'row-resize');
  };

  // NOTE: sash drags deliberately do NOT set `will-change: transform` on the
  // adjacent children. Promoting a pane subtree (PDF canvases, TipTap doc) to
  // its own compositor layer while animating WIDTH forces a full layer
  // re-raster every frame; under raster pressure Chromium paints the stale
  // texture stretched/clipped to the new bounds — the pane visually "jumps"
  // to a wrong size mid-drag even though DOM layout is correct.

  // ── Private: Sash State ──

  /**
   * Walk every sash in the tree and update its CSS class to reflect the
   * current constraint state (SashState).
   *
   * This mirrors VS Code's `SplitView.updateSashEnablement()` which sets
   * `SashState.Disabled`, `AtMinimum`, `AtMaximum`, or `Enabled` on each
   * sash after every resize, controlling directional CSS cursors so the
   * user sees visual feedback about which direction the sash can still
   * move.
   */
  private _updateSashStates(): void {
    this._updateBranchSashStates(this._root);
  }

  /**
   * Recursively update sash states for a single branch node.
   */
  private _updateBranchSashStates(branch: GridBranchNode): void {
    const sashes = branch.sashes;

    for (let i = 0; i < sashes.length; i++) {
      const sash = sashes[i];
      const childA = branch.getChild(i);
      const childB = branch.getChild(i + 1);
      if (!childA || !childB) continue;

      const sizeA = this._getNodeSize(childA);
      const sizeB = this._getNodeSize(childB);
      const minA = this._getMinSizeAlongOrientation(childA, branch.orientation);
      const maxA = this._getMaxSizeAlongOrientation(childA, branch.orientation);
      const minB = this._getMinSizeAlongOrientation(childB, branch.orientation);
      const maxB = this._getMaxSizeAlongOrientation(childB, branch.orientation);

      // Can A grow? A grows if A < maxA AND B > minB (B can shrink to make room)
      const canGrowA = sizeA < maxA && sizeB > minB;
      // Can A shrink? A shrinks if A > minA AND B < maxB (B can grow to absorb)
      const canShrinkA = sizeA > minA && sizeB < maxB;

      let state: SashState;
      if (!canGrowA && !canShrinkA) {
        state = SashState.Disabled;
      } else if (!canShrinkA) {
        state = SashState.AtMinimum;
      } else if (!canGrowA) {
        state = SashState.AtMaximum;
      } else {
        state = SashState.Enabled;
      }

      // Apply CSS classes
      sash.classList.toggle('sash-disabled', state === SashState.Disabled);
      sash.classList.toggle('sash-minimum', state === SashState.AtMinimum);
      sash.classList.toggle('sash-maximum', state === SashState.AtMaximum);
      sash.classList.toggle('sash-enabled', state === SashState.Enabled);
    }

    // Recurse into child branches
    for (const child of branch.children) {
      if (child.type === GridNodeType.Branch) {
        this._updateBranchSashStates(child);
      }
    }
  }

  // ── Private: Deserialization ──

  private _deserializeNode(
    parent: GridBranchNode,
    serialized: SerializedBranchNode,
    viewFactory: (viewId: string) => IGridView
  ): void {
    for (const childState of serialized.children) {
      if (childState.type === SerializedNodeType.Leaf) {
        const view = viewFactory(childState.viewId);
        const leaf = new GridLeafNode(view, childState.sizingMode);
        leaf.cachedSize = childState.size;
        this._views.set(view.id, leaf);
        parent.addChild(leaf);
      } else {
        const branch = new GridBranchNode(
          childState.orientation,
          childState.size,
          childState.sizingMode
        );
        parent.addChild(branch);
        this._deserializeNode(branch, childState, viewFactory);
      }
    }
  }

  // ── Private: Tree Traversal ──

  private _findParent(target: GridNode): GridBranchNode | undefined {
    return this._findParentIn(this._root, target);
  }

  private _findParentIn(branch: GridBranchNode, target: GridNode): GridBranchNode | undefined {
    for (const child of branch.children) {
      if (child === target) {
        return branch;
      }
      if (child.type === GridNodeType.Branch) {
        const found = this._findParentIn(child, target);
        if (found) return found;
      }
    }
    return undefined;
  }

  private _findBranchByElement(element: HTMLElement): GridBranchNode | undefined {
    return this._findBranchByElementIn(this._root, element);
  }

  private _findBranchByElementIn(
    branch: GridBranchNode,
    element: HTMLElement
  ): GridBranchNode | undefined {
    if (branch.element === element) return branch;
    for (const child of branch.children) {
      if (child.type === GridNodeType.Branch) {
        const found = this._findBranchByElementIn(child, element);
        if (found) return found;
      }
    }
    return undefined;
  }

  private _getParentOrientation(node: GridNode): Orientation {
    const parent = this._findParent(node);
    return parent?.orientation ?? this._root.orientation;
  }

  /**
   * Collapse a branch node that has only one child into its parent.
   */
  private _collapseNode(branch: GridBranchNode): void {
    const parent = this._findParent(branch);
    if (!parent) return;

    const index = parent.indexOfChild(branch);
    const onlyChild = branch.getChild(0);
    branch.removeChild(0);
    parent.removeChild(index);
    // The child's own size was measured along the collapsing branch's axis;
    // the slot it is promoted into runs along the parent's. Hand it the
    // branch's slot size, or the subtree shrinks to a stale perpendicular
    // measure on the next layout.
    if (branch.size > 0) {
      this._setNodeSize(onlyChild, branch.size);
    }
    parent.addChild(onlyChild, index);
    branch.dispose();
  }

  // ── Private: Size Helpers ──

  private _getNodeSize(node: GridNode): number {
    if (node.type === GridNodeType.Leaf) {
      return node.cachedSize;
    }
    return node.size;
  }

  private _setNodeSize(node: GridNode, size: number): void {
    if (node.type === GridNodeType.Leaf) {
      node.cachedSize = size;
    } else {
      node.size = size;
    }
  }

  private _setNodeDimensions(node: GridNode, width: number, height: number): void {
    const el = node.type === GridNodeType.Leaf ? node.view.element : node.element;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.flexBasis = `${node.type === GridNodeType.Leaf ? node.cachedSize : node.size}px`;
    el.style.flexGrow = '0';
    el.style.flexShrink = '0';
  }

  private _getNodeWidth(_node: GridNode): number {
    // Use cached grid width instead of el.clientWidth to avoid
    // synchronous reflow when called between style writes.
    return this._width;
  }

  private _getNodeHeight(_node: GridNode): number {
    // Use cached grid height instead of el.clientHeight to avoid
    // synchronous reflow when called between style writes.
    return this._height;
  }

  private _getMinSizeAlongOrientation(node: GridNode, orientation: Orientation): number {
    if (node.type === GridNodeType.Leaf) {
      return orientation === Orientation.Horizontal
        ? node.minimumWidth
        : node.minimumHeight;
    }
    // Branch: sum of children minimums if same orientation, max if cross
    if (node.orientation === orientation) {
      let sum = 0;
      for (const child of node.children) {
        sum += this._getMinSizeAlongOrientation(child, orientation);
      }
      return sum;
    } else {
      let max = 0;
      for (const child of node.children) {
        max = Math.max(max, this._getMinSizeAlongOrientation(child, orientation));
      }
      return max;
    }
  }

  private _getMaxSizeAlongOrientation(node: GridNode, orientation: Orientation): number {
    if (node.type === GridNodeType.Leaf) {
      return orientation === Orientation.Horizontal
        ? node.maximumWidth
        : node.maximumHeight;
    }
    if (node.orientation === orientation) {
      let sum = 0;
      for (const child of node.children) {
        const max = this._getMaxSizeAlongOrientation(child, orientation);
        sum = max === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : sum + max;
        if (sum === Number.POSITIVE_INFINITY) break;
      }
      return sum;
    } else {
      let min = Number.POSITIVE_INFINITY;
      for (const child of node.children) {
        min = Math.min(min, this._getMaxSizeAlongOrientation(child, orientation));
      }
      return min;
    }
  }

  override dispose(): void {
    // Dispose all leaf nodes
    for (const leaf of this._views.values()) {
      leaf.dispose();
    }
    this._views.clear();
    super.dispose();
  }
}

/**
 * Internal state for sash drag operations.
 */
interface SashDragState {
  branch: GridBranchNode;
  sashIndex: number;
  startPos: number;
  isHorizontal: boolean;
  /**
   * Snap threshold for childA (the child before the sash).
   * If childA.snap is true, this is `floor(minA / 2)` — the point past
   * minimum where the view auto-hides. `0` means no snap for childA.
   */
  snapBeforeThreshold: number;
  /** View ID of childA, used when firing onDidSashSnap. */
  snapBeforeViewId: string | null;
  /**
   * Snap threshold for childB (the child after the sash).
   * If childB.snap is true, this is `floor(minB / 2)` — the point past
   * minimum where the view auto-hides. `0` means no snap for childB.
   */
  snapAfterThreshold: number;
  /** View ID of childB, used when firing onDidSashSnap. */
  snapAfterViewId: string | null;
}
