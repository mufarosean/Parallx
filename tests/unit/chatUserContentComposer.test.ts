import { describe, expect, it, vi } from 'vitest';

import { composeChatUserContent } from '../../src/built-in/chat/utilities/chatUserContentComposer';

describe('chat user content composer', () => {
  it('applies slash-command templates when a non-special command is active', () => {
    const applyCommandTemplate = vi.fn().mockReturnValue('templated prompt');

    const result = composeChatUserContent(
      {
        applyCommandTemplate,
        buildEvidenceResponseConstraint: vi.fn(),
      },
      {
        slashResult: {
          command: { name: 'review', description: 'review', promptTemplate: 'x', isBuiltIn: true },
          commandName: 'review',
          remainingText: 'check this',
        },
        effectiveText: 'check this',
        userText: 'check this',
        contextParts: ['context A'],
        retrievalPlan: { intent: 'question', reasoning: 'test', needsRetrieval: true, queries: [] },
        evidenceAssessment: { status: 'sufficient', reasons: [] },
      },
    );

    expect(result).toBe('templated prompt');
    expect(applyCommandTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'review' }),
      'check this',
      'context A',
    );
  });

  it('builds retrieval-analysis guided content for grounded turns', () => {
    const result = composeChatUserContent(
      {
        applyCommandTemplate: vi.fn(),
        buildEvidenceResponseConstraint: () => 'Response Constraint: stay grounded.',
      },
      {
        slashResult: { command: undefined, commandName: undefined, remainingText: 'what is covered' },
        effectiveText: 'what is covered',
        userText: 'what is covered',
        contextParts: ['Retrieved chunk', 'Attachment text'],
        retrievalPlan: { intent: 'question', reasoning: 'Need policy evidence.', needsRetrieval: true, queries: [] },
        evidenceAssessment: { status: 'weak', reasons: ['thin-evidence-set'] },
      },
    );

    expect(result).toContain('[Retrieval Analysis]');
    expect(result).toContain('Intent: question');
    expect(result).toContain('Analysis: Need policy evidence.');
    expect(result).toContain('Evidence: weak');
    expect(result).toContain('Evidence Notes: thin-evidence-set');
    expect(result).toContain('Response Constraint: stay grounded.');
    expect(result).toContain('[User Request]\nwhat is covered');
    expect(result).toContain('[Supporting Context]\nRetrieved chunk\n\nAttachment text');
  });

  it('omits retrieval analysis when retrieval is not needed', () => {
    const result = composeChatUserContent(
      {
        applyCommandTemplate: vi.fn(),
        buildEvidenceResponseConstraint: vi.fn(() => 'unused'),
      },
      {
        slashResult: { command: undefined, commandName: undefined, remainingText: 'hello' },
        effectiveText: 'hello',
        userText: 'hello',
        contextParts: ['Current page'],
        retrievalPlan: { intent: 'conversational', reasoning: 'No retrieval.', needsRetrieval: false, queries: [] },
        evidenceAssessment: { status: 'sufficient', reasons: [] },
      },
    );

    expect(result).not.toContain('[Retrieval Analysis]');
    expect(result).toBe('[User Request]\nhello\n\n[Supporting Context]\nCurrent page');
  });
});