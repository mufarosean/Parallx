// editorCommands.ts — Editor split/close, markdown preview, and editor navigation
//
// Extracted from structuralCommands.ts during Milestone 7.2 Phase D (C.7).

import type { CommandDescriptor } from './commandTypes.js';
import type { IEditorGroupService } from '../services/serviceTypes.js';
import { GroupDirection } from '../services/serviceTypes.js';

// ─── Editor Commands ─────────────────────────────────────────────────────────

export const splitEditor: CommandDescriptor = {
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

export const splitEditorOrthogonal: CommandDescriptor = {
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

export const closeActiveEditor: CommandDescriptor = {
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

export const nextEditor: CommandDescriptor = {
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

export const previousEditor: CommandDescriptor = {
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

// ─── Markdown Preview Commands ───────────────────────────────────────────────

/** Check if a filename has a markdown extension. */
function isMarkdownFile(name: string): boolean {
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
  return ext === '.md' || ext === '.markdown' || ext === '.mdx';
}

export const markdownOpenPreviewToSide: CommandDescriptor = {
  id: 'markdown.showPreviewToSide',
  title: 'Markdown: Open Preview to the Side',
  category: 'Markdown',
  keybinding: 'Ctrl+K V',
  async handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;

    const activeGroup = editorGroupService.activeGroup;
    if (!activeGroup) return;

    const activeEditor = activeGroup.model.activeEditor;
    if (!activeEditor || activeEditor.typeId !== 'parallx.editor.file') return;
    if (!isMarkdownFile(activeEditor.name)) return;

    // Split right to create a new group
    const newGroup = editorGroupService.splitGroup(activeGroup.id, GroupDirection.Right);
    if (!newGroup) return;

    // Close the duplicated text editor from the new group (split copies active editor)
    if (newGroup.model.count > 0) {
      newGroup.model.closeEditor(0, true);
    }

    // Create a MarkdownPreviewInput wrapping the source FileEditorInput (dynamic import)
    const { MarkdownPreviewInput } = await import('../built-in/editor/markdownPreviewInput.js');
    const previewInput = MarkdownPreviewInput.create(activeEditor as any);
    newGroup.openEditor(previewInput, { pinned: true });
  },
};

export const markdownOpenPreview: CommandDescriptor = {
  id: 'markdown.showPreview',
  title: 'Markdown: Open Preview',
  category: 'Markdown',
  async handler(ctx) {
    const editorGroupService = ctx.getService<IEditorGroupService>('IEditorGroupService');
    if (!editorGroupService) return;

    const activeGroup = editorGroupService.activeGroup;
    if (!activeGroup) return;

    const activeEditor = activeGroup.model.activeEditor;
    if (!activeEditor || activeEditor.typeId !== 'parallx.editor.file') return;
    if (!isMarkdownFile(activeEditor.name)) return;

    // Open preview in the same group (replaces the text editor tab)
    const { MarkdownPreviewInput } = await import('../built-in/editor/markdownPreviewInput.js');
    const previewInput = MarkdownPreviewInput.create(activeEditor as any);
    activeGroup.openEditor(previewInput, { pinned: true });
  },
};
