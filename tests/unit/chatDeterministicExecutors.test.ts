import { describe, expect, it } from 'vitest';

import {
  buildDirectMemoryRecallAnswer,
  buildDeterministicWorkflowAnswer,
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

  it('builds deterministic folder summaries from exhaustive retrieved context', () => {
    const answer = buildDeterministicWorkflowAnswer(
      'folder-summary',
      'Give me an overview of the notes folder.',
      [
        '[Retrieved Context]',
        '[1] Source: how-to-file.md',
        'Path: notes/how-to-file.md',
        '# how to file a claim — my notes',
        '',
        '[2] Source: random-thoughts.md',
        'Path: notes/random-thoughts.md',
        '# Random Thoughts',
        '## Weekend Plans',
      ].join('\n'),
    );

    expect(answer).toContain('notes/how-to-file.md');
    expect(answer).toContain('notes/random-thoughts.md');
    expect(answer).toContain('not insurance-related');
  });

  it('filters internal artifacts for document-listing summaries', () => {
    const answer = buildDeterministicWorkflowAnswer(
      'folder-summary',
      'What documents do I have in my workspace?',
      [
        '[Retrieved Context]',
        '[1] Source: data.db-shm',
        'Path: .parallx/data.db-shm',
        'binary-ish',
        '[2] Source: ai-config.json',
        'Path: parallx/ai-config.json',
        '{',
        '[3] Source: Claims Guide.md',
        'Path: Claims Guide.md',
        '# Claims Guide',
      ].join('\n'),
    );

    expect(answer).toContain('Claims Guide.md');
    expect(answer).not.toContain('.parallx/data.db-shm');
    expect(answer).not.toContain('parallx/ai-config.json');
  });

  it('builds deterministic comparison answers for duplicate how-to-file documents', () => {
    const answer = buildDeterministicWorkflowAnswer(
      'comparative',
      'Compare the two how-to-file documents.',
      [
        '[Retrieved Context]',
        '[1] Source: how-to-file.md',
        'Path: claims/how-to-file.md',
        '## Step 1: Document the Incident',
        '## Step 2: File a Police Report',
        '## Step 3: Notify Your Insurance Agent',
        '## Step 4: Work with the Adjuster',
        '## Step 5: Submit Final Documentation',
        '[2] Source: how-to-file.md',
        'Path: notes/how-to-file.md',
        '1. call the agent and tell them what happened',
        '2. they assign an adjuster',
        '3. get your car fixed',
      ].join('\n'),
    );

    expect(answer).toContain('claims/how-to-file.md');
    expect(answer).toContain('notes/how-to-file.md');
    expect(answer).toContain('5-step');
    expect(answer).toContain('3-step');
    expect(answer).toContain('official');
    expect(answer).toContain('informal');
  });

  it('builds deterministic deductible extraction answers from exhaustive context', () => {
    const answer = buildDeterministicWorkflowAnswer(
      'exhaustive-extraction',
      'Extract all deductible amounts from every policy document.',
      [
        '[Retrieved Context]',
        '[1] Source: auto-policy-2024.md',
        'Path: policies/auto-policy-2024.md',
        'Collision coverage deductible is **$500** per incident. Comprehensive deductible is **$250**.',
        '[2] Source: auto-policy-2023.md',
        'Path: policies/auto-policy-2023.md',
        'The deductible for this policy period is **$750**. Comprehensive deductible: **$500**.',
      ].join('\n'),
    );

    expect(answer).toContain('policies/auto-policy-2024.md');
    expect(answer).toContain('$500');
    expect(answer).toContain('$250');
    expect(answer).toContain('policies/auto-policy-2023.md');
    expect(answer).toContain('$750');
  });
});