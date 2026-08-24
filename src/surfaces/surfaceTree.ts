// surfaceTree.ts — the workspace tree
//
// Foundation Decision 3 (docs/FOUNDATION.md). One grid, holding one kind of
// citizen. Left, right, bottom and centre are POSITIONS in this tree, not
// classes — which is the whole reason a surface can be dragged to any edge
// without that being a feature anyone had to write.
//
// NOT YET MOUNTED. The workbench still runs on the seven singleton Parts and
// EditorPart's nested grid. This is the replacement, built and tested in
// isolation so that swapping it in is a small reviewable change rather than a
// big-bang rewrite performed blind. See FOUNDATION.md "Migration order",
// step 3.
//
// Ownership: the tree owns placement, the registry owns lifetime. Closing a
// surface removes it from the tree AND asks the registry to dispose it; moving
// one only ever touches the tree.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { Grid } from '../layout/grid.js';
import { Orientation } from '../layout/layoutTypes.js';
import type { SurfaceRegistry } from './surfaceRegistry.js';
import { SurfaceGridView } from './surfaceGridView.js';
import { SurfacePlacement } from './surfaceTypes.js';
import type { ISurface, ISurfaceBinding } from './surfaceTypes.js';
import {
  captureArrangement,
  type Arrangement,
  type ResolvedArrangement,
  type ResolvedNode,
} from './arrangement.js';

/** Default sizes for a first open. Advisory, like placement itself. */
const DEFAULT_SIDE_SIZE = 260;
const DEFAULT_BOTTOM_SIZE = 220;
const DEFAULT_CENTER_SIZE = 600;

export interface ISurfaceOpenOptions {
  /** Override the descriptor's preferred first placement. */
  readonly placement?: SurfacePlacement;
  /** Open a second view of something already open. */
  readonly forceNew?: boolean;
  /** Open without taking focus. */
  readonly preserveFocus?: boolean;
}

export class SurfaceTree extends Disposable {
  private readonly _grid: Grid;
  private readonly _views = new Map<string, SurfaceGridView>();
  private _activeId: string | undefined;

  private readonly _onDidChangeActive = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActive: Event<string | undefined> = this._onDidChangeActive.event;

  private readonly _onDidChangeStructure = this._register(new Emitter<void>());
  readonly onDidChangeStructure: Event<void> = this._onDidChangeStructure.event;

  constructor(
    private readonly _registry: SurfaceRegistry,
    rootOrientation: Orientation = Orientation.Horizontal,
    width = 0,
    height = 0,
  ) {
    super();
    this._grid = this._register(new Grid(rootOrientation, width, height));

    // A surface disposed from anywhere — an extension unloading, a command —
    // must leave the tree. The registry is the single source of lifetime, so
    // the tree follows it rather than trying to be a second one.
    this._register(this._registry.onDidDisposeInstance((id) => this._detach(id)));
  }

  get grid(): Grid { return this._grid; }
  get activeSurfaceId(): string | undefined { return this._activeId; }
  get surfaceCount(): number { return this._views.size; }

  get surfaces(): readonly ISurface[] {
    return [...this._views.values()].map((v) => v.surface);
  }

  getSurface(id: string): ISurface | undefined {
    return this._views.get(id)?.surface;
  }

  // ── Opening ──

  /**
   * Open a surface of `typeId`, pointed at `binding`.
   *
   * Reuses a live instance with an equal binding and just focuses it — a
   * second click on the same file must not open a second copy. `forceNew` is
   * the deliberate side-by-side path.
   */
  open(typeId: string, binding?: ISurfaceBinding, opts: ISurfaceOpenOptions = {}): ISurface {
    const existing = opts.forceNew ? undefined : this._registry.findInstance(typeId, binding);
    if (existing && this._views.has(existing.surface.id)) {
      if (!opts.preserveFocus) this.setActive(existing.surface.id);
      return existing.surface;
    }

    const instance = this._registry.createInstance(typeId, binding, { forceNew: opts.forceNew });
    if (binding) void instance.surface.setBinding(binding);

    const view = new SurfaceGridView(instance.surface);
    this._views.set(instance.surface.id, view);

    const placement = opts.placement ?? instance.descriptor.placement;
    this._place(view, placement);

    if (!opts.preserveFocus) this.setActive(instance.surface.id);
    this._onDidChangeStructure.fire();
    return instance.surface;
  }

  /**
   * Put a new view somewhere sensible for its declared placement.
   *
   * This is the ONLY place placement is consulted, and only on first open.
   * Once a surface is in the tree its position belongs to the user's
   * arrangement, and nothing re-reads the descriptor's preference — which is
   * what stops an extension pinning itself anywhere.
   */
  private _place(view: SurfaceGridView, placement: SurfacePlacement): void {
    if (this._grid.viewCount === 0) {
      this._grid.addView(view, DEFAULT_CENTER_SIZE);
      return;
    }

    switch (placement) {
      case SurfacePlacement.Side:
        // Added then moved to the edge rather than inserted at index 0: the
        // root is not always horizontal (a bottom strip re-roots it), and
        // index 0 of a vertical root is the TOP, not the left.
        this._grid.addView(view, DEFAULT_SIDE_SIZE);
        this._grid.moveViewToEdge(view.id, Orientation.Horizontal, true);
        break;
      case SurfacePlacement.Bottom:
        this._grid.addView(view, DEFAULT_BOTTOM_SIZE);
        this._grid.moveViewToEdge(view.id, Orientation.Vertical);
        break;
      case SurfacePlacement.Center:
      default: {
        // Beside whatever is active, so opening from a surface lands next to
        // it rather than at an arbitrary end of the layout.
        const anchor = this._activeId && this._views.has(this._activeId)
          ? this._activeId
          : undefined;
        if (anchor) {
          this._grid.splitView(anchor, view, DEFAULT_CENTER_SIZE, Orientation.Horizontal);
        } else {
          this._grid.addView(view, DEFAULT_CENTER_SIZE);
        }
        break;
      }
    }
  }

  // ── Moving ──

  /** Move a surface beside another one. The live instance is preserved. */
  move(
    surfaceId: string,
    targetSurfaceId: string,
    orientation: Orientation,
    insertBefore = false,
  ): void {
    if (!this._views.has(surfaceId) || !this._views.has(targetSurfaceId)) return;
    this._grid.moveView(surfaceId, targetSurfaceId, orientation, insertBefore);
    this._onDidChangeStructure.fire();
  }

  /**
   * Move a surface to an outer edge — the drag-to-any-edge case.
   *
   * There is no special handling for "this one is the sidebar", because after
   * Decision 3 there is no sidebar to special-case. If this method ever needs
   * to know what a surface is, the foundation has broken.
   */
  moveToEdge(surfaceId: string, orientation: Orientation, insertBefore = false): void {
    if (!this._views.has(surfaceId)) return;
    this._grid.moveViewToEdge(surfaceId, orientation, insertBefore);
    this._onDidChangeStructure.fire();
  }

  // ── Closing ──

  /** Remove from the tree AND dispose. For relocation use `move`. */
  close(surfaceId: string): void {
    if (!this._views.has(surfaceId)) return;
    // Detachment happens via the registry's disposal event, so both paths
    // (closed here, or disposed because an extension unloaded) run the same
    // code and cannot drift.
    this._registry.disposeInstance(surfaceId);
  }

  private _detach(surfaceId: string): void {
    const view = this._views.get(surfaceId);
    if (!view) return;
    this._views.delete(surfaceId);
    this._grid.removeView(surfaceId);
    if (this._activeId === surfaceId) {
      this._activeId = this._views.keys().next().value as string | undefined;
      this._onDidChangeActive.fire(this._activeId);
    }
    this._onDidChangeStructure.fire();
  }

  // ── Focus ──

  setActive(surfaceId: string | undefined): void {
    if (surfaceId !== undefined && !this._views.has(surfaceId)) return;
    if (this._activeId === surfaceId) return;
    this._activeId = surfaceId;
    if (surfaceId) this._views.get(surfaceId)?.focus();
    this._onDidChangeActive.fire(surfaceId);
  }

  // ── Layout ──

  layout(width: number, height: number): void {
    this._grid.resize(width, height);
  }

  // ── Arrangements ──

  /** Capture the current shape, bindings and state. */
  capture(meta: { id: string; name: string; icon?: string }): Arrangement {
    return captureArrangement(
      this._grid.serialize(),
      meta,
      (viewId) => this._views.get(viewId)?.surface,
    ).arrangement;
  }

  /**
   * Replace the current shape with a resolved arrangement.
   *
   * Everything currently open is closed first. That is deliberate: an
   * arrangement is a whole shape of the app, and merging one into another
   * produces a layout neither the user nor the arrangement asked for.
   *
   * Placeholder leaves are skipped — the caller has the `unavailable` list and
   * decides how to tell the user. Skipping keeps the rest of the layout,
   * which is the point of resolving before restoring.
   */
  restore(resolved: ResolvedArrangement): { opened: number; skipped: number } {
    for (const id of [...this._views.keys()]) this.close(id);

    let opened = 0;
    let skipped = 0;
    let anchor: string | undefined;

    const walk = (node: ResolvedNode, parentOrientation: Orientation): void => {
      if (node.kind === 'branch') {
        for (const child of node.children) walk(child, node.orientation);
        return;
      }
      if (node.kind !== 'surface') { skipped++; return; }

      const surface = this.open(node.typeId, node.binding, {
        preserveFocus: true,
        forceNew: true,
      });
      if (node.state) surface.restoreState(node.state);
      // Rebuild the shape by placing each surface next to the previous one
      // along its branch's axis. The tree is reconstructed by moves, which is
      // why moveView had to exist before arrangements could.
      if (anchor) this._grid.moveView(surface.id, anchor, parentOrientation);
      anchor = surface.id;
      opened++;
    };

    walk(resolved.root, resolved.rootOrientation);
    this._activeId = this._views.keys().next().value as string | undefined;
    this._onDidChangeActive.fire(this._activeId);
    this._onDidChangeStructure.fire();
    return { opened, skipped };
  }
}
