import { describe, expect, it, vi } from 'vitest';

import { ChatBridge } from '../../src/api/bridges/chatBridge';

describe('ChatBridge', () => {
  it('registers bridged participants with an explicit bridge surface', () => {
    let registeredParticipant: { surface?: string; runtime?: unknown } | undefined;
    const agentService = {
      registerAgent: vi.fn((participant) => {
        registeredParticipant = participant;
        return { dispose: vi.fn() };
      }),
    };
    const bridge = new ChatBridge('tool.test', agentService as any, undefined, []);

    bridge.createChatParticipant('tool.test.participant', vi.fn(async () => ({})) as any);

    expect(registeredParticipant?.surface).toBe('bridge');
    expect(registeredParticipant?.runtime).toBeDefined();
  });

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
        offTopicDirectAnswer: undefined,
        productSemanticsDirectAnswer: undefined,
      },
    });
  });

  it('reports bridge runtime checkpoints through the shared participant context', async () => {
    let registeredHandler: ((...args: any[]) => Promise<any>) | undefined;
    const agentService = {
      registerAgent: vi.fn((participant) => {
        registeredHandler = participant.handler;
        return { dispose: vi.fn() };
      }),
    };
    const rawHandler = vi.fn(async () => ({}));
    const reportTrace = vi.fn();
    const bridge = new ChatBridge('tool.test', agentService as any, undefined, []);

    bridge.createChatParticipant('tool.test.participant', rawHandler as any);

    const result = await registeredHandler?.({
      text: 'hello world',
      requestId: 'req-1',
      mode: 'ask',
      modelId: 'test-model',
      attempt: 0,
      turnState: {
        rawText: 'hello world',
        effectiveText: 'hello world',
        userText: 'hello world',
        contextQueryText: 'hello world',
        mentions: [],
        semantics: {
          rawText: 'hello world',
          normalizedText: 'hello world',
          strippedApostropheText: 'hello world',
          isConversational: false,
          isExplicitMemoryRecall: false,
          isExplicitTranscriptRecall: false,
          isFileEnumeration: false,
          offTopicDirectAnswer: undefined,
          productSemanticsDirectAnswer: undefined,
        },
        queryScope: {
          level: 'workspace',
          pathPrefixes: [],
          mentionFolders: [],
          mentionFiles: [],
        },
        turnRoute: {
          kind: 'grounded',
        },
        contextPlan: {
          intent: 'answer',
          useRetrieval: true,
          useConversationHistory: true,
          usePageContext: false,
          useAttachments: false,
        },
        semanticFallback: undefined,
        hasActiveSlashCommand: false,
        isConversationalTurn: false,
        isRagReady: true,
      },
    }, {
      sessionId: 'session-1',
      history: [],
      runtime: { reportTrace },
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

    expect(reportTrace).toHaveBeenCalledTimes(2);
    expect(reportTrace.mock.calls[0][0]).toMatchObject({
      runtime: 'claw',
      checkpoint: 'bridge-handler-start',
      runState: 'executing',
      sessionId: 'session-1',
    });
    expect(reportTrace.mock.calls[1][0]).toMatchObject({
      runtime: 'claw',
      checkpoint: 'bridge-handler-complete',
      runState: 'completed',
      sessionId: 'session-1',
    });
    expect(result?.metadata).toMatchObject({
      runtimeBoundary: {
        type: 'bridge-compatibility',
        participantId: 'tool.test.participant',
        runtime: 'claw',
      },
    });
  });

  it('marks bridge results with an explicit compatibility boundary', async () => {
    let registeredHandler: ((...args: any[]) => Promise<any>) | undefined;
    const agentService = {
      registerAgent: vi.fn((participant) => {
        registeredHandler = participant.handler;
        return { dispose: vi.fn() };
      }),
    };
    const bridge = new ChatBridge('tool.test', agentService as any, undefined, []);

    bridge.createChatParticipant('tool.test.participant', vi.fn(async () => ({
      metadata: {
        custom: true,
      },
    })) as any);

    const result = await registeredHandler?.({
      text: 'hello world',
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

    expect(result.metadata).toMatchObject({
      custom: true,
      runtimeBoundary: {
        type: 'bridge-compatibility',
        participantId: 'tool.test.participant',
        runtime: 'claw',
      },
    });
  });

  it('reports bridge runtime errors through the shared participant context', async () => {
    let registeredHandler: ((...args: any[]) => Promise<any>) | undefined;
    const agentService = {
      registerAgent: vi.fn((participant) => {
        registeredHandler = participant.handler;
        return { dispose: vi.fn() };
      }),
    };
    const reportTrace = vi.fn();
    const bridge = new ChatBridge('tool.test', agentService as any, undefined, []);

    bridge.createChatParticipant('tool.test.participant', vi.fn(async () => {
      throw new Error('bridge boom');
    }) as any);

    await expect(registeredHandler?.({
      text: 'hello world',
      requestId: 'req-1',
      mode: 'ask',
      modelId: 'test-model',
      attempt: 0,
      turnState: {
        rawText: 'hello world',
        effectiveText: 'hello world',
        userText: 'hello world',
        contextQueryText: 'hello world',
        mentions: [],
        semantics: {
          rawText: 'hello world',
          normalizedText: 'hello world',
          strippedApostropheText: 'hello world',
          isConversational: false,
          isExplicitMemoryRecall: false,
          isExplicitTranscriptRecall: false,
          isFileEnumeration: false,
          offTopicDirectAnswer: undefined,
          productSemanticsDirectAnswer: undefined,
        },
        queryScope: {
          level: 'workspace',
          pathPrefixes: [],
          mentionFolders: [],
          mentionFiles: [],
        },
        turnRoute: {
          kind: 'grounded',
        },
        contextPlan: {
          intent: 'answer',
          useRetrieval: true,
          useConversationHistory: true,
          usePageContext: false,
          useAttachments: false,
        },
        semanticFallback: undefined,
        hasActiveSlashCommand: false,
        isConversationalTurn: false,
        isRagReady: true,
      },
    }, {
      sessionId: 'session-1',
      history: [],
      runtime: { reportTrace },
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
    })).rejects.toThrow('bridge boom');

    expect(reportTrace.mock.calls.at(-1)?.[0]).toMatchObject({
      runtime: 'claw',
      checkpoint: 'bridge-handler-error',
      runState: 'failed',
      note: 'bridge boom',
      sessionId: 'session-1',
    });
  });
});