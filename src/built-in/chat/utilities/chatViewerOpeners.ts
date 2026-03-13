import type { IEditorService, IMemoryService, IWorkspaceMemoryService } from '../../../services/serviceTypes.js';
import { ReadonlyMarkdownInput } from '../../editor/readonlyMarkdownInput.js';

interface IWorkspaceFolderRef {
  readonly uri: { fsPath: string };
}

export interface IOpenChatFileDeps {
  readonly fullPath: string;
  readonly workspaceFolders?: readonly IWorkspaceFolderRef[];
  readonly openFileEditor?: (uri: string, options?: { pinned?: boolean }) => Promise<void>;
}

export interface IOpenChatMemoryViewerDeps {
  readonly sessionId: string;
  readonly workspaceMemoryService?: IWorkspaceMemoryService;
  readonly memoryService?: IMemoryService;
  readonly editorService?: IEditorService;
  readonly workspaceFolders?: readonly IWorkspaceFolderRef[];
  readonly openFileEditor?: (uri: string, options?: { pinned?: boolean }) => Promise<void>;
}

export interface IChatSessionMemoryRecord {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly messageCount: number;
  readonly summary: string;
}

export function resolveChatOpenFilePath(fullPath: string, workspaceFolders?: readonly IWorkspaceFolderRef[]): string {
  const isAbsolute = /^[/\\]/.test(fullPath) || /^[a-zA-Z]:/.test(fullPath);
  if (isAbsolute) {
    return fullPath;
  }
  if (workspaceFolders?.length) {
    const rootFsPath = workspaceFolders[0].uri.fsPath;
    return rootFsPath.endsWith('/') ? rootFsPath + fullPath : rootFsPath + '/' + fullPath;
  }
  return fullPath;
}

export function buildSessionMemoryMarkdown(
  sessionId: string,
  memory?: IChatSessionMemoryRecord,
): string {
  if (!memory) {
    return [
      '# Session Memory',
      '',
      `No memory found for session \`${sessionId}\`.`,
      '',
      'The memory may have been pruned or the session may still be in progress.',
    ].join('\n');
  }

  return [
    '# Session Memory',
    '',
    `**Session ID:** \`${memory.sessionId}\`  `,
    `**Created:** ${memory.createdAt}  `,
    `**Messages in session:** ${memory.messageCount}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    memory.summary,
  ].join('\n');
}

export function openChatFile(deps: IOpenChatFileDeps): void {
  if (!deps.openFileEditor) {
    return;
  }

  const fsPath = resolveChatOpenFilePath(deps.fullPath, deps.workspaceFolders);
  deps.openFileEditor(fsPath, { pinned: true }).catch((err) => {
    console.error('[ChatDataService] openFile failed:', err);
  });
}

export async function openChatMemoryViewer(deps: IOpenChatMemoryViewerDeps): Promise<void> {
  if (!deps.editorService && !deps.openFileEditor) {
    console.warn('[ChatDataService] openMemoryViewer: missing editor opener');
    return;
  }

  console.log('[ChatDataService] openMemoryViewer for session:', deps.sessionId);

  try {
    if (deps.workspaceMemoryService && deps.openFileEditor) {
      const relativePath = await deps.workspaceMemoryService.findSessionSummaryRelativePath(deps.sessionId);
      if (relativePath) {
        const fsPath = resolveChatOpenFilePath(relativePath, deps.workspaceFolders);
        await deps.openFileEditor(fsPath, { pinned: false });
        return;
      }
    }

    if (!deps.memoryService || !deps.editorService) {
      console.warn('[ChatDataService] openMemoryViewer: canonical file not found and legacy memory viewer dependencies missing');
      return;
    }

    const memories = await deps.memoryService.getAllMemories();
    const match = memories.find((memory) => memory.sessionId === deps.sessionId);
    const content = buildSessionMemoryMarkdown(deps.sessionId, match);
    const input = ReadonlyMarkdownInput.create(content, 'Session Memory');
    await deps.editorService.openEditor(input, { pinned: false });
  } catch (err) {
    console.error('[ChatDataService] openMemoryViewer failed:', err);
  }
}