// surfacePlaceholder.ts — the pane that explains its own absence
//
// FOUNDATION.md, open question 3, answered there: a surface whose type is
// gone "must degrade to a named placeholder that explains itself, never a
// blank pane, and never a load failure that takes the arrangement down with
// it".
//
// The placeholder IS that degradation. It keeps the leaf's place so the shape
// the user's hands remember stays whole, and it carries the original typeId,
// binding and state FROZEN — capture reads them straight back, so re-saving
// an arrangement that contains a placeholder loses nothing. Install the
// missing extension, restore again, and the pane comes back real.
//
// Deliberately inert: no upgrade-in-place when the type re-registers.
// Swapping content under the user's cursor reads as a glitch; restoring the
// arrangement is the recovery path.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import { SurfacePlacement } from './surfaceTypes.js';
import type { ISurface, ISurfaceBinding, ISurfaceDescriptor, SurfaceState } from './surfaceTypes.js';
import { DEFAULT_SIZE_CONSTRAINTS } from '../layout/layoutTypes.js';

/**
 * The descriptor adopted placeholder instances carry. NEVER registered: the
 * missing type's lookups must keep failing, so resolveArrangement keeps
 * reporting it as unavailable instead of "resolving" it into another
 * placeholder.
 *
 * Its typeId is NOT what capture stores — a placeholder surface reports the
 * missing type as its own `typeId`, which is what makes the round trip
 * lossless.
 */
export const PLACEHOLDER_DESCRIPTOR: ISurfaceDescriptor = {
  typeId: 'surface.placeholder',
  name: 'Missing Surface',
  placement: SurfacePlacement.Center,
  constraints: DEFAULT_SIZE_CONSTRAINTS,
  bindingKinds: [],
  create: () => {
    throw new Error('Placeholders are built by SurfaceTree.restore, not the registry');
  },
};

export class PlaceholderSurface implements ISurface {
  readonly binding: ISurfaceBinding | undefined;
  private _element: HTMLElement | undefined;
  private readonly _state: SurfaceState;

  readonly minimumWidth = 120;
  readonly maximumWidth = Infinity;
  readonly minimumHeight = 80;
  readonly maximumHeight = Infinity;

  private readonly _onDidChangeTitle = new Emitter<void>();
  readonly onDidChangeTitle: Event<void> = this._onDidChangeTitle.event;
  private readonly _onDidChangeConstraints = new Emitter<void>();
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;
  private readonly _onDidChangeVisibility = new Emitter<boolean>();
  readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

  constructor(
    readonly id: string,
    /** The MISSING type, not 'surface.placeholder': capture must round-trip it. */
    readonly typeId: string,
    binding: ISurfaceBinding | undefined,
    state: SurfaceState | undefined,
  ) {
    this.binding = binding;
    this._state = state ?? {};
  }

  get title(): string {
    return this.binding?.label ?? this.typeId;
  }

  get element(): HTMLElement | undefined {
    return this._element;
  }

  create(container: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'surface-placeholder';

    const name = document.createElement('div');
    name.className = 'surface-placeholder-name';
    name.textContent = this.title;
    root.appendChild(name);

    const detail = document.createElement('div');
    detail.className = 'surface-placeholder-detail';
    detail.textContent =
      `This pane needs "${this.typeId}", which is not available right now. ` +
      'Its place and contents are kept, and it comes back when the surface type does.';
    root.appendChild(detail);

    this._element = root;
    container.appendChild(root);
  }

  async setBinding(): Promise<void> {
    // Frozen. The binding shown is the one the arrangement recorded.
  }

  layout(): void {}

  setVisible(visible: boolean): void {
    this._onDidChangeVisibility.fire(visible);
  }

  focus(): void {
    this._element?.focus();
  }

  /** Hand back EXACTLY what the arrangement stored, so a re-save loses nothing. */
  saveState(): SurfaceState {
    return this._state;
  }

  restoreState(): void {
    // Also frozen: nothing here can meaningfully re-render.
  }

  dispose(): void {
    this._onDidChangeTitle.dispose();
    this._onDidChangeConstraints.dispose();
    this._onDidChangeVisibility.dispose();
  }
}
