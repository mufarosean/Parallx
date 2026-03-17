import { describe, expect, it, vi } from 'vitest';

import { ChatBridge } from '../../src/api/bridges/chatBridge';

describe('ChatBridge', () => {
  it('normalizes bridged participant requests through the shared interpretation contract', async () => {
    let registeredHandler: ((...args: any[]) => Promise<any>) | undefined;
    const agentService = {
      registerAgent: vi.fn((participant) => {
        registeredHandler = participant.handler;
        return { dispose: vi.fn() };
      }),
    };
    const rawHandler = vi.fn(async () => ({}));
    const bridge = new ChatBridge('tool.test', agentService as any, undefined, []);

    bridge.createChatParticipant('tool.test.participant', rawHandler as any);

    expect(registeredHandler).toBeDefined();

    await registeredHandler?.({
      text: '   hello world   ',
      requestId: 'req-1',
      mode: 'ask',
      modelId: 'test-model',
      attempt: 0,
    }, {
      sessionId: 'session-1',
      history: [],
    }, {
      markdown: vi.fn(),
      codeBlock: vi.fn(),
      progress: vi.fn(),
      reference: vi.fn(),
      thinking: vi.fn(),
      warning: vi.fn(),
      button: vi.fn(),
      confirmation: vi.fn(),
      beginToolInvocation: vi.fn(),
      updateToolInvocation: vi.fn(),
      push: vi.fn(),
      replaceLastMarkdown: vi.fn(),
      throwIfDone: vi.fn(),
      reportTokenUsage: vi.fn(),
      setCitations: vi.fn(),
      getMarkdownText: vi.fn(() => ''),
    }, {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    });

    expect(rawHandler).toHaveBeenCalledTimes(1);
    const normalizedRequest = rawHandler.mock.calls[0][0];
    expect(normalizedRequest.text).toBe('hello world');
    expect(normalizedRequest.interpretation).toEqual({
      surface: 'bridge',
      rawText: '   hello world   ',
      effectiveText: 'hello world',
      commandName: undefined,
      hasExplicitCommand: false,
      kind: 'message',
      semantics: {
        rawText: 'hello world',
        normalizedText: 'hello world',
        strippedApostropheText: 'hello world',
        isConversational: false,
        isExplicitMemoryRecall: false,
        isExplicitTranscriptRecall: false,
        isFileEnumeration: false,
        isExhaustiveWorkspaceReview: false,
        offTopicDirectAnswer: undefined,
        productSemanticsDirectAnswer: undefined,
        workflowTypeHint: 'generic-grounded',
        groundedCoverageModeHint: 'representative',
      },
    });
  });
});