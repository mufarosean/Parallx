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
import { PlaceholderSurface, PLACEHOLDER_DESCRIPTOR } from './surfacePlaceholder.js';
import { SerializedNodeType } from '../layout/layoutModel.js';
import type { SerializedBranchNode, SerializedGridNode } from '../layout/layoutModel.js';

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

/** A surface was relocated. What the activity stream calls "adjacent to what". */
export interface ISurfaceMoveEvent {
  readonly surfaceId: string;
  readonly kind: 'beside' | 'edge';
  /** The neighbour, for a 'beside' move. */
  readonly targetSurfaceId?: string;
  readonly orientation: Orientation;
  readonly insertBefore: boolean;
}

export interface IArrangementRestoreEvent {
  readonly name: string;
  readonly opened: number;
  readonly placeholders: number;
}

export class SurfaceTree extends Disposable {
  private readonly _grid: Grid;
  private readonly _views = new Map<string, SurfaceGridView>();
  private _activeId: string | undefined;
  /** Placeholder ids get their own prefix so they can never collide with the
   *  registry's `typeId#n` ids. */
  private _nextPlaceholder = 1;

  private readonly _onDidChangeActive = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActive: Event<string | undefined> = this._onDidChangeActive.event;

  private readonly _onDidChangeStructure = this._register(new Emitter<void>());
  readonly onDidChangeStructure: Event<void> = this._onDidChangeStructure.event;

  // The specific events Decision 7 promised: which surface, where, next to
  // what. The structure event says "something changed"; these say what.

  /** A DELIBERATE open — restore does not fire this per leaf. */
  private readonly _onDidOpenSurface = this._register(new Emitter<ISurface>());
  readonly onDidOpenSurface: Event<ISurface> = this._onDidOpenSurface.event;

  private readonly _onDidMoveSurface = this._register(new Emitter<ISurfaceMoveEvent>());
  readonly onDidMoveSurface: Event<ISurfaceMoveEvent> = this._onDidMoveSurface.event;

  private readonly _onDidCaptureArrangement = this._register(new Emitter<string>());
  readonly onDidCaptureArrangement: Event<string> = this._onDidCaptureArrangement.event;

  private readonly _onDidRestoreArrangement = this._register(new Emitter<IArrangementRestoreEvent>());
  readonly onDidRestoreArrangement: Event<IArrangementRestoreEvent> = this._onDidRestoreArrangement.event;

  /**
   * True while restore is tearing down and rebuilding. A listener narrating
   * closes (the activity tap) checks this so switching arrangements reads as
   * ONE act, not a burst of individual closings nobody performed.
   */
  private _restoring = false;
  get isRestoring(): boolean { return this._restoring; }

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
    if (binding) {
      instance.surface.setBinding(binding).catch((err) => {
        // An unresolvable binding must not become an unhandled rejection; the
        // surface stays open and unbound, which its own UI is in charge of
        // explaining.
        console.error(`[surfaces] binding failed for ${typeId} (${binding.kind}:${binding.key})`, err);
      });
    }

    const view = new SurfaceGridView(instance.surface);
    this._views.set(instance.surface.id, view);

    const placement = opts.placement ?? instance.descriptor.placement;
    this._place(view, placement);

    if (!opts.preserveFocus) this.setActive(instance.surface.id);
    this._onDidOpenSurface.fire(instance.surface);
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
        // index 0 of a vertical root is the TOP, not the left. The size is
        // passed again because the edge may run across the axis addView
        // measured along.
        this._grid.addView(view, DEFAULT_SIDE_SIZE);
        this._grid.moveViewToEdge(view.id, Orientation.Horizontal, true, DEFAULT_SIDE_SIZE);
        break;
      case SurfacePlacement.Bottom:
        this._grid.addView(view, DEFAULT_BOTTOM_SIZE);
        this._grid.moveViewToEdge(view.id, Orientation.Vertical, false, DEFAULT_BOTTOM_SIZE);
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
    this._onDidMoveSurface.fire({
      surfaceId, kind: 'beside', targetSurfaceId, orientation, insertBefore,
    });
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
    this._onDidMoveSurface.fire({ surfaceId, kind: 'edge', orientation, insertBefore });
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
    const { arrangement } = captureArrangement(
      this._grid.serialize(),
      meta,
      (viewId) => this._views.get(viewId)?.surface,
    );
    this._onDidCaptureArrangement.fire(meta.name);
    return arrangement;
  }

  /**
   * Replace the current shape with a resolved arrangement.
   *
   * Everything currently open is closed first. That is deliberate: an
   * arrangement is a whole shape of the app, and merging one into another
   * produces a layout neither the user nor the arrangement asked for.
   *
   * The grid is rebuilt IN PLACE from the arrangement's own tree, so nesting
   * and sizes come back exactly as captured. A leaf whose type is missing
   * becomes a placeholder pane that keeps its spot, its binding and its
   * stored state (see surfacePlaceholder.ts) rather than being skipped: a
   * layout with a hole where the flashcards were is not the layout the user
   * saved.
   */
  restore(resolved: ResolvedArrangement): { opened: number; placeholders: number } {
    this._restoring = true;
    try {
      return this._doRestore(resolved);
    } finally {
      this._restoring = false;
    }
  }

  private _doRestore(resolved: ResolvedArrangement): { opened: number; placeholders: number } {
    for (const id of [...this._views.keys()]) this.close(id);

    let opened = 0;
    let placeholders = 0;
    let firstRealId: string | undefined;
    const built = new Map<string, SurfaceGridView>();

    const build = (node: ResolvedNode): SerializedGridNode => {
      if (node.kind === 'branch') {
        return {
          type: SerializedNodeType.Branch,
          orientation: node.orientation,
          size: node.size,
          sizingMode: node.sizingMode,
          children: node.children.map(build),
        };
      }

      let surface: ISurface;
      if (node.kind === 'surface') {
        surface = this._registry.createInstance(node.typeId, node.binding, {
          forceNew: true,
        }).surface;
        if (node.binding) {
          // State waits for the binding: restoreState before the content has
          // loaded gets clobbered by the load, and a scroll position applied
          // to the wrong document is worse than none.
          const s = surface;
          const state = node.state;
          surface.setBinding(node.binding)
            .then(() => { if (state) s.restoreState(state); })
            .catch((err) => {
              console.error(`[surfaces] restore binding failed for ${node.typeId}`, err);
            });
        } else if (node.state) {
          surface.restoreState(node.state);
        }
        firstRealId ??= surface.id;
        opened++;
      } else {
        surface = new PlaceholderSurface(
          `placeholder#${this._nextPlaceholder++}`,
          node.typeId,
          node.binding,
          node.state,
        );
        this._registry.adoptInstance(surface, PLACEHOLDER_DESCRIPTOR);
        placeholders++;
      }

      const view = new SurfaceGridView(surface);
      this._views.set(surface.id, view);
      built.set(view.id, view);
      return {
        type: SerializedNodeType.Leaf,
        viewId: view.id,
        size: node.size,
        sizingMode: node.sizingMode,
      };
    };

    const root = build(resolved.root) as SerializedBranchNode;
    this._grid.restoreFrom(
      { root, orientation: resolved.rootOrientation, width: 0, height: 0 },
      (viewId) => {
        const view = built.get(viewId);
        if (!view) throw new Error(`Restore built no view for ${viewId}`);
        return view;
      },
    );

    // A placeholder can hold a spot but should not hold the user's focus.
    this._activeId = firstRealId ?? this._views.keys().next().value as string | undefined;
    this._onDidChangeActive.fire(this._activeId);
    this._onDidRestoreArrangement.fire({ name: resolved.name, opened, placeholders });
    this._onDidChangeStructure.fire();
    return { opened, placeholders };
  }
}
