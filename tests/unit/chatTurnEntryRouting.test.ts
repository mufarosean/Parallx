import { describe, expect, it, vi } from 'vitest';

import { resolveChatTurnEntryRouting } from '../../src/built-in/chat/utilities/chatTurnEntryRouting';

function createToken() {
  return {
    isCancellationRequested: false,
    isYieldRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  } as any;
}

function createResponse() {
  return {
    markdown: vi.fn(),
  } as any;
}

describe('chat turn entry routing', () => {
  it('applies slash command remaining text for non-special commands', () => {
    const determineChatTurnRoute = vi.fn(() => ({ kind: 'grounded', reason: 'grounded route' }));
    const handleEarlyDeterministicAnswer = vi.fn(() => false);

    const result = resolveChatTurnEntryRouting({
      parseSlashCommand: () => ({
        command: { name: 'review', description: 'review', promptTemplate: '', isBuiltIn: true },
        commandName: 'review',
        remainingText: 'check this file',
      }),
      determineChatTurnRoute,
      handleEarlyDeterministicAnswer,
    }, {
      requestText: '/review check this file',
      requestCommand: undefined,
      isRagReady: true,
      sessionId: 'session-1',
      response: createResponse(),
      token: createToken(),
    });

    expect(result.effectiveText).toBe('check this file');
    expect(result.activeCommand).toBe('review');
    expect(result.hasActiveSlashCommand).toBe(true);
    expect(determineChatTurnRoute).toHaveBeenCalledWith('check this file', { hasActiveSlashCommand: true });
    expect(handleEarlyDeterministicAnswer).toHaveBeenCalledOnce();
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
      handleEarlyDeterministicAnswer: vi.fn(() => false),
    }, {
      requestText: '/compact summarize',
      requestCommand: undefined,
      isRagReady: false,
      sessionId: 'session-1',
      response: createResponse(),
      token: createToken(),
    });

    expect(compactResult.effectiveText).toBe('/compact summarize');
    expect(compactResult.hasActiveSlashCommand).toBe(false);
  });

  it('returns handled when the early deterministic answer short-circuits', () => {
    const result = resolveChatTurnEntryRouting({
      parseSlashCommand: () => ({ command: undefined, commandName: undefined, remainingText: '' }),
      determineChatTurnRoute: () => ({ kind: 'product-semantics', reason: 'product', directAnswer: 'answer' }),
      handleEarlyDeterministicAnswer: vi.fn(() => true),
    }, {
      requestText: 'what is approve once?',
      requestCommand: undefined,
      isRagReady: true,
      sessionId: 'session-2',
      response: createResponse(),
      token: createToken(),
    });

    expect(result.handled).toBe(true);
    expect(result.hasActiveSlashCommand).toBe(false);
  });
});