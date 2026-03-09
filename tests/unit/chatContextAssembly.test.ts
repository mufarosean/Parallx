import { describe, expect, it, vi } from 'vitest';

import { assembleChatContext } from '../../src/built-in/chat/utilities/chatContextAssembly';

describe('chat context assembly', () => {
  it('assembles context, reports pills, and filters excluded sources', async () => {
    const addReference = vi.fn();
    const reportContextPills = vi.fn();

    const result = await assembleChatContext(
      {
        addReference,
        reportContextPills,
        getExcludedContextIds: () => new Set(['Claims Guide.md']),
        assessEvidenceSufficiency: () => ({ status: 'sufficient', reasons: [] }),
        buildRetrieveAgainQuery: () => '',
      },
      {
        userText: 'What are the filing deadlines?',
        messages: [{ role: 'system', content: 'system prompt text' } as any],
        attachments: [{ name: 'notes.txt', fullPath: 'C:/notes.txt' } as any],
        mentionPills: [{ id: 'rule:claims', label: 'Claims rule', type: 'rule', tokens: 12, removable: true }],
        useRetrieval: true,
        maxMemoryContextChars: 20,
        maxConceptContextChars: 18,
        pageResult: { title: 'Claims', pageId: 'p1', textContent: 'Page context' },
        ragResult: {
          text: '[Retrieved Context]\n[1] Source: Claims Guide.md\nPath: Claims Guide.md\nDeadline within 72 hours',
          sources: [{ uri: 'Claims Guide.md', label: 'Claims Guide.md', index: 1 }],
        },
        memoryResult: 'Remembered conversation details that are definitely longer than the limit',
        conceptResult: 'Concept context that also exceeds the limit',
        attachmentResults: [{ name: 'notes.txt', content: 'attachment body' }],
      },
    );

    expect(addReference).toHaveBeenCalledWith('Claims Guide.md', 'Claims Guide.md', 1);
    expect(reportContextPills).toHaveBeenCalledTimes(1);
    expect(result.contextParts.some((part) => part.includes('Claims Guide.md'))).toBe(false);
    expect(result.contextParts.some((part) => part.includes('Page context'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('[…memory truncated]'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('[…concepts truncated]'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('attachment body'))).toBe(true);
    expect(result.pills.map((pill) => pill.label)).toEqual([
      'System prompt',
      'Claims Guide.md',
      'notes.txt',
      'Claims rule',
    ]);
  });

  it('runs a retrieve-again pass when initial evidence is insufficient', async () => {
    const retrieveContext = vi.fn(async () => ({
      text: '[Retrieved Context]\n[2] Source: Policy.md\nPath: Policy.md\nCollision deductible is $500',
      sources: [{ uri: 'Policy.md', label: 'Policy.md', index: 2 }],
    }));
    const assessEvidenceSufficiency = vi.fn()
      .mockReturnValueOnce({ status: 'insufficient', reasons: ['no-query-term-overlap'] })
      .mockReturnValueOnce({ status: 'sufficient', reasons: [] });

    const result = await assembleChatContext(
      {
        retrieveContext,
        addReference: vi.fn(),
        assessEvidenceSufficiency,
        buildRetrieveAgainQuery: () => 'collision deductible policy',
      },
      {
        userText: 'What is my collision deductible?',
        messages: [{ role: 'system', content: 'system prompt text' } as any],
        mentionPills: [],
        useRetrieval: true,
        maxMemoryContextChars: 100,
        maxConceptContextChars: 100,
        pageResult: null,
        ragResult: {
          text: '[Retrieved Context]\n[1] Source: Summary.md\nPath: Summary.md\nGeneral policy overview',
          sources: [{ uri: 'Summary.md', label: 'Summary.md', index: 1 }],
        },
        memoryResult: null,
        conceptResult: null,
        attachmentResults: [],
      },
    );

    expect(retrieveContext).toHaveBeenCalledWith('collision deductible policy');
    expect(assessEvidenceSufficiency).toHaveBeenCalledTimes(2);
    expect(result.retrievedContextText).toContain('General policy overview');
    expect(result.retrievedContextText).toContain('Collision deductible is $500');
    expect(result.ragSources).toHaveLength(2);
    expect(result.evidenceAssessment.status).toBe('sufficient');
  });
});