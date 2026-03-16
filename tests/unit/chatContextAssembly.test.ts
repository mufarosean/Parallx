import { describe, expect, it, vi } from 'vitest';

import { assembleChatContext } from '../../src/built-in/chat/utilities/chatContextAssembly';

describe('chat context assembly', () => {
  it('assembles context, reports pills, and filters excluded sources', async () => {
    const reportContextPills = vi.fn();

    const result = await assembleChatContext(
      {
        reportContextPills,
        getExcludedContextIds: () => new Set(['Claims Guide.md', 'memory:session-recall']),
        assessEvidenceSufficiency: () => ({ status: 'sufficient', reasons: [] }),
        buildRetrieveAgainQuery: () => '',
      },
      {
        userText: 'What are the filing deadlines?',
        messages: [{ role: 'system', content: 'system prompt text' } as any],
        attachments: [{ kind: 'file', id: 'C:/notes.txt', name: 'notes.txt', fullPath: 'C:/notes.txt', isImplicit: false } as any],
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

    expect(reportContextPills).toHaveBeenCalledTimes(1);
    expect(result.contextParts.some((part) => part.includes('Claims Guide.md'))).toBe(false);
    expect(result.contextParts.some((part) => part.includes('Page context'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('[…memory truncated]'))).toBe(false);
    expect(result.contextParts.some((part) => part.includes('[…concepts truncated]'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('attachment body'))).toBe(true);
    expect(result.provenance.map((entry) => ({ kind: entry.kind, label: entry.label, index: entry.index }))).toEqual([
      { kind: 'page', label: 'Claims', index: undefined },
      { kind: 'rag', label: 'Claims Guide.md', index: 1 },
      { kind: 'memory', label: 'Memory recall', index: undefined },
      { kind: 'concept', label: 'Concept recall', index: undefined },
      { kind: 'attachment', label: 'notes.txt', index: 2 },
    ]);
    expect(result.pills.map((pill) => pill.label)).toEqual([
      'System prompt',
      'Claims Guide.md',
      'Memory recall',
      'Concept recall',
      'notes.txt',
      'Claims rule',
    ]);
  });

  it('creates visible references for direct page and file context even without retrieval', async () => {
    const result = await assembleChatContext(
      {
        assessEvidenceSufficiency: () => ({ status: 'sufficient', reasons: [] }),
        buildRetrieveAgainQuery: () => '',
      },
      {
        userText: 'Summarize the open document',
        messages: [{ role: 'system', content: 'system prompt text' } as any],
        attachments: [{ kind: 'file', name: 'Clark.pdf', fullPath: 'D:/AI/Parallx/Clark.pdf', id: 'D:/AI/Parallx/Clark.pdf', isImplicit: false } as any],
        mentionPills: [],
        useRetrieval: false,
        maxMemoryContextChars: 100,
        maxConceptContextChars: 100,
        pageResult: { title: 'Clark.pdf', pageId: 'pdf-page', textContent: 'Open document text' },
        ragResult: null,
        memoryResult: null,
        conceptResult: null,
        attachmentResults: [{ name: 'Clark.pdf', content: 'Attached file text' }],
      },
    );

    expect(result.provenance.map((entry) => ({ kind: entry.kind, uri: entry.uri, index: entry.index }))).toEqual([
      { kind: 'page', uri: 'parallx-page://pdf-page' },
      { kind: 'attachment', uri: 'D:/AI/Parallx/Clark.pdf', index: 1 },
    ]);
    expect(result.ragSources).toEqual([
      { uri: 'D:/AI/Parallx/Clark.pdf', label: 'Clark.pdf', index: 1 },
    ]);
    expect(result.contextParts.some((part) => part.includes('Open document text'))).toBe(true);
    expect(result.contextParts.some((part) => part.includes('Attached file text'))).toBe(true);
  });

  it('promotes exhaustive direct file reads into citable sources', async () => {
    const result = await assembleChatContext(
      {
        assessEvidenceSufficiency: () => ({ status: 'sufficient', reasons: [] }),
        buildRetrieveAgainQuery: () => '',
      },
      {
        userText: 'Summarize each file in the RF Guides folder.',
        messages: [{ role: 'system', content: 'system prompt text' } as any],
        mentionPills: [],
        useRetrieval: false,
        maxMemoryContextChars: 100,
        maxConceptContextChars: 100,
        pageResult: null,
        ragResult: null,
        memoryResult: null,
        conceptResult: null,
        attachmentResults: [],
        evidenceBundle: {
          plan: {} as any,
          items: [{
            kind: 'exhaustive',
            reads: [
              { relativePath: 'RF Guides/Clark.pdf', content: 'Clark summary text' },
              { relativePath: 'RF Guides/Verrall.pdf', content: 'Verrall summary text' },
            ],
          }],
          totalChars: 34,
        },
      },
    );

    expect(result.ragSources).toEqual([
      { uri: 'RF Guides/Clark.pdf', label: 'Clark.pdf', index: 1 },
      { uri: 'RF Guides/Verrall.pdf', label: 'Verrall.pdf', index: 2 },
    ]);
    expect(result.provenance.map((entry) => ({ kind: entry.kind, uri: entry.uri, index: entry.index }))).toEqual([
      { kind: 'attachment', uri: 'RF Guides/Clark.pdf', index: 1 },
      { kind: 'attachment', uri: 'RF Guides/Verrall.pdf', index: 2 },
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