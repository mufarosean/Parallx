import { describe, expect, it, vi } from 'vitest';

import { handleEarlyDeterministicAnswer, handlePreparedContextDeterministicAnswer } from '../../src/built-in/chat/utilities/chatDeterministicResponse';

function createToken(overrides: Partial<{ isCancellationRequested: boolean; isYieldRequested: boolean }> = {}) {
  return {
    isCancellationRequested: false,
    isYieldRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    ...overrides,
  } as any;
}

function createResponse() {
  return {
    markdown: vi.fn(),
    setCitations: vi.fn(),
  } as any;
}

describe('chat deterministic response', () => {
  it('handles early direct answers and reports runtime trace', () => {
    const response = createResponse();
    const reportRuntimeTrace = vi.fn();
    const reportResponseDebug = vi.fn();

    const handled = handleEarlyDeterministicAnswer({
      route: {
        kind: 'product-semantics',
        reason: 'product semantics',
        directAnswer: 'Approve once only applies to the current action.',
      },
      hasActiveSlashCommand: false,
      isRagReady: true,
      sessionId: 'session-1',
      response,
      token: createToken(),
      reportRuntimeTrace,
      reportResponseDebug,
    });

    expect(handled).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith('Approve once only applies to the current action.');
    expect(reportRuntimeTrace).toHaveBeenCalledOnce();
    expect(reportResponseDebug).toHaveBeenCalledWith({
      phase: 'product-semantics-direct-answer',
      markdownLength: 'Approve once only applies to the current action.'.length,
      yielded: false,
      cancelled: false,
      retrievedContextLength: 0,
    });
  });

  it('handles unsupported specific coverage answers and sets citations', () => {
    const response = createResponse();
    const reportResponseDebug = vi.fn();

    const handled = handlePreparedContextDeterministicAnswer({
      route: { kind: 'grounded', reason: 'grounded route' },
      query: 'What does my policy say about earthquake coverage?',
      evidenceAssessment: {
        status: 'insufficient',
        reasons: ['specific-coverage-not-explicitly-supported'],
      },
      retrievedContextText: '[Retrieved Context]\nPolicy excerpt',
      memoryResult: null,
      ragSources: [{ uri: 'Policy.md', label: 'Policy.md', index: 4 }],
      response,
      token: createToken(),
      reportResponseDebug,
    });

    expect(handled).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('could not find earthquake'));
    expect(response.setCitations).toHaveBeenCalledWith([
      { index: 4, uri: 'Policy.md', label: 'Policy.md' },
    ]);
    expect(reportResponseDebug).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'unsupported-specific-coverage-direct-answer',
    }));
  });

  it('handles memory recall deterministic answers', () => {
    const response = createResponse();
    const reportResponseDebug = vi.fn();

    const handled = handlePreparedContextDeterministicAnswer({
      route: { kind: 'memory-recall', reason: 'memory recall route' },
      query: 'what do you remember',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: '',
      memoryResult: '[Conversation Memory]\nYou asked about deductible changes.',
      ragSources: [],
      response,
      token: createToken(),
      reportResponseDebug,
    });

    expect(handled).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith('From our previous conversation, I remember: You asked about deductible changes.');
    expect(response.setCitations).not.toHaveBeenCalled();
    expect(reportResponseDebug).toHaveBeenCalledWith({
      phase: 'memory-recall-direct-answer',
      markdownLength: 'From our previous conversation, I remember: You asked about deductible changes.'.length,
      yielded: false,
      cancelled: false,
      retrievedContextLength: 0,
    });
  });
});