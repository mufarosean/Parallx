// structuralCommands.ts — layout + part + view + workspace commands
//
// Registers all built-in commands that ship with Parallx Milestone 1.
// Commands are grouped by category:
//   • View  — sidebar, panel, auxiliary bar, status bar visibility toggles
//   • Editor — split, split orthogonal
//   • Layout — reset to defaults
//   • Workspace — save, switch, duplicate, add/remove folder, close, recent, saveAs
//
// Each command is a plain CommandDescriptor object. Registration happens
// via `registerBuiltinCommands()`.

import type { CommandDescriptor, CommandExecutionContext } from './commandTypes.js';
import type { CommandService } from './commandRegistry.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { IEditorGroupService } from '../services/serviceTypes.js';
import { GroupDirection } from '../editor/editorTypes.js';

// ─── Workbench type (avoids circular import) ────────────────────────────────
// Command handlers access workbench via `ctx.workbench` cast to this shape.

interface WorkbenchLike {
  toggleAuxiliaryBar(): void;
  toggleSidebar(): void;
  togglePanel(): void;
  toggleMaximizedPanel(): void;
  toggleStatusBar(): void;
  toggleCommandPalette(): void;
  showQuickOpen(): void;
  readonly workspace: { readonly id: string; readonly name: string };
  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<unknown>;
  switchWorkspace(targetId: string): Promise<void>;
  getRecentWorkspaces(): Promise<readonly { identity: { id: string; name: string }; metadata: { lastAccessedAt: string } }[]>;
  removeRecentWorkspace(workspaceId: string): Promise<void>;
  shutdown(): Promise<void>;

  // Part refs for toggle commands
  readonly _sidebar: { visible: boolean; setVisible(v: boolean): void; id: string };
  readonly _panel: { visible: boolean; setVisible(v: boolean): void; id: string };
  readonly _statusBar: { visible: boolean; setVisible(v: boolean): void };
  readonly _auxiliaryBar: { visible: boolean; setVisible(v: boolean): void };
  _relayout(): void;
  readonly _hGrid: {
    addView(view: unknown, size: number, index?: number): void;
    removeView(id: string): void;
    layout(): void;
    readonly root: { readonly children: readonly unknown[]; readonly orientation: string };
    getView(viewId: string): unknown | undefined;
    hasView(viewId: string): boolean;
    resizeSash(parentNode: unknown, sashIndex: number, delta: number): void;
  };
  readonly _vGrid: {
    addView(view: unknown, size: number): void;
    removeView(id: string): void;
    layout(): void;
    readonly root: { readonly children: readonly unknown[]; readonly orientation: string };
    getView(viewId: string): unknown | undefined;
    hasView(viewId: string): boolean;
    getViewSize(viewId: string): number | undefined;
    resizeSash(parentNode: unknown, sashIndex: number, delta: number): void;
  };
  readonly _workspaceSaver: { save(): Promise<void> };
  readonly _sidebarContainer: ViewContainerLike;
  readonly _panelContainer: ViewContainerLike;
  readonly _auxBarContainer: ViewContainerLike | undefined;
  readonly _viewManager: { getView(viewId: string): unknown | undefined };
  _layoutViewContainers(): void;
}

/** Minimal shape of a view container for cross-container moves. */
interface ViewContainerLike {
  readonly id: string;
  addView(view: unknown, index?: number): void;
  removeView(viewId: string): unknown | undefined;
  getView(viewId: string): unknown | undefined;
}

function wb(ctx: CommandExecutionContext): WorkbenchLike {
  return ctx.workbench as WorkbenchLike;
}

// ─── Electron bridge type ────────────────────────────────────────────────────

interface ElectronBridge {
  close(): void;
}

function electronBridge(): ElectronBridge | undefined {
  return (globalThis as any).parallxElectron as ElectronBridge | undefined;
}

// ─── View Commands ───────────────────────────────────────────────────────────

const showCommands: CommandDescriptor = {
  id: 'workbench.action.showCommands',
  title: 'Show All Commands',
  category: 'View',
  keybinding: 'Ctrl+Shift+P',
  handler(ctx) {
    wb(ctx).toggleCommandPalette();
  },
};

const quickOpen: CommandDescriptor = {
  id: 'workbench.action.quickOpen',
  title: 'Go to File…',
  category: 'View',
  keybinding: 'Ctrl+P',
  handler(ctx) {
    wb(ctx).showQuickOpen();
  },
};

const toggleSidebar: CommandDescriptor = {
  id: 'workbench.action.toggleSidebar',
  title: 'Toggle Primary Sidebar',
  category: 'View',
  keybinding: 'Ctrl+B',
  handler(ctx) {
    wb(ctx).toggleSidebar();
  },
};

const togglePanel: CommandDescriptor = {
  id: 'workbench.action.togglePanel',
  title: 'Toggle Panel',
  category: 'View',
  keybinding: 'Ctrl+J',
  handler(ctx) {
    wb(ctx).togglePanel();
  },
};

const toggleMaximizedPanel: CommandDescriptor = {
  id: 'workbench.action.toggleMaximizedPanel',
  title: 'Toggle Maximized Panel',
  category: 'View',
  handler(ctx) {
    wb(ctx).toggleMaximizedPanel();
  },
};

const toggleAuxiliaryBar: CommandDescriptor = {
  id: 'workbench.action.toggleAuxiliaryBar',
  title: 'Toggle Secondary Sidebar',
  category: 'View',
  handler(ctx) {
    wb(ctx).toggleAuxiliaryBar();
  },
};

const toggleStatusBar: CommandDescriptor = {
  id: 'workbench.action.toggleStatusbarVisibility',
  title: 'Toggle Status Bar Visibility',
  category: 'View',
  handler(ctx) {
    const w = wb(ctx);
    w.toggleStatusBar();
  },
};

// ─── Editor Commands ─────────────────────────────────────────────────────────

const splitEditor: CommandDescriptor = {
  id: 'workbench.action.splitEditor',
  title: 'Split Editor Right',
  category: 'Editor',
  keybinding: 'Ctrl+\\',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) {
      console.warn('[Command] splitEditor — IEditorGroupService not available');
      return;
    }
    const activeGroup = editorGroupService.activeGroup;
    if (!activeGroup) {
      console.warn('[Command] splitEditor — no active editor group');
      return;
    }
    editorGroupService.splitGroup(activeGroup.id, GroupDirection.Right);
  },
};

const splitEditorOrthogonal: CommandDescriptor = {
  id: 'workbench.action.splitEditorOrthogonal',
  title: 'Split Editor Down',
  category: 'Editor',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) {
      console.warn('[Command] splitEditorOrthogonal — IEditorGroupService not available');
      return;
    }
    const activeGroup = editorGroupService.activeGroup;
    if (!activeGroup) {
      console.warn('[Command] splitEditorOrthogonal — no active editor group');
      return;
    }
    editorGroupService.splitGroup(activeGroup.id, GroupDirection.Down);
  },
};

const closeActiveEditor: CommandDescriptor = {
  id: 'workbench.action.closeActiveEditor',
  title: 'Close Editor',
  category: 'Editor',
  keybinding: 'Ctrl+W',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;
    const group = editorGroupService.activeGroup;
    if (!group) return;
    const activeIdx = group.model.activeIndex;
    if (activeIdx >= 0) {
      group.model.closeEditor(activeIdx);
    }
  },
};

const nextEditor: CommandDescriptor = {
  id: 'workbench.action.nextEditor',
  title: 'Open Next Editor',
  category: 'Editor',
  keybinding: 'Ctrl+PageDown',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;
    const group = editorGroupService.activeGroup;
    if (!group || group.model.count === 0) return;
    const nextIdx = (group.model.activeIndex + 1) % group.model.count;
    group.model.setActive(nextIdx);
  },
};

const previousEditor: CommandDescriptor = {
  id: 'workbench.action.previousEditor',
  title: 'Open Previous Editor',
  category: 'Editor',
  keybinding: 'Ctrl+PageUp',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;
    const group = editorGroupService.activeGroup;
    if (!group || group.model.count === 0) return;
    const prevIdx = (group.model.activeIndex - 1 + group.model.count) % group.model.count;
    group.model.setActive(prevIdx);
  },
};

// ─── Layout Commands ─────────────────────────────────────────────────────────

const layoutReset: CommandDescriptor = {
  id: 'layout.reset',
  title: 'Reset Layout to Defaults',
  category: 'Layout',
  handler(ctx) {
    const w = wb(ctx);
    // Ensure sidebar, panel, aux bar are in default state
    if (!w._sidebar.visible) {
      w._sidebar.setVisible(true);
      w._hGrid.addView(w._sidebar as any, 202);
    }
    if (!w._panel.visible) {
      w.togglePanel();
    }
    if (w._auxiliaryBar.visible) {
      w.toggleAuxiliaryBar(); // hide it
    }
    if (!w._statusBar.visible) {
      w._statusBar.setVisible(true);
    }
    w._hGrid.layout();
    w._vGrid.layout();
    w._layoutViewContainers();
    console.log('[Command] Layout reset to defaults');
  },
};

// ─── Workspace Commands ──────────────────────────────────────────────────────

const workspaceSave: CommandDescriptor = {
  id: 'workspace.save',
  title: 'Save Workspace',
  category: 'Workspace',
  keybinding: 'Ctrl+S',
  handler: async (ctx) => {
    await wb(ctx)._workspaceSaver.save();
    console.log('[Command] Workspace saved');
  },
};

const workspaceSwitch: CommandDescriptor = {
  id: 'workspace.switch',
  title: 'Switch Workspace',
  category: 'Workspace',
  handler: async (ctx, targetId?: unknown) => {
    if (typeof targetId !== 'string') {
      console.warn('[Command] workspace.switch requires a string targetId argument');
      return;
    }
    await wb(ctx).switchWorkspace(targetId);
  },
};

const workspaceDuplicate: CommandDescriptor = {
  id: 'workspace.duplicateWorkspace',
  title: 'Duplicate Workspace',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);
    // Save current so the clone captures latest state
    await w._workspaceSaver.save();
    const newName = `${w.workspace.name} (Copy)`;
    const newWs = await w.createWorkspace(newName, undefined, false);
    console.log('[Command] Workspace duplicated as "%s" (id: %s)', newName, (newWs as any).id);
  },
};

const workspaceAddFolder: CommandDescriptor = {
  id: 'workspace.addFolderToWorkspace',
  title: 'Add Folder to Workspace...',
  category: 'Workspace',
  handler: async (_ctx, _folderPath?: unknown) => {
    // DEFERRED: Multi-root workspace support is out of scope for Milestone 2.
    // Implementation requires extending the Workspace model to support multiple
    // root folders, updating WorkspaceLoader/Saver, and adding folder picker UI.
    // Tracked for a future milestone.
    console.log('[Command] workspace.addFolderToWorkspace — deferred (multi-root not in M2 scope)');
  },
};

const workspaceRemoveFolder: CommandDescriptor = {
  id: 'workspace.removeFolderFromWorkspace',
  title: 'Remove Folder from Workspace',
  category: 'Workspace',
  handler: async (_ctx, _folderPath?: unknown) => {
    // DEFERRED: Multi-root workspace support is out of scope for Milestone 2.
    // Requires the same workspace model extensions as addFolderToWorkspace.
    // Tracked for a future milestone.
    console.log('[Command] workspace.removeFolderFromWorkspace — deferred (multi-root not in M2 scope)');
  },
};

const workspaceCloseFolder: CommandDescriptor = {
  id: 'workspace.closeFolder',
  title: 'Close Folder',
  category: 'Workspace',
  keybinding: 'Ctrl+K Ctrl+F',
  handler: async (ctx) => {
    const w = wb(ctx);
    // Save, then switch to a fresh empty workspace
    await w._workspaceSaver.save();
    const freshWs = await w.createWorkspace('Untitled Workspace', undefined, true);
    console.log('[Command] Closed folder — switched to empty workspace "%s"', (freshWs as any).name);
  },
};

const workspaceCloseWindow: CommandDescriptor = {
  id: 'workspace.closeWindow',
  title: 'Close Window',
  category: 'Workspace',
  keybinding: 'Alt+F4',
  handler: async (ctx) => {
    const w = wb(ctx);
    // Save before closing
    await w._workspaceSaver.save();

    // Use Electron bridge if available
    const bridge = electronBridge();
    if (bridge) {
      bridge.close();
    } else {
      // Fallback for non-Electron (browser) environments
      await w.shutdown();
    }
  },
};

const workspaceOpenRecent: CommandDescriptor = {
  id: 'workspace.openRecent',
  title: 'Open Recent Workspace...',
  category: 'Workspace',
  handler: async (ctx) => {
    const recents = await wb(ctx).getRecentWorkspaces();
    // Return the list — the command palette or caller can display choices
    console.log('[Command] Recent workspaces:', recents.map((r) => `${r.identity.name} (${r.identity.id})`).join(', '));
    return recents;
  },
};

const workspaceSaveAs: CommandDescriptor = {
  id: 'workspace.saveAs',
  title: 'Save Workspace As...',
  category: 'Workspace',
  handler: async (ctx, newName?: unknown) => {
    const w = wb(ctx);
    // Save current state first
    await w._workspaceSaver.save();
    const name = typeof newName === 'string' ? newName : `${w.workspace.name} (Copy)`;
    const newWs = await w.createWorkspace(name, undefined, true);
    console.log('[Command] Workspace saved as "%s" (id: %s)', name, (newWs as any).id);
    return newWs;
  },
};

// ─── View Move Commands ──────────────────────────────────────────────────────

const viewMoveToSidebar: CommandDescriptor = {
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

const viewMoveToPanel: CommandDescriptor = {
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

const partResize: CommandDescriptor = {
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

// ─── Helper: find which container holds a view ──────────────────────────────

function _findViewContainer(w: WorkbenchLike, viewId: string): ViewContainerLike | undefined {
  const containers: ViewContainerLike[] = [w._sidebarContainer, w._panelContainer];
  if (w._auxBarContainer) containers.push(w._auxBarContainer);
  return containers.find(c => c.getView(viewId) !== undefined);
}

// ─── Helper: resolve which grid owns a part ──────────────────────────────────

function _resolveGridForPart(w: WorkbenchLike, partId: string): WorkbenchLike['_hGrid'] | WorkbenchLike['_vGrid'] | undefined {
  if (w._hGrid.hasView(partId)) return w._hGrid;
  if (w._vGrid.hasView(partId)) return w._vGrid;
  return undefined;
}

// ─── All builtin commands ────────────────────────────────────────────────────

const ALL_BUILTIN_COMMANDS: CommandDescriptor[] = [
  // View
  showCommands,
  quickOpen,
  toggleSidebar,
  togglePanel,
  toggleMaximizedPanel,
  toggleAuxiliaryBar,
  toggleStatusBar,
  // Editor
  splitEditor,
  splitEditorOrthogonal,
  closeActiveEditor,
  nextEditor,
  previousEditor,
  // Layout
  layoutReset,
  // Workspace
  workspaceSave,
  workspaceSwitch,
  workspaceDuplicate,
  workspaceAddFolder,
  workspaceRemoveFolder,
  workspaceCloseFolder,
  workspaceCloseWindow,
  workspaceOpenRecent,
  workspaceSaveAs,
  // View move
  viewMoveToSidebar,
  viewMoveToPanel,
  partResize,
];

/**
 * Register all built-in commands with the given CommandService.
 * Returns a disposable that unregisters them all.
 */
export function registerBuiltinCommands(commandService: CommandService): IDisposable {
  return commandService.registerCommands(ALL_BUILTIN_COMMANDS);
}

/** Exported for testing / inspection. */
export { ALL_BUILTIN_COMMANDS };
