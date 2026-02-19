// fileCommands.ts — File open, save, revert, and related commands
//
// Extracted from structuralCommands.ts during Milestone 7.2 Phase D (C.7).

import type { CommandDescriptor } from './commandTypes.js';
import type { IEditorService } from '../services/serviceTypes.js';
import { URI } from '../platform/uri.js';
import { electronBridge, ensureUriWithinWorkspaceOrPrompt } from './structuralCommandTypes.js';

// ─── File Commands (M4 Cap 2.2) ──────────────────────────────────────────────

export const fileOpenFile: CommandDescriptor = {
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
    const fileService = ctx.getService<import('../services/serviceTypes.js').IFileService>('IFileService');

    for (const filePath of result) {
      const uri = URI.file(filePath);

      const allowed = await ensureUriWithinWorkspaceOrPrompt(
        ctx,
        uri,
        `Opening file "${uri.basename}"`,
      );
      if (!allowed) {
        console.warn('[Command] file.openFile — skipped outside-workspace file "%s"', filePath);
        continue;
      }

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

export const fileNewTextFile: CommandDescriptor = {
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

export const fileSave: CommandDescriptor = {
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

export const fileSaveAs: CommandDescriptor = {
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

    const fileService = ctx.getService<import('../services/serviceTypes.js').IFileService>('IFileService');
    if (!fileService) {
      console.warn('[Command] file.saveAs — IFileService not available');
      return;
    }

    const targetUri = URI.file(result);

    const allowed = await ensureUriWithinWorkspaceOrPrompt(
      ctx,
      targetUri,
      `Saving file "${targetUri.basename}"`,
    );
    if (!allowed) return;

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

export const fileRevert: CommandDescriptor = {
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

export const fileSaveAll: CommandDescriptor = {
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
