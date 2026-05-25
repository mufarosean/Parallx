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
import type { IToolArtifactStore } from '../services/serviceTypes.js';
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

// §86 / Slice B15 — first when-clause consumer of the boolean
// `activeSelectionExists` key (Slice B14). Returns a JSON description of
// the active selection so AI tools / diagnostic palettes can introspect
// whatever the active surface declared. The active-selection shape is
// opaque (`ContextSelectionLike = object`), so we round-trip it through
// JSON.stringify — anything non-serializable (functions, cyclic refs)
// is dropped silently and an empty string is returned in its place.
const inspectActiveSelection: CommandDescriptor = {
  id: 'workbench.action.inspectActiveSelection',
  title: 'Inspect Active Selection',
  category: 'View',
  when: 'activeSelectionExists',
  keybinding: 'Ctrl+Alt+S',
  aiInvocable: true,
  aiDescription:
    'Return a JSON description of the active surface\'s current selection. Only available when a selection is present. Returns the JSON string, or undefined if no selection is active.',
  async handler(ctx) {
    const contextService = ctx.getService<IContextService>('IContextService');
    if (!contextService) return undefined;
    const sel = contextService.getContext().activeSelection;
    if (!sel) return undefined;
    let json: string;
    try {
      json = JSON.stringify(sel);
    } catch {
      json = '';
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && json) {
        await navigator.clipboard.writeText(json);
      }
    } catch {
      // clipboard write failure is non-fatal.
    }
    return json;
  },
};

// §86 / Slice B16 — first reader command for `IToolArtifactStore`. B8
// established the writer half (chatAgentService → onDidExecuteTool →
// store.put). This slice closes the loop by giving AI tools and the
// command palette a way to enumerate what got stored. Returns a JSON
// array of {toolId, artifactId, mimeType, workspaceId, createdAt}
// records — `data` is intentionally omitted to keep the payload small
// and to avoid leaking large binaries into the clipboard. No when-clause
// gate: the command is always available; an empty store yields '[]'.
const listToolArtifacts: CommandDescriptor = {
  id: 'workbench.action.listToolArtifacts',
  title: 'List Tool Artifacts',
  category: 'View',
  aiInvocable: true,
  aiDescription:
    'Return a JSON array describing every artifact currently held in the workbench tool-artifact store. Each entry has {toolId, artifactId, mimeType, workspaceId, createdAt}. The artifact payload (`data`) is omitted to keep the response small. Empty store yields "[]".',
  async handler(ctx) {
    const store = ctx.getService<IToolArtifactStore>('IToolArtifactStore');
    if (!store) return '[]';
    const summary = store.list().map((r) => ({
      toolId: r.toolId,
      artifactId: r.artifactId,
      mimeType: r.mimeType,
      workspaceId: r.workspaceId,
      createdAt: r.createdAt,
    }));
    let json: string;
    try {
      json = JSON.stringify(summary);
    } catch {
      json = '[]';
    }
    return json;
  },
};

// §86 / Slice B17 — full-record reader counterpart to B16. Given a
// `(toolId, artifactId)` pair (as a single combined argument string in
// the form "toolId/artifactId" to fit the existing CommandDescriptor
// handler shape), returns the stored record's `data` payload directly,
// or `undefined` if no such artifact exists. Distinct from B16 which
// only returns metadata for ALL artifacts — this one targets a single
// artifact's actual content. Empty-key inputs short-circuit to undefined.
const getToolArtifact: CommandDescriptor = {
  id: 'workbench.action.getToolArtifact',
  title: 'Get Tool Artifact',
  category: 'View',
  aiInvocable: true,
  aiDescription:
    'Retrieve the data payload of a single artifact from the tool-artifact store. Argument: a string of the form "toolId/artifactId". Returns the payload (any shape — string, number, object, Uint8Array, …) or undefined if the artifact is not stored. Pair with `workbench.action.listToolArtifacts` to discover available ids.',
  async handler(ctx, key?: unknown) {
    const store = ctx.getService<IToolArtifactStore>('IToolArtifactStore');
    if (!store) return undefined;
    if (typeof key !== 'string' || key.length === 0) return undefined;
    const slash = key.indexOf('/');
    if (slash <= 0 || slash === key.length - 1) return undefined;
    const toolId = key.slice(0, slash);
    const artifactId = key.slice(slash + 1);
    const record = store.get(toolId, artifactId);
    return record?.data;
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
  inspectActiveSelection,
  listToolArtifacts,
  getToolArtifact,
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
