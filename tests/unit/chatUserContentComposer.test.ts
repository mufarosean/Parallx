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
        retrievalPlan: { intent: 'question', reasoning: 'Need policy evidence.', needsRetrieval: true, queries: [], coverageMode: 'representative' },
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
        retrievalPlan: { intent: 'conversational', reasoning: 'No retrieval.', needsRetrieval: false, queries: [], coverageMode: 'representative' },
        evidenceAssessment: { status: 'sufficient', reasons: [] },
      },
    );

    expect(result).not.toContain('[Retrieval Analysis]');
    expect(result).toBe('[User Request]\nhello\n\n[Supporting Context]\nCurrent page');
  });

  it('adds an explicit coverage contract for exhaustive review requests', () => {
    const result = composeChatUserContent(
      {
        applyCommandTemplate: vi.fn(),
        buildEvidenceResponseConstraint: () => 'Response Constraint: stay grounded.',
      },
      {
        slashResult: { command: undefined, commandName: undefined, remainingText: 'summarize each file' },
        effectiveText: 'summarize each file',
        userText: 'summarize each file in the folder',
        contextParts: ['Retrieved chunk'],
        retrievalPlan: { intent: 'exploration', reasoning: 'Need exhaustive file coverage.', needsRetrieval: true, queries: [], coverageMode: 'exhaustive' },
        evidenceAssessment: { status: 'sufficient', reasons: [] },
      },
    );

    expect(result).toContain('Coverage Mode: exhaustive');
    expect(result).toContain('Representative semantic retrieval is not enough.');
    expect(result).toContain('Use available read-only tools to enumerate and read the relevant files before answering.');
    expect(result).toContain('Do not invent summaries for files you have not actually read.');
  });
});