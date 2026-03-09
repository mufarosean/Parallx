import { describe, expect, it, vi } from 'vitest';

import { loadChatContextSources } from '../../src/built-in/chat/utilities/chatContextSourceLoader';

describe('chat context source loader', () => {
  it('loads only the context sources enabled by the plan', async () => {
    const getCurrentPageContent = vi.fn(async () => ({ title: 'Page', pageId: 'p1', textContent: 'Page text' }));
    const retrieveContext = vi.fn(async () => ({ text: '[Retrieved Context]', sources: [{ uri: 'u1', label: 'Source 1', index: 1 }] }));
    const recallMemories = vi.fn(async () => 'memory');
    const recallConcepts = vi.fn(async () => 'concept');
    const readFileContent = vi.fn(async () => 'attachment');
    const reportRetrievalDebug = vi.fn();

    const result = await loadChatContextSources(
      {
        getCurrentPageContent,
        retrieveContext,
        recallMemories,
        recallConcepts,
        readFileContent,
        reportRetrievalDebug,
      },
      {
        userText: 'hello',
        sessionId: 's1',
        attachments: [{ name: 'a.txt', fullPath: 'C:/a.txt' } as any],
        useCurrentPage: false,
        useRetrieval: false,
        useMemoryRecall: true,
        useConceptRecall: false,
        hasActiveSlashCommand: false,
        isRagReady: true,
      },
    );

    expect(getCurrentPageContent).not.toHaveBeenCalled();
    expect(retrieveContext).not.toHaveBeenCalled();
    expect(recallMemories).toHaveBeenCalledTimes(1);
    expect(recallConcepts).not.toHaveBeenCalled();
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(reportRetrievalDebug).not.toHaveBeenCalled();
    expect(result.memoryResult).toBe('memory');
    expect(result.attachmentResults).toHaveLength(1);
  });

  it('reports retrieval attempts and returns rag results when retrieval is enabled', async () => {
    const reportRetrievalDebug = vi.fn();

    const result = await loadChatContextSources(
      {
        retrieveContext: vi.fn(async () => ({
          text: '[Retrieved Context]\nPolicy text',
          sources: [{ uri: 'u1', label: 'Policy', index: 1 }],
        })),
        reportRetrievalDebug,
      },
      {
        userText: 'What does my policy say about collision coverage?',
        sessionId: 's1',
        useCurrentPage: false,
        useRetrieval: true,
        useMemoryRecall: false,
        useConceptRecall: false,
        hasActiveSlashCommand: false,
        isRagReady: true,
      },
    );

    expect(reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: false,
      isRagReady: true,
      needsRetrieval: true,
      attempted: true,
      returnedSources: 1,
    });
    expect(result.ragResult?.sources).toHaveLength(1);
  });
});