import { describe, expect, it, vi } from 'vitest';

import { composeChatSystemPrompt } from '../../src/built-in/chat/utilities/chatSystemPromptComposer';

describe('chat system prompt composer', () => {
  it('builds the agent system prompt with prompt overlay', async () => {
    const prompt = await composeChatSystemPrompt({
      workspaceName: 'Parallx Workspace',
      getPageCount: vi.fn().mockResolvedValue(12),
      getFileCount: vi.fn().mockResolvedValue(4),
      getToolDefinitions: vi.fn(() => [{ name: 'search_knowledge' }] as any),
      isRAGAvailable: true,
      promptFileService: {
        loadLayers: vi.fn().mockResolvedValue({ soul: 'SOUL' }),
        assemblePromptOverlay: vi.fn().mockReturnValue('CUSTOM OVERLAY'),
      },
    });

    expect(prompt).toContain('CUSTOM OVERLAY');
    expect(prompt).toContain('Parallx Workspace');
    expect(prompt).toContain('12 canvas pages');
    expect(prompt).toContain('4 files');
    expect(prompt).toContain('search_knowledge');
  });

  it('falls back cleanly when prompt overlay loading fails', async () => {
    const prompt = await composeChatSystemPrompt({
      workspaceName: 'Parallx Workspace',
      getPageCount: vi.fn().mockResolvedValue(0),
      getFileCount: vi.fn().mockResolvedValue(0),
      getToolDefinitions: vi.fn(() => []),
      isRAGAvailable: false,
      promptFileService: {
        loadLayers: vi.fn().mockRejectedValue(new Error('boom')),
        assemblePromptOverlay: vi.fn(),
      },
    });

    expect(prompt).toContain('You are Parallx AI');
    expect(prompt).not.toContain('CUSTOM OVERLAY');
  });
});