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
import type { IEditorGroupService, IFileService, IWorkspaceService, IEditorService } from '../services/serviceTypes.js';
import { GroupDirection } from '../editor/editorTypes.js';
import { URI } from '../platform/uri.js';
import { FileEditorInput } from '../built-in/editor/fileEditorInput.js';
import { MarkdownPreviewInput } from '../built-in/editor/markdownPreviewInput.js';

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
  showSidebarView(viewId: string): void;
  readonly workspace: { readonly id: string; readonly name: string };
  createWorkspace(name: string, path?: string, switchTo?: boolean): Promise<unknown>;
  switchWorkspace(targetId: string): Promise<void>;
  getRecentWorkspaces(): Promise<readonly { identity: { id: string; name: string }; metadata: { lastAccessedAt: string } }[]>;
  removeRecentWorkspace(workspaceId: string): Promise<void>;
  shutdown(): Promise<void>;

  // Focus model (Cap 8)
  focusPart(partId: string): void;
  hasFocus(partId: string): boolean;
  isPartVisible(partId: string): boolean;

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
  dialog: {
    openFolder(options?: { title?: string }): Promise<string[] | null>;
    openFile(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>;
    saveFile(options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
    showMessageBox(options: { type?: string; title?: string; message: string; buttons?: string[]; defaultId?: number }): Promise<{ response: number }>;
  };
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

// ─── Markdown Preview Commands ───────────────────────────────────────────────

/** Check if a filename has a markdown extension. */
function isMarkdownFile(name: string): boolean {
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
  return ext === '.md' || ext === '.markdown' || ext === '.mdx';
}

const markdownOpenPreviewToSide: CommandDescriptor = {
  id: 'markdown.showPreviewToSide',
  title: 'Markdown: Open Preview to the Side',
  category: 'Markdown',
  keybinding: 'Ctrl+K V',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;

    const activeGroup = editorGroupService.activeGroup;
    if (!activeGroup) return;

    const activeEditor = activeGroup.model.activeEditor;
    if (!(activeEditor instanceof FileEditorInput)) return;
    if (!isMarkdownFile(activeEditor.name)) return;

    // Split right to create a new group
    const newGroup = editorGroupService.splitGroup(activeGroup.id, GroupDirection.Right);
    if (!newGroup) return;

    // Close the duplicated text editor from the new group (split copies active editor)
    if (newGroup.model.count > 0) {
      newGroup.model.closeEditor(0, true);
    }

    // Create a MarkdownPreviewInput wrapping the source FileEditorInput
    const previewInput = MarkdownPreviewInput.create(activeEditor);
    newGroup.openEditor(previewInput, { pinned: true });
  },
};

const markdownOpenPreview: CommandDescriptor = {
  id: 'markdown.showPreview',
  title: 'Markdown: Open Preview',
  category: 'Markdown',
  handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;

    const activeGroup = editorGroupService.activeGroup;
    if (!activeGroup) return;

    const activeEditor = activeGroup.model.activeEditor;
    if (!(activeEditor instanceof FileEditorInput)) return;
    if (!isMarkdownFile(activeEditor.name)) return;

    // Open preview in the same group (replaces the text editor tab)
    const previewInput = MarkdownPreviewInput.create(activeEditor);
    activeGroup.openEditor(previewInput, { pinned: true });
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
  async handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;
    const group = editorGroupService.activeGroup;
    if (!group) return;
    const activeIdx = group.model.activeIndex;
    if (activeIdx >= 0) {
      await group.model.closeEditor(activeIdx);
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
  handler: async (ctx) => {
    const w = wb(ctx);
    const bridge = electronBridge();
    if (!bridge) {
      console.warn('[Command] workspace.addFolderToWorkspace — no Electron bridge');
      return;
    }

    const result = await bridge.dialog.openFolder({ title: 'Add Folder to Workspace' });
    if (!result || result.length === 0) return; // cancelled
    const folderPaths = result;

    const wsService = ctx.getService<IWorkspaceService>('IWorkspaceService');
    if (!wsService) {
      console.warn('[Command] workspace.addFolderToWorkspace — IWorkspaceService not available');
      return;
    }

    for (const p of folderPaths) {
      const uri = URI.file(p);
      wsService.addFolder(uri);
    }

    await w._workspaceSaver.save();
    console.log('[Command] workspace.addFolderToWorkspace — added %d folder(s)', folderPaths.length);
  },
};

const workspaceRemoveFolder: CommandDescriptor = {
  id: 'workspace.removeFolderFromWorkspace',
  title: 'Remove Folder from Workspace',
  category: 'Workspace',
  handler: async (ctx, _folderPath?: unknown) => {
    const w = wb(ctx);
    const wsService = ctx.getService<IWorkspaceService>('IWorkspaceService');
    if (!wsService) {
      console.warn('[Command] workspace.removeFolderFromWorkspace — IWorkspaceService not available');
      return;
    }

    const folders = wsService.folders;
    if (folders.length === 0) {
      console.log('[Command] workspace.removeFolderFromWorkspace — no folders to remove');
      return;
    }

    let targetUri: URI;
    if (typeof _folderPath === 'string') {
      targetUri = URI.file(_folderPath);
    } else if (folders.length === 1) {
      // Only one folder — remove it directly
      targetUri = folders[0].uri;
    } else {
      // TODO: In the future, show a Quick Pick to select which folder to remove.
      // For now, remove the last folder added.
      const last = folders[folders.length - 1];
      targetUri = last.uri;
      console.log('[Command] workspace.removeFolderFromWorkspace — removing last folder "%s"', last.name);
    }

    wsService.removeFolder(targetUri);
    await w._workspaceSaver.save();
    console.log('[Command] workspace.removeFolderFromWorkspace — removed folder');
  },
};

const workspaceCloseFolder: CommandDescriptor = {
  id: 'workspace.closeFolder',
  title: 'Close Folder',
  category: 'Workspace',
  keybinding: 'Ctrl+K Ctrl+F',
  handler: async (ctx) => {
    const w = wb(ctx);
    const wsService = ctx.getService<IWorkspaceService>('IWorkspaceService');
    if (!wsService) {
      console.warn('[Command] workspace.closeFolder — IWorkspaceService not available');
      return;
    }

    const folders = [...wsService.folders];

    // Remove all folders — workspace becomes EMPTY
    for (const f of folders) {
      wsService.removeFolder(f.uri);
    }

    await w._workspaceSaver.save();
    console.log('[Command] workspace.closeFolder — cleared %d folder(s)', folders.length);
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
    const w = wb(ctx);
    const recents = await w.getRecentWorkspaces();

    if (recents.length === 0) {
      console.log('[Command] No recent workspaces');
      return;
    }

    // Show quick pick with recent workspaces
    // Use the command palette in quick-open mode which already shows workspace results
    w.showQuickOpen();
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

const workspaceOpenFolder: CommandDescriptor = {
  id: 'workspace.openFolder',
  title: 'Open Folder...',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);

    const bridge = electronBridge();
    if (!bridge) {
      console.warn('[Command] workspace.openFolder — no Electron bridge');
      return;
    }

    const result = await bridge.dialog.openFolder({ title: 'Open Folder' });
    if (!result || result.length === 0) return; // cancelled
    const folderPath = result[0];

    const wsService = ctx.getService<IWorkspaceService>('IWorkspaceService');
    if (!wsService) {
      console.warn('[Command] workspace.openFolder — IWorkspaceService not available');
      return;
    }

    // Atomically replace all workspace folders with the selected folder.
    // Uses updateFolders() which fires a SINGLE onDidChangeFolders event,
    // matching VS Code's atomic updateFolders pattern. This avoids the
    // intermediate zero-folder state that would cause the explorer to
    // flash "No folder opened" before showing the new tree.
    wsService.updateFolders([{ uri: URI.file(folderPath) }]);

    await w._workspaceSaver.save();
    console.log('[Command] workspace.openFolder — opened "%s"', folderPath);
  },
};

// ─── File Commands (M4 Cap 2.2) ──────────────────────────────────────────────

const fileOpenFile: CommandDescriptor = {
  id: 'file.openFile',
  title: 'Open File...',
  category: 'File',
  keybinding: 'Ctrl+O',
  handler: async (ctx) => {
    const bridge = electronBridge();
    if (!bridge) {
      console.warn('[Command] file.openFile — no Electron bridge');
      return;
    }

    const result = await bridge.dialog.openFile({ title: 'Open File' });
    if (!result || result.length === 0) return;

    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService) {
      console.warn('[Command] file.openFile — IEditorService not available');
      return;
    }

    const textFileManager = ctx.getService<import('../services/serviceTypes.js').ITextFileModelManager>('ITextFileModelManager');
    const fileService = ctx.getService<IFileService>('IFileService');

    for (const filePath of result) {
      const uri = URI.file(filePath);
      if (textFileManager && fileService) {
        const { FileEditorInput } = await import('../built-in/editor/fileEditorInput.js');
        const input = FileEditorInput.create(uri, textFileManager, fileService);
        await editorService.openEditor(input, { pinned: result.length > 1 });
      } else {
        // Fallback to placeholder
        const { PlaceholderEditorInput } = await import('../editor/editorInput.js');
        const input = new PlaceholderEditorInput(uri.basename, uri.fsPath, uri.toString());
        await editorService.openEditor(input, { pinned: result.length > 1 });
      }
    }
    console.log('[Command] file.openFile — opened %d file(s)', result.length);
  },
};

const fileNewTextFile: CommandDescriptor = {
  id: 'file.newTextFile',
  title: 'New Text File',
  category: 'File',
  keybinding: 'Ctrl+N',
  handler: async (ctx) => {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService) {
      console.warn('[Command] file.newTextFile — IEditorService not available');
      return;
    }

    const { UntitledEditorInput } = await import('../built-in/editor/untitledEditorInput.js');
    const input = UntitledEditorInput.create();
    await editorService.openEditor(input, { pinned: false });
    console.log('[Command] file.newTextFile — created untitled editor "%s"', input.name);
  },
};

const fileSave: CommandDescriptor = {
  id: 'file.save',
  title: 'Save',
  category: 'File',
  keybinding: 'Ctrl+S',
  when: 'activeEditor',
  handler: async (ctx) => {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService?.activeEditor) {
      console.log('[Command] file.save — no active editor');
      return;
    }

    const active = editorService.activeEditor;

    // Use FileEditorInput/UntitledEditorInput directly if available
    if (typeof (active as any).save === 'function') {
      await (active as any).save();
      console.log('[Command] file.save — saved via editor input');
      return;
    }

    // Legacy fallback: uri-based approach
    const rawUri = (active as any).uri;
    if (!rawUri) {
      const commandService = ctx.getService<import('../services/serviceTypes.js').ICommandService>('ICommandService');
      if (commandService) {
        await (commandService as any).executeCommand('file.saveAs');
      }
      return;
    }
    const saveUri: import('../platform/uri.js').URI = typeof rawUri === 'string' ? URI.parse(rawUri) : rawUri;
    if (saveUri.scheme === 'untitled') {
      const commandService = ctx.getService<import('../services/serviceTypes.js').ICommandService>('ICommandService');
      if (commandService) {
        await (commandService as any).executeCommand('file.saveAs');
      }
      return;
    }

    const textFileManager = ctx.getService<import('../services/serviceTypes.js').ITextFileModelManager>('ITextFileModelManager');
    if (textFileManager) {
      const model = textFileManager.get(saveUri);
      if (model) {
        await model.save();
        console.log('[Command] file.save — saved "%s"', saveUri.basename);
        return;
      }
    }

    console.log('[Command] file.save — no model backing');
  },
};

const fileSaveAs: CommandDescriptor = {
  id: 'file.saveAs',
  title: 'Save As...',
  category: 'File',
  keybinding: 'Ctrl+Shift+S',
  handler: async (ctx) => {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService?.activeEditor) {
      console.log('[Command] file.saveAs — no active editor');
      return;
    }

    const bridge = electronBridge();
    if (!bridge) {
      console.warn('[Command] file.saveAs — no Electron bridge');
      return;
    }

    const active = editorService.activeEditor;
    const rawSaveAsUri = (active as any).uri;
    const currentUri: import('../platform/uri.js').URI | undefined = rawSaveAsUri
      ? (typeof rawSaveAsUri === 'string' ? URI.parse(rawSaveAsUri) : rawSaveAsUri)
      : undefined;
    const defaultPath = currentUri && currentUri.scheme !== 'untitled'
      ? currentUri.fsPath
      : undefined;

    const result = await bridge.dialog.saveFile({
      title: 'Save As',
      defaultPath,
    });
    if (!result) return; // cancelled

    const fileService = ctx.getService<IFileService>('IFileService');
    if (!fileService) {
      console.warn('[Command] file.saveAs — IFileService not available');
      return;
    }

    const targetUri = URI.file(result);

    // Get content from text file model or editor
    const textFileManager = ctx.getService<import('../services/serviceTypes.js').ITextFileModelManager>('ITextFileModelManager');
    let content = '';
    if (textFileManager && currentUri) {
      const model = textFileManager.get(currentUri);
      if (model) {
        content = (model as any).content ?? '';
      }
    }

    await fileService.writeFile(targetUri, content);
    console.log('[Command] file.saveAs — saved to "%s"', targetUri.fsPath);
  },
};

const fileRevert: CommandDescriptor = {
  id: 'file.revert',
  title: 'Revert File',
  category: 'File',
  handler: async (ctx) => {
    const editorService = ctx.getService<IEditorService>('IEditorService');
    if (!editorService?.activeEditor) {
      console.log('[Command] file.revert — no active editor');
      return;
    }

    const active = editorService.activeEditor;

    // Check if this is an untitled file (no revert possible)
    const rawUri = (active as any).uri;
    if (!rawUri) {
      console.log('[Command] file.revert — cannot revert untitled file');
      return;
    }
    const uri: import('../platform/uri.js').URI = typeof rawUri === 'string' ? URI.parse(rawUri) : rawUri;
    if (uri.scheme === 'untitled') {
      console.log('[Command] file.revert — cannot revert untitled file');
      return;
    }

    // If the input has a dirty flag, confirm with the user first
    if ((active as any).isDirty) {
      const bridge = electronBridge();
      if (bridge) {
        const { response } = await bridge.dialog.showMessageBox({
          type: 'warning',
          title: 'Revert File',
          message: `Revert "${uri.basename}" and lose unsaved changes?`,
          buttons: ['Revert', 'Cancel'],
          defaultId: 1,
        });
        if (response !== 0) return; // cancelled
      }
    }

    // Use EditorInput.revert() directly if available (preferred path)
    if (typeof (active as any).revert === 'function') {
      await (active as any).revert();
      console.log('[Command] file.revert — reverted "%s"', uri.basename);
      return;
    }

    // Fallback: use textFileModelManager
    const textFileManager = ctx.getService<import('../services/serviceTypes.js').ITextFileModelManager>('ITextFileModelManager');
    if (!textFileManager) {
      console.warn('[Command] file.revert — ITextFileModelManager not available');
      return;
    }

    const model = textFileManager.get(uri);
    if (model) {
      await model.revert();
      console.log('[Command] file.revert — reverted "%s"', uri.basename);
    }
  },
};

const fileSaveAll: CommandDescriptor = {
  id: 'file.saveAll',
  title: 'Save All',
  category: 'File',
  keybinding: 'Ctrl+K S',
  handler: async (ctx) => {
    const textFileManager = ctx.getService<import('../services/serviceTypes.js').ITextFileModelManager>('ITextFileModelManager');
    if (textFileManager) {
      await textFileManager.saveAll();
      console.log('[Command] file.saveAll — saved all dirty models');
    }
  },
};

// ─── Edit Commands (browser-native delegates) ────────────────────────────────

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
  handler: () => {
    // Trigger browser-native find (works on textarea)
    // Note: window.find() is deprecated but still functional in Electron
    (globalThis as any).parallxElectron?.webContents?.find?.() ?? (window as any).find?.();
  },
};

const editReplace: CommandDescriptor = {
  id: 'edit.replace',
  title: 'Replace',
  category: 'Edit',
  keybinding: 'Ctrl+H',
  handler: () => {
    // Browser-native find doesn't support replace — stub for M4
    console.log('[Command] edit.replace — deferred to future milestone');
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

// ─── Focus Commands (Cap 8) ──────────────────────────────────────────────────

import { PartId } from '../parts/partTypes.js';

/**
 * Cycling order for F6/Shift+F6 (matches VS Code navigationActions.ts):
 *   Editor → Panel → AuxiliaryBar → StatusBar → ActivityBar → Sidebar → Editor
 * Hidden parts are skipped automatically.
 */
const FOCUS_CYCLE_ORDER: string[] = [
  PartId.Editor,
  PartId.Panel,
  PartId.AuxiliaryBar,
  PartId.StatusBar,
  PartId.ActivityBar,
  PartId.Sidebar,
];

function findVisibleNeighbour(w: WorkbenchLike, partId: string, next: boolean): string {
  const idx = FOCUS_CYCLE_ORDER.indexOf(partId);
  const len = FOCUS_CYCLE_ORDER.length;
  let current = idx >= 0 ? idx : 0;

  // Walk up to len times to find a visible neighbour (avoids infinite loop)
  for (let i = 0; i < len; i++) {
    current = next
      ? (current + 1) % len
      : (current - 1 + len) % len;
    const candidateId = FOCUS_CYCLE_ORDER[current];
    // Editor is always visible
    if (candidateId === PartId.Editor || w.isPartVisible(candidateId)) {
      return candidateId;
    }
  }
  return PartId.Editor; // fallback
}

function getCurrentlyFocusedPart(w: WorkbenchLike): string | undefined {
  for (const partId of FOCUS_CYCLE_ORDER) {
    if (w.hasFocus(partId)) return partId;
  }
  return undefined;
}

const focusNextPart: CommandDescriptor = {
  id: 'workbench.action.focusNextPart',
  title: 'Focus Next Part',
  category: 'View',
  keybinding: 'F6',
  handler(ctx) {
    const w = wb(ctx);
    const current = getCurrentlyFocusedPart(w) ?? PartId.Editor;
    const target = findVisibleNeighbour(w, current, true);
    w.focusPart(target);
  },
};

const focusPreviousPart: CommandDescriptor = {
  id: 'workbench.action.focusPreviousPart',
  title: 'Focus Previous Part',
  category: 'View',
  keybinding: 'Shift+F6',
  handler(ctx) {
    const w = wb(ctx);
    const current = getCurrentlyFocusedPart(w) ?? PartId.Editor;
    const target = findVisibleNeighbour(w, current, false);
    w.focusPart(target);
  },
};

const focusFirstEditorGroup: CommandDescriptor = {
  id: 'workbench.action.focusFirstEditorGroup',
  title: 'Focus First Editor Group',
  category: 'View',
  keybinding: 'Ctrl+1',
  handler(ctx) {
    wb(ctx).focusPart(PartId.Editor);
  },
};

const focusSecondEditorGroup: CommandDescriptor = {
  id: 'workbench.action.focusSecondEditorGroup',
  title: 'Focus Second Editor Group',
  category: 'View',
  keybinding: 'Ctrl+2',
  handler(ctx) {
    // When multi-group is implemented, this should focus group 2.
    // For now, focus the editor part.
    wb(ctx).focusPart(PartId.Editor);
  },
};

const focusThirdEditorGroup: CommandDescriptor = {
  id: 'workbench.action.focusThirdEditorGroup',
  title: 'Focus Third Editor Group',
  category: 'View',
  keybinding: 'Ctrl+3',
  handler(ctx) {
    wb(ctx).focusPart(PartId.Editor);
  },
};

const focusSideBar: CommandDescriptor = {
  id: 'workbench.action.focusSideBar',
  title: 'Focus into Primary Side Bar',
  category: 'View',
  keybinding: 'Ctrl+0',
  handler(ctx) {
    const w = wb(ctx);
    // Show sidebar if hidden, then focus
    if (!w.isPartVisible(PartId.Sidebar)) {
      w.toggleSidebar();
    }
    w.focusPart(PartId.Sidebar);
  },
};

const focusPanel: CommandDescriptor = {
  id: 'workbench.action.focusPanel',
  title: 'Focus into Panel',
  category: 'View',
  keybinding: 'Ctrl+`',
  handler(ctx) {
    const w = wb(ctx);
    // Show panel if hidden, then focus
    if (!w.isPartVisible(PartId.Panel)) {
      w.togglePanel();
    }
    w.focusPart(PartId.Panel);
  },
};

const focusActivityBar: CommandDescriptor = {
  id: 'workbench.action.focusActivityBar',
  title: 'Focus Activity Bar',
  category: 'View',
  handler(ctx) {
    wb(ctx).focusPart(PartId.ActivityBar);
  },
};

const focusStatusBar: CommandDescriptor = {
  id: 'workbench.action.focusStatusBar',
  title: 'Focus Status Bar',
  category: 'View',
  handler(ctx) {
    const w = wb(ctx);
    if (!w.isPartVisible(PartId.StatusBar)) return; // no-op if hidden
    w.focusPart(PartId.StatusBar);
  },
};

// ─── Sidebar view switch ─────────────────────────────────────────────────────

const showSearchView: CommandDescriptor = {
  id: 'workbench.view.search',
  title: 'Search: Show Search',
  category: 'View',
  handler(ctx) {
    wb(ctx).showSidebarView('view.search');
  },
};

const showExplorerView: CommandDescriptor = {
  id: 'workbench.view.explorer',
  title: 'Explorer: Show Explorer',
  category: 'View',
  handler(ctx) {
    wb(ctx).showSidebarView('view.explorer');
  },
};

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
  workspaceOpenFolder,
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
