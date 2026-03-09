import { describe, expect, it, vi } from 'vitest';

import { executeChatModelOnly } from '../../src/built-in/chat/utilities/chatModelOnlyExecutor';

function createToken(overrides: Partial<{ isCancellationRequested: boolean; isYieldRequested: boolean }> = {}) {
  return {
    isCancellationRequested: false,
    isYieldRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    ...overrides,
  } as any;
}

function createResponse() {
  const markdown: string[] = [];
  return {
    markdown: vi.fn((content: string) => markdown.push(content)),
    thinking: vi.fn(),
    warning: vi.fn(),
    replaceLastMarkdown: vi.fn(),
    reportTokenUsage: vi.fn(),
    getMarkdownText: vi.fn(() => markdown.join('')),
  } as any;
}

describe('chat model-only executor', () => {
  it('streams markdown, thinking, and token usage for a normal no-tool turn', async () => {
    const response = createResponse();

    const result = await executeChatModelOnly(
      {
        sendChatRequest: async function* () {
          yield { thinking: 'reasoning', content: '', done: false };
          yield { content: 'Hello ', done: false };
          yield { content: 'world', done: true, promptEvalCount: 12, evalCount: 4 };
        },
        resetNetworkTimeout: vi.fn(),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn((text: string) => ({ toolCalls: [], cleanedText: text })),
        stripToolNarration: vi.fn((text: string) => text),
        reportFirstTokenLatency: vi.fn(),
        reportStreamCompleteLatency: vi.fn(),
      },
      {
        messages: [{ role: 'user', content: 'hello' }],
        requestOptions: {},
        abortSignal: new AbortController().signal,
        response,
        token: createToken(),
        canInvokeTools: true,
        isEditMode: false,
      },
    );

    expect(result.producedContent).toBe(true);
    expect(result.turnContent).toBe('Hello world');
    expect(response.thinking).toHaveBeenCalledWith('reasoning');
    expect(response.markdown).toHaveBeenCalledTimes(2);
    expect(response.reportTokenUsage).toHaveBeenCalledWith(12, 4);
  });

  it('parses edit-mode output without streaming raw markdown', async () => {
    const response = createResponse();
    const parseEditResponse = vi.fn();

    const result = await executeChatModelOnly(
      {
        sendChatRequest: async function* () {
          yield { content: '{"operations":[]}', done: true };
        },
        resetNetworkTimeout: vi.fn(),
        parseEditResponse,
        extractToolCallsFromText: vi.fn((text: string) => ({ toolCalls: [], cleanedText: text })),
        stripToolNarration: vi.fn((text: string) => text),
      },
      {
        messages: [{ role: 'user', content: 'edit this' }],
        requestOptions: { format: { type: 'object' } },
        abortSignal: new AbortController().signal,
        response,
        token: createToken(),
        canInvokeTools: false,
        isEditMode: true,
      },
    );

    expect(result.producedContent).toBe(true);
    expect(response.markdown).not.toHaveBeenCalled();
    expect(parseEditResponse).toHaveBeenCalledWith('{"operations":[]}', response);
  });

  it('warns when a model-only turn still returns tool calls', async () => {
    const response = createResponse();

    const result = await executeChatModelOnly(
      {
        sendChatRequest: async function* () {
          yield {
            content: '',
            done: true,
            toolCalls: [{ function: { name: 'search_workspace', arguments: { query: 'x' } } }],
          };
        },
        resetNetworkTimeout: vi.fn(),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn((text: string) => ({ toolCalls: [], cleanedText: text })),
        stripToolNarration: vi.fn((text: string) => text),
      },
      {
        messages: [{ role: 'user', content: 'hello' }],
        requestOptions: {},
        abortSignal: new AbortController().signal,
        response,
        token: createToken(),
        canInvokeTools: true,
        isEditMode: false,
      },
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(response.warning).toHaveBeenCalledWith('Tool calls are not available in this mode.');
  });
});