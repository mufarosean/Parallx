import type { Event } from '../../../platform/events.js';
import type { IChatWidgetServices, IWorkspaceFileEntry } from '../chatTypes.js';

export interface IChatWidgetAttachmentAdapterDeps {
  readonly getOpenEditorFiles?: () => Array<{ name: string; fullPath: string }>;
  readonly getActiveEditorFile?: () => { name: string; fullPath: string } | undefined;
  readonly onDidChangeOpenEditors?: Event<void>;
  readonly listWorkspaceFiles?: () => Promise<readonly IWorkspaceFileEntry[]>;
  readonly openFile?: (fullPath: string) => void;
  readonly openPage?: (pageId: string) => void;
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

export function buildChatWidgetAttachmentServices(
  deps: IChatWidgetAttachmentAdapterDeps,
): Pick<IChatWidgetServices, 'attachmentServices' | 'openFile' | 'openPage' | 'openMemory'> {
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
    openMemory: deps.openMemory
      ? (sessionId: string) => deps.openMemory!(sessionId)
      : undefined,
  };
}