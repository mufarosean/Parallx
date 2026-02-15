// gridView.ts — view interface for grid participation

import { IDisposable, Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS, Orientation } from './layoutTypes.js';
import { $,  hide, show } from '../ui/dom.js';

/**
 * Interface that views must implement to participate in the grid system.
 *
 * The grid calls `layout()` when dimensions change, reads size constraints
 * to enforce valid layouts, and uses `element` for DOM attachment.
 */
export interface IGridView extends IDisposable {
  /** The DOM element representing this view. */
  readonly element: HTMLElement;

  /** Unique identifier for this grid view. */
  readonly id: string;

  // ── Size Constraints (may be dynamic / computed) ──

  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;

  /**
   * Called by the grid when this view's dimensions change.
   * The view should resize its content to fit.
   */
  layout(width: number, height: number, orientation: Orientation): void;

  /**
   * Called when the view's visibility changes within the grid.
   */
  setVisible(visible: boolean): void;

  /**
   * Serialize view-specific state for persistence.
   */
  toJSON(): object;

  /**
   * Event fired when size constraints change, so the grid can revalidate.
   */
  readonly onDidChangeConstraints: Event<void>;

  /**
   * Whether the view should snap (auto-hide) when dragged past its
   * minimum size threshold, VS Code parity: IView.snap.
   *
   * @defaultValue `false`
   */
  readonly snap?: boolean;
}

/**
 * Factory signature used to reconstruct an IGridView from serialized state.
 *
 * `Grid.deserialize()` receives a `GridViewFactory` so each view type can
 * hydrate itself without coupling the grid to concrete view classes.
 */
export type GridViewFactory = (json: object) => IGridView;

/**
 * Base class providing common implementation for IGridView.
 *
 * Subclasses override size constraint getters and the `layoutContent()` method.
 */
export abstract class BaseGridView extends Disposable implements IGridView {
  private readonly _element: HTMLElement;
  private _width = 0;
  private _height = 0;
  private _visible = true;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  constructor(
    readonly id: string,
    private readonly _constraints: SizeConstraints = DEFAULT_SIZE_CONSTRAINTS
  ) {
    super();
    this._element = $('div');
    this._element.classList.add('grid-view', `grid-view-${id}`);
    this._element.style.overflow = 'hidden';
    this._element.style.position = 'relative';
  }

  // ── IGridView ──

  get element(): HTMLElement {
    return this._element;
  }

  get minimumWidth(): number {
    return this._constraints.minimumWidth;
  }
  get maximumWidth(): number {
    return this._constraints.maximumWidth;
  }
  get minimumHeight(): number {
    return this._constraints.minimumHeight;
  }
  get maximumHeight(): number {
    return this._constraints.maximumHeight;
  }

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get visible(): boolean {
    return this._visible;
  }

  layout(width: number, height: number, orientation: Orientation): void {
    this._width = width;
    this._height = height;
    this._element.style.width = `${width}px`;
    this._element.style.height = `${height}px`;
    this.layoutContent(width, height, orientation);
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    visible ? show(this._element) : hide(this._element);
  }

  toJSON(): object {
    return {
      id: this.id,
      width: this._width,
      height: this._height,
      visible: this._visible,
    };
  }

  /**
   * Notify the grid that our constraints have changed.
   */
  protected fireConstraintsChanged(): void {
    this._onDidChangeConstraints.fire();
  }

  /**
   * Reconstruct a BaseGridView subclass from serialised state.
   *
   * Subclasses should override this to return a concrete instance.
   * By default it throws — concrete views must provide the implementation.
   *
   * @example
   * ```ts
   * class MyView extends BaseGridView {
   *   static fromJSON(json: object): MyView { … }
   * }
   * ```
   */
  static fromJSON(_json: object): IGridView {
    throw new Error('BaseGridView.fromJSON must be overridden by subclasses');
  }

  /**
   * Override to update internal content when dimensions change.
   */
  protected abstract layoutContent(width: number, height: number, orientation: Orientation): void;
}
