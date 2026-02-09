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

// ─── Workbench type (avoids circular import) ────────────────────────────────
// Command handlers access workbench via `ctx.workbench` cast to this shape.

interface WorkbenchLike {
  toggleAuxiliaryBar(): void;
  readonly workspace: { readonly id: string; readonly name: string };
  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<unknown>;
  switchWorkspace(targetId: string): Promise<void>;
  getRecentWorkspaces(): Promise<readonly { id: string; name: string; timestamp: number }[]>;
  removeRecentWorkspace(workspaceId: string): Promise<void>;
  shutdown(): Promise<void>;

  // Part refs for toggle commands
  readonly _sidebar: { visible: boolean; setVisible(v: boolean): void; id: string };
  readonly _panel: { visible: boolean; setVisible(v: boolean): void; id: string };
  readonly _statusBar: { visible: boolean; setVisible(v: boolean): void };
  readonly _auxiliaryBar: { visible: boolean; setVisible(v: boolean): void };
  readonly _hGrid: { addView(view: unknown, size: number): void; removeView(id: string): void; layout(): void };
  readonly _vGrid: { addView(view: unknown, size: number): void; removeView(id: string): void; layout(): void };
  readonly _workspaceSaver: { save(): Promise<void> };
  _layoutViewContainers(): void;
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

const toggleSidebar: CommandDescriptor = {
  id: 'workbench.action.toggleSidebar',
  title: 'Toggle Primary Sidebar',
  category: 'View',
  keybinding: 'Ctrl+B',
  handler(ctx) {
    const w = wb(ctx);
    const sidebar = w._sidebar;
    if (sidebar.visible) {
      w._hGrid.removeView(sidebar.id);
      sidebar.setVisible(false);
    } else {
      sidebar.setVisible(true);
      w._hGrid.addView(sidebar as any, 202);
    }
    w._hGrid.layout();
    w._layoutViewContainers();
  },
};

const togglePanel: CommandDescriptor = {
  id: 'workbench.action.togglePanel',
  title: 'Toggle Panel',
  category: 'View',
  keybinding: 'Ctrl+J',
  handler(ctx) {
    const w = wb(ctx);
    const panel = w._panel;
    if (panel.visible) {
      w._vGrid.removeView(panel.id);
      panel.setVisible(false);
    } else {
      panel.setVisible(true);
      w._vGrid.addView(panel as any, 200);
    }
    w._vGrid.layout();
    w._layoutViewContainers();
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
  id: 'workbench.action.toggleStatusBar',
  title: 'Toggle Status Bar',
  category: 'View',
  handler(ctx) {
    const w = wb(ctx);
    const sb = w._statusBar;
    sb.setVisible(!sb.visible);
  },
};

// ─── Editor Commands ─────────────────────────────────────────────────────────

const splitEditor: CommandDescriptor = {
  id: 'workbench.action.splitEditor',
  title: 'Split Editor Right',
  category: 'Editor',
  keybinding: 'Ctrl+\\',
  handler(_ctx) {
    // Editor groups are implemented in Cap 9; stub for now
    console.log('[Command] splitEditor — not yet implemented (Cap 9)');
  },
};

const splitEditorOrthogonal: CommandDescriptor = {
  id: 'workbench.action.splitEditorOrthogonal',
  title: 'Split Editor Down',
  category: 'Editor',
  handler(_ctx) {
    console.log('[Command] splitEditorOrthogonal — not yet implemented (Cap 9)');
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
      w._panel.setVisible(true);
      w._vGrid.addView(w._panel as any, 200);
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
    // Multi-root folder support is a future expansion.
    // For now this logs intent; full implementation requires workspace model extension.
    console.log('[Command] workspace.addFolderToWorkspace — multi-root not yet implemented');
  },
};

const workspaceRemoveFolder: CommandDescriptor = {
  id: 'workspace.removeFolderFromWorkspace',
  title: 'Remove Folder from Workspace',
  category: 'Workspace',
  handler: async (_ctx, _folderPath?: unknown) => {
    console.log('[Command] workspace.removeFolderFromWorkspace — multi-root not yet implemented');
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
    console.log('[Command] Recent workspaces:', recents.map((r) => `${r.name} (${r.id})`).join(', '));
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
  handler(_ctx, _viewId?: unknown) {
    // View relocation is driven by DnD in Cap 4; command stub for programmatic use
    console.log('[Command] view.moveToSidebar — programmatic move not yet implemented');
  },
};

const viewMoveToPanel: CommandDescriptor = {
  id: 'view.moveToPanel',
  title: 'Move View to Panel',
  category: 'View',
  handler(_ctx, _viewId?: unknown) {
    console.log('[Command] view.moveToPanel — programmatic move not yet implemented');
  },
};

const partResize: CommandDescriptor = {
  id: 'part.resize',
  title: 'Resize Part',
  category: 'Layout',
  handler(_ctx, _partId?: unknown, _delta?: unknown) {
    console.log('[Command] part.resize — programmatic resize not yet implemented');
  },
};

// ─── All builtin commands ────────────────────────────────────────────────────

const ALL_BUILTIN_COMMANDS: CommandDescriptor[] = [
  // View
  toggleSidebar,
  togglePanel,
  toggleAuxiliaryBar,
  toggleStatusBar,
  // Editor
  splitEditor,
  splitEditorOrthogonal,
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
