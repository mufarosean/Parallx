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
import { wb } from './structuralCommandTypes.js';

//  Re-export sub-modules for backward compatibility 
export {
  showCommands, quickOpen, gotoLine,
  toggleSidebar, togglePanel, toggleMaximizedPanel, toggleAuxiliaryBar, toggleStatusBar, toggleZenMode,
  viewMoveToSidebar, viewMoveToPanel, partResize,
  showSearchView, showExplorerView,
} from './viewCommands.js';
export {
  splitEditor, splitEditorOrthogonal, closeActiveEditor, nextEditor, previousEditor,
  markdownOpenPreviewToSide, markdownOpenPreview,
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

//  Import for aggregation 
import {
  showCommands, quickOpen, gotoLine,
  toggleSidebar, togglePanel, toggleMaximizedPanel, toggleAuxiliaryBar, toggleStatusBar, toggleZenMode,
  viewMoveToSidebar, viewMoveToPanel, partResize,
  showSearchView, showExplorerView,
} from './viewCommands.js';
import {
  splitEditor, splitEditorOrthogonal, closeActiveEditor, nextEditor, previousEditor,
  markdownOpenPreviewToSide, markdownOpenPreview,
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

//  Layout Commands 

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
  handler(ctx) {
    wb(ctx).selectColorTheme();
  },
};

const openSettings: CommandDescriptor = {
  id: 'workbench.action.openSettings',
  title: 'Open Settings',
  category: 'Preferences',
  keybinding: 'Ctrl+,',
  async handler(ctx) {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService) return;
    const { SettingsEditorInput } = await import('../built-in/editor/settingsEditorInput.js');
    await editorService.openEditor(SettingsEditorInput.getInstance(), { pinned: true });
  },
};

const openKeybindings: CommandDescriptor = {
  id: 'workbench.action.openKeybindings',
  title: 'Open Keyboard Shortcuts',
  category: 'Preferences',
  keybinding: 'Ctrl+K Ctrl+S',
  async handler(ctx) {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService) return;
    const { KeybindingsEditorInput } = await import('../built-in/editor/keybindingsEditorInput.js');
    await editorService.openEditor(KeybindingsEditorInput.getInstance(), { pinned: true });
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
  // Preferences
  openSettings,
  openKeybindings,
  selectColorTheme,
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
