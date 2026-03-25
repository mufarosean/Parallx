import { describe, expect, it } from 'vitest';

import { selectDeterministicAnswer } from '../../src/built-in/chat/utilities/chatDeterministicAnswerSelector';

describe('chat deterministic answer selector', () => {
  it('selects route-level direct answers first', () => {
    const answer = selectDeterministicAnswer({
      route: {
        kind: 'product-semantics',
        reason: 'matched product semantics',
        directAnswer: 'Approve once allows only the current action to run.',
      },
    });

    expect(answer).toEqual({
      markdown: 'Approve once allows only the current action to run.',
      phase: 'product-semantics-direct-answer',
      retrievedContextLength: 0,
    });
  });

  it('selects unsupported specific coverage after evidence assessment', () => {
    const answer = selectDeterministicAnswer({
      route: { kind: 'grounded', reason: 'grounded route' },
      query: 'What does my policy say about earthquake coverage?',
      evidenceAssessment: {
        status: 'insufficient',
        reasons: ['specific-coverage-not-explicitly-supported'],
      },
      retrievedContextText: '[Retrieved Context]\nPolicy excerpt',
    });

    expect(answer?.phase).toBe('unsupported-specific-coverage-direct-answer');
    expect(answer?.markdown).toContain('could not find earthquake');
    expect(answer?.retrievedContextLength).toBeGreaterThan(0);
  });

  it('selects unsupported workspace-topic answers for off-topic folder-paper queries', () => {
    const answer = selectDeterministicAnswer({
      route: { kind: 'grounded', reason: 'grounded route' },
      query: 'In the RF Guides folder, which paper is about baking chocolate chip cookies? If none, say that none of the RF Guides papers appear to be about that.',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      retrievedContextText: '[Retrieved Context]\n---\n[1] Source: [Source: "RF Guides/Clark.pdf"]\nPath: RF Guides/Clark.pdf\nClark discusses reserve variability.\n---',
    });

    expect(answer?.phase).toBe('unsupported-workspace-topic-direct-answer');
    expect(answer?.markdown).toBe('None of the Rf Guides papers appear to be about that. [1]');
  });

  it('selects a direct memory answer for memory-recall routes', () => {
    const answer = selectDeterministicAnswer({
      route: { kind: 'memory-recall', reason: 'memory recall route' },
      memoryContext: '[Conversation Memory]\nYou asked about deductible changes.',
    });

    expect(answer).toEqual({
      markdown: 'From our previous conversation, I remember: You asked about deductible changes.',
      phase: 'memory-recall-direct-answer',
      retrievedContextLength: 0,
    });
  });

  it('returns undefined when no deterministic answer applies', () => {
    const answer = selectDeterministicAnswer({
      route: { kind: 'grounded', reason: 'grounded route' },
      query: 'What does my policy say about collision coverage?',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
    });

    expect(answer).toBeUndefined();
  });

  it('does not short-circuit summary-like grounded requests based on workflow label alone', () => {
    const answer = selectDeterministicAnswer({
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
    });

    expect(answer).toBeUndefined();
  });

  it('does not short-circuit explicit extraction asks through deterministic workflow answers anymore', () => {
    const answer = selectDeterministicAnswer({
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
    });

    expect(answer).toBeUndefined();
  });

  it('does not short-circuit folder-summary turns through deterministic workflow answers', () => {
    const answer = selectDeterministicAnswer({
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
    });

    expect(answer).toBeUndefined();
  });

  it('does not short-circuit comparative turns through deterministic workflow answers', () => {
    const answer = selectDeterministicAnswer({
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
    });

    expect(answer).toBeUndefined();
  });
});