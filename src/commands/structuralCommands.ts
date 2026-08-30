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
import type { IEditorGroupService } from '../services/serviceTypes.js';
import { wb } from './structuralCommandTypes.js';
import { ALL_LAYOUT_COMMANDS } from './layoutCommands.js';

//  Re-export sub-modules for backward compatibility 
export {
  showCommands, quickOpen, gotoLine,
  toggleSidebar, togglePanel, toggleMaximizedPanel, toggleAuxiliaryBar, toggleStatusBar, toggleZenMode, saveLayout, addWidget, adoptWidget,
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
  toggleSidebar, togglePanel, toggleMaximizedPanel, toggleAuxiliaryBar, toggleStatusBar, toggleZenMode, saveLayout, addWidget, adoptWidget,
  viewMoveToSidebar, viewMoveToPanel, partResize,
  showSearchView, showExplorerView, showView,
} from './viewCommands.js';
import {
  toggleWordWrap, changeEncoding,
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
    // The default shape is data (defaultLayoutState) and the layout rebuilds
    // it in place. The hand-rolled version this replaces re-added the
    // sidebar at the END of the grid — on the right.
    wb(ctx).resetLayout();
    console.log('[Command] Layout reset to defaults');
  },
};

// ── Part relocation — positions, not classes ──
//
// The body is one tree, so "the sidebar on the right" is a move, not a
// feature. Obsidian's sidebar-on-either-edge, from the palette; the shape
// persists with the body tree.

function movePartCommand(
  id: string,
  title: string,
  partId: string,
  orientation: 'horizontal' | 'vertical',
  before: boolean,
  aiDescription: string,
): CommandDescriptor {
  return {
    id,
    title,
    category: 'Layout',
    aiInvocable: true,
    aiDescription,
    handler(ctx) {
      wb(ctx).movePartToEdge(partId, orientation, before);
    },
  };
}

function resetPartCommand(
  id: string,
  title: string,
  partId: string,
  aiDescription: string,
): CommandDescriptor {
  return {
    id,
    title,
    category: 'Layout',
    aiInvocable: true,
    aiDescription,
    handler(ctx) {
      wb(ctx).resetPartPlacement(partId);
    },
  };
}

const resetPanelPosition = resetPartCommand(
  'layout.resetPanelPosition', 'Reset Panel To Default Position',
  'workbench.parts.panel',
  'Move the panel back to its default place below the editor, leaving everything else where it is.',
);
const resetSidebarPosition = resetPartCommand(
  'layout.resetSidebarPosition', 'Reset Primary Sidebar To Default Position',
  'workbench.parts.sidebar',
  'Move the primary sidebar back to the left edge at its default width.',
);
const resetAuxBarPosition = resetPartCommand(
  'layout.resetAuxBarPosition', 'Reset Secondary Sidebar To Default Position',
  'workbench.parts.auxiliarybar',
  'Move the secondary sidebar back to the right edge at its default width.',
);

const moveSidebarLeft = movePartCommand(
  'layout.moveSidebarLeft', 'Move Primary Sidebar To Left Edge',
  'workbench.parts.sidebar', 'horizontal', true,
  'Move the primary sidebar to the left edge of the window.',
);
const moveSidebarRight = movePartCommand(
  'layout.moveSidebarRight', 'Move Primary Sidebar To Right Edge',
  'workbench.parts.sidebar', 'horizontal', false,
  'Move the primary sidebar to the right edge of the window.',
);
const movePanelBottom = movePartCommand(
  'layout.movePanelBottom', 'Move Panel To Bottom Edge',
  'workbench.parts.panel', 'vertical', false,
  'Move the panel back to the bottom edge of the window.',
);
const movePanelLeft = movePartCommand(
  'layout.movePanelLeft', 'Move Panel To Left Edge',
  'workbench.parts.panel', 'horizontal', true,
  'Move the panel to the left edge of the window as a side column.',
);
const movePanelRight = movePartCommand(
  'layout.movePanelRight', 'Move Panel To Right Edge',
  'workbench.parts.panel', 'horizontal', false,
  'Move the panel to the right edge of the window as a side column.',
);
const moveAuxBarLeft = movePartCommand(
  'layout.moveAuxBarLeft', 'Move Secondary Sidebar To Left Edge',
  'workbench.parts.auxiliarybar', 'horizontal', true,
  'Move the secondary sidebar to the left edge of the window.',
);
const moveAuxBarRight = movePartCommand(
  'layout.moveAuxBarRight', 'Move Secondary Sidebar To Right Edge',
  'workbench.parts.auxiliarybar', 'horizontal', false,
  'Move the secondary sidebar to the right edge of the window.',
);

//  Edit Commands (browser-native delegates) 

// Undo/redo first offer the action to the focused editor pane via a cancelable
// DOM event. Panes that manage their own history (e.g. the PDF reader's
// highlight overlay, which isn't an editable surface) handle it and call
// preventDefault. If no pane claims it, fall back to the browser-native
// execCommand path that drives undo/redo inside editable inputs/contenteditable.
function delegateEditHistory(eventName: string, nativeCommand: 'undo' | 'redo'): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const claimed = !target.dispatchEvent(
    new CustomEvent(eventName, { bubbles: true, cancelable: true }),
  );
  if (!claimed) document.execCommand(nativeCommand);
}

const editUndo: CommandDescriptor = {
  id: 'edit.undo',
  title: 'Undo',
  category: 'Edit',
  keybinding: 'Ctrl+Z',
  handler: () => { delegateEditHistory('parallx:edit-undo', 'undo'); },
};

const editRedo: CommandDescriptor = {
  id: 'edit.redo',
  title: 'Redo',
  category: 'Edit',
  keybinding: 'Ctrl+Shift+Z',
  handler: () => { delegateEditHistory('parallx:edit-redo', 'redo'); },
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
      // Alias: forward the origin so the palette/menu attribution survives.
      await commandService.executeCommandFrom(ctx.origin, 'settings.open');
    }
  },
};

const openKeybindings: CommandDescriptor = {
  id: 'workbench.action.openKeybindings',
  title: 'Open Keyboard Shortcuts',
  category: 'Preferences',
  keybinding: 'Ctrl+K Ctrl+S',
  aiInvocable: true,
  aiDescription: 'Open the keyboard shortcuts panel in Settings.',
  async handler(ctx) {
    // ONE shortcuts surface (STANDARDIZATION.md P1): the Settings hub's
    // panel, which can actually REBIND keys. The read-only editor tab this
    // used to open is deleted.
    const commandService = ctx.getService<import('../services/serviceTypes.js').ICommandService>('ICommandService');
    await commandService?.executeCommandFrom(ctx.origin, 'settings.openKeyboardShortcuts');
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
  saveLayout,
  addWidget,
  adoptWidget,
  toggleAuxiliaryBar,
  toggleStatusBar,
  toggleZenMode,
  // Layout gestures: widgets, containers, parts, saved layouts, window
  // (SYSTEM_INTEGRITY.md Phase B — every gesture has a command)
  ...ALL_LAYOUT_COMMANDS,
  // Editor
  toggleWordWrap,
  changeEncoding,
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
  resetPanelPosition,
  resetSidebarPosition,
  resetAuxBarPosition,
  moveSidebarLeft,
  moveSidebarRight,
  movePanelBottom,
  movePanelLeft,
  movePanelRight,
  moveAuxBarLeft,
  moveAuxBarRight,
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
