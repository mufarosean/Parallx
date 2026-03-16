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

  it('routes explicit prior-session history questions to the transcript lane', async () => {
    const result = await prepareChatTurnPrelude({
      isRAGAvailable: () => true,
      reportRuntimeTrace: vi.fn(),
      reportRetrievalDebug: vi.fn(),
    }, {
      buildFollowUpRetrievalQuery: (query) => query,
    }, {
      requestText: 'What did we discuss in the previous session about coverage exclusions?',
      history: [],
      sessionId: 'session-3',
      hasActiveSlashCommand: false,
    });

    expect(result.turnRoute.kind).toBe('transcript-recall');
    expect(result.contextPlan.useTranscriptRecall).toBe(true);
    expect(result.contextPlan.useRetrieval).toBe(false);
    expect(result.contextPlan.useCurrentPage).toBe(false);
  });

  it('does not inject inferred folder attachments for exhaustive folder-summary turns', async () => {
    const listFolderFiles = vi.fn().mockResolvedValue([
      { relativePath: 'RF Guides/Clark.pdf', content: 'Clark content' },
    ]);

    const result = await prepareChatTurnPrelude({
      listFolderFiles,
      isRAGAvailable: () => true,
      reportRuntimeTrace: vi.fn(),
      reportRetrievalDebug: vi.fn(),
    }, {
      buildFollowUpRetrievalQuery: (query) => query,
    }, {
      requestText: 'Can you provide a one paragraph summary for each of the files in the RF Guides folder?',
      history: [],
      sessionId: 'session-4',
      hasActiveSlashCommand: false,
    });

    expect(result.turnRoute.workflowType).toBe('folder-summary');
    expect(result.turnRoute.coverageMode).toBe('exhaustive');
    expect(result.mentionPills).toHaveLength(0);
    expect(result.mentionContextBlocks).toHaveLength(0);
    expect(listFolderFiles).not.toHaveBeenCalled();
  });

  it('applies a bounded semantic fallback for broad ambiguous workspace-summary phrasing', async () => {
    const reportRuntimeTrace = vi.fn();
    const reportRetrievalDebug = vi.fn();
    const reportResponseDebug = vi.fn();

    const result = await prepareChatTurnPrelude({
      isRAGAvailable: () => true,
      listFilesRelative: vi.fn().mockResolvedValue([]),
      reportRuntimeTrace,
      reportRetrievalDebug,
      reportResponseDebug,
    }, {
      buildFollowUpRetrievalQuery: (query) => query,
    }, {
      requestText: 'Tell me about everything in here.',
      history: [],
      sessionId: 'session-5',
      hasActiveSlashCommand: false,
    });

    expect(result.semanticFallback?.kind).toBe('broad-workspace-summary');
    expect(result.turnRoute.workflowType).toBe('folder-summary');
    expect(result.turnRoute.coverageMode).toBe('exhaustive');
    expect(result.contextPlan.retrievalPlan.coverageMode).toBe('exhaustive');
    expect(reportResponseDebug).toHaveBeenCalledWith({
      phase: 'semantic-fallback',
      markdownLength: 0,
      yielded: false,
      cancelled: false,
      retrievedContextLength: 0,
      note: 'broad-workspace-summary:0.76',
    });
    expect(reportRuntimeTrace).toHaveBeenCalledOnce();
    expect(reportRetrievalDebug).toHaveBeenCalledWith({
      hasActiveSlashCommand: false,
      isRagReady: true,
      needsRetrieval: false,
      attempted: false,
    });
  });
});