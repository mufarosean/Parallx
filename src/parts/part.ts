// part.ts — base part class (structural container)
import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { IGridView } from '../layout/gridView.js';
import { SizeConstraints, DEFAULT_SIZE_CONSTRAINTS, Dimensions, Orientation } from '../layout/layoutTypes.js';
import { IPart, PartPosition, PartState } from './partTypes.js';
import { $ } from '../ui/dom.js';

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

  /**
   * Adopt an element built elsewhere as this part's root — the editor part
   * dissolving into a named region of the body tree keeps its Part API and
   * identity (classes, data-part-id) by stamping them onto the REGION's
   * element instead of owning a leaf of its own. Content and element are
   * the same node in that model.
   */
  protected _adoptExternalElement(element: HTMLElement): void {
    element.classList.add('part', `part-${this.id.replace(/\./g, '-')}`);
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', this.name);
    element.setAttribute('data-part-id', this.id);
    this._element = element;
    this._contentElement = element;
    this._created = true;
  }
  private _titleElement: HTMLElement | undefined;
  private _created = false;

  private _width = 0;
  private _height = 0;
  /** The content's size while the layout glides the box (holdContent). */
  private _held: { width: number; height: number; axis: 'width' | 'height'; anchor: 'start' | 'end' } | undefined;
  private _visible: boolean;
  /** Gliding shut: on screen until it lands, no longer counted as shown. */
  private _leaving = false;
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
    private readonly _snap = false,
  ) {
    super();
    this._position = position;
    this._visible = defaultVisible;
  }

  // ── IGridView — snap ──

  /** Whether this part snaps (auto-hides) when dragged past minimum. */
  get snap(): boolean { return this._snap; }

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

  // A part gliding open or shut may pass below its minimum on the way to
  // or from nothing (holdContent), so the grid lets it.
  get minimumWidth(): number { return this._held?.axis === 'width' ? 0 : this._constraints.minimumWidth; }
  get maximumWidth(): number { return this._constraints.maximumWidth; }
  get minimumHeight(): number { return this._held?.axis === 'height' ? 0 : this._constraints.minimumHeight; }
  get maximumHeight(): number { return this._constraints.maximumHeight; }

  // ── State ──

  get visible(): boolean { return this._visible && !this._leaving; }
  get constraints(): SizeConstraints { return this._constraints; }
  get position(): PartPosition { return this._position; }
  /** The content's size: the box's, or along a glide the size it holds. */
  get width(): number { return this._held?.axis === 'width' ? this._held.width : this._width; }
  get height(): number { return this._held?.axis === 'height' ? this._held.height : this._height; }
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
    this._element = $('div');
    this._element.classList.add('part', `part-${this.id.replace(/\./g, '-')}`);
    this._element.setAttribute('role', 'region');
    this._element.setAttribute('aria-label', this._name);
    this._element.setAttribute('data-part-id', this.id);
    if (!this._visible) {
      this._element.classList.add('hidden');
    }

    // Optional title bar area (subclasses may use it)
    if (this.hasTitleArea) {
      this._titleElement = $('div');
      this._titleElement.classList.add('part-title');
      this._element.appendChild(this._titleElement);
      this.createTitleArea(this._titleElement);
    }

    // Content container — where views will be mounted
    this._contentElement = $('div');
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

    // Gliding: the box moves, the content keeps its size and rides the edge.
    if (this._held) {
      this._placeHeldContent();
      return;
    }

    this.layoutContent(width, height);

    if (changed) {
      this._onDidChangeSize.fire({ width, height });
    }
  }

  // ── Show / hide motion ──

  /**
   * While the layout glides this part's box open or shut, keep the content
   * at its current full size instead of re-flowing it every frame: the box
   * clips it, and it stays against the MOVING edge (`anchor`, along `axis`),
   * so it slides in and out with that edge like a drawer. Minimum sizes are
   * off meanwhile, so the box can pass through nothing. Holding again keeps
   * the size already held (a glide reversed mid-way).
   */
  holdContent(axis: 'width' | 'height', anchor: 'start' | 'end'): void {
    if (!this._created) return;
    this._held = this._held
      ? { ...this._held, axis, anchor }
      : { width: this._width, height: this._height, axis, anchor };
    this._placeHeldContent();
  }

  /** The glide is over: the content takes the box's size again. */
  releaseContent(): void {
    if (!this._held) return;
    this._held = undefined;
    for (const child of this._heldChildren()) {
      child.style.width = '';
      child.style.height = '';
      child.style.flex = '';
      child.style.transform = '';
    }
    this.layoutContent(this._width, this._height);
    this._onDidChangeSize.fire({ width: this._width, height: this._height });
  }

  private _heldChildren(): HTMLElement[] {
    return [this._titleElement, this._contentElement].filter((e): e is HTMLElement => !!e && e !== this._element);
  }

  private _placeHeldContent(): void {
    const held = this._held;
    if (!held) return;
    const box = held.axis === 'width' ? this._width : this._height;
    const full = held.axis === 'width' ? held.width : held.height;
    // Against the trailing edge, the content's far side lines up with the
    // box's: it hangs out past the leading side, which the box clips.
    const shift = held.anchor === 'end' ? Math.min(0, box - full) : 0;
    const titleHeight = this._titleElement && this._titleElement !== this._element ? this._titleElement.offsetHeight : 0;
    for (const child of this._heldChildren()) {
      if (held.axis === 'width') {
        child.style.width = `${held.width}px`;
      } else if (child === this._contentElement) {
        child.style.height = `${Math.max(0, held.height - titleHeight)}px`;
        child.style.flex = 'none';
      }
      child.style.transform = shift === 0 ? '' : held.axis === 'width' ? `translateX(${shift}px)` : `translateY(${shift}px)`;
    }
  }

  // ── Visibility ──

  setVisible(visible: boolean): void {
    const was = this.visible;
    this._leaving = false;
    if (this._visible !== visible) {
      this._visible = visible;
      if (this._created) {
        this._element.classList.toggle('hidden', !visible);
      }
    }
    if (was !== visible) this._onDidChangeVisibility.fire(visible);
  }

  /**
   * The layout is gliding this part shut (true), or brought it back mid-way
   * (false). It stays on screen until the glide lands with setVisible(false),
   * but reads as hidden from the first frame, so "show it if hidden" (an
   * activity icon, a reveal) brings it straight back instead of watching it
   * finish leaving.
   */
  setLeaving(leaving: boolean): void {
    if (!this._visible || this._leaving === leaving) return;
    this._leaving = leaving;
    this._onDidChangeVisibility.fire(!leaving);
  }

  // ── State persistence ──

  saveState(): PartState {
    return {
      id: this.id,
      visible: this.visible,
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
      visible: this.visible,
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