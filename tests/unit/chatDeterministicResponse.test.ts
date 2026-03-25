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

  it('does not attach all retrieval candidates when a deterministic answer lacks attributable references', () => {
    const response = createResponse();

    const handled = handlePreparedContextDeterministicAnswer({
      route: { kind: 'grounded', reason: 'grounded route' },
      query: 'What does my policy say about earthquake coverage?',
      evidenceAssessment: {
        status: 'insufficient',
        reasons: ['specific-coverage-not-explicitly-supported'],
      },
      retrievedContextText: '[Retrieved Context]\nPolicy excerpt',
      memoryResult: null,
      ragSources: [
        { uri: 'Policy.md', label: 'Policy.md', index: 4 },
        { uri: 'Claims.md', label: 'Claims.md', index: 5 },
      ],
      response,
      token: createToken(),
    });

    expect(handled).toBe(true);
    expect(response.setCitations).not.toHaveBeenCalled();
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

  it('handles unsupported workspace-topic answers and preserves attributable citations', () => {
    const response = createResponse();
    const reportResponseDebug = vi.fn();

    const handled = handlePreparedContextDeterministicAnswer({
      route: { kind: 'grounded', reason: 'grounded route' },
      query: 'In the RF Guides folder, which paper is about baking chocolate chip cookies? If none, say that none of the RF Guides papers appear to be about that.',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: '[Retrieved Context]\n---\n[1] Source: [Source: "RF Guides/Clark.pdf"]\nPath: RF Guides/Clark.pdf\nClark discusses reserve variability.\n---',
      memoryResult: null,
      ragSources: [{ uri: 'RF Guides/Clark.pdf', label: 'Clark.pdf', index: 1 }],
      response,
      token: createToken(),
      reportResponseDebug,
    });

    expect(handled).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith('None of the Rf Guides papers appear to be about that. [1]');
    expect(response.setCitations).toHaveBeenCalledWith([
      { index: 1, uri: 'RF Guides/Clark.pdf', label: 'Clark.pdf' },
    ]);
    expect(reportResponseDebug).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'unsupported-workspace-topic-direct-answer',
    }));
  });

  it('does not short-circuit summary-like grounded requests at the prepared-context seam', () => {
    const response = createResponse();

    const handled = handlePreparedContextDeterministicAnswer({
      route: {
        kind: 'grounded',
        reason: 'misclassified route',
        workflowType: 'exhaustive-extraction',
      },
      query: 'Give me a bulleted list with a short summary of each file in the RF Guides folder.',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: [
        '[Retrieved Context]',
        '[1] Source: Auto Insurance Policy.md',
        'Path: RF Guides/Auto Insurance Policy.md',
        'Collision deductible is **$500**. Comprehensive deductible is **$250**.',
      ].join('\n'),
      memoryResult: null,
      ragSources: [{ uri: 'RF Guides/Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
      response,
      token: createToken(),
    });

    expect(handled).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
    expect(response.setCitations).not.toHaveBeenCalled();
  });

  it('does not short-circuit explicit extraction requests at the prepared-context seam anymore', () => {
    const response = createResponse();

    const handled = handlePreparedContextDeterministicAnswer({
      route: {
        kind: 'grounded',
        reason: 'explicit extraction route',
      },
      query: 'List every deductible amount from all policy documents.',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: [
        '[Retrieved Context]',
        '[1] Source: Auto Insurance Policy.md',
        'Path: RF Guides/Auto Insurance Policy.md',
        'Collision deductible is **$500**. Comprehensive deductible is **$250**.',
      ].join('\n'),
      memoryResult: null,
      ragSources: [{ uri: 'RF Guides/Auto Insurance Policy.md', label: 'Auto Insurance Policy.md', index: 1 }],
      response,
      token: createToken(),
    });

    expect(handled).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
    expect(response.setCitations).not.toHaveBeenCalled();
  });

  it('does not short-circuit folder-summary turns at the prepared-context seam', () => {
    const response = createResponse();

    const handled = handlePreparedContextDeterministicAnswer({
      route: {
        kind: 'grounded',
        reason: 'folder summary route',
        workflowType: 'folder-summary',
      },
      query: 'What documents do I have in my workspace?',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: [
        '[Retrieved Context]',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '# Claims Guide',
      ].join('\n'),
      memoryResult: null,
      ragSources: [{ uri: 'Claims Guide.md', label: 'Claims Guide.md', index: 1 }],
      response,
      token: createToken(),
    });

    expect(handled).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
    expect(response.setCitations).not.toHaveBeenCalled();
  });

  it('does not short-circuit comparative turns at the prepared-context seam', () => {
    const response = createResponse();

    const handled = handlePreparedContextDeterministicAnswer({
      route: {
        kind: 'grounded',
        reason: 'comparative route',
        workflowType: 'comparative',
      },
      query: 'Compare Claims Guide.md and Accident Quick Reference.md',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: [
        '[Retrieved Context]',
        '[1] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        'Claims guide content',
        '[2] Source: Accident Quick Reference.md',
        'Path: Accident Quick Reference.md',
        'Accident quick reference content',
      ].join('\n'),
      memoryResult: null,
      ragSources: [
        { uri: 'Claims Guide.md', label: 'Claims Guide.md', index: 1 },
        { uri: 'Accident Quick Reference.md', label: 'Accident Quick Reference.md', index: 2 },
      ],
      response,
      token: createToken(),
    });

    expect(handled).toBe(false);
    expect(response.markdown).not.toHaveBeenCalled();
    expect(response.setCitations).not.toHaveBeenCalled();
  });
});