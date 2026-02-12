// view.ts — generic view interface with lifecycle
import { IDisposable, Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';

// ─── View State ──────────────────────────────────────────────────────────────

/**
 * Serialisable state blob returned by a view's `saveState()`.
 */
export type ViewState = Record<string, unknown>;

// ─── IView ───────────────────────────────────────────────────────────────────

/**
 * Contract for content-based UI elements hosted inside parts.
 *
 * Views are layout-agnostic — they receive dimensions but don't control
 * their placement. They manage their own internal state and DOM.
 *
 * Lifecycle: createElement → setVisible(true) → layout → focus → … → dispose
 */
export interface IView extends IDisposable {
  /** Unique identifier. */
  readonly id: string;

  /** Human-readable name shown in tabs. */
  readonly name: string;

  /** Optional icon identifier (CSS class or codicon). */
  readonly icon?: string;

  /** The root DOM element (available after createElement). */
  readonly element: HTMLElement | undefined;

  // ── Size Constraints ──

  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;

  // ── Lifecycle ──

  /** Create the view's DOM structure inside the given container. */
  createElement(container: HTMLElement): void;

  /** Show or hide the view without disposing it. */
  setVisible(visible: boolean): void;

  /** Respond to dimension changes. */
  layout(width: number, height: number): void;

  /** Receive keyboard focus. */
  focus(): void;

  // ── State ──

  /** Persist view-specific state. */
  saveState(): ViewState;

  /** Restore view-specific state. */
  restoreState(state: ViewState): void;

  // ── Events ──

  /** Fires when size constraints change. */
  readonly onDidChangeConstraints: Event<void>;

  /** Fires when visibility changes. */
  readonly onDidChangeVisibility: Event<boolean>;
}

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

    this._element = document.createElement('div');
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