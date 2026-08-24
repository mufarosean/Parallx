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
import { PartId } from '../parts/partTypes.js';
import { Grid } from '../layout/grid.js';
import { GridNodeType } from '../layout/gridNode.js';
import type { GridBranchNode } from '../layout/gridNode.js';
import { Orientation, SizingMode } from '../layout/layoutTypes.js';
import { SerializedNodeType } from '../layout/layoutModel.js';
import type { SerializedGrid, SerializedGridNode, SerializedLeafNode } from '../layout/layoutModel.js';
import type { IGridView } from '../layout/gridView.js';
import { SurfaceTree } from '../surfaces/surfaceTree.js';
import { surfaceRegistry } from '../surfaces/surfaceRegistry.js';
import { PartRegistry } from '../parts/partRegistry.js';
import { TitlebarPart, titlebarPartDescriptor } from '../parts/titlebarPart.js';
import { ActivityBarPart, activityBarPartDescriptor } from '../parts/activityBarPart.js';
import { sidebarPartDescriptor } from '../parts/sidebarPart.js';
import { editorPartDescriptor } from '../parts/editorPart.js';
import { auxiliaryBarPartDescriptor } from '../parts/auxiliaryBarPart.js';
import { panelPartDescriptor } from '../parts/panelPart.js';
import { statusBarPartDescriptor } from '../parts/statusBarPart.js';
import { $ } from '../ui/dom.js';

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

// ── Zen Mode Exit Info ──

export interface ZenModeExitInfo {
  sidebar: boolean;
  panel: boolean;
  statusBar: boolean;
  auxBar: boolean;
  activityBar: boolean;
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
   * True while a layout METHOD is mutating the tree. The grid-change
   * tracker exists to remember what the USER dragged; letting it observe a
   * toggle mid-flight records garbage (a cross-axis split's provisional
   * half, a maximize target) as "the size the user wanted". This raced in
   * the old three-grid code too — it is why restoring a maximized panel
   * silently did nothing.
   */
  private _suspendTracking = false;

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

  /** Resolve a default-state viewId to the part that backs it. */
  private _partGridView(viewId: string): IGridView {
    for (const part of [this._sidebar, this._editor, this._panel, this._auxiliaryBar]) {
      if (part.id === viewId) return part;
    }
    throw new Error(`Layout: no part backs view "${viewId}"`);
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
    const activityBarHidden = this._activityBarPart.element.classList.contains('hidden');
    const abw = activityBarHidden ? 0 : ACTIVITY_BAR_WIDTH;
    const statusH = this._statusBar.visible ? STATUS_HEIGHT : 0;
    this._grid.resizeWithFixedViews(
      this._container.clientWidth - abw,
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

    // Re-layout activity bar (chrome, outside the grid)
    const activityBarHidden = this._activityBarPart.element.classList.contains('hidden');
    const activityBarW = activityBarHidden ? 0 : ACTIVITY_BAR_WIDTH;
    if (!activityBarHidden) {
      this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, rbodyH, Orientation.Vertical);
    }

    // Keep the companion strips at their sizes; the editor absorbs the
    // window delta (VS Code parity). The distribution recurses into nested
    // branches, so it finds the editor wherever it sits.
    this._grid.resizeWithFixedViews(rw - activityBarW, rbodyH, this._editor.id);

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
        this._grid.removeView(this._auxiliaryBar.id);
        this._auxiliaryBar.setVisible(false);
        this._auxBarVisible = false;
      } else {
        this._auxiliaryBar.setVisible(true);
        // Added then moved to the edge: "right edge" is a position in the
        // tree, not an index, and this stays correct whatever shape the
        // tree has grown into.
        this._grid.addView(this._auxiliaryBar, this._lastAuxBarWidth);
        this._grid.moveViewToEdge(
          this._auxiliaryBar.id, Orientation.Horizontal, false, this._lastAuxBarWidth,
        );
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
        this._grid.addView(this._sidebar, this._lastSidebarWidth);
        this._grid.moveViewToEdge(
          this._sidebar.id, Orientation.Horizontal, true, this._lastSidebarWidth,
        );
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
        // Removing the panel collapses the editor-column branch it shared
        // with the editor; the editor takes over the slot.
        this._grid.removeView(this._panel.id);
        this._panel.setVisible(false);
        this._panelMaximized = false;
        this._onDidChangePanelMaximized.fire(false);
        this._relayoutBody();
      } else {
        this._panel.setVisible(true);
        this._showPanelBelowEditor();
        this._panelMaximized = false;
        this._onDidChangePanelMaximized.fire(false);
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
        // Show + maximize in one go
        this._panel.setVisible(true);
        this._showPanelBelowEditor();
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

      // Restore pre-zen visibility state
      const s = this._preZenState;
      if (s) {
        this._withTrackingSuspended(() => {
          if (s.sidebar && !this._sidebar.visible) {
            this._sidebar.setVisible(true);
            this._grid.addView(this._sidebar, this._lastSidebarWidth);
            this._grid.moveViewToEdge(
              this._sidebar.id, Orientation.Horizontal, true, this._lastSidebarWidth,
            );
          }
          if (s.panel && !this._panel.visible) {
            this._panel.setVisible(true);
            this._showPanelBelowEditor();
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
        });
        this._preZenState = null;
      }

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
      };
      this._zenMode = true;
      this._container.classList.add('zenMode');

      this._withTrackingSuspended(() => {
        // Hide sidebar
        if (this._sidebar.visible) {
          const w = this._grid.getViewSize(this._sidebar.id);
          if (w !== undefined && w > 0) this._lastSidebarWidth = w;
          this._grid.removeView(this._sidebar.id);
          this._sidebar.setVisible(false);
        }

        // Hide panel
        if (this._panel.visible) {
          const h = this._grid.getViewSize(this._panel.id);
          if (h !== undefined && h > 0) this._lastPanelHeight = h;
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

        // Hide activity bar
        this._activityBarPart.element.classList.add('hidden');
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
