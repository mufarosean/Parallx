// part.ts — base part class (structural container)
import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IGridView } from '../layout/gridView.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS, Dimensions, Orientation } from '../layout/layoutTypes.js';
import { IPart, PartPosition, PartState } from './partTypes.js';

/**
 * Abstract base class for all structural workbench parts.
 *
 * A Part is a layout-aware structural container that occupies a fixed region
 * in the workbench grid. It implements both `IPart` (lifecycle/state) and
 * `IGridView` (grid sizing/DOM) so the grid system can manage it directly.
 *
 * Concrete parts (TitlebarPart, SidebarPart, etc.) extend this class and
 * override `createContent()` to build their internal DOM.
 */
export abstract class Part extends Disposable implements IPart, IGridView {

  // ── DOM ──

  private _element!: HTMLElement;
  private _contentElement!: HTMLElement;
  private _titleElement: HTMLElement | undefined;
  private _created = false;

  private _width = 0;
  private _height = 0;
  private _visible: boolean;
  private _position: PartPosition;

  // ── Events ──

  private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
  readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

  private readonly _onDidChangeSize = this._register(new Emitter<Dimensions>());
  readonly onDidChangeSize: Event<Dimensions> = this._onDidChangeSize.event;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  constructor(
    readonly id: string,
    private readonly _name: string,
    position: PartPosition,
    private readonly _constraints: SizeConstraints = DEFAULT_SIZE_CONSTRAINTS,
    defaultVisible = true,
  ) {
    super();
    this._position = position;
    this._visible = defaultVisible;
  }

  // ── IGridView — element ──

  get element(): HTMLElement {
    if (!this._created) {
      throw new Error(`Part "${this.id}" has not been created yet. Call create() first.`);
    }
    return this._element;
  }

  /** Container element where child content (views) is mounted. */
  get contentElement(): HTMLElement {
    if (!this._created) {
      throw new Error(`Part "${this.id}" has not been created yet. Call create() first.`);
    }
    return this._contentElement;
  }

  // ── IGridView — size constraints ──

  get minimumWidth(): number { return this._constraints.minimumWidth; }
  get maximumWidth(): number { return this._constraints.maximumWidth; }
  get minimumHeight(): number { return this._constraints.minimumHeight; }
  get maximumHeight(): number { return this._constraints.maximumHeight; }

  // ── State ──

  get visible(): boolean { return this._visible; }
  get position(): PartPosition { return this._position; }
  get width(): number { return this._width; }
  get height(): number { return this._height; }
  get name(): string { return this._name; }

  // ── Lifecycle — create ──

  /**
   * Build the part's DOM structure. Called once, before the first mount.
   */
  create(parent: HTMLElement): void {
    if (this._created) {
      return; // idempotent
    }

    // Root element
    this._element = document.createElement('div');
    this._element.classList.add('part', `part-${this.id.replace(/\./g, '-')}`);
    this._element.setAttribute('role', 'region');
    this._element.setAttribute('aria-label', this._name);
    this._element.setAttribute('data-part-id', this.id);
    if (!this._visible) {
      this._element.classList.add('hidden');
    }

    // Optional title bar area (subclasses may use it)
    if (this.hasTitleArea) {
      this._titleElement = document.createElement('div');
      this._titleElement.classList.add('part-title');
      this._element.appendChild(this._titleElement);
      this.createTitleArea(this._titleElement);
    }

    // Content container — where views will be mounted
    this._contentElement = document.createElement('div');
    this._contentElement.classList.add('part-content');
    this._element.appendChild(this._contentElement);

    // Let the concrete part build its internals
    this.createContent(this._contentElement);

    this._created = true;

    // Append to parent
    parent.appendChild(this._element);
  }

  // ── Lifecycle — mount ──

  /**
   * Move the part's element into a new parent.
   * The part must already have been created.
   */
  mount(parent: HTMLElement): void {
    if (!this._created) {
      this.create(parent);
      return;
    }
    parent.appendChild(this._element);
  }

  // ── Lifecycle — layout ──

  /**
   * Called by the grid when this part's dimensions change.
   */
  layout(width: number, height: number, _orientation: Orientation): void {
    const changed = this._width !== width || this._height !== height;
    this._width = width;
    this._height = height;

    this._element.style.width = `${width}px`;
    this._element.style.height = `${height}px`;

    this.layoutContent(width, height);

    if (changed) {
      this._onDidChangeSize.fire({ width, height });
    }
  }

  // ── Visibility ──

  setVisible(visible: boolean): void {
    if (this._visible === visible) {
      return;
    }
    this._visible = visible;
    if (this._created) {
      this._element.classList.toggle('hidden', !visible);
    }
    this._onDidChangeVisibility.fire(visible);
  }

  // ── State persistence ──

  saveState(): PartState {
    return {
      id: this.id,
      visible: this._visible,
      width: this._width,
      height: this._height,
      position: this._position,
      data: this.savePartData(),
    };
  }

  restoreState(state: PartState): void {
    if (state.visible !== this._visible) {
      this.setVisible(state.visible);
    }
    this._position = state.position;
    if (state.data) {
      this.restorePartData(state.data);
    }
  }

  toJSON(): object {
    return {
      id: this.id,
      type: 'part',
      width: this._width,
      height: this._height,
      visible: this._visible,
    };
  }

  // ── Protected hooks for subclasses ──

  /** Whether this part renders a title bar. Override to return true. */
  protected get hasTitleArea(): boolean {
    return false;
  }

  /** Build the title area DOM. Override when `hasTitleArea` is true. */
  protected createTitleArea(_container: HTMLElement): void {
    // no-op by default
  }

  /** Build the part's content DOM structure. Subclasses must implement. */
  protected abstract createContent(container: HTMLElement): void;

  /** Called during layout(). Subclasses can react to dimension changes. */
  protected layoutContent(_width: number, _height: number): void {
    // no-op by default
  }

  /** Return part-specific data for persistence. Override to customise. */
  protected savePartData(): Record<string, unknown> | undefined {
    return undefined;
  }

  /** Restore part-specific data. Override to customise. */
  protected restorePartData(_data: Record<string, unknown>): void {
    // no-op by default
  }

  /** Notify the grid that constraints have changed. */
  protected fireConstraintsChanged(): void {
    this._onDidChangeConstraints.fire();
  }
}