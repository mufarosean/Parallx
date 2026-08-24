// gridNode.ts — internal grid tree structure

import { Disposable, IDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { Orientation, SizingMode } from './layoutTypes.js';
import { IGridView } from './gridView.js';
import {
  SerializedBranchNode,
  SerializedLeafNode,
  SerializedNodeType,
} from './layoutModel.js';
import { $ } from '../ui/dom.js';

// ─── Node Types ─────────────────────────────────────────────────────────────

export enum GridNodeType {
  Branch = 'branch',
  Leaf = 'leaf',
}

// ─── Grid Node (union) ──────────────────────────────────────────────────────

export type GridNode = GridBranchNode | GridLeafNode;

// ─── Branch Node ────────────────────────────────────────────────────────────

/**
 * A branch node in the grid tree. Splits space among children
 * along an orientation (horizontal or vertical).
 */
export class GridBranchNode extends Disposable {
  readonly type = GridNodeType.Branch;
  readonly element: HTMLElement;

  private _children: GridNode[] = [];
  private _sashes: HTMLElement[] = [];

  /** Public read-only access to sash DOM elements for state updates. */
  get sashes(): readonly HTMLElement[] {
    return this._sashes;
  }
  private readonly _childConstraintListeners = new Map<GridNode, IDisposable>();

  private readonly _onDidChange = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this._onDidChange.event;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  /**
   * A named region's identity, when this branch is one. Regions are
   * addressable (insert into, flex by id, edge-stamp) and keep-alive.
   */
  regionId: string | undefined;
  /** Exempt from canonical collapse: survives one or zero children. */
  keepAlive = false;

  constructor(
    private _orientation: Orientation,
    private _size: number = 0,
    private _sizingMode: SizingMode = SizingMode.Pixel
  ) {
    super();
    this.element = $('div');
    this.element.classList.add('grid-branch');
    this._applyStyles();
  }

  get orientation(): Orientation {
    return this._orientation;
  }

  /**
   * Re-orient a branch in place.
   *
   * Needed by `Grid.moveViewToEdge`: dropping a view on an edge that runs
   * across the root's axis has to turn the root, and the root's element is
   * already mounted in the workbench — swapping the node would mean swapping
   * live DOM. Turning it re-applies flex-direction and leaves the children
   * (and their views) untouched.
   *
   * Sizes along the new axis are the caller's problem: the grid re-layouts
   * after any structural change.
   */
  set orientation(value: Orientation) {
    if (this._orientation === value) return;
    this._orientation = value;
    this._applyStyles();
    // Sashes carry their axis in class and cursor; a turned branch that kept
    // its children needs them recut for the new axis.
    if (this._children.length > 0) this._rebuildSashes();
    this._onDidChange.fire();
  }

  get children(): readonly GridNode[] {
    return this._children;
  }

  get childCount(): number {
    return this._children.length;
  }

  get size(): number {
    return this._size;
  }

  set size(value: number) {
    this._size = value;
  }

  get sizingMode(): SizingMode {
    return this._sizingMode;
  }

  /**
   * Add a child node at a specific index. Creates a sash before it if needed.
   */
  addChild(child: GridNode, index: number = this._children.length): void {
    this._children.splice(index, 0, child);

    // Subscribe to child constraint changes and propagate upward
    if (child.onDidChangeConstraints) {
      const listener = child.onDidChangeConstraints(() => {
        this._onDidChangeConstraints.fire();
      });
      this._childConstraintListeners.set(child, listener);
    }

    // Insert ONLY the new element. Re-appending the siblings would detach
    // them from the document for a moment, and a detached iframe or webview
    // reloads — adding a view must never restart the ones already there.
    const next = this._children[index + 1];
    this.element.insertBefore(child.element, next ? next.element : null);
    this._rebuildSashes();
    this._onDidChange.fire();
  }

  /**
   * Remove a child node by index. Returns the removed node.
   */
  removeChild(index: number): GridNode {
    const [removed] = this._children.splice(index, 1);

    // Clean up constraint listener for the removed child
    this._childConstraintListeners.get(removed)?.dispose();
    this._childConstraintListeners.delete(removed);

    removed.element.remove();
    this._rebuildSashes();
    this._onDidChange.fire();
    return removed;
  }

  /**
   * Get child at index.
   */
  getChild(index: number): GridNode {
    return this._children[index];
  }

  /**
   * Find a child index by node reference.
   */
  indexOfChild(child: GridNode): number {
    return this._children.indexOf(child);
  }

  /**
   * Drop and recreate the sashes between children.
   *
   * Sashes are stateless handles, so recutting them is cheap. The children's
   * own elements are deliberately never touched here — see addChild for why.
   */
  private _rebuildSashes(): void {
    for (const sash of this._sashes) {
      sash.remove();
    }
    this._sashes = [];

    for (let i = 0; i < this._children.length - 1; i++) {
      const sash = this._createSash(i);
      this._sashes.push(sash);
      this._children[i].element.insertAdjacentElement('afterend', sash);
    }
  }

  /**
   * Create a resize sash handle between two children.
   */
  private _createSash(index: number): HTMLElement {
    const sash = $('div');
    sash.classList.add('grid-sash');

    if (this.orientation === Orientation.Horizontal) {
      sash.classList.add('grid-sash-vertical');
      sash.style.cursor = 'col-resize';
      // Size comes from CSS (--px-seam): the sash covers the card seam
      // exactly, and the hover line paints centered inside it (workbench.css).
    } else {
      sash.classList.add('grid-sash-horizontal');
      sash.style.cursor = 'row-resize';

    }

    sash.style.flexShrink = '0';
    sash.style.zIndex = '10';
    sash.dataset.sashIndex = String(index);

    return sash;
  }

  /**
   * Apply CSS styles for grid layout.
   */
  private _applyStyles(): void {
    this.element.style.display = 'flex';
    this.element.style.flexDirection =
      this.orientation === Orientation.Horizontal ? 'row' : 'column';
    this.element.style.overflow = 'hidden';
    this.element.style.width = '100%';
    this.element.style.height = '100%';
  }

  /**
   * Get sizes of all children in pixels for layout distribution.
   */
  getChildSizes(): number[] {
    return this._children.map((c) => {
      if (c.type === GridNodeType.Leaf) {
        return c.cachedSize;
      }
      return c.size;
    });
  }

  /**
   * Serialize this branch node.
   */
  serialize(): SerializedBranchNode {
    return {
      type: SerializedNodeType.Branch,
      orientation: this.orientation,
      size: this._size,
      sizingMode: this._sizingMode,
      children: this._children.map((child) => child.serialize()),
      ...(this.regionId ? { regionId: this.regionId } : {}),
      ...(this.keepAlive ? { keepAlive: true } : {}),
    };
  }

  override dispose(): void {
    for (const listener of this._childConstraintListeners.values()) {
      listener.dispose();
    }
    this._childConstraintListeners.clear();
    for (const sash of this._sashes) {
      sash.remove();
    }
    this._sashes = [];
    super.dispose();
  }
}

// ─── Leaf Node ──────────────────────────────────────────────────────────────

/**
 * A leaf node in the grid tree. Hosts a single IGridView.
 */
export class GridLeafNode extends Disposable {
  readonly type = GridNodeType.Leaf;
  private _cachedSize = 0;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  constructor(
    readonly view: IGridView,
    private _sizingMode: SizingMode = SizingMode.Pixel
  ) {
    super();

    // Forward constraint changes from the view
    this._register(
      view.onDidChangeConstraints(() => {
        this._onDidChangeConstraints.fire();
      })
    );
  }

  get element(): HTMLElement {
    return this.view.element;
  }

  get id(): string {
    return this.view.id;
  }

  get cachedSize(): number {
    return this._cachedSize;
  }

  set cachedSize(value: number) {
    this._cachedSize = value;
  }

  get sizingMode(): SizingMode {
    return this._sizingMode;
  }

  // ── Size Constraints (delegated to view) ──

  get minimumWidth(): number {
    return this.view.minimumWidth;
  }
  get maximumWidth(): number {
    return this.view.maximumWidth;
  }
  get minimumHeight(): number {
    return this.view.minimumHeight;
  }
  get maximumHeight(): number {
    return this.view.maximumHeight;
  }

  get snap(): boolean {
    return !!this.view.snap;
  }

  /**
   * Serialize this leaf node.
   */
  serialize(): SerializedLeafNode {
    return {
      type: SerializedNodeType.Leaf,
      viewId: this.view.id,
      size: this._cachedSize,
      sizingMode: this._sizingMode,
      minimumWidth: this.view.minimumWidth,
      maximumWidth: this.view.maximumWidth,
      minimumHeight: this.view.minimumHeight,
      maximumHeight: this.view.maximumHeight,
    };
  }

  override dispose(): void {
    super.dispose();
    // Note: we don't dispose the view here — the grid manages view lifecycle
  }
}
