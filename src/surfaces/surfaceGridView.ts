// surfaceGridView.ts — a surface, as a citizen of the workspace tree
//
// Foundation Decision 3 (docs/FOUNDATION.md). The grid speaks IGridView; the
// app speaks ISurface. This is the whole of the translation, and it is
// deliberately thin: any logic that accumulates here is logic that belongs on
// one side or the other.
//
// It is also where the invariant is enforced in practice. The grid tells this
// wrapper its width, height and orientation; the wrapper passes on width and
// height and DROPS the orientation. A surface that could read the orientation
// could infer its position, and the first `if (orientation === Vertical)` in a
// surface is the day the foundation stops holding.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import type { IGridView } from '../layout/gridView.js';
import type { Orientation } from '../layout/layoutTypes.js';
import type { ISurface } from './surfaceTypes.js';

export class SurfaceGridView extends Disposable implements IGridView {
  readonly element: HTMLElement;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  private _created = false;

  constructor(readonly surface: ISurface) {
    super();
    this.element = document.createElement('div');
    this.element.className = 'surface-host';
    // The host owns overflow so a surface never has to know it is in a
    // constrained cell — the same reason it never learns its orientation.
    this.element.style.overflow = 'hidden';
    this.element.style.position = 'relative';

    this._register(this.surface.onDidChangeConstraints(() => this._onDidChangeConstraints.fire()));
  }

  get id(): string {
    return this.surface.id;
  }

  get minimumWidth(): number { return this.surface.minimumWidth; }
  get maximumWidth(): number { return this.surface.maximumWidth; }
  get minimumHeight(): number { return this.surface.minimumHeight; }
  get maximumHeight(): number { return this.surface.maximumHeight; }

  /**
   * Build on first layout rather than in the constructor.
   *
   * A surface moved into the tree, or restored from an arrangement into a
   * collapsed region, should not pay for its DOM until it is actually going to
   * be shown.
   */
  layout(width: number, height: number, _orientation: Orientation): void {
    if (!this._created) {
      this.surface.create(this.element);
      this._created = true;
    }
    this.surface.layout(width, height);
  }

  setVisible(visible: boolean): void {
    // Hide, never dispose. This is the retention contract M101 established for
    // tabs, extended to positions: a surface hidden by a collapsed region or a
    // switched arrangement keeps running, so returning to it is instant and
    // nothing in flight is lost.
    this.surface.setVisible(visible);
  }

  focus(): void {
    this.surface.focus();
  }

  toJSON(): object {
    return {
      id: this.surface.id,
      typeId: this.surface.typeId,
      binding: this.surface.binding
        ? { kind: this.surface.binding.kind, key: this.surface.binding.key }
        : undefined,
      state: this.surface.saveState(),
    };
  }

  override dispose(): void {
    // The surface outlives this wrapper on a MOVE: the grid detaches and
    // re-attaches, and disposing here would destroy exactly what the move
    // exists to preserve. Ownership sits with the registry, which disposes on
    // close. See Grid.moveView.
    super.dispose();
  }
}
