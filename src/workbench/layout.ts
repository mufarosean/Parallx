// layout.ts — Layout base class
//
// Owns the workspace tree, part references, and all layout-mutation methods
// (toggle sidebar/panel/status bar/aux bar, zen mode, relayout).
//
// FOUNDATION.md, Decision 3, migration step: the body of the window is ONE
// grid. What used to be three (a horizontal grid, a vertical grid nested
// through a hand-rolled adapter, and EditorPart's own grid inside that) is
// now a single tree in which sidebar, editor column and panel are POSITIONS.
// The default shape is DATA — `defaultLayoutState` builds the serialized
// tree and the grid restores it — rather than a construction encoded in call
// order. Chrome stays chrome: titlebar, activity bar and status bar are the
// window frame, not content, and live outside the tree.
//
// EditorPart still exists and still runs its own inner grid; it dissolves in
// the NEXT migration step. What is gone already: the editor-column adapter,
// every index-hardcoded sash special case, and the second grid.
//
// VS Code alignment: mirrors `src/vs/workbench/browser/layout.ts`.
// `Workbench extends Layout` adds service wiring, tool registration, and
// lifecycle management.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { Part } from '../parts/part.js';
import { PartId, PartPosition } from '../parts/partTypes.js';
import { Grid } from '../layout/grid.js';
import { GridNodeType } from '../layout/gridNode.js';
import type { GridBranchNode } from '../layout/gridNode.js';
import { Orientation, SizingMode } from '../layout/layoutTypes.js';
import { SerializedNodeType } from '../layout/layoutModel.js';
import type { SerializedGrid, SerializedGridNode, SerializedLeafNode } from '../layout/layoutModel.js';
import type { IGridView } from '../layout/gridView.js';
import { SurfaceTree } from '../surfaces/surfaceTree.js';
import { surfaceRegistry } from '../surfaces/surfaceRegistry.js';
import { PartDragController } from './partDrag.js';
import type { PartDropZone } from './partDrag.js';
import { PartRegistry } from '../parts/partRegistry.js';
import { TitlebarPart, titlebarPartDescriptor } from '../parts/titlebarPart.js';
import { ActivityBarPart, activityBarPartDescriptor } from '../parts/activityBarPart.js';
import { sidebarPartDescriptor } from '../parts/sidebarPart.js';
import { editorPartDescriptor } from '../parts/editorPart.js';
import { auxiliaryBarPartDescriptor } from '../parts/auxiliaryBarPart.js';
import { panelPartDescriptor } from '../parts/panelPart.js';
import { statusBarPartDescriptor } from '../parts/statusBarPart.js';
import { $ } from '../ui/dom.js';
import { ContextMenu } from '../ui/contextMenu.js';

// ── Layout Constants ──

export const TITLE_HEIGHT = 30;
export const STATUS_HEIGHT = 22;
export const ACTIVITY_BAR_WIDTH = 48;
export const PART_HEADER_HEIGHT_PX = 35;
export const DEFAULT_SIDEBAR_WIDTH = 202;
export const DEFAULT_PANEL_HEIGHT = 200;
export const DEFAULT_AUX_BAR_WIDTH = 480;
export const MIN_EDITOR_WIDTH = 200;

/** Editor strip left visible when the panel is maximized. */
const MAXIMIZED_EDITOR_MIN = 30;

/**
 * The three toggleable regions of the body, defined RELATIVE TO THE EDITOR
 * (left of it, right of it, below it) — never by which part started there.
 * The titlebar toggles and their shortcuts address these areas: hiding
 * "the bottom" hides whatever occupies the bottom.
 */
export type BodyArea = 'left' | 'right' | 'bottom';

/** Each area's window edge — the home for a restored occupant with no
 *  resolvable recall. */
const AREA_EDGES: Record<BodyArea, { orientation: Orientation; before: boolean }> = {
  left: { orientation: Orientation.Horizontal, before: true },
  right: { orientation: Orientation.Horizontal, before: false },
  bottom: { orientation: Orientation.Vertical, before: false },
};

// ── Zen Mode Exit Info ──

export interface ZenModeExitInfo {
  sidebar: boolean;
  panel: boolean;
  statusBar: boolean;
  auxBar: boolean;
  activityBar: boolean;
  activityBarRight: boolean;
}

// ── The default shape, as data ───────────────────────────────────────────────

export interface DefaultLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly sidebarVisible: boolean;
  readonly sidebarWidth: number;
  readonly panelVisible: boolean;
  readonly panelHeight: number;
  readonly auxBarVisible: boolean;
  readonly auxBarWidth: number;
  readonly ids: {
    readonly sidebar: string;
    readonly editor: string;
    readonly panel: string;
    readonly auxiliaryBar: string;
  };
}

/**
 * The workbench's default tree: H[ sidebar, V[ editor, panel ], aux ], with
 * hidden parts simply absent and the editor standing alone when the panel is.
 *
 * Exported and pure so the shape is testable as a value, and so `resetLayout`
 * and first boot are literally the same code path.
 */
export function defaultLayoutState(o: DefaultLayoutOptions): SerializedGrid {
  const leaf = (viewId: string, size: number): SerializedLeafNode => ({
    type: SerializedNodeType.Leaf, viewId, size, sizingMode: SizingMode.Pixel,
  });

  const sidebarW = o.sidebarVisible ? o.sidebarWidth : 0;
  const auxW = o.auxBarVisible ? o.auxBarWidth : 0;
  const editorW = Math.max(MIN_EDITOR_WIDTH, o.width - sidebarW - auxW);

  const editorColumn: SerializedGridNode = o.panelVisible
    ? {
        type: SerializedNodeType.Branch,
        orientation: Orientation.Vertical,
        size: editorW,
        sizingMode: SizingMode.Pixel,
        children: [
          leaf(o.ids.editor, Math.max(0, o.height - o.panelHeight)),
          leaf(o.ids.panel, o.panelHeight),
        ],
      }
    : leaf(o.ids.editor, editorW);

  const children: SerializedGridNode[] = [];
  if (o.sidebarVisible) children.push(leaf(o.ids.sidebar, sidebarW));
  children.push(editorColumn);
  if (o.auxBarVisible) children.push(leaf(o.ids.auxiliaryBar, auxW));

  return {
    root: {
      type: SerializedNodeType.Branch,
      orientation: Orientation.Horizontal,
      size: 0,
      sizingMode: SizingMode.Pixel,
      children,
    },
    orientation: Orientation.Horizontal,
    width: o.width,
    height: o.height,
  };
}

/**
 * Layout base class — owns the workspace tree, part references, and all
 * layout-mutation methods (toggle sidebar/panel/status bar/aux bar, zen mode,
 * relayout).
 */
export abstract class Layout extends Disposable {

  // ── Layout Events ─────────────────────────────────────────────────────

  private readonly _onDidChangeZenMode = this._register(new Emitter<boolean>());
  readonly onDidChangeZenMode: Event<boolean> = this._onDidChangeZenMode.event;

  private readonly _onDidChangePartVisibility = this._register(
    new Emitter<{ partId: string; visible: boolean }>(),
  );
  readonly onDidChangePartVisibility: Event<{ partId: string; visible: boolean }> =
    this._onDidChangePartVisibility.event;

  private readonly _onDidChangePanelMaximized = this._register(new Emitter<boolean>());
  readonly onDidChangePanelMaximized: Event<boolean> = this._onDidChangePanelMaximized.event;

  // ── The one tree ──────────────────────────────────────────────────────

  protected _tree!: SurfaceTree;
  protected _bodyRow!: HTMLElement;

  /**
   * The body grid. Parts sit in it as plain grid views for now; surfaces
   * join them as the migration proceeds, and the parts dissolve. Capture
   * ignores non-surface leaves, so arrangements stay clean throughout.
   */
  protected get _grid(): Grid {
    return this._tree.grid;
  }

  // ── Part References ───────────────────────────────────────────────────

  protected _partRegistry!: PartRegistry;
  protected _titlebar!: TitlebarPart;
  protected _activityBarPart!: ActivityBarPart;
  /**
   * The right ribbon. Icons here belong to containers docked in the RIGHT
   * rail — clicking the left ribbon for a right sidebar is awkward, so the
   * ribbon is part of the rail, not global chrome. Hidden while empty;
   * revealed by the rails coordinator (and as a drop strip during a
   * container drag).
   */
  protected _activityBarRight: ActivityBarPart | undefined;
  protected _sidebar!: Part;
  protected _editor!: Part;
  protected _auxiliaryBar!: Part;
  protected _panel!: Part;
  protected _statusBar!: Part;

  // ── Layout State ──────────────────────────────────────────────────────

  /** Auxiliary bar visibility (tracked separately for grid add/remove). */
  protected _auxBarVisible = false;

  /** Last known sidebar width — restored on toggle / persisted across sessions. */
  protected _lastSidebarWidth: number = DEFAULT_SIDEBAR_WIDTH;
  /** Last known panel height — restored on toggle / persisted across sessions. */
  protected _lastPanelHeight: number = DEFAULT_PANEL_HEIGHT;
  /** Last known auxiliary bar width — restored on toggle / persisted across sessions. */
  protected _lastAuxBarWidth: number = DEFAULT_AUX_BAR_WIDTH;
  /** Whether the panel is currently maximized (occupying all vertical space). */
  protected _panelMaximized = false;
  /** Whether Zen Mode is active (all chrome hidden). */
  protected _zenMode = false;
  /** Pre–Zen-Mode visibility snapshot for restore. */
  protected _preZenState: ZenModeExitInfo | null = null;
  /**
   * The WHOLE body tree at zen entry. Exit restores it in one step —
   * rebuilding part by part replays each one against a half-rebuilt tree
   * and drifts from the arrangement the user actually had.
   */
  protected _preZenTree: SerializedGrid | null = null;

  /**
   * True while a layout METHOD is mutating the tree. The grid-change
   * tracker exists to remember what the USER dragged; letting it observe a
   * toggle mid-flight records garbage (a cross-axis split's provisional
   * half, a maximize target) as "the size the user wanted". This raced in
   * the old three-grid code too — it is why restoring a maximized panel
   * silently did nothing.
   */
  private _suspendTracking = false;

  /**
   * Where each hidden part was, described re-creatably (see
   * Grid.describePosition). A part the user stacked under the sidebar and
   * then hid must come back UNDER THE SIDEBAR — snapping to the factory
   * position would punish arranging things.
   */
  private readonly _placementRecall = new Map<
    string,
    | { kind: 'beside'; siblingId: string; orientation: Orientation; before: boolean }
    | { kind: 'edge'; orientation: Orientation; before: boolean }
  >();

  /**
   * What each body AREA held when its toggle hid it, in hide order. The
   * toggles address areas, not parts — "hide the bottom" means whatever
   * occupies the bottom — so the restore half needs the actual occupant
   * set, not an assumption that it was the panel.
   */
  private readonly _areaMemory = new Map<BodyArea, string[]>();

  /** Sizes of floating views hidden by an area toggle, for their return. */
  private readonly _hiddenFloatingSizes = new Map<string, number>();

  private _partDrag: PartDragController | undefined;

  /**
   * Floating grid citizens beyond the four parts (container boxes today,
   * surfaces tomorrow). Registered so the tree validator accepts their
   * leaves, the restore factory can resolve them, and the seam stamping
   * covers their cards.
   */
  private readonly _floatingViews = new Map<string, IGridView>();

  /**
   * Resolver for floating leaves found in a SAVED tree whose views do not
   * exist yet (a box shell for a container whose tool activates later).
   * Set by the workbench before restore.
   */
  protected _floatingViewFactory: ((viewId: string) => IGridView | undefined) | undefined;

  /** Container drops on the grid (detach/move-beside/edge). Set by Workbench. */
  protected _onContainerDropped: ((containerId: string, zone: PartDropZone) => void) | undefined;
  /** Container drops that mean "join this target". Set by Workbench. */
  protected _onContainerDockRequested: ((containerId: string, rail: 'left' | 'right' | 'panel') => void) | undefined;
  /** Eligibility for joining a dock target. Set by Workbench. */
  protected _canContainerDockInto: ((containerId: string, rail: 'left' | 'right' | 'panel') => boolean) | undefined;
  /** Grip menus offer Add Widget when the workbench wires this — the
   *  picker seats a new widget beside the asking part. */
  protected _onAddWidgetRequested: ((anchor: { x: number; y: number }, partId: string) => void) | undefined;

  constructor(protected readonly _container: HTMLElement) {
    super();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2 — Layout: create parts, build the tree, assemble DOM
  // ════════════════════════════════════════════════════════════════════════

  protected _initializeLayout(): void {
    // 1. Create part registry and register all standard parts
    this._partRegistry = this._register(new PartRegistry());
    this._partRegistry.registerMany([
      titlebarPartDescriptor,
      activityBarPartDescriptor,
      sidebarPartDescriptor,
      editorPartDescriptor,
      auxiliaryBarPartDescriptor,
      panelPartDescriptor,
      statusBarPartDescriptor,
    ]);
    this._partRegistry.createAll();

    // 2. Cache part references
    this._titlebar = this._partRegistry.requirePart(PartId.Titlebar) as TitlebarPart;
    this._activityBarPart = this._partRegistry.requirePart(PartId.ActivityBar) as ActivityBarPart;
    this._sidebar = this._partRegistry.requirePart(PartId.Sidebar) as Part;
    this._editor = this._partRegistry.requirePart(PartId.Editor) as Part;
    this._auxiliaryBar = this._partRegistry.requirePart(PartId.AuxiliaryBar) as Part;
    this._panel = this._partRegistry.requirePart(PartId.Panel) as Part;
    this._statusBar = this._partRegistry.requirePart(PartId.StatusBar) as Part;

    // 2b. Hook for subclass to inject services before create()
    this._onBeforePartsCreated();

    // 3. Create parts into temporary container so their elements exist
    const tempDiv = $('div');
    tempDiv.classList.add('hidden');
    document.body.appendChild(tempDiv);

    this._titlebar.create(tempDiv);
    this._activityBarPart.create(tempDiv);

    // The right ribbon is workbench chrome like the left one, but DYNAMIC:
    // it exists for the containers docked on the right, so it starts hidden
    // and is not in the part registry's fixed seven.
    this._activityBarRight = new ActivityBarPart(
      PartId.ActivityBarRight, 'Right Activity Bar', 'left', PartPosition.Right,
    );
    this._activityBarRight.create(tempDiv);
    this._activityBarRight.setVisible(false);
    this._sidebar.create(tempDiv);
    this._editor.create(tempDiv);
    this._auxiliaryBar.create(tempDiv);
    this._panel.create(tempDiv);
    this._statusBar.create(tempDiv);

    // 4. Build the body: activity bar (chrome) + the one grid
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    this._mountBody(w, h);

    // 5. Assemble final DOM
    this._container.appendChild(this._titlebar.element);
    this._titlebar.layout(w, TITLE_HEIGHT, Orientation.Horizontal);

    this._container.appendChild(this._bodyRow);
    // .workbench-middle CSS already sets flex: 1 1 0 and min-height: 0

    this._container.appendChild(this._statusBar.element);
    this._statusBar.layout(w, STATUS_HEIGHT, Orientation.Horizontal);

    tempDiv.remove();

    // 6. Initialize sash drag on the grid
    this._grid.initializeSashDrag();
  }

  /**
   * Build the tree from the cached part fields and wrap it in the body row.
   * Separated from part creation so tests can drive the layout machinery
   * with fake parts.
   */
  protected _mountBody(width: number, height: number): void {
    const bodyH = height - TITLE_HEIGHT - STATUS_HEIGHT;
    const bodyW = width - ACTIVITY_BAR_WIDTH;

    this._tree = new SurfaceTree(surfaceRegistry, Orientation.Horizontal, bodyW, bodyH);
    this._grid.restoreFrom(
      this._currentDefaultState(bodyW, bodyH),
      (viewId) => this._partGridView(viewId),
    );

    this._bodyRow = $('div');
    this._bodyRow.classList.add('workbench-middle');

    this._bodyRow.appendChild(this._activityBarPart.element);
    this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, bodyH, Orientation.Vertical);

    this._bodyRow.appendChild(this._grid.element);
    this._grid.element.classList.add('workbench-grid');

    if (this._activityBarRight) {
      this._bodyRow.appendChild(this._activityBarRight.element);
      this._activityBarRight.layout(ACTIVITY_BAR_WIDTH, bodyH, Orientation.Vertical);
    }

    this._updateEdgeAttributes();
  }

  /** Combined width of the visible ribbons flanking the grid. */
  protected _chromeBarsWidth(): number {
    const left = this._activityBarPart.element.classList.contains('hidden')
      ? 0 : ACTIVITY_BAR_WIDTH;
    const right = this._activityBarRight?.visible ? ACTIVITY_BAR_WIDTH : 0;
    return left + right;
  }

  /**
   * Show or hide the right ribbon. Driven by whether the right rail has any
   * containers (and by a container drag needing a visible drop strip).
   */
  setRightActivityBarVisible(visible: boolean): void {
    if (!this._activityBarRight || this._activityBarRight.visible === visible) return;
    this._activityBarRight.setVisible(visible);
    this._relayout();
  }

  get rightActivityBar(): ActivityBarPart | undefined {
    return this._activityBarRight;
  }

  /**
   * Stamp each part with which WINDOW edges its cell touches, straight from
   * the tree. The card CSS keys its top/right seams on these — per-part
   * margin assumptions ("the aux bar is rightmost") stopped being true the
   * moment parts became movable, and a card that guesses wrong loses its
   * box on the edge it guessed about.
   */
  protected _updateEdgeAttributes(): void {
    const stamp = (id: string, element: HTMLElement | undefined): void => {
      if (!element || !this._grid.hasView(id)) return;
      const edges = this._grid.edgeTouches(id);
      if (!edges) return;
      element.setAttribute('data-edge-top', edges.top ? '1' : '0');
      element.setAttribute('data-edge-right', edges.right ? '1' : '0');
    };
    for (const part of [this._sidebar, this._editor, this._panel, this._auxiliaryBar]) {
      stamp(part.id, part.element);
    }
    for (const [id, view] of this._floatingViews) {
      stamp(id, view.element);
    }
  }

  /** Ids of the floating views currently registered with the grid layer. */
  floatingViewIds(): readonly string[] {
    return [...this._floatingViews.keys()];
  }

  /** The default shape for the CURRENT visibility flags and remembered sizes. */
  private _currentDefaultState(width: number, height: number): SerializedGrid {
    return defaultLayoutState({
      width,
      height,
      sidebarVisible: this._sidebar.visible,
      sidebarWidth: this._lastSidebarWidth,
      panelVisible: this._panel.visible,
      panelHeight: this._lastPanelHeight,
      auxBarVisible: this._auxBarVisible || this._auxiliaryBar.visible,
      auxBarWidth: this._lastAuxBarWidth,
      ids: {
        sidebar: this._sidebar.id,
        editor: this._editor.id,
        panel: this._panel.id,
        auxiliaryBar: this._auxiliaryBar.id,
      },
    });
  }

  /** Resolve a saved leaf id to the grid view that backs it. */
  private _partGridView(viewId: string): IGridView {
    for (const part of [this._sidebar, this._editor, this._panel, this._auxiliaryBar]) {
      if (part.id === viewId) return part;
    }
    const floating = this._floatingViews.get(viewId) ?? this._floatingViewFactory?.(viewId);
    if (floating) {
      this._floatingViews.set(viewId, floating);
      return floating;
    }
    throw new Error(`Layout: no view backs "${viewId}"`);
  }

  /** Record where a part sits, for restoring it there after a hide. */
  private _recordPlacement(partId: string): void {
    const described = this._grid.describePosition(partId);
    if (described) this._placementRecall.set(partId, described);
  }

  /**
   * Seat a part at its recalled position, falling back to its default
   * placement when the recall no longer resolves (the neighbour is gone).
   * Caller suspends tracking.
   */
  private _placePart(part: IGridView, size: number, fallback: () => void): void {
    const recall = this._placementRecall.get(part.id);
    if (recall?.kind === 'beside' && this._grid.hasView(recall.siblingId)) {
      this._grid.addView(part, size);
      this._grid.moveView(part.id, recall.siblingId, recall.orientation, recall.before);
      // Settle real pixels first: a cross-axis move leaves provisional
      // halves, and an exact resize computed against those would be scaled
      // away by the next layout. Same order as _showPanelBelowEditor.
      this._relayoutBody();
      this._grid.resizeView(part.id, size);
      return;
    }
    if (recall?.kind === 'edge') {
      this._grid.addView(part, size);
      this._grid.moveViewToEdge(part.id, recall.orientation, recall.before, size);
      return;
    }
    fallback();
  }

  private _withTrackingSuspended(fn: () => void): void {
    const previous = this._suspendTracking;
    this._suspendTracking = true;
    try {
      fn();
    } finally {
      this._suspendTracking = previous;
    }
  }

  /**
   * Settle the grid after a structural change: companion strips keep their
   * sizes, the editor absorbs the difference — the same policy as a window
   * resize. A bare `layout()` here would instead rescale EVERY child
   * proportionally, squeezing the sidebar because the aux bar appeared.
   */
  protected _relayoutBody(): void {
    const statusH = this._statusBar.visible ? STATUS_HEIGHT : 0;
    this._grid.resizeWithFixedViews(
      this._container.clientWidth - this._chromeBarsWidth(),
      this._container.clientHeight - TITLE_HEIGHT - statusH,
      this._editor.id,
    );
  }

  /**
   * Subclass hook — called after parts are cached but before create().
   * Workbench uses this to inject services (e.g. IWindowService into titlebar).
   */
  protected _onBeforePartsCreated(): void {
    // Default no-op
  }

  // ════════════════════════════════════════════════════════════════════════
  // Window resize handler
  // ════════════════════════════════════════════════════════════════════════

  /** Public relayout entry point for commands that change part visibility. */
  _relayout(): void {
    this._onWindowResize();
  }

  protected _onWindowResize = (): void => {
    const rw = this._container.clientWidth;
    const rh = this._container.clientHeight;
    const statusH = this._statusBar.visible ? STATUS_HEIGHT : 0;
    const rbodyH = rh - TITLE_HEIGHT - statusH;

    this._titlebar.layout(rw, TITLE_HEIGHT, Orientation.Horizontal);
    if (this._statusBar.visible) {
      this._statusBar.layout(rw, STATUS_HEIGHT, Orientation.Horizontal);
    }

    // Re-layout the ribbons (chrome, outside the grid)
    if (!this._activityBarPart.element.classList.contains('hidden')) {
      this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, rbodyH, Orientation.Vertical);
    }
    if (this._activityBarRight?.visible) {
      this._activityBarRight.layout(ACTIVITY_BAR_WIDTH, rbodyH, Orientation.Vertical);
    }

    // Keep the companion strips at their sizes; the editor absorbs the
    // window delta (VS Code parity). The distribution recurses into nested
    // branches, so it finds the editor wherever it sits.
    this._grid.resizeWithFixedViews(rw - this._chromeBarsWidth(), rbodyH, this._editor.id);

    this._layoutViewContainers();
  };

  // ════════════════════════════════════════════════════════════════════════
  // Grid handlers — size tracking, double-click reset, snap-to-hide
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Wire grid-change listeners for part size tracking and sash reset.
   * Called by Workbench after Phase 3 content setup is complete.
   */
  protected _wireGridHandlers(): void {
    // Grid sash drags are already rAF-throttled inside Grid itself.
    // Layout contributed containers synchronously here so nested views do not
    // visually lag behind the structural resize.
    this._register(this._grid.onDidChange(() => {
      this._updateEdgeAttributes();
      this._layoutViewContainers();

      // Track sizes after USER sash drags so toggles restore the right
      // ones. Id-based, wherever the part sits in the tree. Programmatic
      // mutations suspend this — see _suspendTracking.
      if (this._suspendTracking) return;
      if (this._sidebar.visible) {
        const w = this._grid.getViewSize(this._sidebar.id);
        if (w !== undefined && w > 0) this._lastSidebarWidth = w;
      }
      if (this._panel.visible) {
        if (this._panelMaximized) {
          this._panelMaximized = false;
          this._onDidChangePanelMaximized.fire(false);
        }
        const h = this._grid.getViewSize(this._panel.id);
        if (h !== undefined && h > 0) this._lastPanelHeight = h;
      }
      if (this._auxBarVisible) {
        const w = this._grid.getViewSize(this._auxiliaryBar.id);
        if (w !== undefined && w > 0) this._lastAuxBarWidth = w;
      }
    }));

    // Double-click on a sash resets the adjacent companion strip to its
    // default size (VS Code parity: Sash.onDidReset). Decided by which part
    // the sash touches — never by a hardcoded index.
    this._register(this._grid.onDidSashReset(({ branch, sashIndex }) => {
      this._resetSashToDefault(branch, sashIndex);
    }));

    // Snap-to-hide (VS Code parity: SplitView snap behaviour).
    this._register(this._grid.onDidSashSnap(({ viewId }) => {
      if (viewId === this._sidebar.id && this._sidebar.visible) {
        this.toggleSidebar();
      } else if (viewId === this._auxiliaryBar.id && this._auxBarVisible) {
        this.toggleAuxiliaryBar();
      } else if (viewId === this._panel.id && this._panel.visible) {
        this.togglePanel();
      }
    }));

    // Drag a part by its header: drop zones over every other part (split
    // beside, stack below) and along the window edges. The PRIMARY way to
    // rearrange the workbench; the palette commands are the same moves for
    // keyboard users.
    this._partDrag = this._register(new PartDragController({
      gridElement: this._grid.element,
      onMoveBeside: (partId, targetId, orientation, before) =>
        this.movePartBeside(partId, targetId, orientation, before),
      onMoveToEdge: (partId, orientation, before) =>
        this.movePartToEdge(partId, orientation, before),
      dockTargets: { left: this._sidebar.id, right: this._auxiliaryBar.id, panel: this._panel.id },
      canDockInto: (containerId, rail) =>
        this._canContainerDockInto?.(containerId, rail) ?? true,
      onContainerDrop: (containerId, zone) =>
        this._onContainerDropped?.(containerId, zone),
      onContainerDock: (containerId, rail) =>
        this._onContainerDockRequested?.(containerId, rail),
    }));
    this._armPartDragHandles();
  }

  /**
   * Give each movable part its drag grip. Sidebar and aux bar drag by their
   * headers; the panel has no title area of its own, so it drags by the
   * view container's tab strip (empty area — the tabs' own drag wins on the
   * tabs themselves). Content-provided handles may not exist yet on early
   * wiring, so this is safe to call again once they do.
   */
  protected _armPartDragHandles(): void {
    if (!this._partDrag) return;
    const arm = (part: Part, selector: string): void => {
      const handle = part.element.querySelector<HTMLElement>(selector);
      if (handle && !handle.classList.contains('part-drag-handle')) {
        this._partDrag!.armHandle(part.id, handle);
      }
    };
    arm(this._sidebar, '.part-title');
    arm(this._auxiliaryBar, '.part-title');
    arm(this._panel, '.view-container-tabs');

    // The same grips answer to RIGHT-CLICK with placement actions. The
    // palette carries these commands too, but a grip you can already drag
    // is where the hand goes looking — palette-only recovery does not
    // exist for someone who rarely opens the palette.
    this._armPlacementMenu(this._sidebar, '.part-title');
    this._armPlacementMenu(this._auxiliaryBar, '.part-title');
    this._armPlacementMenu(this._panel, '.view-container-tabs');
  }

  private _armPlacementMenu(part: Part, selector: string): void {
    const handle = part.element.querySelector<HTMLElement>(selector);
    if (!handle || handle.dataset.placementMenu === '1') return;
    handle.dataset.placementMenu = '1';

    handle.addEventListener('contextmenu', (e) => {
      // A tab under the cursor keeps its own meaning; the strip's empty
      // area speaks for the part.
      if (e.target instanceof HTMLElement && e.target.closest('.view-tab')) return;
      e.preventDefault();
      e.stopPropagation();

      const menu = ContextMenu.show({
        items: [
          { id: 'reset', label: 'Reset To Default Position', group: '1_reset' },
          { id: 'edge-left', label: 'Move To Left Edge', group: '2_move', order: 1 },
          { id: 'edge-right', label: 'Move To Right Edge', group: '2_move', order: 2 },
          { id: 'edge-bottom', label: 'Move To Bottom Edge', group: '2_move', order: 3 },
          ...(this._onAddWidgetRequested
            ? [{ id: 'add-widget', label: 'Add Widget…', group: '3_widget' }]
            : []),
        ],
        anchor: { x: e.clientX, y: e.clientY },
      });
      menu.onDidSelect(({ item }) => {
        switch (item.id) {
          case 'reset':
            this.resetPartPlacement(part.id);
            break;
          case 'edge-left':
            this.movePartToEdge(part.id, Orientation.Horizontal, true);
            break;
          case 'edge-right':
            this.movePartToEdge(part.id, Orientation.Horizontal, false);
            break;
          case 'edge-bottom':
            this.movePartToEdge(part.id, Orientation.Vertical, false);
            break;
          case 'add-widget':
            this._onAddWidgetRequested?.({ x: e.clientX, y: e.clientY }, part.id);
            break;
        }
      });
    });
  }

  private _resetSashToDefault(branch: GridBranchNode, sashIndex: number): void {
    const ids: string[] = [];
    for (const child of [branch.getChild(sashIndex), branch.getChild(sashIndex + 1)]) {
      if (child && child.type === GridNodeType.Leaf) ids.push(child.view.id);
    }

    if (ids.includes(this._sidebar.id) && this._sidebar.visible) {
      this._grid.resizeView(this._sidebar.id, DEFAULT_SIDEBAR_WIDTH);
      this._lastSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
    } else if (ids.includes(this._panel.id) && this._panel.visible) {
      this._grid.resizeView(this._panel.id, DEFAULT_PANEL_HEIGHT);
      this._lastPanelHeight = DEFAULT_PANEL_HEIGHT;
      if (this._panelMaximized) {
        this._panelMaximized = false;
        this._onDidChangePanelMaximized.fire(false);
      }
    } else if (ids.includes(this._auxiliaryBar.id) && this._auxBarVisible) {
      this._grid.resizeView(this._auxiliaryBar.id, DEFAULT_AUX_BAR_WIDTH);
      this._lastAuxBarWidth = DEFAULT_AUX_BAR_WIDTH;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // View container layout (template method — overridden by Workbench)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Layout all active view containers to match current part dimensions.
   * Default no-op — Workbench overrides with the full implementation that
   * sizes sidebar, panel, and auxiliary bar containers.
   */
  protected _layoutViewContainers(): void {
    // Overridden by Workbench
  }

  // ════════════════════════════════════════════════════════════════════════
  // Toggle Methods — part visibility mutations
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Toggle visibility of the auxiliary bar (secondary sidebar).
   * When shown, it appears at the right edge of the body.
   */
  toggleAuxiliaryBar(): void {
    this._withTrackingSuspended(() => {
      if (this._auxBarVisible) {
        const currentWidth = this._grid.getViewSize(this._auxiliaryBar.id);
        if (currentWidth !== undefined && currentWidth > 0) {
          this._lastAuxBarWidth = currentWidth;
        }
        this._recordPlacement(this._auxiliaryBar.id);
        this._grid.removeView(this._auxiliaryBar.id);
        this._auxiliaryBar.setVisible(false);
        this._auxBarVisible = false;
      } else {
        this._auxiliaryBar.setVisible(true);
        // Back where the user last had it; the right edge only as the
        // first-time default.
        this._placePart(this._auxiliaryBar, this._lastAuxBarWidth, () => {
          this._grid.addView(this._auxiliaryBar, this._lastAuxBarWidth);
          this._grid.moveViewToEdge(
            this._auxiliaryBar.id, Orientation.Horizontal, false, this._lastAuxBarWidth,
          );
        });
        this._auxBarVisible = true;
      }
      this._relayoutBody();
    });
    this._layoutViewContainers();
    this._onDidChangePartVisibility.fire({
      partId: PartId.AuxiliaryBar,
      visible: this._auxBarVisible,
    });
  }

  /**
   * Toggle primary sidebar visibility.
   *
   * VS Code reference: ViewContainerActivityAction.run() — clicking active
   * icon toggles sidebar. Remembers width before collapse and restores it.
   */
  toggleSidebar(): void {
    const el = this._sidebar.element;

    if (this._sidebar.visible) {
      // Save current width before collapsing so we can restore later
      const currentWidth = this._grid.getViewSize(this._sidebar.id);
      if (currentWidth !== undefined && currentWidth > 0) {
        this._lastSidebarWidth = currentWidth;
      }

      // Animate out, then remove from grid
      el.classList.add('sidebar-animating', 'sidebar-collapsed');
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        el.removeEventListener('transitionend', finish);
        el.classList.remove('sidebar-animating', 'sidebar-collapsed');
        this._withTrackingSuspended(() => {
          this._recordPlacement(this._sidebar.id);
          this._grid.removeView(this._sidebar.id);
          this._sidebar.setVisible(false);
          this._relayoutBody();
        });
        this._layoutViewContainers();
        this._onDidChangePartVisibility.fire({ partId: PartId.Sidebar, visible: false });
      };
      el.addEventListener('transitionend', finish, { once: true });
      // Safety fallback in case transitionend is missed
      setTimeout(finish, 200);
    } else {
      // Add at the left edge, then animate in
      this._sidebar.setVisible(true);
      el.classList.add('sidebar-animating', 'sidebar-collapsed');
      this._withTrackingSuspended(() => {
        this._placePart(this._sidebar, this._lastSidebarWidth, () => {
          this._grid.addView(this._sidebar, this._lastSidebarWidth);
          this._grid.moveViewToEdge(
            this._sidebar.id, Orientation.Horizontal, true, this._lastSidebarWidth,
          );
        });
        this._relayoutBody();
      });
      this._layoutViewContainers();

      // Force reflow so the initial collapsed state is rendered before removing the class
      void el.offsetWidth;
      el.classList.remove('sidebar-collapsed');
      el.addEventListener('transitionend', () => {
        el.classList.remove('sidebar-animating');
      }, { once: true });
      setTimeout(() => el.classList.remove('sidebar-animating'), 200);
      this._onDidChangePartVisibility.fire({ partId: PartId.Sidebar, visible: true });
    }
  }

  /**
   * Toggle panel visibility.
   *
   * VS Code reference: TogglePanelAction (workbench.action.togglePanel, Ctrl+J).
   * Remembers height before collapse and restores it on expand.
   */
  togglePanel(): void {
    this._withTrackingSuspended(() => {
      if (this._panel.visible) {
        const currentHeight = this._grid.getViewSize(this._panel.id);
        if (currentHeight !== undefined && currentHeight > 0) {
          this._lastPanelHeight = currentHeight;
        }
        // Removing the panel collapses the branch it shared with its
        // neighbour; the neighbour takes over the slot.
        this._recordPlacement(this._panel.id);
        this._grid.removeView(this._panel.id);
        this._panel.setVisible(false);
        this._panelMaximized = false;
        this._onDidChangePanelMaximized.fire(false);
        this._relayoutBody();
      } else {
        this._panel.setVisible(true);
        // Back where the user last had it — under the sidebar if that is
        // where they stacked it; below the editor only as the default.
        this._placePart(this._panel, this._lastPanelHeight, () => this._showPanelBelowEditor());
        this._panelMaximized = false;
        this._onDidChangePanelMaximized.fire(false);
        this._relayoutBody();
      }
    });
    this._layoutViewContainers();
    this._onDidChangePartVisibility.fire({
      partId: PartId.Panel,
      visible: this._panel.visible,
    });
  }

  /**
   * Split the editor's slot: panel below, at its remembered height.
   * Caller suspends tracking.
   */
  private _showPanelBelowEditor(): void {
    const height = this._lastPanelHeight;
    this._grid.splitView(this._editor.id, this._panel, height, Orientation.Vertical);
    // A cross-axis split halves the slot (it has no meaningful measure for
    // the new axis); settle real pixels first, then move the new sash to
    // the exact remembered height, clamped like any drag.
    this._relayoutBody();
    this._grid.resizeView(this._panel.id, height);
  }

  /**
   * Toggle panel between normal and maximized height.
   *
   * VS Code reference: toggleMaximizedPanel — stores non-maximized height,
   * sets panel to fill all vertical space (editor gets minimum), restores on
   * second toggle.
   */
  toggleMaximizedPanel(): void {
    this._withTrackingSuspended(() => {
      if (!this._panel.visible) {
        // Show + maximize in one go, in the panel's own place
        this._panel.setVisible(true);
        this._placePart(this._panel, this._lastPanelHeight, () => this._showPanelBelowEditor());
        this._relayoutBody();
        this._onDidChangePartVisibility.fire({ partId: PartId.Panel, visible: true });
      }

      if (this._panelMaximized) {
        this._grid.resizeView(this._panel.id, this._lastPanelHeight);
        this._panelMaximized = false;
      } else {
        const currentHeight = this._grid.getViewSize(this._panel.id);
        if (currentHeight !== undefined && currentHeight > 0) {
          this._lastPanelHeight = currentHeight;
        }
        // Shrinking the editor to a strip grows the panel by the same
        // amount: the two share a branch, and the resize is zero-sum
        // within it.
        this._grid.resizeView(this._editor.id, MAXIMIZED_EDITOR_MIN);
        this._panelMaximized = true;
      }
    });
    this._onDidChangePanelMaximized.fire(this._panelMaximized);
    this._layoutViewContainers();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Area toggles — visibility of REGIONS, not hardcoded parts
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Which body area a view occupies, measured from the TREE's geometry
   * against the editor — the one citizen that never hides, so it anchors
   * the frame of reference. "Left" is everything wholly left of the
   * editor's column, wherever it started life: a sidebar moved to the
   * right edge is a RIGHT-area occupant now, and the left toggle has no
   * business touching it.
   */
  areaOf(viewId: string): BodyArea | 'center' {
    if (viewId === this._editor.id) return 'center';
    const r = this._grid.cellRect(viewId);
    const er = this._grid.cellRect(this._editor.id);
    if (!r || !er) return 'center';
    const eps = 2;
    if (r.left + r.width <= er.left + eps) return 'left';
    if (r.left >= er.left + er.width - eps) return 'right';
    if (r.top >= er.top + er.height - eps) return 'bottom';
    return 'center';
  }

  /** Everything currently occupying an area: companion parts and floating
   *  boxes alike. The editor is no area's occupant. */
  private _areaOccupants(area: BodyArea): string[] {
    const ids: string[] = [];
    for (const part of [this._sidebar, this._panel, this._auxiliaryBar]) {
      if (this._grid.hasView(part.id) && this.areaOf(part.id) === area) ids.push(part.id);
    }
    for (const id of this._floatingViews.keys()) {
      if (this._grid.hasView(id) && this.areaOf(id) === area) ids.push(id);
    }
    return ids;
  }

  isAreaOccupied(area: BodyArea): boolean {
    return this._areaOccupants(area).length > 0;
  }

  /** Last known area per part — kept while a part is HIDDEN so its rail
   *  icon (and the way back it offers) survives the hide. */
  private readonly _lastPartArea = new Map<string, BodyArea | 'center'>();

  /**
   * Which parts have wandered into a rail AREA that is not their home —
   * each earns an icon in that rail's ribbon, exactly like a docked
   * container announces itself there. Keyed off GEOMETRY (areaOf), never
   * off which gesture put the part there. A hidden part keeps its last
   * known rail so the icon remains a way back.
   */
  railIconPlacements(): ReadonlyArray<{ partId: string; rail: 'left' | 'right' }> {
    const homes: ReadonlyArray<[Part, BodyArea]> = [
      [this._sidebar, 'left'],
      [this._panel, 'bottom'],
      [this._auxiliaryBar, 'right'],
    ];
    const out: { partId: string; rail: 'left' | 'right' }[] = [];
    for (const [part, home] of homes) {
      let area: BodyArea | 'center' | undefined;
      if (this._grid.hasView(part.id)) {
        area = this.areaOf(part.id);
        this._lastPartArea.set(part.id, area);
      } else {
        area = this._lastPartArea.get(part.id);
      }
      if ((area === 'left' || area === 'right') && area !== home) {
        out.push({ partId: part.id, rail: area });
      }
    }
    return out;
  }

  /**
   * Show or hide a body AREA. This is what the titlebar toggles and their
   * shortcuts mean: "hide the bottom" hides whatever occupies the bottom —
   * the panel if it lives there, a detached terminal box if that is what
   * the user parked there instead. Hiding remembers the occupant set;
   * toggling an empty area restores that set, or the area's default part
   * when nothing was ever hidden.
   */
  toggleArea(area: BodyArea): void {
    const occupants = this._areaOccupants(area);
    if (occupants.length > 0) {
      this._areaMemory.set(area, occupants);
      for (const id of occupants) this._hideBodyView(id);
      return;
    }
    const remembered = this._areaMemory.get(area);
    const toShow = remembered && remembered.length > 0
      ? remembered : [this._defaultAreaPart(area).id];
    // Reverse hide order: the first-hidden view's recall may name a
    // later-hidden sibling, which must already be back for it to resolve.
    for (const id of [...toShow].reverse()) this._showBodyView(id, area);
  }

  private _defaultAreaPart(area: BodyArea): Part {
    switch (area) {
      case 'left': return this._sidebar;
      case 'bottom': return this._panel;
      case 'right': return this._auxiliaryBar;
    }
  }

  /** Hide one body view, whatever kind it is, remembering its place. */
  private _hideBodyView(viewId: string): void {
    if (viewId === this._sidebar.id) {
      if (this._sidebar.visible) this.toggleSidebar();
      return;
    }
    if (viewId === this._panel.id) {
      if (this._panel.visible) this.togglePanel();
      return;
    }
    if (viewId === this._auxiliaryBar.id) {
      if (this._auxBarVisible) this.toggleAuxiliaryBar();
      return;
    }
    // A floating box: out of the tree, place and size remembered. The box
    // object itself stays registered so its leaf can come back.
    if (!this._grid.hasView(viewId)) return;
    this._withTrackingSuspended(() => {
      const size = this._grid.getViewSize(viewId);
      if (size !== undefined && size > 0) this._hiddenFloatingSizes.set(viewId, size);
      this._recordPlacement(viewId);
      this._grid.removeView(viewId);
      this._relayoutBody();
    });
    this._layoutViewContainers();
  }

  /** Bring one body view back — recalled place first, area edge as home. */
  private _showBodyView(viewId: string, area: BodyArea): void {
    if (viewId === this._sidebar.id) {
      if (!this._sidebar.visible) this.toggleSidebar();
      return;
    }
    if (viewId === this._panel.id) {
      if (!this._panel.visible) this.togglePanel();
      return;
    }
    if (viewId === this._auxiliaryBar.id) {
      if (!this._auxBarVisible) this.toggleAuxiliaryBar();
      return;
    }
    const view = this._floatingViews.get(viewId);
    if (!view || this._grid.hasView(viewId)) return;
    const size = this._hiddenFloatingSizes.get(viewId) ?? DEFAULT_PANEL_HEIGHT;
    this._withTrackingSuspended(() => {
      this._placePart(view, size, () => {
        this._grid.addView(view, size);
        const edge = AREA_EDGES[area];
        this._grid.moveViewToEdge(viewId, edge.orientation, edge.before, size);
      });
      this._relayoutBody();
    });
    this._layoutViewContainers();
  }

  /**
   * Toggle status bar visibility.
   *
   * VS Code reference: ToggleStatusbarVisibilityAction
   * (workbench.action.toggleStatusbarVisibility).
   * Status bar is a fixed-height (22 px) strip — no sash resizing needed.
   */
  toggleStatusBar(): void {
    const visible = !this._statusBar.visible;
    this._statusBar.setVisible(visible);
    this._relayout();
    this._onDidChangePartVisibility.fire({
      partId: PartId.StatusBar,
      visible,
    });
  }

  /**
   * Toggle Zen Mode — hide all chrome to focus on the editor.
   *
   * VS Code reference: ToggleZenMode (workbench.action.toggleZenMode, Ctrl+K Z).
   * Saves visibility state of all parts before entering, restores on exit.
   */
  toggleZenMode(): void {
    if (this._zenMode) {
      // ── Exit Zen Mode ──
      this._zenMode = false;
      this._container.classList.remove('zenMode');

      // Restore the pre-zen arrangement — the exact tree, in one step.
      const s = this._preZenState;
      const tree = this._preZenTree;
      if (tree && this.restoreBodyTree(tree)) {
        if (s) {
          if (s.statusBar && !this._statusBar.visible) {
            this._statusBar.setVisible(true);
          }
          if (s.activityBar) {
            this._activityBarPart.element.classList.remove('hidden');
          }
          if (s.activityBarRight) {
            this._activityBarRight?.setVisible(true);
          }
        }
      } else if (s) {
        // The snapshot failed to apply (it should not — it is our own
        // serialize): fall back to seating each part at its recalled spot.
        this._withTrackingSuspended(() => {
          if (s.sidebar && !this._sidebar.visible) {
            this._sidebar.setVisible(true);
            this._placePart(this._sidebar, this._lastSidebarWidth, () => {
              this._grid.addView(this._sidebar, this._lastSidebarWidth);
              this._grid.moveViewToEdge(
                this._sidebar.id, Orientation.Horizontal, true, this._lastSidebarWidth,
              );
            });
          }
          if (s.panel && !this._panel.visible) {
            this._panel.setVisible(true);
            this._placePart(this._panel, this._lastPanelHeight, () => this._showPanelBelowEditor());
          }
          if (s.statusBar && !this._statusBar.visible) {
            this._statusBar.setVisible(true);
          }
          if (s.auxBar && !this._auxBarVisible) {
            this.toggleAuxiliaryBar();
          }
          if (s.activityBar) {
            this._activityBarPart.element.classList.remove('hidden');
          }
          if (s.activityBarRight) {
            this._activityBarRight?.setVisible(true);
          }
        });
      }
      this._preZenState = null;
      this._preZenTree = null;

      this._relayout();
      this._layoutViewContainers();
    } else {
      // ── Enter Zen Mode ──
      // Snapshot current visibility
      this._preZenState = {
        sidebar: this._sidebar.visible,
        panel: this._panel.visible,
        statusBar: this._statusBar.visible,
        auxBar: this._auxBarVisible,
        activityBar: !this._activityBarPart.element.classList.contains('hidden'),
        activityBarRight: this._activityBarRight?.visible ?? false,
      };
      // Snapshot the arrangement BEFORE dismantling it.
      this._preZenTree = this._grid.serialize();
      this._zenMode = true;
      this._container.classList.add('zenMode');

      this._withTrackingSuspended(() => {
        // Hide sidebar
        if (this._sidebar.visible) {
          const w = this._grid.getViewSize(this._sidebar.id);
          if (w !== undefined && w > 0) this._lastSidebarWidth = w;
          this._recordPlacement(this._sidebar.id);
          this._grid.removeView(this._sidebar.id);
          this._sidebar.setVisible(false);
        }

        // Hide panel
        if (this._panel.visible) {
          const h = this._grid.getViewSize(this._panel.id);
          if (h !== undefined && h > 0) this._lastPanelHeight = h;
          this._recordPlacement(this._panel.id);
          this._grid.removeView(this._panel.id);
          this._panel.setVisible(false);
          this._panelMaximized = false;
          this._onDidChangePanelMaximized.fire(false);
        }

        // Hide status bar
        if (this._statusBar.visible) {
          this._statusBar.setVisible(false);
        }

        // Hide auxiliary bar
        if (this._auxBarVisible) {
          this.toggleAuxiliaryBar();
        }

        // Hide the ribbons
        this._activityBarPart.element.classList.add('hidden');
        this._activityBarRight?.setVisible(false);
      });

      this._relayout();
      this._layoutViewContainers();
    }

    this._onDidChangeZenMode.fire(this._zenMode);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Reset
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Rebuild the default shape from scratch: sidebar and panel shown at their
   * default sizes, aux bar hidden, status bar shown. The same data the first
   * boot uses, restored in place — parts are detached and re-seated, never
   * disposed.
   */
  resetLayout(): void {
    const sidebarWas = this._sidebar.visible;
    const panelWas = this._panel.visible;
    const auxWas = this._auxBarVisible;

    this._sidebar.setVisible(true);
    this._panel.setVisible(true);
    this._auxiliaryBar.setVisible(false);
    this._auxBarVisible = false;
    this._lastSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
    this._lastPanelHeight = DEFAULT_PANEL_HEIGHT;
    this._lastAuxBarWidth = DEFAULT_AUX_BAR_WIDTH;
    if (this._panelMaximized) {
      this._panelMaximized = false;
      this._onDidChangePanelMaximized.fire(false);
    }
    if (!this._statusBar.visible) {
      this.toggleStatusBar();
    }
    // A reset means "forget my arrangement" — recalled positions and
    // hidden-area memory included.
    this._placementRecall.clear();
    this._areaMemory.clear();
    this._hiddenFloatingSizes.clear();

    const rw = this._container.clientWidth;
    const rh = this._container.clientHeight;
    const bodyH = rh - TITLE_HEIGHT - STATUS_HEIGHT;
    const bodyW = rw - ACTIVITY_BAR_WIDTH;
    this._withTrackingSuspended(() => {
      this._grid.restoreFrom(
        this._currentDefaultState(bodyW, bodyH),
        (viewId) => this._partGridView(viewId),
      );
    });

    if (!sidebarWas) {
      this._onDidChangePartVisibility.fire({ partId: PartId.Sidebar, visible: true });
    }
    if (!panelWas) {
      this._onDidChangePartVisibility.fire({ partId: PartId.Panel, visible: true });
    }
    if (auxWas) {
      this._onDidChangePartVisibility.fire({ partId: PartId.AuxiliaryBar, visible: false });
    }
    this._layoutViewContainers();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Body tree persistence and relocation
  // ════════════════════════════════════════════════════════════════════════

  /** The body tree as saved state. Leaves are part ids — stable across runs. */
  serializeBodyTree(): SerializedGrid {
    return this._grid.serialize();
  }

  /**
   * Restore a saved body tree — the user's part POSITIONS, which the old
   * three-grid model never persisted (a sidebar moved to the right edge
   * snapped back to the left on restart).
   *
   * Only a tree whose every leaf is one of the four body parts, exactly
   * once, editor included, is accepted. That is deliberate validation, not
   * pedantry: saves from the OLD model carry the aspirational default state
   * with titlebar and statusbar leaves, and they fall through here to the
   * legacy visibility path rather than restoring a shape the app never had.
   */
  restoreBodyTree(saved: SerializedGrid | undefined): boolean {
    if (!saved || typeof saved !== 'object' || !saved.root) return false;

    const leaves: string[] = [];
    const walk = (node: SerializedGridNode): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === SerializedNodeType.Leaf) {
        leaves.push(node.viewId);
        return;
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child);
      }
    };
    walk(saved.root);

    const unique = new Set(leaves);
    if (leaves.length === 0 || unique.size !== leaves.length) return false;
    if (!unique.has(this._editor.id)) return false;
    const known = new Set(
      [this._sidebar, this._editor, this._panel, this._auxiliaryBar].map((p) => p.id),
    );
    for (const id of unique) {
      if (known.has(id)) continue;
      // A floating container box or a widget seat: resolvable whenever the
      // factory is wired, because a shell can be built for ANY id of these
      // prefixes — its content arrives when the tool/type does. Anything
      // else is a tree from a model this build does not speak: legacy path.
      if ((id.startsWith('container:') || id.startsWith('widget:')) && this._floatingViewFactory) continue;
      if (this._floatingViews.has(id)) continue;
      return false;
    }

    const sidebarWas = this._sidebar.visible;
    const panelWas = this._panel.visible;
    const auxWas = this._auxBarVisible;

    // Floating views not present in the restored tree do not survive it: an
    // arrangement is a whole shape (drop from the registry; the box manager
    // reconciles its own state via floatingViewIds()).
    for (const id of [...this._floatingViews.keys()]) {
      if (!unique.has(id)) this._floatingViews.delete(id);
    }

    this._withTrackingSuspended(() => {
      this._grid.restoreFrom(saved, (viewId) => this._partGridView(viewId));
      // Presence in the tree IS visibility now.
      this._sidebar.setVisible(unique.has(this._sidebar.id));
      this._panel.setVisible(unique.has(this._panel.id));
      const auxVisible = unique.has(this._auxiliaryBar.id);
      this._auxiliaryBar.setVisible(auxVisible);
      this._auxBarVisible = auxVisible;
      this._panelMaximized = false;
      this._relayoutBody();
    });

    if (sidebarWas !== this._sidebar.visible) {
      this._onDidChangePartVisibility.fire({ partId: PartId.Sidebar, visible: this._sidebar.visible });
    }
    if (panelWas !== this._panel.visible) {
      this._onDidChangePartVisibility.fire({ partId: PartId.Panel, visible: this._panel.visible });
    }
    if (auxWas !== this._auxBarVisible) {
      this._onDidChangePartVisibility.fire({ partId: PartId.AuxiliaryBar, visible: this._auxBarVisible });
    }
    this._layoutViewContainers();
    return true;
  }

  /**
   * Move a part to an outer edge of the body — the sidebar to the right,
   * the panel to a side. A position change, nothing more: the part keeps
   * its instance, its content and its size along the new axis, and the
   * shape persists with the body tree.
   */
  movePartToEdge(partId: string, orientation: Orientation, before: boolean): void {
    if (!this._grid.hasView(partId)) return;
    this._withTrackingSuspended(() => {
      const size = this._grid.getViewSize(partId);
      this._grid.moveViewToEdge(
        partId, orientation, before, size !== undefined && size > 0 ? size : undefined,
      );
      this._relayoutBody();
    });
    this._layoutViewContainers();
  }

  /**
   * Put ONE companion part back at its default position and size, leaving
   * everything else exactly where the user has it. The escape hatch for
   * "this thing wandered off and I want it home" without resetting the
   * whole layout.
   */
  resetPartPlacement(partId: string): void {
    this._placementRecall.delete(partId);
    const wasHidden = !this._grid.hasView(partId);

    if (partId === this._panel.id) {
      this._lastPanelHeight = DEFAULT_PANEL_HEIGHT;
      this._withTrackingSuspended(() => {
        if (this._grid.hasView(partId)) this._grid.removeView(partId);
        this._panel.setVisible(true);
        this._showPanelBelowEditor();
        if (this._panelMaximized) {
          this._panelMaximized = false;
          this._onDidChangePanelMaximized.fire(false);
        }
        this._relayoutBody();
      });
      if (wasHidden) {
        this._onDidChangePartVisibility.fire({ partId: PartId.Panel, visible: true });
      }
    } else if (partId === this._sidebar.id) {
      this._lastSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
      this._withTrackingSuspended(() => {
        if (this._grid.hasView(partId)) this._grid.removeView(partId);
        this._sidebar.setVisible(true);
        this._grid.addView(this._sidebar, DEFAULT_SIDEBAR_WIDTH);
        this._grid.moveViewToEdge(partId, Orientation.Horizontal, true, DEFAULT_SIDEBAR_WIDTH);
        this._relayoutBody();
      });
      if (wasHidden) {
        this._onDidChangePartVisibility.fire({ partId: PartId.Sidebar, visible: true });
      }
    } else if (partId === this._auxiliaryBar.id) {
      this._lastAuxBarWidth = DEFAULT_AUX_BAR_WIDTH;
      this._withTrackingSuspended(() => {
        if (this._grid.hasView(partId)) this._grid.removeView(partId);
        this._auxiliaryBar.setVisible(true);
        this._grid.addView(this._auxiliaryBar, DEFAULT_AUX_BAR_WIDTH);
        this._grid.moveViewToEdge(partId, Orientation.Horizontal, false, DEFAULT_AUX_BAR_WIDTH);
        this._relayoutBody();
      });
      if (!this._auxBarVisible) {
        this._auxBarVisible = true;
        this._onDidChangePartVisibility.fire({ partId: PartId.AuxiliaryBar, visible: true });
      }
    } else {
      return;
    }
    this._layoutViewContainers();
  }

  /**
   * Move a part beside another one — split its space or stack below it.
   * "Panel under the sidebar" is this with a vertical orientation, and the
   * dragged instance keeps running throughout.
   */
  movePartBeside(partId: string, targetId: string, orientation: Orientation, before: boolean): void {
    if (partId === targetId) return;
    if (!this._grid.hasView(partId) || !this._grid.hasView(targetId)) return;
    this._withTrackingSuspended(() => {
      this._grid.moveView(partId, targetId, orientation, before);
      this._relayoutBody();
    });
    this._layoutViewContainers();
  }

  // ── Floating views (container boxes; surfaces later) ──

  /**
   * Seat a floating citizen in the grid at a drop zone — beside another
   * view, at an edge, or (no zone) at the right edge as the default.
   */
  addFloatingView(view: IGridView, zone?: PartDropZone): void {
    this._floatingViews.set(view.id, view);
    this._withTrackingSuspended(() => {
      if (zone?.kind === 'beside' && this._grid.hasView(zone.targetId)) {
        this._grid.addView(view, 300);
        this._grid.moveView(view.id, zone.targetId, zone.orientation, zone.before);
      } else if (zone?.kind === 'edge') {
        const size = zone.orientation === Orientation.Horizontal ? 300 : 220;
        this._grid.addView(view, size);
        this._grid.moveViewToEdge(view.id, zone.orientation, zone.before, size);
      } else {
        this._grid.addView(view, 300);
        this._grid.moveViewToEdge(view.id, Orientation.Horizontal, false, 300);
      }
      this._relayoutBody();
    });
    this._layoutViewContainers();
  }

  /** Remove a floating citizen from the grid. Removal, not disposal. */
  removeFloatingView(viewId: string): void {
    this._floatingViews.delete(viewId);
    if (!this._grid.hasView(viewId)) return;
    this._withTrackingSuspended(() => {
      this._grid.removeView(viewId);
      this._relayoutBody();
    });
    this._layoutViewContainers();
  }

  /** Register a floating view that restore created through the factory. */
  protected _adoptFloatingView(view: IGridView): void {
    this._floatingViews.set(view.id, view);
  }

  hasFloatingView(viewId: string): boolean {
    return this._floatingViews.has(viewId);
  }

  // ── LayoutHost Protocol ──────────────────────────────────────────────────
  // These methods fulfil the LayoutHost interface expected by LayoutService.
  // VS Code reference: IWorkbenchLayoutService.isVisible / setPartHidden.

  /**
   * Check whether a part is currently visible by its PartId.
   */
  isPartVisible(partId: string): boolean {
    switch (partId) {
      case PartId.Sidebar: return this._sidebar.visible;
      case PartId.Panel: return this._panel.visible;
      case PartId.AuxiliaryBar: return this._auxBarVisible;
      case PartId.StatusBar: return this._statusBar!.visible;
      case PartId.ActivityBar: return true; // always visible
      case PartId.Titlebar: return true;    // always visible
      case PartId.Editor: return true;      // always visible
      default: return false;
    }
  }

  /**
   * Show or hide a part by its PartId.
   * Dispatches to the relevant toggle method following VS Code's
   * `setPartHidden → setSideBarHidden / setPanelHidden` pattern.
   */
  setPartHidden(hidden: boolean, partId: string): void {
    const isVisible = this.isPartVisible(partId);
    // No-op if already in the desired state
    if (hidden === !isVisible) return;

    switch (partId) {
      case PartId.Sidebar:
        this.toggleSidebar();
        break;
      case PartId.Panel:
        this.togglePanel();
        break;
      case PartId.AuxiliaryBar:
        this.toggleAuxiliaryBar();
        break;
      case PartId.StatusBar:
        this.toggleStatusBar();
        break;
      // Titlebar, Editor, ActivityBar — not toggleable
      default:
        console.warn(`[Layout] setPartHidden not supported for "${partId}"`);
        break;
    }
  }
}
