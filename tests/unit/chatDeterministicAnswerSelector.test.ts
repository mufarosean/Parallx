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
});