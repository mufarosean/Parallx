import { describe, expect, it, vi } from 'vitest';

import { buildChatWidgetAttachmentServices } from '../../src/built-in/chat/utilities/chatWidgetAttachmentAdapter';

describe('chat widget attachment adapter', () => {
  it('builds attachment services when editor callbacks are available', async () => {
    const getOpenEditorFiles = vi.fn(() => [{ name: 'Claims Guide.md', fullPath: 'Claims Guide.md' }]);
    const getActiveEditorFile = vi.fn(() => ({ name: 'Claims Guide.md', fullPath: 'Claims Guide.md' }));
    const onDidChangeOpenEditors = vi.fn() as any;
    const listWorkspaceFiles = vi.fn().mockResolvedValue([{ name: 'docs', isDirectory: true }]);

    const services = buildChatWidgetAttachmentServices({
      getOpenEditorFiles,
      getActiveEditorFile,
      onDidChangeOpenEditors,
      listWorkspaceFiles,
    });

    expect(services.attachmentServices?.getOpenEditorFiles()).toEqual([
      { name: 'Claims Guide.md', fullPath: 'Claims Guide.md' },
    ]);
    expect(services.attachmentServices?.getActiveEditorFile()).toEqual(
      { name: 'Claims Guide.md', fullPath: 'Claims Guide.md' },
    );
    await expect(services.attachmentServices?.listWorkspaceFiles?.()).resolves.toEqual([
      { name: 'docs', isDirectory: true },
    ]);
    expect(services.attachmentServices?.onDidChangeOpenEditors).toBe(onDidChangeOpenEditors);
  });

  it('delegates open targets when callbacks are available', () => {
    const openFile = vi.fn();
    const openPage = vi.fn();
    const openMemory = vi.fn();

    const services = buildChatWidgetAttachmentServices({
      openFile,
      openPage,
      openMemory,
    });

    services.openFile?.('Vehicle Info.md');
    services.openPage?.('page-1');
    services.openMemory?.('session-1');

    expect(openFile).toHaveBeenCalledWith('Vehicle Info.md');
    expect(openPage).toHaveBeenCalledWith('page-1');
    expect(openMemory).toHaveBeenCalledWith('session-1');
  });

  it('omits attachment services when editor callbacks are missing', () => {
    const services = buildChatWidgetAttachmentServices({});

    expect(services.attachmentServices).toBeUndefined();
    expect(services.openFile).toBeUndefined();
    expect(services.openPage).toBeUndefined();
    expect(services.openMemory).toBeUndefined();
  });
});