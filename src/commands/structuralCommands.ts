// structuralCommands.ts  Built-in command aggregation and registration
//
// This file aggregates all built-in command families (extracted into separate
// files during Milestone 7.2 Phase D) and provides the registration entry point.
//
// Command families:
//    View       viewCommands.ts
//    Editor     editorCommands.ts
//    Workspace  workspaceCommands.ts
//    File       fileCommands.ts
//    Focus      focusCommands.ts
//    Layout     inline (small)
//    Edit       inline (small, browser-native delegates)
//    Preferences  inline (small)

import type { CommandDescriptor } from './commandTypes.js';
import type { CommandService } from './commandRegistry.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { IEditorGroupService, IEditorService } from '../services/serviceTypes.js';
import type { IContextService } from '../services/serviceTypes.js';
import { serialize as serializeParallxUri } from '../workbench/resources/parallxUri.js';
import { wb } from './structuralCommandTypes.js';

//  Re-export sub-modules for backward compatibility 
export {
  showCommands, quickOpen, gotoLine,
  toggleSidebar, togglePanel, toggleMaximizedPanel, toggleAuxiliaryBar, toggleStatusBar, toggleZenMode,
  viewMoveToSidebar, viewMoveToPanel, partResize,
  showSearchView, showExplorerView, showView,
} from './viewCommands.js';
export {
  splitEditor, splitEditorOrthogonal, closeActiveEditor, nextEditor, previousEditor,
  markdownOpenPreviewToSide, markdownOpenPreview,
  addSelectionToChat,
} from './editorCommands.js';
export {
  workspaceSave, workspaceSwitch, workspaceDuplicate,
  workspaceAddFolder, workspaceRemoveFolder, workspaceCloseFolder,
  workspaceCloseWindow, workspaceOpenRecent, workspaceSaveAs,
  workspaceRename, workspaceOpenFolder, workspaceExportToFile, workspaceImportFromFile,
} from './workspaceCommands.js';
export {
  fileOpenFile, fileNewTextFile, fileSave, fileSaveAs, fileSaveAll, fileRevert,
} from './fileCommands.js';
export {
  focusNextPart, focusPreviousPart,
  focusFirstEditorGroup, focusSecondEditorGroup, focusThirdEditorGroup,
  focusSideBar, focusPanel, focusActivityBar, focusStatusBar,
} from './focusCommands.js';
export { installDocling } from './doclingCommands.js';

//  Import for aggregation 
import {
  showCommands, quickOpen, gotoLine,
  toggleSidebar, togglePanel, toggleMaximizedPanel, toggleAuxiliaryBar, toggleStatusBar, toggleZenMode,
  viewMoveToSidebar, viewMoveToPanel, partResize,
  showSearchView, showExplorerView, showView,
} from './viewCommands.js';
import {
  splitEditor, splitEditorOrthogonal, closeActiveEditor, nextEditor, previousEditor,
  markdownOpenPreviewToSide, markdownOpenPreview,
  addSelectionToChat,
} from './editorCommands.js';
import {
  workspaceSave, workspaceSwitch, workspaceDuplicate,
  workspaceAddFolder, workspaceRemoveFolder, workspaceCloseFolder,
  workspaceCloseWindow, workspaceOpenRecent, workspaceSaveAs,
  workspaceRename, workspaceOpenFolder, workspaceExportToFile, workspaceImportFromFile,
} from './workspaceCommands.js';
import {
  fileOpenFile, fileNewTextFile, fileSave, fileSaveAs, fileSaveAll, fileRevert,
} from './fileCommands.js';
import {
  focusNextPart, focusPreviousPart,
  focusFirstEditorGroup, focusSecondEditorGroup, focusThirdEditorGroup,
  focusSideBar, focusPanel, focusActivityBar, focusStatusBar,
} from './focusCommands.js';
import { installDocling } from './doclingCommands.js';

//  Layout Commands 

const layoutReset: CommandDescriptor = {
  id: 'layout.reset',
  title: 'Reset Layout to Defaults',
  category: 'Layout',
  aiInvocable: true,
  aiDescription: 'Restore the workbench layout to its default arrangement.',
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

//  Edit Commands (browser-native delegates) 

const editUndo: CommandDescriptor = {
  id: 'edit.undo',
  title: 'Undo',
  category: 'Edit',
  keybinding: 'Ctrl+Z',
  handler: () => { document.execCommand('undo'); },
};

const editRedo: CommandDescriptor = {
  id: 'edit.redo',
  title: 'Redo',
  category: 'Edit',
  keybinding: 'Ctrl+Shift+Z',
  handler: () => { document.execCommand('redo'); },
};

const editCut: CommandDescriptor = {
  id: 'edit.cut',
  title: 'Cut',
  category: 'Edit',
  keybinding: 'Ctrl+X',
  handler: () => { document.execCommand('cut'); },
};

const editCopy: CommandDescriptor = {
  id: 'edit.copy',
  title: 'Copy',
  category: 'Edit',
  keybinding: 'Ctrl+C',
  handler: () => { document.execCommand('copy'); },
};

const editPaste: CommandDescriptor = {
  id: 'edit.paste',
  title: 'Paste',
  category: 'Edit',
  keybinding: 'Ctrl+V',
  handler: () => { document.execCommand('paste'); },
};

const editFind: CommandDescriptor = {
  id: 'edit.find',
  title: 'Find',
  category: 'Edit',
  keybinding: 'Ctrl+F',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    const pane = editorGroupService?.activeGroup?.activePane;
    if (pane && typeof (pane as any).showFind === 'function') {
      (pane as any).showFind();
    }
  },
};

const editReplace: CommandDescriptor = {
  id: 'edit.replace',
  title: 'Replace',
  category: 'Edit',
  keybinding: 'Ctrl+H',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    const pane = editorGroupService?.activeGroup?.activePane;
    if (pane && typeof (pane as any).showReplace === 'function') {
      (pane as any).showReplace();
    }
  },
};

//  Preferences: Open Settings / Keyboard Shortcuts 

const selectColorTheme: CommandDescriptor = {
  id: 'workbench.action.selectTheme',
  title: 'Color Theme',
  category: 'Preferences',
  keybinding: 'Ctrl+T',
  aiInvocable: true,
  aiDescription: 'Open the color theme picker so the user can choose a theme.',
  handler(ctx) {
    wb(ctx).selectColorTheme();
  },
};

const openSettings: CommandDescriptor = {
  id: 'workbench.action.openSettings',
  title: 'Open Settings',
  category: 'Preferences',
  aiInvocable: true,
  aiDescription: 'Open the workspace settings editor.',
  // Keybinding is owned by the `parallx.settings` manifest binding `settings.open`
  // to `Ctrl+,`. This legacy id is kept as an alias so menus, the welcome card,
  // and any external command-palette muscle memory all route to the single,
  // schema-driven editor (M60 Phase ε).
  async handler(ctx) {
    const commandService = ctx.getService<import('../services/serviceTypes.js').ICommandService>('ICommandService');
    if (commandService) {
      await commandService.executeCommand('settings.open');
    }
  },
};

const openKeybindings: CommandDescriptor = {
  id: 'workbench.action.openKeybindings',
  title: 'Open Keyboard Shortcuts',
  category: 'Preferences',
  keybinding: 'Ctrl+K Ctrl+S',
  aiInvocable: true,
  aiDescription: 'Open the keyboard shortcuts editor.',
  async handler(ctx) {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService) return;
    const { KeybindingsEditorInput } = await import('../built-in/editor/keybindingsEditorInput.js');
    await editorService.openEditor(KeybindingsEditorInput.getInstance(), { pinned: true });
  },
};

// §86 / Slice B5 — first command gated on the new activeResourceType context
// key (set by B3's binding from the §86 ContextService snapshot). Copies the
// canonical `parallx://...` URI of the active resource to the clipboard.
// Pure consumer of B1+B3+B4 plumbing.
const copyActiveResourceUri: CommandDescriptor = {
  id: 'workbench.action.copyActiveResourceUri',
  title: 'Copy Active Resource URI',
  category: 'View',
  when: 'activeResourceType',
  keybinding: 'Ctrl+Alt+U',
  aiInvocable: true,
  aiDescription:
    'Copy the canonical parallx:// URI of the currently active resource (file, canvas page, chat session, or tool artifact) to the system clipboard. Returns the URI string.',
  async handler(ctx) {
    const contextService = ctx.getService<IContextService>('IContextService');
    if (!contextService) return undefined;
    const resource = contextService.getContext().activeResource;
    if (!resource) return undefined;
    const uri = serializeParallxUri(resource);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(uri);
      }
    } catch {
      // clipboard write failure is non-fatal; the URI is still returned to
      // the caller so AI/test invocations can use it.
    }
    return uri;
  },
};

// §86 / Slice B7 + B11 — second when-clause consumer of the new context keys,
// this time using the equality operator on `activeResourceType`. The command
// is only enabled when the active resource is a file (i.e. the editor surface
// has a file-backed input). It copies the file's absolute fsPath — distinct
// from B5 which copies the canonical parallx:// URI. Slice B11 strengthens
// the gate to require an *editor* surface (the first compound `&&` when-clause
// in the built-in palette) and binds a default `Ctrl+Alt+P` keybinding.
const copyActiveFilePath: CommandDescriptor = {
  id: 'workbench.action.copyActiveFilePath',
  title: 'Copy Active File Path',
  category: 'File',
  when: "activeResourceType == 'file' && activeSurfaceKind == 'editor'",
  keybinding: 'Ctrl+Alt+P',
  aiInvocable: true,
  aiDescription:
    'Copy the absolute filesystem path of the currently active file to the system clipboard. Only available when a file resource is active. Returns the path string.',
  async handler(ctx) {
    const contextService = ctx.getService<IContextService>('IContextService');
    if (!contextService) return undefined;
    const resource = contextService.getContext().activeResource;
    if (!resource || resource.type !== 'file') return undefined;
    const fsPath = resource.path;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fsPath);
      }
    } catch {
      // clipboard write failure is non-fatal; the path is still returned.
    }
    return fsPath;
  },
};

// §86 / Slice B13 — third when-clause consumer, this time on the new
// `activeWorkspaceId` key introduced by Slice B12. Provides a diagnostic
// way to copy the active workspace identifier to the clipboard / return
// it to AI callers. Mirrors B5's pattern (truthy gate on a single §86
// key) so we exercise all three identity fields uniformly.
const copyActiveWorkspaceId: CommandDescriptor = {
  id: 'workbench.action.copyActiveWorkspaceId',
  title: 'Copy Active Workspace ID',
  category: 'Workspace',
  when: 'activeWorkspaceId',
  keybinding: 'Ctrl+Alt+W',
  aiInvocable: true,
  aiDescription:
    'Copy the identifier of the currently active workspace to the system clipboard. Only available when a workspace is active. Returns the workspace ID string.',
  async handler(ctx) {
    const contextService = ctx.getService<IContextService>('IContextService');
    if (!contextService) return undefined;
    const id = contextService.getContext().workspaceId;
    if (!id) return undefined;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
      }
    } catch {
      // clipboard write failure is non-fatal; the id is still returned.
    }
    return id;
  },
};

//  All builtin commands 

const ALL_BUILTIN_COMMANDS: CommandDescriptor[] = [
  // View
  showCommands,
  quickOpen,
  gotoLine,
  toggleSidebar,
  togglePanel,
  toggleMaximizedPanel,
  toggleAuxiliaryBar,
  toggleStatusBar,
  toggleZenMode,
  // Editor
  splitEditor,
  splitEditorOrthogonal,
  closeActiveEditor,
  // Markdown
  markdownOpenPreviewToSide,
  markdownOpenPreview,
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
  workspaceRename,
  workspaceOpenFolder,
  workspaceExportToFile,
  workspaceImportFromFile,
  // File
  fileOpenFile,
  fileNewTextFile,
  fileSave,
  fileSaveAs,
  fileSaveAll,
  fileRevert,
  // Edit (browser-native delegates)
  editUndo,
  editRedo,
  editCut,
  editCopy,
  editPaste,
  editFind,
  editReplace,
  // View move
  viewMoveToSidebar,
  viewMoveToPanel,
  partResize,
  // Focus (Cap 8)
  focusNextPart,
  focusPreviousPart,
  focusFirstEditorGroup,
  focusSecondEditorGroup,
  focusThirdEditorGroup,
  focusSideBar,
  focusPanel,
  focusActivityBar,
  focusStatusBar,
  // Sidebar view switch
  showSearchView,
  showExplorerView,
  showView,
  // Preferences
  openSettings,
  openKeybindings,
  selectColorTheme,
  // §86 / Slice B5 — resource utilities (gated on activeResourceType)
  copyActiveResourceUri,
  copyActiveFilePath,
  copyActiveWorkspaceId,
  // Docling (M21)
  installDocling,
  // M48: Selection → AI command
  addSelectionToChat,
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
