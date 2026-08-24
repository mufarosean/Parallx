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
  aiInvocable: true,
  aiDescription: 'Open the command palette listing every available command.',
  handler(ctx) {
    wb(ctx).toggleCommandPalette();
  },
};

export const quickOpen: CommandDescriptor = {
  id: 'workbench.action.quickOpen',
  title: 'Go to File…',
  category: 'View',
  keybinding: 'Ctrl+P',
  aiInvocable: true,
  aiDescription: 'Open the quick file picker to navigate to a file by name.',
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
  aiInvocable: true,
  aiDescription: 'Show or hide the primary sidebar (explorer, search, etc.).',
  handler(ctx) {
    wb(ctx).toggleSidebar();
  },
};

export const togglePanel: CommandDescriptor = {
  id: 'workbench.action.togglePanel',
  title: 'Toggle Panel',
  category: 'View',
  keybinding: 'Ctrl+J',
  aiInvocable: true,
  aiDescription: 'Show or hide the bottom panel (terminal, output, diagnostics).',
  handler(ctx) {
    wb(ctx).togglePanel();
  },
};

export const toggleMaximizedPanel: CommandDescriptor = {
  id: 'workbench.action.toggleMaximizedPanel',
  title: 'Toggle Maximized Panel',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Maximize or restore the bottom panel.',
  handler(ctx) {
    wb(ctx).toggleMaximizedPanel();
  },
};

export const toggleAuxiliaryBar: CommandDescriptor = {
  id: 'workbench.action.toggleAuxiliaryBar',
  title: 'Toggle Secondary Sidebar',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Show or hide the secondary side bar.',
  handler(ctx) {
    wb(ctx).toggleAuxiliaryBar();
  },
};

export const toggleStatusBar: CommandDescriptor = {
  id: 'workbench.action.toggleStatusbarVisibility',
  title: 'Toggle Status Bar Visibility',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Show or hide the status bar at the bottom of the window.',
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
  aiInvocable: true,
  aiDescription: 'Enter or exit distraction-free Zen mode.',
  handler(ctx) {
    wb(ctx).toggleZenMode();
  },
};

// ─── View Move Commands ──────────────────────────────────────────────────────

export const viewMoveToSidebar: CommandDescriptor = {
  id: 'view.moveToSidebar',
  title: 'Move View to Sidebar',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Move the active view container to the sidebar.',
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
  aiInvocable: true,
  aiDescription: 'Move the active view container to the bottom panel.',
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
    const current = w._grid.getViewSize(partId);
    if (current === undefined) {
      console.warn('[Command] part.resize — part "%s" not found in the grid', partId);
      return;
    }
    // Address the part by id, wherever it sits in the tree. The sash-index
    // walk this replaces broke the moment a part sat one branch deeper.
    w._grid.resizeView(partId, current + delta);
    w._layoutViewContainers();
    console.log('[Command] Resized part "%s" by %dpx', partId, delta);
  },
};

// ─── Sidebar view switch ─────────────────────────────────────────────────────

export const showSearchView: CommandDescriptor = {
  id: 'workbench.view.search',
  title: 'Search: Show Search',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Reveal the search view in the sidebar.',
  handler(ctx) {
    wb(ctx).showSidebarView('view.search');
  },
};

export const showExplorerView: CommandDescriptor = {
  id: 'workbench.view.explorer',
  title: 'Explorer: Show Explorer',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Reveal the file explorer view in the sidebar.',
  handler(ctx) {
    wb(ctx).showSidebarView('view.explorer');
  },
};

/** Generic command to show any sidebar view by its view ID. */
export const showView: CommandDescriptor = {
  id: 'workbench.view.show',
  title: 'View: Show View',
  category: 'View',
  handler(ctx, ...args: unknown[]) {
    const viewId = args[0];
    if (typeof viewId === 'string') {
      wb(ctx).showSidebarView(viewId);
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _findViewContainer(w: WorkbenchLike, viewId: string): ViewContainerLike | undefined {
  const containers: ViewContainerLike[] = [w._sidebarContainer, w._panelContainer];
  if (w._auxBarContainer) containers.push(w._auxBarContainer);
  return containers.find(c => c.getView(viewId) !== undefined);
}

