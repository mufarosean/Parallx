import { describe, expect, it, vi } from 'vitest';

import { ChatContentPartKind, ChatMode } from '../../src/services/chatTypes';
import { assembleChatTurnMessages } from '../../src/built-in/chat/utilities/chatTurnMessageAssembly';

describe('chat turn message assembly', () => {
  it('uses the AI profile prompt overlay ahead of file overlays and appends prompt preferences', async () => {
    const result = await assembleChatTurnMessages({
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn().mockResolvedValue(3),
      getCurrentPageTitle: () => 'Policy Notes',
      getFileCount: vi.fn().mockResolvedValue(9),
      getPromptOverlay: vi.fn().mockResolvedValue('DISK LAYER'),
      getWorkspaceDigest: vi.fn().mockResolvedValue('WORKSPACE DIGEST'),
      getPreferencesForPrompt: vi.fn().mockResolvedValue('PREFERENCES BLOCK'),
      isRAGAvailable: () => true,
      isIndexing: () => false,
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          chat: { systemPrompt: 'LIVE PERSONA', workspaceDescription: 'Insurance workspace' },
        } as any),
      } as any,
    }, {
      mode: ChatMode.Agent,
      history: [],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('LIVE PERSONA');
    expect(result.messages[0].content).not.toContain('DISK LAYER');
    expect(result.messages[0].content).toContain('WORKSPACE DIGEST');
    expect(result.messages[0].content).toContain('Insurance workspace');
    expect(result.messages[0].content).toContain('PREFERENCES BLOCK');
  });

  it('materializes history as alternating user and assistant messages with code blocks', async () => {
    const result = await assembleChatTurnMessages({
      getWorkspaceName: () => 'Demo Workspace',
      getPageCount: vi.fn().mockResolvedValue(0),
      getCurrentPageTitle: () => undefined,
      isRAGAvailable: () => false,
      isIndexing: () => false,
    }, {
      mode: ChatMode.Agent,
      history: [
        {
          request: { text: 'Explain this helper.' },
          response: {
            parts: [
              { kind: ChatContentPartKind.Markdown, content: 'It formats a summary.' },
              { kind: ChatContentPartKind.Code, code: 'return summary;' },
              { kind: ChatContentPartKind.Thinking, thinking: 'ignored' },
            ],
          },
        },
      ] as any,
    });

    expect(result.messages).toHaveLength(3);
    expect(result.messages[1]).toEqual({
      role: 'user',
      content: 'Explain this helper.',
    });
    expect(result.messages[2]).toEqual({
      role: 'assistant',
      content: 'It formats a summary.\n```\nreturn summary;\n```',
    });
  });
});