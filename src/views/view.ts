// view.ts — generic view interface with lifecycle
import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';
export { DEFAULT_SIZE_CONSTRAINTS };
import { $ } from '../ui/dom.js';
import type { IView, ViewState } from './viewTypes.js';
export type { IView, ViewState } from './viewTypes.js';

// ─── Base View ───────────────────────────────────────────────────────────────

/**
 * Base class providing common implementation for IView.
 *
 * Subclasses override `createViewContent()` to build their internal DOM
 * and optionally override `layoutContent()`, `saveViewState()`,
 * `restoreViewState()`, and the constraint getters.
 */
export abstract class View extends Disposable implements IView {

  private _element: HTMLElement | undefined;
  private _width = 0;
  private _height = 0;
  private _visible = false;
  private _created = false;

  // ── Events ──

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
  readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly icon?: string,
    private readonly _constraints: SizeConstraints = DEFAULT_SIZE_CONSTRAINTS,
  ) {
    super();
  }

  // ── Element ──

  get element(): HTMLElement | undefined { return this._element; }
  get width(): number { return this._width; }
  get height(): number { return this._height; }
  get visible(): boolean { return this._visible; }

  // ── Size Constraints ──

  get minimumWidth(): number { return this._constraints.minimumWidth; }
  get maximumWidth(): number { return this._constraints.maximumWidth; }
  get minimumHeight(): number { return this._constraints.minimumHeight; }
  get maximumHeight(): number { return this._constraints.maximumHeight; }

  // ── Lifecycle — createElement ──

  createElement(container: HTMLElement): void {
    if (this._created) {
      // Idempotent: re-mount into new container
      if (this._element) {
        container.appendChild(this._element);
      }
      return;
    }

    this._element = $('div');
    this._element.classList.add('view', `view-${this.id}`);
    this._element.setAttribute('data-view-id', this.id);
    // .view CSS: overflow hidden, position relative, width/height 100%, display none

    this.createViewContent(this._element);
    this._created = true;

    container.appendChild(this._element);
  }

  // ── Lifecycle — visibility ──

  setVisible(visible: boolean): void {
    if (this._visible === visible) return;
    this._visible = visible;

    if (this._element) {
      this._element.classList.toggle('visible', visible);
    }

    this._onDidChangeVisibility.fire(visible);
  }

  // ── Lifecycle — layout ──

  layout(width: number, height: number): void {
    this._width = width;
    this._height = height;

    if (this._element) {
      this._element.style.width = `${width}px`;
      this._element.style.height = `${height}px`;
    }

    this.layoutContent(width, height);
  }

  // ── Lifecycle — focus ──

  focus(): void {
    this._element?.focus();
  }

  // ── State ──

  saveState(): ViewState {
    return this.saveViewState();
  }

  restoreState(state: ViewState): void {
    this.restoreViewState(state);
  }

  // ── Protected hooks ──

  /** Build the view's internal DOM. Subclasses must implement. */
  protected abstract createViewContent(container: HTMLElement): void;

  /** React to dimension changes. Override for custom layout logic. */
  protected layoutContent(_width: number, _height: number): void {
    // no-op by default
  }

  /** Return view-specific persistence data. */
  protected saveViewState(): ViewState {
    return {};
  }

  /** Restore view-specific persistence data. */
  protected restoreViewState(_state: ViewState): void {
    // no-op by default
  }

  /** Notify observers that constraints changed. */
  protected fireConstraintsChanged(): void {
    this._onDidChangeConstraints.fire();
  }
}