import { describe, expect, it } from 'vitest';

import {
  buildDirectMemoryRecallAnswer,
  buildUnsupportedSpecificCoverageAnswer,
} from '../../src/built-in/chat/utilities/chatDeterministicExecutors';

describe('chat deterministic executors', () => {
  it('builds a direct memory recall answer from stored memory context', () => {
    const answer = buildDirectMemoryRecallAnswer([
      '[Conversation Memory]',
      '---',
      'Previous session (2026-03-01)',
      'You preferred concise answers and asked about deductible changes.',
    ].join('\n'));

    expect(answer).toBe('From our previous conversation, I remember: You preferred concise answers and asked about deductible changes.');
  });

  it('returns undefined when memory context has no usable content', () => {
    const answer = buildDirectMemoryRecallAnswer('[Conversation Memory]\n---\nPrevious session (2026-03-01)');

    expect(answer).toBeUndefined();
  });

  it('builds an unsupported specific coverage answer when evidence is insufficient', () => {
    const answer = buildUnsupportedSpecificCoverageAnswer(
      'What does my policy say about earthquake coverage?',
      { status: 'insufficient', reasons: ['specific-coverage-not-explicitly-supported'] },
    );

    expect(answer).toContain('could not find earthquake');
    expect(answer).toContain('do not explicitly name that specific coverage');
  });

  it('returns undefined when the evidence does not indicate a missing specific coverage', () => {
    const answer = buildUnsupportedSpecificCoverageAnswer(
      'What does my policy say about collision coverage?',
      { status: 'sufficient', reasons: [] },
    );

    expect(answer).toBeUndefined();
  });
});