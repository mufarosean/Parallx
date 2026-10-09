import type { Event } from '../../../platform/events.js';
import type { IChatWidgetServices, IWorkspaceFileEntry } from '../chatTypes.js';
import type { IChatImageAttachment } from '../../../services/chatTypes.js';

export interface IChatWidgetAttachmentAdapterDeps {
  readonly getOpenEditorFiles?: () => Array<{ name: string; fullPath: string }>;
  readonly getActiveEditorFile?: () => { name: string; fullPath: string } | undefined;
  readonly onDidChangeOpenEditors?: Event<void>;
  readonly listWorkspaceFiles?: () => Promise<readonly IWorkspaceFileEntry[]>;
  readonly openFile?: (fullPath: string) => void;
  readonly openPage?: (pageId: string) => void;
  readonly openCanvasBlock?: (pageId: string, blockId: string) => void;
  readonly openImage?: (attachment: IChatImageAttachment) => void;
  readonly openMemory?: (sessionId: string) => void;
  readonly notifyWarning?: (message: string) => void;
}

/**
 * True when the string is a real filesystem path (Windows drive, UNC, or
 * POSIX absolute). Tool editors carry `Tool editor: <typeId>` as their
 * description — attaching that produces a junk file attachment the model
 * reports as unreadable, so editor lists must filter on this first.
 */
export function isAttachableFsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

/**
 * The filesystem path an open editor shows, or undefined when it shows no
 * file. Its URI first: a text editor's description is the path relative to
 * the workspace (`notes/plan.md`), which the absolute-path check refused, so
 * every Markdown, text and code file was left out of the chat's suggestion
 * while PDFs and Word files (whose description is the full path) were not
 * (found 2026-10-09). The description is the fallback for an editor with no
 * file URI.
 */
export function attachableEditorPath(editor: { readonly uri?: { readonly scheme: string; readonly fsPath: string }; readonly description?: string; readonly name: string }): string | undefined {
  if (editor.uri && editor.uri.scheme === 'file' && editor.uri.fsPath) return editor.uri.fsPath;
  const p = editor.description || editor.name;
  return isAttachableFsPath(p) ? p : undefined;
}

export function buildChatWidgetAttachmentServices(
  deps: IChatWidgetAttachmentAdapterDeps,
): Pick<IChatWidgetServices, 'attachmentServices' | 'openFile' | 'openPage' | 'openCanvasBlock' | 'openImage' | 'openMemory'> {
  return {
    attachmentServices: (deps.getOpenEditorFiles && deps.onDidChangeOpenEditors)
      ? {
          getOpenEditorFiles: deps.getOpenEditorFiles,
          getActiveEditorFile: deps.getActiveEditorFile ?? (() => undefined),
          onDidChangeOpenEditors: deps.onDidChangeOpenEditors,
          listWorkspaceFiles: deps.listWorkspaceFiles
            ? async () => [...await deps.listWorkspaceFiles!()]
            : undefined,
          notifyWarning: deps.notifyWarning,
        }
      : undefined,
    openFile: deps.openFile
      ? (fullPath: string) => deps.openFile!(fullPath)
      : undefined,
    openPage: deps.openPage
      ? (pageId: string) => deps.openPage!(pageId)
      : undefined,
    openCanvasBlock: deps.openCanvasBlock
      ? (pageId: string, blockId: string) => deps.openCanvasBlock!(pageId, blockId)
      : undefined,
    openImage: deps.openImage
      ? (attachment: IChatImageAttachment) => deps.openImage!(attachment)
      : undefined,
    openMemory: deps.openMemory
      ? (sessionId: string) => deps.openMemory!(sessionId)
      : undefined,
  };
}