// workspaceCommands.ts — Workspace lifecycle and folder management commands
//
// Extracted from structuralCommands.ts during Milestone 7.2 Phase D (C.7).

import type { CommandDescriptor } from './commandTypes.js';
import type { IWorkspaceService, IFileService } from '../services/serviceTypes.js';
import { URI } from '../platform/uri.js';
import { wb, electronBridge, ensureUriWithinWorkspaceOrPrompt } from './structuralCommandTypes.js';

// ─── Workspace Commands ──────────────────────────────────────────────────────

export const workspaceSave: CommandDescriptor = {
  id: 'workspace.save',
  title: 'Save Workspace',
  category: 'Workspace',
  keybinding: 'Ctrl+S',
  handler: async (ctx) => {
    await wb(ctx)._workspaceSaver.save();
    console.log('[Command] Workspace saved');
  },
};

export const workspaceSwitch: CommandDescriptor = {
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

export const workspaceDuplicate: CommandDescriptor = {
  id: 'workspace.duplicateWorkspace',
  title: 'Duplicate Workspace',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);
    // Save current so the clone captures latest state
    await w._workspaceSaver.save();
    // Collect current live state to clone into the new workspace
    const currentState = w._workspaceSaver.collectState();
    const newName = `${w.workspace.name} (Copy)`;
    const newWs = await w.createWorkspace(newName, undefined, false, currentState);
    console.log('[Command] Workspace duplicated as "%s" (id: %s)', newName, (newWs as any).id);
  },
};

export const workspaceAddFolder: CommandDescriptor = {
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

export const workspaceRemoveFolder: CommandDescriptor = {
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

export const workspaceCloseFolder: CommandDescriptor = {
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

export const workspaceCloseWindow: CommandDescriptor = {
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

export const workspaceOpenRecent: CommandDescriptor = {
  id: 'workspace.openRecent',
  title: 'Open Recent Workspace...',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);

    // Open Quick Access in general mode — the GeneralProvider already
    // shows recent workspaces with switch actions.
    w.showQuickOpen();
  },
};

export const workspaceSaveAs: CommandDescriptor = {
  id: 'workspace.saveAs',
  title: 'Save Workspace As...',
  category: 'Workspace',
  handler: async (ctx, newName?: unknown) => {
    const w = wb(ctx);
    // Save current state first
    await w._workspaceSaver.save();

    // Prompt for a name if none was passed programmatically
    let name: string;
    if (typeof newName === 'string' && newName.length > 0) {
      name = newName;
    } else {
      // Use the notification service's input box modal
      const { showInputBoxModal } = await import('../api/notificationService.js');
      const result = await showInputBoxModal(document.body, {
        prompt: 'Save Workspace As',
        value: `${w.workspace.name} (Copy)`,
        placeholder: 'Enter workspace name',
        validateInput: (v) => (v.trim().length === 0 ? 'Name cannot be empty' : undefined),
      });
      if (!result) return; // cancelled
      name = result.trim();
    }

    // Collect current live state to clone into the new workspace
    const currentState = w._workspaceSaver.collectState();
    const newWs = await w.createWorkspace(name, undefined, true, currentState);
    console.log('[Command] Workspace saved as "%s" (id: %s)', name, (newWs as any).id);
    return newWs;
  },
};

export const workspaceRename: CommandDescriptor = {
  id: 'workspace.rename',
  title: 'Rename Workspace...',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);
    const { showInputBoxModal } = await import('../api/notificationService.js');
    const result = await showInputBoxModal(document.body, {
      prompt: 'Rename Workspace',
      value: w.workspace.name,
      placeholder: 'Enter new workspace name',
      validateInput: (v) => (v.trim().length === 0 ? 'Name cannot be empty' : undefined),
    });
    if (!result) return; // cancelled
    const newName = result.trim();
    if (newName === w.workspace.name) return; // no change

    w.workspace.rename(newName);
    w._titlebar.setWorkspaceName(newName);
    w._updateWindowTitle();
    await w._workspaceSaver.save();
    console.log('[Command] Workspace renamed to "%s"', newName);
  },
};

export const workspaceOpenFolder: CommandDescriptor = {
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

export const workspaceExportToFile: CommandDescriptor = {
  id: 'workspace.exportToFile',
  title: 'Save Workspace to File...',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);
    const fileService = ctx.getService<IFileService>('IFileService');
    if (!fileService) {
      console.warn('[Command] workspace.exportToFile — IFileService not available');
      return;
    }

    await w._workspaceSaver.save();

    const { createWorkspaceManifestFromState } = await import('../workspace/workspaceManifest.js');
    const state = w._workspaceSaver.collectState() as import('../workspace/workspaceTypes.js').WorkspaceState;
    const manifest = createWorkspaceManifestFromState(state, {
      exportedBy: 'Parallx',
    });

    const safeName = w.workspace.name.replace(/[\\/:*?"<>|]/g, '_');
    const target = await fileService.saveFileDialog({
      defaultName: `${safeName}.parallx-workspace.json`,
      filters: [
        { name: 'Parallx Workspace', extensions: ['parallx-workspace.json', 'json'] },
      ],
    });
    if (!target) return;

    const allowed = await ensureUriWithinWorkspaceOrPrompt(
      ctx,
      target,
      `Saving workspace file "${target.basename}"`,
    );
    if (!allowed) return;

    await fileService.writeFile(target, JSON.stringify(manifest, null, 2));
    console.log('[Command] workspace.exportToFile — saved "%s"', target.fsPath);
  },
};

export const workspaceImportFromFile: CommandDescriptor = {
  id: 'workspace.importFromFile',
  title: 'Open Workspace from File...',
  category: 'Workspace',
  handler: async (ctx) => {
    const w = wb(ctx);
    const fileService = ctx.getService<IFileService>('IFileService');
    if (!fileService) {
      console.warn('[Command] workspace.importFromFile — IFileService not available');
      return;
    }

    const picked = await fileService.openFileDialog({
      multiSelect: false,
      filters: [
        { name: 'Parallx Workspace', extensions: ['parallx-workspace.json', 'json'] },
      ],
    });
    if (!picked || picked.length === 0) return;

    const fileUri = picked[0];

    const allowed = await ensureUriWithinWorkspaceOrPrompt(
      ctx,
      fileUri,
      `Opening workspace file "${fileUri.basename}"`,
    );
    if (!allowed) return;

    const file = await fileService.readFile(fileUri);

    const {
      parseWorkspaceManifest,
      manifestToWorkspaceState,
    } = await import('../workspace/workspaceManifest.js');

    const manifest = parseWorkspaceManifest(file.content);
    const restoredState = manifestToWorkspaceState(manifest);

    await w.createWorkspace(
      manifest.identity.name,
      fileUri.fsPath,
      true,
      restoredState,
    );

    console.log('[Command] workspace.importFromFile — opened "%s"', fileUri.fsPath);
  },
};
