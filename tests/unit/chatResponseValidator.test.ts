import { describe, expect, it, vi } from 'vitest';

import { validateAndFinalizeChatResponse } from '../../src/built-in/chat/utilities/chatResponseValidator';

function createResponse(markdown: string) {
  const parts = [{ kind: 'markdown', content: markdown }];
  const appended: string[] = [];
  return {
    _response: { parts },
    markdown: vi.fn((content: string) => appended.push(content)),
    setCitations: vi.fn(),
    getMarkdownText: vi.fn(() => {
      const base = parts
        .filter((part) => part.kind === 'markdown')
        .map((part) => part.content)
        .join('');
      return base + appended.join('');
    }),
  } as any;
}

function createToken(overrides: Partial<{ isCancellationRequested: boolean; isYieldRequested: boolean }> = {}) {
  return {
    isCancellationRequested: false,
    isYieldRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
    ...overrides,
  } as any;
}

describe('chat response validator', () => {
  it('repairs markdown, remaps citations, and appends a citation footer', () => {
    const response = createResponse('Answer [1] then [2].');
    const reportResponseDebug = vi.fn();

    validateAndFinalizeChatResponse(
      {
        repairMarkdown: (markdown) => markdown.replace('Answer', 'Repaired answer'),
        buildMissingCitationFooter: () => '\n\nSources:\n[3] Policy.md\n[5] Claims.md',
        applyFallbackAnswer: vi.fn(),
        reportResponseDebug,
      },
      {
        response,
        token: createToken(),
        isEditMode: false,
        isConversational: false,
        citationMode: 'required',
        ragSources: [
          { uri: 'Policy.md', label: 'Policy.md', index: 3 },
          { uri: 'Claims.md', label: 'Claims.md', index: 5 },
        ],
        retrievedContextLength: 120,
      },
    );

    expect(response._response.parts[0].content).toBe('Repaired answer [3] then [5].');
    expect(response.markdown).toHaveBeenCalledWith('\n\nSources:\n[3] Policy.md\n[5] Claims.md');
    expect(response.setCitations).toHaveBeenCalledWith([
      { index: 3, uri: 'Policy.md', label: 'Policy.md' },
      { index: 5, uri: 'Claims.md', label: 'Claims.md' },
    ]);
    expect(reportResponseDebug).toHaveBeenCalledWith({
      phase: 'final-no-fallback-needed',
      markdownLength: response.getMarkdownText().trim().length,
      yielded: false,
      cancelled: false,
      retrievedContextLength: 120,
    });
  });

  it('applies the final fallback when no markdown remains', () => {
    const response = createResponse('');
    const applyFallbackAnswer = vi.fn();

    validateAndFinalizeChatResponse(
      {
        repairMarkdown: (markdown) => markdown,
        buildMissingCitationFooter: () => '',
        applyFallbackAnswer,
      },
      {
        response,
        token: createToken(),
        isEditMode: false,
        isConversational: false,
        citationMode: 'none',
        ragSources: [],
        retrievedContextLength: 0,
      },
    );

    expect(applyFallbackAnswer).toHaveBeenCalledWith('final', 'extractive');
  });
});