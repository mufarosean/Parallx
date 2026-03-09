import type { Event } from '../../../platform/events.js';
import type { IChatWidgetServices } from '../chatTypes.js';

export interface IChatWidgetAttachmentAdapterDeps {
  readonly getOpenEditorFiles?: () => Array<{ name: string; fullPath: string }>;
  readonly onDidChangeOpenEditors?: Event<void>;
  readonly listWorkspaceFiles?: () => Promise<readonly unknown[]>;
  readonly openFile?: (fullPath: string) => void;
  readonly openPage?: (pageId: string) => void;
  readonly openMemory?: (sessionId: string) => void;
}

export function buildChatWidgetAttachmentServices(
  deps: IChatWidgetAttachmentAdapterDeps,
): Pick<IChatWidgetServices, 'attachmentServices' | 'openFile' | 'openPage' | 'openMemory'> {
  return {
    attachmentServices: (deps.getOpenEditorFiles && deps.onDidChangeOpenEditors)
      ? {
          getOpenEditorFiles: deps.getOpenEditorFiles,
          onDidChangeOpenEditors: deps.onDidChangeOpenEditors,
          listWorkspaceFiles: deps.listWorkspaceFiles
            ? () => deps.listWorkspaceFiles!()
            : undefined,
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