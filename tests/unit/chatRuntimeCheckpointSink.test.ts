import { describe, expect, it, vi } from 'vitest';

import { createChatRuntimeCheckpointSink } from '../../src/built-in/chat/utilities/chatRuntimeCheckpointSink';

describe('chat runtime checkpoint sink', () => {
  it('maps memory checkpoints through the runtime trace contract', () => {
    const reportRuntimeTrace = vi.fn();
    const sink = createChatRuntimeCheckpointSink({
      runtimeTraceSeed: {
        route: { kind: 'grounded', reason: 'retrieval' },
        contextPlan: {
          route: 'grounded',
          intent: 'question',
          useRetrieval: true,
          useMemoryRecall: false,
          useTranscriptRecall: false,
          useConceptRecall: false,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'Need evidence.',
          retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: true, queries: ['policy'] },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
      },
      reportRuntimeTrace,
    });

    sink.recordMemoryCheckpoint({ checkpoint: 'memory-summary-refined-stored', note: 'stored refined summary' });

    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'memory-summary-refined-stored',
      note: 'stored refined summary',
    }));
  });

  it('maps run outcomes through the runtime trace contract', () => {
    const reportRuntimeTrace = vi.fn();
    const sink = createChatRuntimeCheckpointSink({
      runtimeTraceSeed: {
        route: { kind: 'grounded', reason: 'retrieval' },
        contextPlan: {
          route: 'grounded',
          intent: 'question',
          useRetrieval: true,
          useMemoryRecall: false,
          useTranscriptRecall: false,
          useConceptRecall: false,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'Need evidence.',
          retrievalPlan: { intent: 'question', reasoning: 'Need evidence.', needsRetrieval: true, queries: ['policy'] },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
      },
      reportRuntimeTrace,
    });

    sink.recordOutcome('run-failed', 'failed', 'boom');

    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'run-failed',
      runState: 'failed',
      note: 'boom',
    }));
  });
});