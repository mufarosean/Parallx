// viewCommands.ts — View visibility, view move, and sidebar switch commands
//
// Extracted from structuralCommands.ts during Milestone 7.2 Phase D (C.7).

import type { CommandDescriptor } from './commandTypes.js';
import { wb } from './structuralCommandTypes.js';
import type { WorkbenchLike, ViewContainerLike } from './structuralCommandTypes.js';

// ─── View Commands ───────────────────────────────────────────────────────────

export const showCommands: CommandDescriptor = {
  id: 'workbench.action.showCommands',
  title: 'Show All Commands',
  category: 'View',
  keybinding: 'Ctrl+Shift+P',
  handler(ctx) {
    wb(ctx).toggleCommandPalette();
  },
};

export const quickOpen: CommandDescriptor = {
  id: 'workbench.action.quickOpen',
  title: 'Go to File…',
  category: 'View',
  keybinding: 'Ctrl+P',
  handler(ctx) {
    wb(ctx).showQuickOpen();
  },
};

export const gotoLine: CommandDescriptor = {
  id: 'workbench.action.gotoLine',
  title: 'Go to Line/Column…',
  category: 'Go',
  keybinding: 'Ctrl+G',
  handler(ctx) {
    wb(ctx).showGoToLine();
  },
};

export const toggleSidebar: CommandDescriptor = {
  id: 'workbench.action.toggleSidebar',
  title: 'Toggle Primary Sidebar',
  category: 'View',
  keybinding: 'Ctrl+B',
  handler(ctx) {
    wb(ctx).toggleSidebar();
  },
};

export const togglePanel: CommandDescriptor = {
  id: 'workbench.action.togglePanel',
  title: 'Toggle Panel',
  category: 'View',
  keybinding: 'Ctrl+J',
  handler(ctx) {
    wb(ctx).togglePanel();
  },
};

export const toggleMaximizedPanel: CommandDescriptor = {
  id: 'workbench.action.toggleMaximizedPanel',
  title: 'Toggle Maximized Panel',
  category: 'View',
  handler(ctx) {
    wb(ctx).toggleMaximizedPanel();
  },
};

export const toggleAuxiliaryBar: CommandDescriptor = {
  id: 'workbench.action.toggleAuxiliaryBar',
  title: 'Toggle Secondary Sidebar',
  category: 'View',
  handler(ctx) {
    wb(ctx).toggleAuxiliaryBar();
  },
};

export const toggleStatusBar: CommandDescriptor = {
  id: 'workbench.action.toggleStatusbarVisibility',
  title: 'Toggle Status Bar Visibility',
  category: 'View',
  handler(ctx) {
    const w = wb(ctx);
    w.toggleStatusBar();
  },
};

export const toggleZenMode: CommandDescriptor = {
  id: 'workbench.action.toggleZenMode',
  title: 'Toggle Zen Mode',
  category: 'View',
  keybinding: 'Ctrl+K Z',
  handler(ctx) {
    wb(ctx).toggleZenMode();
  },
};

// ─── View Move Commands ──────────────────────────────────────────────────────

export const viewMoveToSidebar: CommandDescriptor = {
  id: 'view.moveToSidebar',
  title: 'Move View to Sidebar',
  category: 'View',
  handler(ctx, viewId?: unknown) {
    if (typeof viewId !== 'string') {
      console.warn('[Command] view.moveToSidebar requires a string viewId argument');
      return;
    }
    const w = wb(ctx);
    const targetContainer = w._sidebarContainer;
    const sourceContainer = _findViewContainer(w, viewId);
    if (!sourceContainer) {
      console.warn('[Command] view.moveToSidebar — view "%s" not found in any container', viewId);
      return;
    }
    if (sourceContainer.id === targetContainer.id) {
      console.log('[Command] view.moveToSidebar — view "%s" already in sidebar', viewId);
      return;
    }
    const view = sourceContainer.removeView(viewId);
    if (view) {
      targetContainer.addView(view);
      w._layoutViewContainers();
      console.log('[Command] Moved view "%s" to sidebar', viewId);
    }
  },
};

export const viewMoveToPanel: CommandDescriptor = {
  id: 'view.moveToPanel',
  title: 'Move View to Panel',
  category: 'View',
  handler(ctx, viewId?: unknown) {
    if (typeof viewId !== 'string') {
      console.warn('[Command] view.moveToPanel requires a string viewId argument');
      return;
    }
    const w = wb(ctx);
    const targetContainer = w._panelContainer;
    const sourceContainer = _findViewContainer(w, viewId);
    if (!sourceContainer) {
      console.warn('[Command] view.moveToPanel — view "%s" not found in any container', viewId);
      return;
    }
    if (sourceContainer.id === targetContainer.id) {
      console.log('[Command] view.moveToPanel — view "%s" already in panel', viewId);
      return;
    }
    const view = sourceContainer.removeView(viewId);
    if (view) {
      targetContainer.addView(view);
      w._layoutViewContainers();
      console.log('[Command] Moved view "%s" to panel', viewId);
    }
  },
};

export const partResize: CommandDescriptor = {
  id: 'part.resize',
  title: 'Resize Part',
  category: 'Layout',
  handler(ctx, partId?: unknown, delta?: unknown) {
    if (typeof partId !== 'string' || typeof delta !== 'number') {
      console.warn('[Command] part.resize requires (partId: string, delta: number)');
      return;
    }
    const w = wb(ctx);
    // Determine which grid contains the part and find its sash index.
    // Sidebar and auxiliary bar live in hGrid; panel lives in vGrid.
    const grid = _resolveGridForPart(w, partId);
    if (!grid) {
      console.warn('[Command] part.resize — part "%s" not found in any grid', partId);
      return;
    }
    // Find the leaf index within the root branch
    const root = grid.root as { readonly children: readonly { readonly type?: string; view?: { id: string } }[] };
    const sashIndex = root.children.findIndex((child: any) => {
      if (child.type === 'leaf' && child.view?.id === partId) return true;
      // Also match the editor column adapter
      if (child.view?.id === partId) return true;
      return false;
    });
    if (sashIndex < 0) {
      console.warn('[Command] part.resize — cannot find sash for part "%s"', partId);
      return;
    }
    // Resize the sash between this part and its neighbor.
    // Use max(0, sashIndex - 1) to resize the sash *before* this part,
    // so a positive delta increases the part's size.
    const actualSashIndex = sashIndex > 0 ? sashIndex - 1 : 0;
    grid.resizeSash(grid.root, actualSashIndex, sashIndex > 0 ? delta : -delta);
    grid.layout();
    w._layoutViewContainers();
    console.log('[Command] Resized part "%s" by %dpx', partId, delta);
  },
};

// ─── Sidebar view switch ─────────────────────────────────────────────────────

export const showSearchView: CommandDescriptor = {
  id: 'workbench.view.search',
  title: 'Search: Show Search',
  category: 'View',
  handler(ctx) {
    wb(ctx).showSidebarView('view.search');
  },
};

export const showExplorerView: CommandDescriptor = {
  id: 'workbench.view.explorer',
  title: 'Explorer: Show Explorer',
  category: 'View',
  handler(ctx) {
    wb(ctx).showSidebarView('view.explorer');
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _findViewContainer(w: WorkbenchLike, viewId: string): ViewContainerLike | undefined {
  const containers: ViewContainerLike[] = [w._sidebarContainer, w._panelContainer];
  if (w._auxBarContainer) containers.push(w._auxBarContainer);
  return containers.find(c => c.getView(viewId) !== undefined);
}

function _resolveGridForPart(w: WorkbenchLike, partId: string): WorkbenchLike['_hGrid'] | WorkbenchLike['_vGrid'] | undefined {
  if (w._hGrid.hasView(partId)) return w._hGrid;
  if (w._vGrid.hasView(partId)) return w._vGrid;
  return undefined;
}
