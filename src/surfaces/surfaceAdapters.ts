// surfaceAdapters.ts — the existing citizens, as surfaces
//
// Foundation step 2 (docs/FOUNDATION.md). Nothing in the app is rewritten to
// become a surface: the two content contracts that already exist are wrapped.
// This is what makes the migration incremental rather than a cutover, and it
// is also the proof that ISurface was derived from what was there rather than
// invented next to it — if either adapter needed a field ISurface lacks, the
// type was wrong.
//
// Both adapters own the thing they wrap and dispose it. A surface's lifetime
// is the registry's business (see SurfaceRegistry.disposeInstance); the view
// or pane inside is an implementation detail of the adapter.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IView } from '../views/viewTypes.js';
import type { IEditorPane } from '../editor/editorPane.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { ISurface, ISurfaceBinding, SurfaceState } from './surfaceTypes.js';

// ─── IView → ISurface ────────────────────────────────────────────────────────

/**
 * Wraps a sidebar/panel view.
 *
 * A view has no binding concept — it is "the explorer", not "the explorer of
 * X" — so `binding` stays undefined and `setBinding` is a no-op. That is not a
 * gap to fill later: a bindingless surface is a legitimate shape (a settings
 * hub, a graph of everything), and the descriptor says so with an empty
 * `bindingKinds`.
 */
export class ViewSurface extends Disposable implements ISurface {
  private readonly _onDidChangeTitle = this._register(new Emitter<void>());
  readonly onDidChangeTitle: Event<void> = this._onDidChangeTitle.event;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
  readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

  constructor(
    readonly id: string,
    readonly typeId: string,
    private readonly _view: IView,
  ) {
    super();
    this._register(this._view.onDidChangeConstraints(() => this._onDidChangeConstraints.fire()));
    this._register(this._view.onDidChangeVisibility((v) => this._onDidChangeVisibility.fire(v)));
    this._register(this._view);
  }

  get title(): string { return this._view.name; }
  get icon(): string | undefined { return this._view.icon; }
  get binding(): ISurfaceBinding | undefined { return undefined; }
  get element(): HTMLElement | undefined { return this._view.element; }

  get minimumWidth(): number { return this._view.minimumWidth; }
  get maximumWidth(): number { return this._view.maximumWidth; }
  get minimumHeight(): number { return this._view.minimumHeight; }
  get maximumHeight(): number { return this._view.maximumHeight; }

  create(container: HTMLElement): void { this._view.createElement(container); }
  async setBinding(): Promise<void> { /* views take no binding */ }
  layout(width: number, height: number): void { this._view.layout(width, height); }
  setVisible(visible: boolean): void { this._view.setVisible(visible); }
  focus(): void { this._view.focus(); }
  saveState(): SurfaceState { return this._view.saveState(); }
  restoreState(state: SurfaceState): void { this._view.restoreState(state); }
}

// ─── IEditorPane → ISurface ──────────────────────────────────────────────────

/** How an editor input is addressed as a binding, and back again. */
export interface IEditorBindingBridge {
  /** Identity of what this input points at. */
  toBinding(input: IEditorInput): ISurfaceBinding;
  /** Rebuild an input from a persisted binding. Undefined if unresolvable. */
  fromBinding(binding: ISurfaceBinding): IEditorInput | undefined;
}

/**
 * Bridge for file-backed and uri-backed inputs.
 *
 * The uri's scheme is the binding kind when there is one — 'file' for files,
 * 'untitled' for buffers that are not files and should not claim to be.
 *
 * Without a uri, the input's SERIALIZED form is the key: the same payload the
 * editor-restore path already round-trips. The instance id would be simpler,
 * but it is a session counter, and an arrangement written with one could
 * never resolve after a restart.
 */
export function editorInputToBinding(input: IEditorInput): ISurfaceBinding {
  const uri = input.uri;
  if (uri) {
    return {
      kind: uri.scheme || 'file',
      key: String(uri),
      label: input.name,
      description: input.description || undefined,
    };
  }
  let key: string;
  try {
    key = JSON.stringify(input.serialize());
  } catch {
    // Session-local, and marked as such: still good enough to match a live
    // instance, never good enough to persist quietly as if it were stable.
    key = `session:${input.id}`;
  }
  return {
    kind: input.typeId,
    key,
    label: input.name,
    description: input.description || undefined,
  };
}

/**
 * Wraps an editor pane.
 *
 * Unlike a view, a pane already HAD a binding — `IEditorInput` is one under
 * another name, which is why this adapter is the shorter of the two.
 */
export class EditorPaneSurface extends Disposable implements ISurface {
  private _input: IEditorInput | undefined;
  private _inputListener: { dispose(): void } | undefined;
  private _created = false;
  private _pendingInput: IEditorInput | undefined;

  private readonly _onDidChangeTitle = this._register(new Emitter<void>());
  readonly onDidChangeTitle: Event<void> = this._onDidChangeTitle.event;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
  readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

  // Panes carry no size hints of their own; the editor area was always the
  // flexible one. Stated here rather than inherited so a pane that grows an
  // opinion has somewhere to put it.
  readonly minimumWidth = 200;
  readonly maximumWidth = Infinity;
  readonly minimumHeight = 100;
  readonly maximumHeight = Infinity;

  constructor(
    readonly id: string,
    readonly typeId: string,
    private readonly _pane: IEditorPane,
    private readonly _bridge: IEditorBindingBridge,
  ) {
    super();
    this._register(this._pane);
  }

  get title(): string { return this._input?.name ?? this.typeId; }
  get icon(): string | undefined { return undefined; }
  get binding(): ISurfaceBinding | undefined {
    return this._input ? this._bridge.toBinding(this._input) : undefined;
  }
  get element(): HTMLElement | undefined { return this._pane.element; }

  create(container: HTMLElement): void {
    this._pane.create(container);
    this._created = true;
    if (this._pendingInput) {
      const input = this._pendingInput;
      this._pendingInput = undefined;
      void this._pane.setInput(input).catch((err) => {
        console.error('[surfaces] deferred setInput failed', err);
      });
    }
  }

  async setBinding(binding: ISurfaceBinding | undefined): Promise<void> {
    if (!binding) {
      if (this._created) this._pane.clearInput();
      this._pendingInput = undefined;
      this._setInput(undefined);
      this._onDidChangeTitle.fire();
      return;
    }
    const input = this._bridge.fromBinding(binding);
    if (!input) {
      // Unresolvable binding: leave the pane as it is rather than blanking a
      // working editor. An arrangement restoring a deleted file wants a named
      // placeholder, not an empty pane and no explanation.
      throw new Error(`Cannot resolve binding: ${binding.kind}:${binding.key}`);
    }
    this._setInput(input);
    if (this._created) {
      await this._pane.setInput(input);
    } else {
      // No DOM yet — SurfaceGridView creates lazily on first layout, and a
      // pane fed setInput before create renders nothing. Hold the input and
      // apply it when create runs.
      this._pendingInput = input;
    }
    this._onDidChangeTitle.fire();
  }

  /** Swap the tracked input: re-wire the label listener, dispose the old one. */
  private _setInput(input: IEditorInput | undefined): void {
    if (this._input === input) return;
    this._inputListener?.dispose();
    const previous = this._input;
    this._input = input;
    // A renamed file must repaint its tab: the input's label event is the
    // only channel that knows.
    this._inputListener = input?.onDidChangeLabel(() => this._onDidChangeTitle.fire());
    // The bridge builds inputs for this adapter alone; a replaced one has no
    // other owner left to dispose it.
    previous?.dispose();
  }

  override dispose(): void {
    this._inputListener?.dispose();
    this._inputListener = undefined;
    this._input?.dispose();
    this._input = undefined;
    this._pendingInput = undefined;
    super.dispose();
  }

  layout(width: number, height: number): void { this._pane.layout(width, height); }

  setVisible(visible: boolean): void {
    // IEditorPane has no visibility contract — panes were disposed on switch
    // before M101 and hidden after it. Reflecting it on the element keeps the
    // hide-never-dispose guarantee true for wrapped panes too.
    const el = this._pane.element;
    if (el) el.style.display = visible ? '' : 'none';
    this._onDidChangeVisibility.fire(visible);
  }

  focus(): void { this._pane.focus(); }
  saveState(): SurfaceState { return this._pane.saveViewState(); }
  restoreState(state: SurfaceState): void { this._pane.restoreViewState(state); }
}
