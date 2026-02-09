// src/main.ts — Renderer entry point
// Boots the Parallx workbench inside the Electron renderer process.

import { Part } from './parts/part.js';
import { PartRegistry } from './parts/partRegistry.js';
import { PartId } from './parts/partTypes.js';
import { Orientation } from './layout/layoutTypes.js';
import { Grid } from './layout/grid.js';

// Import all part descriptors
import { titlebarPartDescriptor } from './parts/titlebarPart.js';
import { sidebarPartDescriptor } from './parts/sidebarPart.js';
import { panelPartDescriptor } from './parts/panelPart.js';
import { editorPartDescriptor } from './parts/editorPart.js';
import { auxiliaryBarPartDescriptor } from './parts/auxiliaryBarPart.js';
import { statusBarPartDescriptor } from './parts/statusBarPart.js';
import { StatusBarPart, StatusBarAlignment } from './parts/statusBarPart.js';
import { SidebarPart } from './parts/sidebarPart.js';

// Import view system
import { ViewManager } from './views/viewManager.js';
import { ViewContainer } from './views/viewContainer.js';
import {
  ExplorerPlaceholderView,
  SearchPlaceholderView,
  TerminalPlaceholderView,
  OutputPlaceholderView,
  allPlaceholderViewDescriptors,
} from './views/placeholderViews.js';

// Import drag-and-drop
import { DragAndDropController } from './dnd/dragAndDrop.js';
import { DropPosition, DragPayload, DropResult } from './dnd/dndTypes.js';

// Import events for adapter
import { Emitter } from './platform/events.js';
import { IGridView } from './layout/gridView.js';

// ── Electron window controls bridge ──

declare global {
  interface Window {
    parallxElectron?: {
      platform: string;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (cb: (maximized: boolean) => void) => void;
    };
  }
}

// ── Bootstrap ──

function bootstrap(): void {
  const container = document.getElementById('workbench');
  if (!container) {
    throw new Error('Missing #workbench element');
  }

  // 1. Create part registry and register all standard parts
  const registry = new PartRegistry();
  registry.registerMany([
    titlebarPartDescriptor,
    sidebarPartDescriptor,
    editorPartDescriptor,
    auxiliaryBarPartDescriptor,
    panelPartDescriptor,
    statusBarPartDescriptor,
  ]);

  // 2. Create all parts
  registry.createAll();

  // 3. Retrieve parts
  const titlebar = registry.requirePart(PartId.Titlebar) as Part;
  const sidebar = registry.requirePart(PartId.Sidebar) as Part;
  const editor = registry.requirePart(PartId.Editor) as Part;
  const auxiliaryBar = registry.requirePart(PartId.AuxiliaryBar) as Part;
  const panel = registry.requirePart(PartId.Panel) as Part;
  const statusBar = registry.requirePart(PartId.StatusBar) as Part;

  // 4. Build the workbench DOM structure using Grid system
  // VS Code layout: sidebar spans full height, panel sits under editor only.
  //
  //   Titlebar (full width, fixed)
  //   [ ActivityBar | hGrid( Sidebar | vGrid( Editor | Panel ) ) ]
  //   StatusBar (full width, fixed)
  //
  // Two grids:
  //   - vGrid (Vertical): editor | panel           → row-resize sash
  //   - hGrid (Horizontal): sidebar | vGrid-wrapper → col-resize sash
  // Activity bar is a standalone element before hGrid in the body row.

  const w = container.clientWidth;
  const h = container.clientHeight;
  const titleH = 30;
  const statusH = 22;
  const activityBarW = 48;
  const bodyH = h - titleH - statusH;
  const sidebarW = sidebar.visible ? 202 : 0;
  const auxBarW = auxiliaryBar.visible ? 250 : 0;
  const panelH = panel.visible ? 200 : 0;
  const editorAreaW = Math.max(200, w - activityBarW - sidebarW - auxBarW - 4); // 4px for sash
  const editorH = bodyH - panelH - (panel.visible ? 4 : 0); // 4px for sash

  // ── Create parts into temporary containers so their elements exist ──
  const tempDiv = document.createElement('div');
  tempDiv.style.display = 'none';
  document.body.appendChild(tempDiv);

  titlebar.create(tempDiv);
  sidebar.create(tempDiv);
  editor.create(tempDiv);
  auxiliaryBar.create(tempDiv);
  panel.create(tempDiv);
  statusBar.create(tempDiv);

  // ── Vertical grid: editor | panel (stacked in the right column) ──
  const vGrid = new Grid(Orientation.Vertical, editorAreaW, bodyH);
  vGrid.addView(editor, editorH);
  if (panel.visible) {
    vGrid.addView(panel, panelH);
  }
  vGrid.layout();

  // ── Wrap vGrid in an adapter so hGrid can manage it as a leaf ──
  const editorColumnAdapter = createEditorColumnAdapter(vGrid);

  // ── Horizontal grid: sidebar | editorColumn ──
  const hGridW = w - activityBarW;
  const hGrid = new Grid(Orientation.Horizontal, hGridW, bodyH);

  if (sidebar.visible) {
    hGrid.addView(sidebar, sidebarW);
  }
  hGrid.addView(editorColumnAdapter, editorAreaW);
  if (auxiliaryBar.visible) {
    hGrid.addView(auxiliaryBar, auxBarW);
  }
  hGrid.layout();

  // ── Body row wrapper: activityBar + hGrid ──
  const bodyRow = document.createElement('div');
  bodyRow.classList.add('workbench-middle');

  const activityBarEl = document.createElement('div');
  activityBarEl.classList.add('activity-bar');
  bodyRow.appendChild(activityBarEl);

  // Hide the sidebar's internal activity bar slot
  const internalActivityBar = sidebar.element.querySelector('.sidebar-activity-bar') as HTMLElement;
  if (internalActivityBar) {
    internalActivityBar.style.display = 'none';
  }

  // Append hGrid element into bodyRow (after activityBar)
  bodyRow.appendChild(hGrid.element);
  hGrid.element.style.flex = '1';

  // Append vGrid into the editorColumn adapter element
  editorColumnAdapter.element.appendChild(vGrid.element);
  vGrid.element.style.width = '100%';
  vGrid.element.style.height = '100%';

  // ── Assemble final DOM ──
  container.appendChild(titlebar.element);
  titlebar.layout(w, titleH, Orientation.Horizontal);

  container.appendChild(bodyRow);
  bodyRow.style.flex = '1';

  container.appendChild(statusBar.element);
  statusBar.layout(w, statusH, Orientation.Horizontal);

  // Clean up temp container
  tempDiv.remove();

  // ── Initialize sash drag on both grids ──
  hGrid.initializeSashDrag();
  vGrid.initializeSashDrag();

  // 5. Populate the titlebar with window controls
  setupTitlebar(titlebar);

  // 6. Set up the view system
  const viewManager = new ViewManager();
  viewManager.registerMany(allPlaceholderViewDescriptors);

  const sidebarContainer = setupSidebarViews(viewManager, sidebar, activityBarEl);
  const panelContainer = setupPanelViews(viewManager, panel);

  // 7. Editor watermark
  setupEditorWatermark(editor);

  // 8. Add status bar entries
  setupStatusBar(statusBar as unknown as StatusBarPart);

  // 9. Set up drag-and-drop between parts
  const dndController = setupDragAndDrop(sidebar, editor, panel, sidebarContainer, panelContainer);

  // 10. Layout view containers
  layoutViewContainers(sidebar, sidebarContainer, panel, panelContainer);

  // Update view containers when grid sizes change (sash drag)
  hGrid.onDidChange(() => {
    layoutViewContainers(sidebar, sidebarContainer, panel, panelContainer);
  });
  vGrid.onDidChange(() => {
    layoutViewContainers(sidebar, sidebarContainer, panel, panelContainer);
  });

  // 11. Relayout on window resize
  window.addEventListener('resize', () => {
    const rw = container.clientWidth;
    const rh = container.clientHeight;
    const rbodyH = rh - titleH - statusH;

    titlebar.layout(rw, titleH, Orientation.Horizontal);
    statusBar.layout(rw, statusH, Orientation.Horizontal);

    // Resize hGrid (cascades to vGrid via editorColumnAdapter)
    hGrid.resize(rw - activityBarW, rbodyH);

    // Relayout view containers
    layoutViewContainers(sidebar, sidebarContainer, panel, panelContainer);
  });

  console.log('Parallx workbench started.');
}

// ── Editor Column Adapter ──

/**
 * Creates an IGridView adapter that wraps the vGrid (editor | panel) as a leaf
 * in the horizontal grid. This lets the sidebar sit alongside it at full height.
 */
function createEditorColumnAdapter(vGrid: Grid): IGridView & { element: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.classList.add('editor-column');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.overflow = 'hidden';
  wrapper.style.position = 'relative';

  const emitter = new Emitter<void>();

  return {
    element: wrapper,
    id: 'workbench.editorColumn',
    minimumWidth: 200,
    maximumWidth: Number.POSITIVE_INFINITY,
    minimumHeight: 0,
    maximumHeight: Number.POSITIVE_INFINITY,
    layout(width: number, height: number, _orientation: Orientation): void {
      wrapper.style.width = `${width}px`;
      wrapper.style.height = `${height}px`;
      // Relay to vertical grid (editor | panel)
      vGrid.resize(width, height);
    },
    setVisible(visible: boolean): void {
      wrapper.style.display = visible ? 'flex' : 'none';
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

// ── Titlebar ──

function setupTitlebar(titlebar: Part): void {
  const el = titlebar.element;

  // Left: app icon + menu bar
  const leftSlot = el.querySelector('.titlebar-left') as HTMLElement;
  if (leftSlot) {
    leftSlot.classList.add('titlebar-menubar');

    // App icon
    const appIcon = document.createElement('span');
    appIcon.textContent = '⊞';
    appIcon.classList.add('titlebar-app-icon');
    leftSlot.appendChild(appIcon);

    // Menu items (structural placeholders — no dropdowns in this milestone)
    const menuItems = ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help'];
    for (const label of menuItems) {
      const item = document.createElement('span');
      item.textContent = label;
      item.classList.add('titlebar-menu-item');
      leftSlot.appendChild(item);
    }
  }

  // Right: window controls
  const rightSlot = el.querySelector('.titlebar-right') as HTMLElement;
  if (rightSlot) {
    const controls = document.createElement('div');
    controls.classList.add('window-controls');

    const makeBtn = (label: string, action: () => void, hoverColor?: string): HTMLElement => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.classList.add('window-control-btn');
      btn.addEventListener('click', action);
      if (hoverColor) {
        btn.addEventListener('mouseenter', () => btn.style.backgroundColor = hoverColor);
        btn.addEventListener('mouseleave', () => btn.style.backgroundColor = '');
      }
      return btn;
    };

    const api = window.parallxElectron;
    if (api) {
      controls.appendChild(makeBtn('─', () => api.minimize(), 'rgba(255,255,255,0.1)'));
      controls.appendChild(makeBtn('□', () => api.maximize(), 'rgba(255,255,255,0.1)'));
      controls.appendChild(makeBtn('✕', () => api.close(), '#e81123'));
    }

    rightSlot.appendChild(controls);
  }
}

// ── View system setup ──

function setupSidebarViews(viewManager: ViewManager, sidebar: Part, activityBarEl: HTMLElement): ViewContainer {
  const sidebarPart = sidebar as unknown as SidebarPart;
  const container = new ViewContainer('sidebar');

  // Hide the ViewContainer's own horizontal tab bar — we use the activity bar instead
  container.hideTabBar();

  // Create views from registered descriptors
  const explorerView = viewManager.createViewSync('view.explorer')!;
  const searchView = viewManager.createViewSync('view.search')!;

  container.addView(explorerView);
  container.addView(searchView);

  // ── Activity bar: vertical icon strip (standalone, full height) ──
  const views = [
    { id: 'view.explorer', icon: '📁', label: 'Explorer' },
    { id: 'view.search', icon: '🔍', label: 'Search' },
  ];

  for (const v of views) {
    const btn = document.createElement('button');
    btn.classList.add('activity-bar-item');
    btn.dataset.viewId = v.id;
    btn.title = v.label;
    btn.textContent = v.icon;
    btn.addEventListener('click', () => {
      container.activateView(v.id);
      // Update active indicator
      activityBarEl.querySelectorAll('.activity-bar-item').forEach(el =>
        el.classList.toggle('active', el === btn));
    });
    activityBarEl.appendChild(btn);
  }

  // Mark the first one active
  activityBarEl.querySelector('.activity-bar-item')?.classList.add('active');

  // ── Header slot: show active view name ──
  const headerSlot = sidebar.element.querySelector('.sidebar-header') as HTMLElement;
  if (headerSlot) {
    const headerLabel = document.createElement('span');
    headerLabel.classList.add('sidebar-header-label');
    headerLabel.textContent = 'EXPLORER';
    headerSlot.appendChild(headerLabel);

    container.onDidChangeActiveView((viewId) => {
      if (viewId) {
        const view = container.getView(viewId);
        headerLabel.textContent = (view?.name ?? 'EXPLORER').toUpperCase();
      }
    });
  }

  // Mount view container into the sidebar's view slot
  const sidebarContent = sidebar.element.querySelector('.sidebar-views') as HTMLElement;
  if (sidebarContent) {
    sidebarContent.appendChild(container.element);
  }

  // Show views in the manager
  viewManager.showView('view.explorer');
  viewManager.showView('view.search');

  return container;
}

function setupPanelViews(viewManager: ViewManager, panel: Part): ViewContainer {
  const container = new ViewContainer('panel');

  const terminalView = viewManager.createViewSync('view.terminal')!;
  const outputView = viewManager.createViewSync('view.output')!;

  container.addView(terminalView);
  container.addView(outputView);

  // Mount into the panel's view slot
  const panelContent = panel.element.querySelector('.panel-views') as HTMLElement;
  if (panelContent) {
    panelContent.appendChild(container.element);
  }

  viewManager.showView('view.terminal');
  viewManager.showView('view.output');

  return container;
}

function setupEditorWatermark(editor: Part): void {
  const watermark = editor.element.querySelector('.editor-watermark') as HTMLElement;
  if (watermark) {
    watermark.innerHTML = `
      <div style="text-align: center; color: rgba(255,255,255,0.25);">
        <div style="font-size: 48px; margin-bottom: 16px;">⊞</div>
        <div style="font-size: 14px;">Parallx Workbench</div>
        <div style="font-size: 12px; margin-top: 4px;">No editors open</div>
      </div>
    `;
  }
}

// ── Status bar ──

function setupStatusBar(statusBar: StatusBarPart): void {
  statusBar.addEntry({
    id: 'branch',
    text: '⎇ master',
    alignment: StatusBarAlignment.Left,
    priority: 0,
    tooltip: 'Current branch',
  });
  statusBar.addEntry({
    id: 'errors',
    text: '⊘ 0  ⚠ 0',
    alignment: StatusBarAlignment.Left,
    priority: 10,
    tooltip: 'Errors and warnings',
  });
  statusBar.addEntry({
    id: 'line-col',
    text: 'Ln 1, Col 1',
    alignment: StatusBarAlignment.Right,
    priority: 100,
  });
  statusBar.addEntry({
    id: 'encoding',
    text: 'UTF-8',
    alignment: StatusBarAlignment.Right,
    priority: 90,
  });
}

// ── Layout View Containers ──

function layoutViewContainers(
  sidebar: Part,
  sidebarContainer: ViewContainer,
  panel: Part,
  panelContainer: ViewContainer,
): void {
  // Sidebar view container fills the part minus the header
  if (sidebar.visible && sidebar.width > 0) {
    const headerH = 35;
    sidebarContainer.layout(sidebar.width, sidebar.height - headerH, Orientation.Vertical);
  }
  // Panel view container fills the part minus the tab bar
  if (panel.visible && panel.height > 0) {
    const panelTabH = 30;
    panelContainer.layout(panel.width, panel.height - panelTabH, Orientation.Horizontal);
  }
}

// ── Drag-and-Drop Setup ──

function setupDragAndDrop(
  sidebar: Part,
  editor: Part,
  panel: Part,
  sidebarContainer: ViewContainer,
  panelContainer: ViewContainer,
): DragAndDropController {
  const dnd = new DragAndDropController();

  // Register drop targets on the main parts
  dnd.registerTarget(sidebar.id, sidebar.element);
  dnd.registerTarget(editor.id, editor.element);
  dnd.registerTarget(panel.id, panel.element);

  // Make sidebar view tabs draggable
  makeSidebarTabsDraggable(dnd, sidebarContainer, sidebar.id);

  // Make panel view tabs draggable
  makePanelTabsDraggable(dnd, panelContainer, panel.id);

  // Handle drops — move views between containers
  dnd.onDropCompleted((result: DropResult) => {
    console.log('Drop completed:', result);
    // In this milestone, log the event. Full view-move logic will come
    // in a later capability once ViewManager.moveView() is wired.
  });

  return dnd;
}

/**
 * Make sidebar ViewContainer tabs draggable.
 */
function makeSidebarTabsDraggable(dnd: DragAndDropController, container: ViewContainer, partId: string): void {
  // Find tab elements in the sidebar container and make them draggable
  const tabBar = container.element.querySelector('.view-container-tabs');
  if (!tabBar) return;

  const observer = new MutationObserver(() => {
    const tabs = tabBar.querySelectorAll('.view-tab');
    tabs.forEach((tab) => {
      const el = tab as HTMLElement;
      if (el.draggable) return; // already wired
      const viewId = el.dataset.viewId;
      if (!viewId) return;
      dnd.makeDraggable(el, { viewId, sourcePartId: partId });
    });
  });
  observer.observe(tabBar, { childList: true });

  // Wire existing tabs immediately
  const existingTabs = tabBar.querySelectorAll('.view-tab');
  existingTabs.forEach((tab) => {
    const el = tab as HTMLElement;
    const viewId = el.dataset.viewId;
    if (!viewId) return;
    dnd.makeDraggable(el, { viewId, sourcePartId: partId });
  });
}

/**
 * Make panel ViewContainer tabs draggable.
 */
function makePanelTabsDraggable(dnd: DragAndDropController, container: ViewContainer, partId: string): void {
  const tabBar = container.element.querySelector('.view-container-tabs');
  if (!tabBar) return;

  const observer = new MutationObserver(() => {
    const tabs = tabBar.querySelectorAll('.view-tab');
    tabs.forEach((tab) => {
      const el = tab as HTMLElement;
      if (el.draggable) return;
      const viewId = el.dataset.viewId;
      if (!viewId) return;
      dnd.makeDraggable(el, { viewId, sourcePartId: partId });
    });
  });
  observer.observe(tabBar, { childList: true });

  const existingTabs = tabBar.querySelectorAll('.view-tab');
  existingTabs.forEach((tab) => {
    const el = tab as HTMLElement;
    const viewId = el.dataset.viewId;
    if (!viewId) return;
    dnd.makeDraggable(el, { viewId, sourcePartId: partId });
  });
}

// ── Start ──

document.addEventListener('DOMContentLoaded', bootstrap);
