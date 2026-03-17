import { describe, expect, it, vi } from 'vitest';

import {
  buildChatCanvasParticipantServices,
  buildChatWorkspaceParticipantServices,
} from '../../src/built-in/chat/utilities/chatScopedParticipantAdapters';

describe('chat scoped participant adapters', () => {
  it('delegates workspace participant services', async () => {
    const listPages = vi.fn().mockResolvedValue([{ id: 'page-1', title: 'Claims' }]);
    const searchPages = vi.fn().mockResolvedValue([{ id: 'page-2', title: 'Policy' }]);
    const getPageContent = vi.fn().mockResolvedValue('content');
    const getPageTitle = vi.fn().mockResolvedValue('Claims');
    const listFiles = vi.fn().mockResolvedValue([{ name: 'Claims.md', type: 'file', size: 42 }]);
    const readFileContent = vi.fn().mockResolvedValue('file text');
    const reportParticipantDebug = vi.fn();

    const services = buildChatWorkspaceParticipantServices({
      sendChatRequest: vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }) as AsyncIterable<any>),
      getActiveModel: vi.fn(() => 'model'),
      getWorkspaceName: vi.fn(() => 'Parallx'),
      listPages,
      searchPages,
      getPageContent,
      getPageTitle,
      listFiles,
      readFileContent,
      reportParticipantDebug,
    });

    expect(services.getActiveModel()).toBe('model');
    expect(services.getWorkspaceName()).toBe('Parallx');
    await expect(services.listPages()).resolves.toEqual([{ id: 'page-1', title: 'Claims' }]);
    await expect(services.searchPages('policy')).resolves.toEqual([{ id: 'page-2', title: 'Policy' }]);
    await expect(services.getPageContent('page-1')).resolves.toBe('content');
    await expect(services.getPageTitle('page-1')).resolves.toBe('Claims');
    await expect(services.listFiles?.('')).resolves.toEqual([{ name: 'Claims.md', type: 'file', size: 42 }]);
    await expect(services.readFileContent?.('Claims.md')).resolves.toBe('file text');
    services.reportParticipantDebug?.({
      surface: 'workspace',
      usedSharedTurnState: true,
      attachmentCount: 1,
      fileAttachmentCount: 1,
      imageAttachmentCount: 0,
      queryScopeLevel: 'document',
    });
    expect(reportParticipantDebug).toHaveBeenCalled();
  });

  it('delegates canvas participant services', async () => {
    const getPageStructure = vi.fn().mockResolvedValue({ pageId: 'page-1', title: 'Claims', blocks: [] });
    const readFileContent = vi.fn().mockResolvedValue('file text');

    const services = buildChatCanvasParticipantServices({
      sendChatRequest: vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} }) as AsyncIterable<any>),
      getActiveModel: vi.fn(() => 'model'),
      getWorkspaceName: vi.fn(() => 'Parallx'),
      getCurrentPageId: vi.fn(() => 'page-1'),
      getCurrentPageTitle: vi.fn(() => 'Claims'),
      getPageStructure,
      readFileContent,
    });

    expect(services.getActiveModel()).toBe('model');
    expect(services.getWorkspaceName()).toBe('Parallx');
    expect(services.getCurrentPageId()).toBe('page-1');
    expect(services.getCurrentPageTitle()).toBe('Claims');
    await expect(services.getPageStructure('page-1')).resolves.toEqual({ pageId: 'page-1', title: 'Claims', blocks: [] });
    await expect(services.readFileContent?.('Claims.md')).resolves.toBe('file text');
    expect(getPageStructure).toHaveBeenCalledWith('page-1');
  });
});