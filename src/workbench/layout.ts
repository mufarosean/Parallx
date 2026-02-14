// layout.ts — Layout base class
//
// Owns the grid system, part references, and all layout-mutation methods
// (toggle sidebar/panel/status bar/aux bar, zen mode, relayout).
//
// VS Code alignment: mirrors `src/vs/workbench/browser/layout.ts`.
// In VS Code the inheritance chain is `Layout → Workbench`:
//   - Layout owns the grid, part visibility, toggle methods, state persistence
//   - Workbench adds service wiring, tool/extension registration, lifecycle
//
// Parallx follows the same split. Workbench extends Layout.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { Part } from '../parts/part.js';
import { PartId } from '../parts/partTypes.js';
import { Grid } from '../layout/grid.js';
import { Orientation } from '../layout/layoutTypes.js';
import { IGridView } from '../layout/gridView.js';
import { PartRegistry } from '../parts/partRegistry.js';
import { TitlebarPart, titlebarPartDescriptor } from '../parts/titlebarPart.js';
import { ActivityBarPart, activityBarPartDescriptor } from '../parts/activityBarPart.js';
import { sidebarPartDescriptor } from '../parts/sidebarPart.js';
import { editorPartDescriptor } from '../parts/editorPart.js';
import { auxiliaryBarPartDescriptor } from '../parts/auxiliaryBarPart.js';
import { panelPartDescriptor } from '../parts/panelPart.js';
import { statusBarPartDescriptor } from '../parts/statusBarPart.js';

// ── Layout Constants ──

export const TITLE_HEIGHT = 30;
export const STATUS_HEIGHT = 22;
export const ACTIVITY_BAR_WIDTH = 48;
export const DEFAULT_SIDEBAR_WIDTH = 202;
export const DEFAULT_PANEL_HEIGHT = 200;
export const DEFAULT_AUX_BAR_WIDTH = 250;
export const MIN_EDITOR_WIDTH = 200;

// ── Zen Mode Exit Info ──

export interface ZenModeExitInfo {
  sidebar: boolean;
  panel: boolean;
  statusBar: boolean;
  auxBar: boolean;
  activityBar: boolean;
}

/**
 * Layout base class — owns the grid system, part references, and all
 * layout-mutation methods (toggle sidebar/panel/status bar/aux bar, zen mode,
 * relayout).
 *
 * VS Code alignment: mirrors `src/vs/workbench/browser/layout.ts`.
 * `Workbench extends Layout` adds service wiring, tool registration,
 * and lifecycle management.
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

  // ── Grid Infrastructure ───────────────────────────────────────────────

  protected _hGrid!: Grid;
  protected _vGrid!: Grid;
  protected _editorColumnAdapter!: IGridView & { element: HTMLElement };
  protected _bodyRow!: HTMLElement;

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
  // VS Code tracks these through LayoutStateModel with typed keys.
  // Parallx uses plain protected fields for now; the typed model can be
  // introduced when layout persistence needs its own storage path.

  /** Auxiliary bar visibility (tracked separately for grid add/remove). */
  protected _auxBarVisible = false;

  /** Last known sidebar width — restored on toggle / persisted across sessions. */
  protected _lastSidebarWidth: number = DEFAULT_SIDEBAR_WIDTH;
  /** Last known panel height — restored on toggle / persisted across sessions. */
  protected _lastPanelHeight: number = DEFAULT_PANEL_HEIGHT;
  /** Whether the panel is currently maximized (occupying all vertical space). */
  protected _panelMaximized = false;
  /** Whether Zen Mode is active (all chrome hidden). */
  protected _zenMode = false;
  /** Pre–Zen-Mode visibility snapshot for restore. */
  protected _preZenState: ZenModeExitInfo | null = null;

  constructor(protected readonly _container: HTMLElement) {
    super();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2 — Layout: create parts, build grids, assemble DOM
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

    // 3. Compute initial dimensions
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    const bodyH = h - TITLE_HEIGHT - STATUS_HEIGHT;
    const sidebarW = this._sidebar.visible ? this._lastSidebarWidth : 0;
    const auxBarW = this._auxiliaryBar.visible ? DEFAULT_AUX_BAR_WIDTH : 0;
    const panelH = this._panel.visible ? DEFAULT_PANEL_HEIGHT : 0;
    const editorAreaW = Math.max(MIN_EDITOR_WIDTH, w - ACTIVITY_BAR_WIDTH - sidebarW - auxBarW - 4);
    const editorH = bodyH - panelH - (this._panel.visible ? 4 : 0);

    // 4. Create parts into temporary container so their elements exist
    const tempDiv = document.createElement('div');
    tempDiv.classList.add('hidden');
    document.body.appendChild(tempDiv);

    this._titlebar.create(tempDiv);
    this._activityBarPart.create(tempDiv);
    this._sidebar.create(tempDiv);
    this._editor.create(tempDiv);
    this._auxiliaryBar.create(tempDiv);
    this._panel.create(tempDiv);
    this._statusBar.create(tempDiv);

    // 5. Vertical grid: editor | panel (stacked in the right column)
    this._vGrid = new Grid(Orientation.Vertical, editorAreaW, bodyH);
    this._vGrid.addView(this._editor, editorH);
    if (this._panel.visible) {
      this._vGrid.addView(this._panel, panelH);
    }
    this._vGrid.layout();

    // 6. Wrap vGrid in adapter so hGrid can manage it as a leaf
    this._editorColumnAdapter = this._createEditorColumnAdapter(this._vGrid);

    // 7. Horizontal grid: sidebar | editorColumn
    const hGridW = w - ACTIVITY_BAR_WIDTH;
    this._hGrid = new Grid(Orientation.Horizontal, hGridW, bodyH);
    if (this._sidebar.visible) {
      this._hGrid.addView(this._sidebar, sidebarW);
    }
    this._hGrid.addView(this._editorColumnAdapter, editorAreaW);
    if (this._auxiliaryBar.visible) {
      this._hGrid.addView(this._auxiliaryBar, auxBarW);
    }
    this._hGrid.layout();

    // 8. Body row: activityBar (Part) + hGrid
    this._bodyRow = document.createElement('div');
    this._bodyRow.classList.add('workbench-middle');

    // Mount the ActivityBarPart — replaces ad-hoc div.activity-bar
    this._bodyRow.appendChild(this._activityBarPart.element);
    this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, bodyH, Orientation.Vertical);

    this._bodyRow.appendChild(this._hGrid.element);
    this._hGrid.element.classList.add('workbench-hgrid');

    this._editorColumnAdapter.element.appendChild(this._vGrid.element);
    this._vGrid.element.classList.add('workbench-vgrid');

    // 9. Assemble final DOM
    this._container.appendChild(this._titlebar.element);
    this._titlebar.layout(w, TITLE_HEIGHT, Orientation.Horizontal);

    this._container.appendChild(this._bodyRow);
    // .workbench-middle CSS already sets flex: 1 1 0 and min-height: 0

    this._container.appendChild(this._statusBar.element);
    this._statusBar.layout(w, STATUS_HEIGHT, Orientation.Horizontal);

    tempDiv.remove();

    // 10. Initialize sash drag on both grids
    this._hGrid.initializeSashDrag();
    this._vGrid.initializeSashDrag();
  }

  /**
   * Subclass hook — called after parts are cached but before create().
   * Workbench uses this to inject services (e.g. IWindowService into titlebar).
   */
  protected _onBeforePartsCreated(): void {
    // Default no-op
  }

  // ════════════════════════════════════════════════════════════════════════
  // Editor Column Adapter
  // ════════════════════════════════════════════════════════════════════════

  private _createEditorColumnAdapter(vGrid: Grid): IGridView & { element: HTMLElement } {
    const wrapper = document.createElement('div');
    wrapper.classList.add('editor-column');

    const emitter = new Emitter<void>();

    return {
      element: wrapper,
      id: 'workbench.editorColumn',
      minimumWidth: MIN_EDITOR_WIDTH,
      maximumWidth: Number.POSITIVE_INFINITY,
      minimumHeight: 0,
      maximumHeight: Number.POSITIVE_INFINITY,
      layout(width: number, height: number, _orientation: Orientation): void {
        wrapper.style.width = `${width}px`;
        wrapper.style.height = `${height}px`;
        vGrid.resize(width, height);
      },
      setVisible(visible: boolean): void {
        wrapper.classList.toggle('hidden', !visible);
      },
      toJSON(): object {
        return { id: 'workbench.editorColumn', type: 'adapter' };
      },
      onDidChangeConstraints: emitter.event,
      dispose(): void {
        emitter.dispose();
      },
    };
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

    // Re-layout activity bar (not in hGrid, so must be done explicitly)
    const activityBarHidden = this._activityBarPart.element.classList.contains('hidden');
    const activityBarW = activityBarHidden ? 0 : ACTIVITY_BAR_WIDTH;
    if (!activityBarHidden) {
      this._activityBarPart.layout(ACTIVITY_BAR_WIDTH, rbodyH, Orientation.Vertical);
    }

    // Resize hGrid (cascades to vGrid via editorColumnAdapter)
    this._hGrid.resize(rw - activityBarW, rbodyH);

    this._layoutViewContainers();
  };

  // ════════════════════════════════════════════════════════════════════════
  // Grid sash handlers — track part sizes + double-click reset
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Wire grid-change listeners for sidebar/panel size tracking and sash reset.
   * Called by Workbench after Phase 3 content setup is complete.
   */
  protected _wireGridHandlers(): void {
    // Layout view containers on any grid change
    this._hGrid.onDidChange(() => this._layoutViewContainers());
    this._vGrid.onDidChange(() => this._layoutViewContainers());

    // Track sidebar width after sash drags so toggleSidebar() restores the right size
    this._hGrid.onDidChange(() => {
      if (this._sidebar.visible) {
        const w = this._hGrid.getViewSize(this._sidebar.id);
        if (w !== undefined && w > 0) {
          this._lastSidebarWidth = w;
        }
      }
    });

    // Double-click sash resets sidebar to default width (VS Code parity: Sash.onDidReset)
    this._hGrid.onDidSashReset(({ sashIndex }) => {
      if (sashIndex === 0 && this._sidebar.visible) {
        const currentWidth = this._hGrid.getViewSize(this._sidebar.id);
        if (currentWidth !== undefined) {
          const delta = DEFAULT_SIDEBAR_WIDTH - currentWidth;
          if (delta !== 0) {
            this._hGrid.resizeSash(this._hGrid.root, 0, delta);
            this._hGrid.layout();
            this._lastSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
          }
        }
      }
    });

    // Track panel height after sash drags so togglePanel() restores the right size.
    // Also reset _panelMaximized if user manually drags sash while maximized.
    this._vGrid.onDidChange(() => {
      if (this._panel.visible) {
        if (this._panelMaximized) {
          this._panelMaximized = false;
          this._onDidChangePanelMaximized.fire(false);
        }
        const h = this._vGrid.getViewSize(this._panel.id);
        if (h !== undefined && h > 0) {
          this._lastPanelHeight = h;
        }
      }
    });

    // Double-click sash resets panel to default height (VS Code parity: Sash.onDidReset)
    this._vGrid.onDidSashReset(({ sashIndex }) => {
      if (sashIndex === 0 && this._panel.visible) {
        const currentHeight = this._vGrid.getViewSize(this._panel.id);
        if (currentHeight !== undefined) {
          const delta = DEFAULT_PANEL_HEIGHT - currentHeight;
          if (delta !== 0) {
            this._vGrid.resizeSash(this._vGrid.root, 0, delta);
            this._vGrid.layout();
            this._lastPanelHeight = DEFAULT_PANEL_HEIGHT;
            this._panelMaximized = false;
            this._onDidChangePanelMaximized.fire(false);
          }
        }
      }
    });
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
  // Toggle Methods — Part visibility mutations
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Toggle visibility of the auxiliary bar (secondary sidebar).
   * When shown, it appears on the right side of the editor area.
   *
   * Workbench overrides this to add secondary activity bar and content setup.
   */
  toggleAuxiliaryBar(): void {
    if (this._auxBarVisible) {
      // Hide: remove from hGrid
      this._hGrid.removeView(this._auxiliaryBar.id);
      this._auxiliaryBar.setVisible(false);
      this._auxBarVisible = false;
    } else {
      // Show: add to hGrid at the end (right of editor column)
      this._auxiliaryBar.setVisible(true);
      this._hGrid.addView(this._auxiliaryBar, DEFAULT_AUX_BAR_WIDTH);
      this._auxBarVisible = true;
    }
    this._hGrid.layout();
    this._layoutViewContainers();
    this._onDidChangePartVisibility.fire({
      partId: PartId.AuxiliaryBar,
      visible: this._auxBarVisible,
    });
  }

  /**
   * Toggle primary sidebar visibility.
   *
   * VS Code reference: ViewContainerActivityAction.run() — clicking active icon toggles sidebar.
   * Remembers width before collapse and restores it on expand.
   */
  toggleSidebar(): void {
    const el = this._sidebar.element;

    if (this._sidebar.visible) {
      // Save current width before collapsing so we can restore later
      const currentWidth = this._hGrid.getViewSize(this._sidebar.id);
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
        this._hGrid.removeView(this._sidebar.id);
        this._sidebar.setVisible(false);
        this._hGrid.layout();
        this._layoutViewContainers();
        this._onDidChangePartVisibility.fire({ partId: PartId.Sidebar, visible: false });
      };
      el.addEventListener('transitionend', finish, { once: true });
      // Safety fallback in case transitionend is missed
      setTimeout(finish, 200);
    } else {
      // Add to grid, then animate in
      this._sidebar.setVisible(true);
      el.classList.add('sidebar-animating', 'sidebar-collapsed');
      this._hGrid.addView(this._sidebar as any, this._lastSidebarWidth, 0);
      this._hGrid.layout();
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
    if (this._panel.visible) {
      // Save current height before collapsing
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined && currentHeight > 0) {
        this._lastPanelHeight = currentHeight;
      }
      this._vGrid.removeView(this._panel.id);
      this._panel.setVisible(false);
      this._panelMaximized = false;
      this._onDidChangePanelMaximized.fire(false);
    } else {
      this._panel.setVisible(true);
      this._vGrid.addView(this._panel as any, this._lastPanelHeight);
      this._panelMaximized = false;
      this._onDidChangePanelMaximized.fire(false);
    }
    this._vGrid.layout();
    this._layoutViewContainers();
    this._onDidChangePartVisibility.fire({
      partId: PartId.Panel,
      visible: this._panel.visible,
    });
  }

  /**
   * Toggle panel between normal and maximized height.
   *
   * VS Code reference: toggleMaximizedPanel — stores non-maximized height,
   * sets panel to fill all vertical space (editor gets minimum), restores on
   * second toggle.
   */
  toggleMaximizedPanel(): void {
    if (!this._panel.visible) {
      // Show + maximize in one go
      this._panel.setVisible(true);
      this._vGrid.addView(this._panel as any, this._lastPanelHeight);
      this._vGrid.layout();
      // Now maximize
    }

    if (this._panelMaximized) {
      // Restore to previous non-maximized height
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined) {
        const delta = this._lastPanelHeight - currentHeight;
        if (delta !== 0) {
          this._vGrid.resizeSash(this._vGrid.root, 0, delta);
          this._vGrid.layout();
        }
      }
      this._panelMaximized = false;
    } else {
      // Save current height, then maximize panel (give editor minimum)
      const currentHeight = this._vGrid.getViewSize(this._panel.id);
      if (currentHeight !== undefined && currentHeight > 0) {
        this._lastPanelHeight = currentHeight;
      }
      // Calculate how much to grow: vGrid total height minus a thin editor minimum
      const editorMin = 30; // minimal editor strip when maximized
      const editorSize = this._vGrid.getViewSize(this._editor.id);
      if (editorSize !== undefined) {
        const delta = editorSize - editorMin;
        if (delta > 0) {
          this._vGrid.resizeSash(this._vGrid.root, 0, -delta);
          this._vGrid.layout();
        }
      }
      this._panelMaximized = true;
    }
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
        if (s.sidebar && !this._sidebar.visible) {
          this._sidebar.setVisible(true);
          this._hGrid.addView(this._sidebar as any, this._lastSidebarWidth, 0);
        }
        if (s.panel && !this._panel.visible) {
          this._panel.setVisible(true);
          this._vGrid.addView(this._panel as any, this._lastPanelHeight);
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
        this._preZenState = null;
      }

      this._hGrid.layout();
      this._vGrid.layout();
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

      // Hide sidebar
      if (this._sidebar.visible) {
        const w = this._hGrid.getViewSize(this._sidebar.id);
        if (w !== undefined && w > 0) this._lastSidebarWidth = w;
        this._hGrid.removeView(this._sidebar.id);
        this._sidebar.setVisible(false);
      }

      // Hide panel
      if (this._panel.visible) {
        const h = this._vGrid.getViewSize(this._panel.id);
        if (h !== undefined && h > 0) this._lastPanelHeight = h;
        this._vGrid.removeView(this._panel.id);
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

      this._hGrid.layout();
      this._vGrid.layout();
      this._relayout();
      this._layoutViewContainers();
    }

    this._onDidChangeZenMode.fire(this._zenMode);
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
