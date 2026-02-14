// grid.ts — core grid splitting/resizing logic

import { Disposable, DisposableStore, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { startDrag, endDrag } from '../ui/dom.js';
import { Orientation, SizingMode } from './layoutTypes.js';
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

    const parent = this._findParent(existingNode);
    if (!parent) {
      throw new Error(`Orphaned view: ${existingViewId}`);
    }

    const existingIndex = parent.indexOfChild(existingNode);

    if (parent.orientation === splitOrientation) {
      // Same orientation — add as sibling, splitting the existing view's space.
      // VS Code parity: the new view gets half the existing view's current size.
      // The `size` param is a hint, but we clamp to ensure correctness.
      const insertIndex = insertBefore ? existingIndex : existingIndex + 1;
      const existingSize = existingNode.cachedSize;
      const minExisting = this._getMinSizeAlongOrientation(existingNode, splitOrientation);
      const minNew = this._getMinSizeAlongOrientation(newLeaf, splitOrientation);

      // Ensure the split is at most what the existing view can give
      const clampedSize = Math.min(size, existingSize - minExisting);
      const actualNewSize = Math.max(clampedSize, minNew);
      const actualExistingSize = Math.max(existingSize - actualNewSize, minExisting);

      existingNode.cachedSize = actualExistingSize;
      newLeaf.cachedSize = actualNewSize;
      parent.addChild(newLeaf, insertIndex);
    } else {
      // Different orientation — wrap existing in a new branch
      parent.removeChild(existingIndex);

      const wrapper = new GridBranchNode(splitOrientation, existingNode.cachedSize, SizingMode.Pixel);
      const halfSize = Math.floor(existingNode.cachedSize / 2);
      existingNode.cachedSize = halfSize;
      newLeaf.cachedSize = halfSize;

      if (insertBefore) {
        wrapper.addChild(newLeaf);
        wrapper.addChild(existingNode);
      } else {
        wrapper.addChild(existingNode);
        wrapper.addChild(newLeaf);
      }

      parent.addChild(wrapper, existingIndex);
    }

    this._onDidChange.fire({ type: 'structure', viewId: newView.id });
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
    this._onDidChange.fire({ type: 'resize' });
  }

  /**
   * Resize a specific sash between two children.
   *
   * @param parentNode - The branch containing the sash
   * @param sashIndex - Index of the sash (between child[sashIndex] and child[sashIndex+1])
   * @param delta - Pixels to move the sash (positive = increase first child)
   */
  resizeSash(parentNode: GridBranchNode, sashIndex: number, delta: number): void {
    const childA = parentNode.getChild(sashIndex);
    const childB = parentNode.getChild(sashIndex + 1);

    if (!childA || !childB) {
      return;
    }

    const sizeA = this._getNodeSize(childA);
    const sizeB = this._getNodeSize(childB);

    // Enforce constraints
    const minA = this._getMinSizeAlongOrientation(childA, parentNode.orientation);
    const maxA = this._getMaxSizeAlongOrientation(childA, parentNode.orientation);
    const minB = this._getMinSizeAlongOrientation(childB, parentNode.orientation);
    const maxB = this._getMaxSizeAlongOrientation(childB, parentNode.orientation);

    const newSizeA = Math.min(maxA, Math.max(minA, sizeA + delta));
    const newSizeB = Math.min(maxB, Math.max(minB, sizeB - (newSizeA - sizeA)));

    this._setNodeSize(childA, newSizeA);
    this._setNodeSize(childB, newSizeB);

    // Re-layout from this branch
    this._layoutNode(
      parentNode,
      this._getNodeWidth(parentNode),
      this._getNodeHeight(parentNode)
    );

    this._onDidChange.fire({ type: 'resize' });
  }

  /**
   * Layout the entire grid tree, distributing space to all nodes.
   */
  layout(): void {
    this._layoutNode(this._root, this._width, this._height);
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
    const sashCount = Math.max(0, branch.childCount - 1);
    const sashSpace = sashCount * 4; // 4px per sash
    const availableForChildren = totalAvailable - sashSpace;

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

    this._sashDragState = { branch, sashIndex, startPos, isHorizontal };

    // Visual feedback: add active class to sash during drag
    target.classList.add('active');

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!this._sashDragState) return;
      const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - this._sashDragState.startPos;
      if (Math.abs(delta) < 1) return;

      this.resizeSash(this._sashDragState.branch, this._sashDragState.sashIndex, delta);
      this._sashDragState.startPos = currentPos;
    };

    const onMouseUp = () => {
      target.classList.remove('active');
      this._sashDragState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      endDrag();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    startDrag(isHorizontal ? 'col-resize' : 'row-resize');
  };

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

  private _getNodeWidth(node: GridNode): number {
    const el = node.type === GridNodeType.Leaf ? node.view.element : node.element;
    return el.clientWidth || this._width;
  }

  private _getNodeHeight(node: GridNode): number {
    const el = node.type === GridNodeType.Leaf ? node.view.element : node.element;
    return el.clientHeight || this._height;
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
}
