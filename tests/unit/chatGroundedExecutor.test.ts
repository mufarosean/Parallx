import { describe, expect, it, vi } from 'vitest';

import { executeChatGrounded } from '../../src/built-in/chat/utilities/chatGroundedExecutor';

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

describe('chat grounded executor', () => {
  it('executes tool calls and appends tool results to the conversation', async () => {
    const response = createResponse();
    const messages = [{ role: 'user', content: 'find it' }] as any[];
    const invokeTool = vi.fn(async () => ({ content: 'tool result' }));

    const result = await executeChatGrounded(
      {
        sendChatRequest: vi.fn()
          .mockImplementationOnce(async function* () {
            yield {
              content: '',
              done: true,
              toolCalls: [{ function: { name: 'search_workspace', arguments: { query: 'find it' } } }],
            };
          })
          .mockImplementationOnce(async function* () {
            yield { content: 'Final answer', done: true };
          }),
        invokeTool,
        resetNetworkTimeout: vi.fn(),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn((text: string) => ({ toolCalls: [], cleanedText: text })),
        stripToolNarration: vi.fn((text: string) => text),
        buildExtractiveFallbackAnswer: vi.fn(() => ''),
        reportResponseDebug: vi.fn(),
      },
      {
        messages,
        requestOptions: { tools: [] },
        abortSignal: new AbortController().signal,
        response,
        token: createToken(),
        maxIterations: 3,
        canInvokeTools: true,
        isEditMode: false,
        requestText: 'find it',
        userContent: 'find it',
        retrievedContextText: '',
        evidenceAssessment: { status: 'sufficient', reasons: [] },
      },
    );

    expect(result.producedContent).toBe(true);
    expect(invokeTool).toHaveBeenCalledWith('search_workspace', { query: 'find it' }, expect.any(Object));
    expect(messages.some((message) => message.role === 'tool' && message.content === 'tool result')).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith('Final answer');
  });

  it('falls back to extractive grounded output when the loop never produces markdown', async () => {
    const response = createResponse();

    const result = await executeChatGrounded(
      {
        sendChatRequest: vi.fn()
          .mockImplementationOnce(async function* () {
            yield {
              content: '',
              done: true,
              toolCalls: [{ function: { name: 'search_workspace', arguments: { query: 'policy' } } }],
            };
          })
          .mockImplementationOnce(async function* () {
            yield { content: '', done: true };
          })
          .mockImplementationOnce(async function* () {
            yield { content: '', done: true };
          }),
        invokeTool: vi.fn(async () => ({ content: 'tool result' })),
        resetNetworkTimeout: vi.fn(),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn((text: string) => ({ toolCalls: [], cleanedText: text })),
        stripToolNarration: vi.fn((text: string) => text),
        buildExtractiveFallbackAnswer: vi.fn(() => 'Relevant details from retrieved context'),
        reportResponseDebug: vi.fn(),
      },
      {
        messages: [{ role: 'user', content: 'policy' }] as any,
        requestOptions: { tools: [] },
        abortSignal: new AbortController().signal,
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: true,
        isEditMode: false,
        requestText: 'policy',
        userContent: 'policy',
        retrievedContextText: '[Retrieved Context]\nPolicy details',
        evidenceAssessment: { status: 'insufficient', reasons: ['thin-evidence'] },
      },
    );

    expect(result.producedContent).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith('Relevant details from retrieved context');
  });
});