import { describe, expect, it, vi } from 'vitest';

import { resolveChatTurnEntryRouting } from '../../src/built-in/chat/utilities/chatTurnEntryRouting';

describe('chat turn entry routing', () => {
  it('applies slash command remaining text for non-special commands', () => {
    const determineChatTurnRoute = vi.fn(() => ({ kind: 'grounded', reason: 'grounded route' }));

    const result = resolveChatTurnEntryRouting({
      parseSlashCommand: () => ({
        command: { name: 'review', description: 'review', promptTemplate: '', isBuiltIn: true },
        commandName: 'review',
        remainingText: 'check this file',
      }),
      determineChatTurnRoute,
    }, {
      requestText: '/review check this file',
      requestCommand: undefined,
      isRagReady: true,
    });

    expect(result.effectiveText).toBe('check this file');
    expect(result.activeCommand).toBe('review');
    expect(result.hasActiveSlashCommand).toBe(true);
    expect(determineChatTurnRoute).toHaveBeenCalledWith('check this file', { hasActiveSlashCommand: true });
  });

  it('preserves text for compact and init special handlers', () => {
    const determineChatTurnRoute = vi.fn(() => ({ kind: 'conversational', reason: 'chatty' }));

    const compactResult = resolveChatTurnEntryRouting({
      parseSlashCommand: () => ({
        command: { name: 'compact', description: 'compact', promptTemplate: '', isBuiltIn: true, specialHandler: 'compact' },
        commandName: 'compact',
        remainingText: 'ignored',
      }),
      determineChatTurnRoute,
    }, {
      requestText: '/compact summarize',
      requestCommand: undefined,
      isRagReady: false,
    });

    expect(compactResult.effectiveText).toBe('/compact summarize');
    expect(compactResult.hasActiveSlashCommand).toBe(false);
  });

  it('never short-circuits — handled is always false', () => {
    const result = resolveChatTurnEntryRouting({
      parseSlashCommand: () => ({ command: undefined, commandName: undefined, remainingText: '' }),
      determineChatTurnRoute: () => ({ kind: 'grounded', reason: 'grounded' }),
    }, {
      requestText: 'what is approve once?',
      requestCommand: undefined,
      isRagReady: true,
    });

    expect(result.handled).toBe(false);
    expect(result.hasActiveSlashCommand).toBe(false);
  });
});