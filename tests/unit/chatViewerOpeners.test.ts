import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/built-in/editor/readonlyMarkdownInput', () => ({
  ReadonlyMarkdownInput: {
    create: vi.fn((content: string, name: string) => ({ content, name })),
  },
}));

import { ReadonlyMarkdownInput } from '../../src/built-in/editor/readonlyMarkdownInput';
import {
  buildSessionMemoryMarkdown,
  openChatFile,
  openChatMemoryViewer,
  resolveChatOpenFilePath,
} from '../../src/built-in/chat/utilities/chatViewerOpeners';

describe('chat viewer openers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves relative and absolute file paths', () => {
    expect(resolveChatOpenFilePath('Claims Guide.md', [{ uri: { fsPath: 'D:/AI/Parallx/demo-workspace' } }])).toBe('D:/AI/Parallx/demo-workspace/Claims Guide.md');
    expect(resolveChatOpenFilePath('D:/AI/Parallx/demo-workspace/Claims Guide.md')).toBe('D:/AI/Parallx/demo-workspace/Claims Guide.md');
  });

  it('opens files through the editor callback', async () => {
    const openFileEditor = vi.fn().mockResolvedValue(undefined);

    openChatFile({
      fullPath: 'Claims Guide.md',
      workspaceFolders: [{ uri: { fsPath: 'D:/AI/Parallx/demo-workspace' } }],
      openFileEditor,
    });

    await Promise.resolve();
    expect(openFileEditor).toHaveBeenCalledWith('D:/AI/Parallx/demo-workspace/Claims Guide.md', { pinned: true });
  });

  it('builds session memory markdown for present and missing memory', () => {
    expect(buildSessionMemoryMarkdown('session-1', {
      sessionId: 'session-1',
      createdAt: '2026-03-08T00:00:00.000Z',
      messageCount: 3,
      summary: 'Summary text.',
    })).toContain('Summary text.');

    expect(buildSessionMemoryMarkdown('session-2')).toContain('No memory found for session `session-2`.');
  });

  it('opens a session memory viewer with markdown input', async () => {
    const editorService = {
      openEditor: vi.fn().mockResolvedValue(undefined),
    } as any;
    const memoryService = {
      getAllMemories: vi.fn().mockResolvedValue([
        {
          sessionId: 'session-1',
          createdAt: '2026-03-08T00:00:00.000Z',
          messageCount: 3,
          summary: 'Summary text.',
        },
      ]),
    } as any;

    await openChatMemoryViewer({ sessionId: 'session-1', memoryService, editorService });

    expect(ReadonlyMarkdownInput.create).toHaveBeenCalled();
    expect(editorService.openEditor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Session Memory', content: expect.stringContaining('Summary text.') }),
      { pinned: false },
    );
  });
});