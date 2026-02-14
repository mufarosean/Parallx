// layoutRenderer.ts — render UI from layout state

import { Disposable, DisposableStore, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { Orientation } from './layoutTypes.js';
import { IGridView } from './gridView.js';
import { Grid } from './grid.js';
import { SerializedGrid, SerializedLayoutState, createDefaultLayoutState } from './layoutModel.js';

/**
 * Renders and manages the grid layout within a container DOM element.
 *
 * Responsibilities:
 * - Mount grid to DOM from layout state
 * - Handle container resize events
 * - Update grid on state changes
 * - Clean up old DOM elements on re-render
 * - Apply CSS classes for styling hooks
 */
export class LayoutRenderer extends Disposable {
  private _grid: Grid | undefined;
  private readonly _disposables = this._register(new DisposableStore());
  private _resizeObserver: ResizeObserver | undefined;

  private readonly _onDidLayout = this._register(new Emitter<void>());
  /** Fired after the layout has been rendered or re-rendered. */
  readonly onDidLayout: Event<void> = this._onDidLayout.event;

  private readonly _onDidResize = this._register(new Emitter<{ width: number; height: number }>());
  /** Fired when the container is resized. */
  readonly onDidResize: Event<{ width: number; height: number }> = this._onDidResize.event;

  constructor(private readonly _container: HTMLElement) {
    super();
    this._applyContainerStyles();
  }

  // ── Public API ──

  /** The current grid instance. */
  get grid(): Grid | undefined {
    return this._grid;
  }

  /**
   * Render a grid from serialized layout state.
   * Uses the view factory to create IGridView instances for each leaf.
   */
  renderFromState(
    state: SerializedLayoutState,
    viewFactory: (viewId: string) => IGridView
  ): Grid {
    // Clean up existing grid
    this._disposeGrid();

    const grid = Grid.deserialize(state.grid, viewFactory);
    this._mountGrid(grid);
    return grid;
  }

  /**
   * Render a fresh grid with default layout.
   */
  renderDefault(
    viewFactory: (viewId: string) => IGridView
  ): Grid {
    const { width, height } = this._getContainerDimensions();
    const state = createDefaultLayoutState(width, height);
    return this.renderFromState(state, viewFactory);
  }

  /**
   * Render a grid from an already-constructed Grid instance.
   */
  renderGrid(grid: Grid): void {
    this._disposeGrid();
    this._mountGrid(grid);
  }

  /**
   * Create a new empty grid and mount it.
   */
  createEmptyGrid(orientation: Orientation = Orientation.Vertical): Grid {
    this._disposeGrid();
    const { width, height } = this._getContainerDimensions();
    const grid = new Grid(orientation, width, height);
    this._mountGrid(grid);
    return grid;
  }

  /**
   * Force a re-layout of the current grid using current container dimensions.
   */
  relayout(): void {
    if (!this._grid) return;
    const { width, height } = this._getContainerDimensions();
    this._grid.resize(width, height);
    this._onDidLayout.fire();
  }

  // ── Private ──

  /**
   * Mount a grid into the container DOM.
   */
  private _mountGrid(grid: Grid): void {
    this._grid = grid;
    this._disposables.add(grid);

    // Clear container and mount grid element
    this._clearContainer();
    this._container.appendChild(grid.element);
    grid.element.classList.add('parallx-grid-root');

    // Initialize sash drag handling
    grid.initializeSashDrag();

    // Perform initial layout
    const { width, height } = this._getContainerDimensions();
    grid.resize(width, height);

    // Watch for container resize
    this._watchResize();

    this._onDidLayout.fire();
  }

  /**
   * Dispose the current grid and clean up DOM.
   */
  private _disposeGrid(): void {
    this._unwatchResize();
    if (this._grid) {
      this._disposables.delete(this._grid);
      this._grid.dispose();
      this._grid = undefined;
    }
    this._clearContainer();
  }

  /**
   * Set up ResizeObserver on the container.
   */
  private _watchResize(): void {
    this._unwatchResize();
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this._container) {
          const { width, height } = entry.contentRect;
          if (this._grid && (width > 0 || height > 0)) {
            this._grid.resize(Math.floor(width), Math.floor(height));
            this._onDidResize.fire({ width: Math.floor(width), height: Math.floor(height) });
            this._onDidLayout.fire();
          }
        }
      }
    });
    this._resizeObserver.observe(this._container);
  }

  /**
   * Tear down ResizeObserver.
   */
  private _unwatchResize(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  /**
   * Remove all child elements from the container.
   */
  private _clearContainer(): void {
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }
  }

  /**
   * Read current container dimensions.
   */
  private _getContainerDimensions(): { width: number; height: number } {
    return {
      width: this._container.clientWidth || 800,
      height: this._container.clientHeight || 600,
    };
  }

  /**
   * Apply base CSS classes and styles to the container.
   */
  private _applyContainerStyles(): void {
    this._container.classList.add('parallx-layout-container', 'fill-container');
  }

  override dispose(): void {
    this._unwatchResize();
    this._disposeGrid();
    super.dispose();
  }
}
