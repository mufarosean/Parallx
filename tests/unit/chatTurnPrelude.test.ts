import { describe, expect, it, vi } from 'vitest';

import { prepareChatTurnPrelude } from '../../src/built-in/chat/utilities/chatTurnPrelude';

describe('chat turn prelude', () => {
  it('uses cleaned mention text to build the retrieval query and plan the route', async () => {
    const buildFollowUpRetrievalQuery = vi.fn((query: string) => `${query} deductible`);
    const reportRuntimeTrace = vi.fn();
    const reportRetrievalDebug = vi.fn();

    const result = await prepareChatTurnPrelude({
      readFileContent: vi.fn().mockResolvedValue('Policy text'),
      isRAGAvailable: () => true,
      reportRuntimeTrace,
      reportRetrievalDebug,
    }, {
      buildFollowUpRetrievalQuery,
    }, {
      requestText: 'What is my deductible? @file:"Auto Insurance Policy.md"',
      history: [],
      sessionId: 'session-1',
      hasActiveSlashCommand: false,
    });

    expect(result.userText).toBe('What is my deductible?');
    expect(result.contextQueryText).toBe('What is my deductible? deductible');
    expect(result.mentionPills).toHaveLength(1);
    expect(result.mentionContextBlocks[0]).toContain('Mentioned file: Auto Insurance Policy.md');
    expect(result.contextPlan.useRetrieval).toBe(true);
    expect(buildFollowUpRetrievalQuery).toHaveBeenCalledWith('What is my deductible?', []);
    expect(reportRuntimeTrace).toHaveBeenCalledOnce();
    expect(reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: false,
      isRagReady: true,
      needsRetrieval: true,
      attempted: false,
    });
  });

  it('keeps raw text when there are no mentions and disables retrieval for active slash commands', async () => {
    const result = await prepareChatTurnPrelude({
      isRAGAvailable: () => true,
      reportRuntimeTrace: vi.fn(),
      reportRetrievalDebug: vi.fn(),
    }, {
      buildFollowUpRetrievalQuery: (query) => query,
    }, {
      requestText: 'Explain this code path',
      history: [{ request: { text: 'previous turn' } }] as any,
      sessionId: 'session-2',
      hasActiveSlashCommand: true,
    });

    expect(result.userText).toBe('Explain this code path');
    expect(result.mentionPills).toHaveLength(0);
    expect(result.mentionContextBlocks).toHaveLength(0);
    expect(result.isRagReady).toBe(true);
    expect(result.contextPlan.useRetrieval).toBe(false);
    expect(result.retrievalPlan.needsRetrieval).toBe(false);
  });
});