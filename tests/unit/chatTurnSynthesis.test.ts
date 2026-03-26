import { describe, expect, it, vi } from 'vitest';

import { executePreparedChatTurn } from '../../src/built-in/chat/utilities/chatTurnSynthesis';

function createToken(overrides: Partial<{ isCancellationRequested: boolean; isYieldRequested: boolean }> = {}) {
  return {
    isCancellationRequested: false,
    isYieldRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    ...overrides,
  } as any;
}

function createResponse(markdownText = '') {
  let markdown = markdownText;
  return {
    markdown: vi.fn((content: string) => {
      markdown += content;
    }),
    thinking: vi.fn(),
    warning: vi.fn(),
    setCitations: vi.fn(),
    getMarkdownText: vi.fn(() => markdown),
  } as any;
}

describe('chat turn synthesis', () => {
  it('runs the model-only path, queues memory write-back, and validates the response', async () => {
    const response = createResponse('final answer');
    const executeModelOnly = vi.fn().mockResolvedValue({ producedContent: true });
    const executeGrounded = vi.fn();
    const queueMemoryWriteBack = vi.fn();
    const validateAndFinalizeResponse = vi.fn();
    const reportRuntimeTrace = vi.fn();

    const result = await executePreparedChatTurn(
      {
        sendChatRequest: vi.fn() as any,
        buildExtractiveFallbackAnswer: vi.fn(() => ''),
        buildMissingCitationFooter: vi.fn(() => ''),
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
        repairMarkdown: vi.fn((markdown: string) => markdown),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn(() => ({ toolCalls: [], cleanedText: '' })),
        stripToolNarration: vi.fn((text: string) => text),
        categorizeError: vi.fn(() => ({ message: 'boom' })),
        reportRuntimeTrace,
        executeModelOnly: executeModelOnly as any,
        executeGrounded: executeGrounded as any,
        queueMemoryWriteBack: queueMemoryWriteBack as any,
        validateAndFinalizeResponse: validateAndFinalizeResponse as any,
      },
      {
        messages: [{ role: 'user', content: 'hello' } as any],
        requestOptions: { tools: undefined },
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: false,
        isEditMode: false,
        useModelOnlyExecution: true,
        requestText: 'hello',
        userContent: 'hello',
        retrievedContextText: 'retrieved',
        evidenceAssessment: { status: 'sufficient', reasons: [] },
        isConversationalTurn: false,
        citationMode: 'required',
        ragSources: [{ uri: 'Policy.md', label: 'Policy.md', index: 1 }],
        retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: true, queries: ['policy deductible'] },
        memoryEnabled: true,
        sessionId: 'session-1',
        history: [],
        networkTimeoutMs: 50,
        runtimeTraceSeed: {
          route: { kind: 'grounded', reason: 'retrieval' },
          contextPlan: {
            route: 'grounded',
            intent: 'question',
            useRetrieval: true,
            useMemoryRecall: false,
            useTranscriptRecall: false,
            useConceptRecall: false,
            useCurrentPage: false,
            citationMode: 'required',
            reasoning: 'Need evidence.',
            retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: true, queries: ['policy deductible'] },
          },
          hasActiveSlashCommand: false,
          isRagReady: true,
        },
      },
    );

    expect(result).toEqual({});
    expect(executeModelOnly).toHaveBeenCalledOnce();
    expect(executeGrounded).not.toHaveBeenCalled();
    expect(queueMemoryWriteBack).toHaveBeenCalledWith(
      expect.objectContaining({
        buildDeterministicSessionSummary: expect.any(Function),
      }),
      expect.objectContaining({
        memoryEnabled: true,
        requestText: 'hello',
        sessionId: 'session-1',
      }),
    );
    expect(validateAndFinalizeResponse.mock.invocationCallOrder[0]).toBeLessThan(queueMemoryWriteBack.mock.invocationCallOrder[0]);
    expect(response.thinking).toHaveBeenCalledWith(
      'Intent: question\nAnalysis: Need evidence.\nSearched for:\n• policy deductible',
    );
    expect(validateAndFinalizeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        applyFallbackAnswer: expect.any(Function),
        repairMarkdown: expect.any(Function),
      }),
      expect.objectContaining({
        citationMode: 'required',
        ragSources: [{ uri: 'Policy.md', label: 'Policy.md', index: 1 }],
      }),
    );
    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'post-finalization',
      runState: 'completed',
    }));
  });

  it('applies a visible fallback on aborts without user cancellation', async () => {
    const response = createResponse('');

    const result = await executePreparedChatTurn(
      {
        sendChatRequest: vi.fn() as any,
        buildExtractiveFallbackAnswer: vi.fn(() => 'Relevant details from retrieved context'),
        buildMissingCitationFooter: vi.fn(() => '\n\nSources: [1] Policy.md'),
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
        repairMarkdown: vi.fn((markdown: string) => markdown),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn(() => ({ toolCalls: [], cleanedText: '' })),
        stripToolNarration: vi.fn((text: string) => text),
        categorizeError: vi.fn(() => ({ message: 'boom' })),
        executeModelOnly: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as any,
        queueMemoryWriteBack: vi.fn() as any,
        validateAndFinalizeResponse: vi.fn() as any,
      },
      {
        messages: [{ role: 'user', content: 'hello' } as any],
        requestOptions: { tools: undefined },
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: false,
        isEditMode: false,
        useModelOnlyExecution: true,
        requestText: 'hello',
        userContent: 'hello',
        retrievedContextText: 'retrieved',
        evidenceAssessment: { status: 'weak', reasons: [] },
        isConversationalTurn: false,
        citationMode: 'required',
        ragSources: [{ uri: 'Policy.md', label: 'Policy.md', index: 1 }],
        retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: false, queries: [] },
        memoryEnabled: true,
        sessionId: 'session-1',
        history: [],
        networkTimeoutMs: 50,
      },
    );

    expect(result).toEqual({});
    expect(response.markdown).toHaveBeenCalledWith('Relevant details from retrieved context');
    expect(response.markdown).toHaveBeenCalledWith('\n\nSources: [1] Policy.md');
    expect(response.setCitations).toHaveBeenCalledWith([
      { index: 1, uri: 'Policy.md', label: 'Policy.md' },
    ]);
  });

  it('returns error details for non-abort failures', async () => {
    const response = createResponse('');

    const result = await executePreparedChatTurn(
      {
        sendChatRequest: vi.fn() as any,
        buildExtractiveFallbackAnswer: vi.fn(() => ''),
        buildMissingCitationFooter: vi.fn(() => ''),
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
        repairMarkdown: vi.fn((markdown: string) => markdown),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn(() => ({ toolCalls: [], cleanedText: '' })),
        stripToolNarration: vi.fn((text: string) => text),
        categorizeError: vi.fn(() => ({ message: 'Friendly failure' })),
        executeModelOnly: vi.fn().mockRejectedValue(new Error('boom')) as any,
        queueMemoryWriteBack: vi.fn() as any,
        validateAndFinalizeResponse: vi.fn() as any,
      },
      {
        messages: [{ role: 'user', content: 'hello' } as any],
        requestOptions: { tools: undefined },
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: false,
        isEditMode: false,
        useModelOnlyExecution: true,
        requestText: 'hello',
        userContent: 'hello',
        retrievedContextText: 'retrieved',
        evidenceAssessment: { status: 'weak', reasons: [] },
        isConversationalTurn: false,
        citationMode: 'disabled',
        ragSources: [],
        retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: false, queries: [] },
        memoryEnabled: true,
        sessionId: 'session-1',
        history: [],
        networkTimeoutMs: 50,
      },
    );

    expect(result).toEqual({
      errorDetails: {
        message: 'Friendly failure',
        responseIsIncomplete: true,
      },
    });
  });

  it('retries transient errors up to 3 times then succeeds', async () => {
    vi.useFakeTimers();
    const response = createResponse('');
    (response as any).progress = vi.fn();

    const executeModelOnly = vi.fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:11434'))
      .mockResolvedValueOnce({ producedContent: true });

    const validateAndFinalizeResponse = vi.fn();

    const promise = executePreparedChatTurn(
      {
        sendChatRequest: vi.fn() as any,
        buildExtractiveFallbackAnswer: vi.fn(() => ''),
        buildMissingCitationFooter: vi.fn(() => ''),
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
        repairMarkdown: vi.fn((markdown: string) => markdown),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn(() => ({ toolCalls: [], cleanedText: '' })),
        stripToolNarration: vi.fn((text: string) => text),
        categorizeError: vi.fn(() => ({ message: 'Connection refused' })),
        executeModelOnly: executeModelOnly as any,
        queueMemoryWriteBack: vi.fn() as any,
        validateAndFinalizeResponse: validateAndFinalizeResponse as any,
      },
      {
        messages: [{ role: 'user', content: 'hello' } as any],
        requestOptions: { tools: undefined },
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: false,
        isEditMode: false,
        useModelOnlyExecution: true,
        requestText: 'hello',
        userContent: 'hello',
        retrievedContextText: 'retrieved',
        evidenceAssessment: { status: 'weak', reasons: [] },
        isConversationalTurn: false,
        citationMode: 'disabled',
        ragSources: [],
        retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: false, queries: [] },
        memoryEnabled: true,
        sessionId: 'session-1',
        history: [],
        networkTimeoutMs: 60_000,
      },
    );

    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;
    vi.useRealTimers();

    expect(result).toEqual({});
    expect(executeModelOnly).toHaveBeenCalledTimes(2);
    expect(response.progress).toHaveBeenCalledWith(expect.stringContaining('Connection issue detected'));
    expect(validateAndFinalizeResponse).toHaveBeenCalled();
  });

  it('gives up after exhausting transient retries', async () => {
    vi.useFakeTimers();
    const response = createResponse('');
    (response as any).progress = vi.fn();

    const transientError = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    const executeModelOnly = vi.fn().mockRejectedValue(transientError);

    const promise = executePreparedChatTurn(
      {
        sendChatRequest: vi.fn() as any,
        buildExtractiveFallbackAnswer: vi.fn(() => ''),
        buildMissingCitationFooter: vi.fn(() => ''),
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
        repairMarkdown: vi.fn((markdown: string) => markdown),
        parseEditResponse: vi.fn(),
        extractToolCallsFromText: vi.fn(() => ({ toolCalls: [], cleanedText: '' })),
        stripToolNarration: vi.fn((text: string) => text),
        categorizeError: vi.fn(() => ({ message: 'Connection refused' })),
        executeModelOnly: executeModelOnly as any,
        queueMemoryWriteBack: vi.fn() as any,
        validateAndFinalizeResponse: vi.fn() as any,
      },
      {
        messages: [{ role: 'user', content: 'hello' } as any],
        requestOptions: { tools: undefined },
        response,
        token: createToken(),
        maxIterations: 2,
        canInvokeTools: false,
        isEditMode: false,
        useModelOnlyExecution: true,
        requestText: 'hello',
        userContent: 'hello',
        retrievedContextText: 'retrieved',
        evidenceAssessment: { status: 'weak', reasons: [] },
        isConversationalTurn: false,
        citationMode: 'disabled',
        ragSources: [],
        retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: false, queries: [] },
        memoryEnabled: true,
        sessionId: 'session-1',
        history: [],
        networkTimeoutMs: 60_000,
      },
    );

    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(2500);
    const result = await promise;
    vi.useRealTimers();

    // 1 initial + 3 retries = 4 total calls
    expect(executeModelOnly).toHaveBeenCalledTimes(4);
    expect(response.progress).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      errorDetails: {
        message: 'Connection refused',
        responseIsIncomplete: true,
      },
    });
  });
});