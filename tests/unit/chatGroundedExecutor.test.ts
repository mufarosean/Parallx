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
    const invokeToolWithRuntimeControl = vi.fn(async () => ({ content: 'tool result' }));

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
        invokeToolWithRuntimeControl,
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
    expect(invokeToolWithRuntimeControl).toHaveBeenCalledWith('search_workspace', { query: 'find it' }, expect.objectContaining({ isCancellationRequested: false }), expect.anything());
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
        invokeToolWithRuntimeControl: vi.fn(async () => ({ content: 'tool result' })),
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

  it('uses runtime-controlled tool invocation and emits approval-aware trace checkpoints', async () => {
    const response = createResponse();
    const runtimeTraceCalls: any[] = [];

    const result = await executeChatGrounded(
      {
        sendChatRequest: vi.fn()
          .mockImplementationOnce(async function* () {
            yield {
              content: '',
              done: true,
              toolCalls: [{ function: { name: 'write_file', arguments: { path: 'notes.md' } } }],
            };
          })
          .mockImplementationOnce(async function* () {
            yield { content: 'Wrote the file.', done: true };
          }),
        invokeToolWithRuntimeControl: vi.fn(async (_name, _args, _token, observer) => {
          const metadata = {
            name: 'write_file',
            permissionLevel: 'requires-approval',
            enabled: true,
            requiresApproval: true,
            autoApproved: false,
            approvalSource: 'default',
            description: 'Write a file',
          } as const;
          observer?.onValidated?.(metadata as any);
          observer?.onApprovalRequested?.(metadata as any);
          observer?.onApprovalResolved?.(metadata as any, true);
          const toolResult = { content: 'tool result' };
          observer?.onExecuted?.(metadata as any, toolResult);
          return toolResult;
        }),
        resetNetworkTimeout: vi.fn(),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn((text: string) => ({ toolCalls: [], cleanedText: text })),
        stripToolNarration: vi.fn((text: string) => text),
        buildExtractiveFallbackAnswer: vi.fn(() => ''),
        reportResponseDebug: vi.fn(),
        reportRuntimeTrace: vi.fn((trace) => runtimeTraceCalls.push(trace)),
      },
      {
        messages: [{ role: 'user', content: 'write it' }] as any,
        requestOptions: { tools: [] },
        abortSignal: new AbortController().signal,
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: true,
        isEditMode: false,
        requestText: 'write it',
        userContent: 'write it',
        retrievedContextText: '',
        evidenceAssessment: { status: 'sufficient', reasons: [] },
        runtimeTraceSeed: {
          route: { kind: 'grounded', reason: 'tool-needed' },
          contextPlan: {
            route: 'grounded',
            intent: 'task',
            useRetrieval: false,
            useMemoryRecall: false,
            useTranscriptRecall: false,
            useConceptRecall: false,
            useCurrentPage: false,
            citationMode: 'disabled',
            reasoning: 'Tool execution required',
            retrievalPlan: { intent: 'task', reasoning: 'Tool execution required', needsRetrieval: false, queries: [] },
          },
          hasActiveSlashCommand: false,
          isRagReady: false,
        },
      },
    );

    expect(result.producedContent).toBe(true);
    expect(runtimeTraceCalls.map((trace) => trace.checkpoint)).toEqual(expect.arrayContaining([
      'tool-validated',
      'approval-requested',
      'approval-resolved',
      'tool-executed',
    ]));
    expect(runtimeTraceCalls.some((trace) => trace.approvalState === 'pending')).toBe(true);
    expect(runtimeTraceCalls.some((trace) => trace.approvalState === 'approved')).toBe(true);
  });
});