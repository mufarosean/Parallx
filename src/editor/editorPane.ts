// editorPane.ts — abstract editor pane
//
// Renders the content of an editor input. The pane is the visual
// representation — it receives an EditorInput and produces DOM.
//
// Lifecycle: create → setInput → layout → clearInput → dispose
//
// Implements IGridView so the editor group grid can size it.
// Concrete panes extend this class for specific editor types
// (text, diff, welcome, etc.).

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IEditorInput } from './editorInput.js';
import type { SizeConstraints } from '../layout/layoutTypes.js';
import { DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';
import { $ } from '../ui/dom.js';

// ─── View State ──────────────────────────────────────────────────────────────

/**
 * Serializable view state for restoring scroll position, selection, etc.
 */
export type EditorPaneViewState = Record<string, unknown>;

// ─── IEditorPane ─────────────────────────────────────────────────────────────

export interface IEditorPane extends IDisposable {
  readonly id: string;
  readonly element: HTMLElement | undefined;
  readonly input: IEditorInput | undefined;

  create(container: HTMLElement): void;
  setInput(input: IEditorInput): Promise<void>;
  clearInput(): void;
  layout(width: number, height: number): void;
  focus(): void;
  saveViewState(): EditorPaneViewState;
  restoreViewState(state: EditorPaneViewState): void;

  readonly onDidChangeViewState: Event<void>;
}

// ─── EditorPane (abstract base) ──────────────────────────────────────────────

let _nextPaneId = 1;

/**
 * Abstract base class for editor panes.
 *
 * Subclasses implement `createPaneContent()` and `renderInput()`.
 */
export abstract class EditorPane extends Disposable implements IEditorPane {
  readonly id: string;

  private _element: HTMLElement | undefined;
  private _input: IEditorInput | undefined;
  private _width = 0;
  private _height = 0;
  private _created = false;

  private readonly _onDidChangeViewState = this._register(new Emitter<void>());
  readonly onDidChangeViewState: Event<void> = this._onDidChangeViewState.event;

  protected readonly constraints: SizeConstraints;

  constructor(id?: string, constraints?: SizeConstraints) {
    super();
    this.id = id ?? `editor-pane-${_nextPaneId++}`;
    this.constraints = constraints ?? DEFAULT_SIZE_CONSTRAINTS;
  }

  // ── Accessors ──

  get element(): HTMLElement | undefined { return this._element; }
  get input(): IEditorInput | undefined { return this._input; }
  get width(): number { return this._width; }
  get height(): number { return this._height; }

  // ── Lifecycle — create ──

  create(container: HTMLElement): void {
    if (this._created) return;

    this._element = $('div');
    this._element.classList.add('editor-pane', 'fill-container');

    this.createPaneContent(this._element);
    this._created = true;
    container.appendChild(this._element);
  }

  // ── Lifecycle — input ──

  async setInput(input: IEditorInput): Promise<void> {
    const previous = this._input;
    this._input = input;
    await this.renderInput(input, previous);
  }

  clearInput(): void {
    const previous = this._input;
    this._input = undefined;
    this.clearPaneContent(previous);
  }

  // ── Lifecycle — layout ──

  layout(width: number, height: number): void {
    this._width = width;
    this._height = height;
    if (this._element) {
      this._element.style.width = `${width}px`;
      this._element.style.height = `${height}px`;
    }
    this.layoutPaneContent(width, height);
  }

  // ── Focus ──

  focus(): void {
    this._element?.focus();
  }

  // ── View state ──

  saveViewState(): EditorPaneViewState {
    return this.savePaneViewState();
  }

  restoreViewState(state: EditorPaneViewState): void {
    this.restorePaneViewState(state);
  }

  protected fireViewStateChanged(): void {
    this._onDidChangeViewState.fire();
  }

  // ── Protected hooks ──

  /** Build the pane's internal DOM structure. */
  protected abstract createPaneContent(container: HTMLElement): void;

  /** Render the given input into the pane. */
  protected abstract renderInput(input: IEditorInput, previous: IEditorInput | undefined): Promise<void>;

  /** Clear the pane content when the input is removed. */
  protected clearPaneContent(_previous: IEditorInput | undefined): void {
    // no-op by default
  }

  /** React to dimension changes. */
  protected layoutPaneContent(_width: number, _height: number): void {
    // no-op by default
  }

  /** Return pane-specific view state for persistence. */
  protected savePaneViewState(): EditorPaneViewState {
    return {};
  }

  /** Restore pane-specific view state. */
  protected restorePaneViewState(_state: EditorPaneViewState): void {
    // no-op by default
  }
}

// ─── PlaceholderEditorPane ───────────────────────────────────────────────────

/**
 * Simple editor pane for development/testing.
 * Shows the editor name and description in a centered label.
 */
export class PlaceholderEditorPane extends EditorPane {
  private _label: HTMLElement | undefined;

  constructor() {
    super('placeholder-pane');
  }

  protected override createPaneContent(container: HTMLElement): void {
    container.classList.add('placeholder-pane-content');

    this._label = $('div');
    this._label.classList.add('placeholder-pane-label');
    this._label.textContent = 'No editor';
    container.appendChild(this._label);
  }

  protected override async renderInput(input: IEditorInput): Promise<void> {
    if (this._label) {
      this._label.textContent = input.description
        ? `${input.name}\n${input.description}`
        : input.name;
    }
  }

  protected override clearPaneContent(): void {
    if (this._label) {
      this._label.textContent = 'No editor';
    }
  }
}

// ─── ToolEditorPane ──────────────────────────────────────────────────────────

/**
 * Editor pane that delegates rendering to a tool-provided editor provider.
 *
 * The input must have a `provider` property with `createEditorPane(container)`.
 * This is duck-typed to avoid a hard dependency on the API bridge layer.
 */
class ToolEditorPane extends EditorPane {
  private _contentContainer: HTMLElement | undefined;
  private _providerDisposable: IDisposable | undefined;

  constructor() {
    super('tool-editor-pane');
  }

  protected override createPaneContent(container: HTMLElement): void {
    this._contentContainer = $('div');
    this._contentContainer.classList.add('fill-container-scroll');
    container.appendChild(this._contentContainer);
  }

  protected override async renderInput(input: IEditorInput): Promise<void> {
    // Dispose previous provider content
    this._disposeProviderContent();

    if (!this._contentContainer) return;

    // Duck-type check for a tool editor provider
    const provider = (input as any).provider;
    if (provider && typeof provider.createEditorPane === 'function') {
      this._providerDisposable = provider.createEditorPane(this._contentContainer, input);
    } else {
      // Fallback: show the input name
      const label = $('div');
      label.style.cssText = 'color: var(--color-text-muted, #888); font-size: 14px; text-align: center; padding: 16px;';
      label.textContent = input.name;
      this._contentContainer.appendChild(label);
    }
  }

  protected override clearPaneContent(): void {
    this._disposeProviderContent();
    if (this._contentContainer) {
      this._contentContainer.innerHTML = '';
    }
  }

  private _disposeProviderContent(): void {
    if (this._providerDisposable) {
      this._providerDisposable.dispose();
      this._providerDisposable = undefined;
    }
  }

  override dispose(): void {
    this._disposeProviderContent();
    super.dispose();
  }
}

// ─── Editor Pane Factory Registry ────────────────────────────────────────────

/**
 * A factory function that returns an EditorPane for a given input, or null
 * if it cannot handle that input type.
 */
export type EditorPaneFactory = (input: IEditorInput) => EditorPane | null;

const _paneFactories: EditorPaneFactory[] = [];

/**
 * Register a pane factory. Factories are consulted in registration order.
 * The first factory returning a non-null pane wins.
 */
export function registerEditorPaneFactory(factory: EditorPaneFactory): IDisposable {
  _paneFactories.push(factory);
  return toDisposable(() => {
    const idx = _paneFactories.indexOf(factory);
    if (idx >= 0) _paneFactories.splice(idx, 1);
  });
}

// ─── Smart Pane Factory ──────────────────────────────────────────────────────

/**
 * Create the appropriate editor pane for an input.
 *
 * First, consults the registered pane factories (e.g., the file-editor
 * resolver registers one for FileEditorInput / UntitledEditorInput).
 *
 * Then falls back to:
 *  - ToolEditorPane (if the input has a tool-provided editor provider)
 *  - PlaceholderEditorPane (last resort)
 */
export function createEditorPaneForInput(input: IEditorInput): EditorPane {
  // Try registered factories first
  for (const factory of _paneFactories) {
    const pane = factory(input);
    if (pane) return pane;
  }

  // Fall back to tool editor pane / placeholder
  const provider = (input as any).provider;
  if (provider && typeof provider.createEditorPane === 'function') {
    return new ToolEditorPane();
  }
  return new PlaceholderEditorPane();
}
