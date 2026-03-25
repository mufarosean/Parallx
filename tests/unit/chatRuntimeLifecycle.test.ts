import { describe, expect, it, vi } from 'vitest';

import { createChatRuntimeLifecycle } from '../../src/built-in/chat/utilities/chatRuntimeLifecycle';

describe('chat runtime lifecycle', () => {
  it('routes memory checkpoints only after completion and records outcome traces through the shared lifecycle', () => {
    const reportRuntimeTrace = vi.fn();
    const queueMemoryWriteBackImpl = vi.fn((_deps, options) => {
      options.onCheckpoint?.({ checkpoint: 'memory-summary-refined-stored' });
    });

    const lifecycle = createChatRuntimeLifecycle({
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
      queueMemoryWriteBackImpl: queueMemoryWriteBackImpl as any,
    });

    lifecycle.queueMemoryWriteBack(
      {
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
      },
      {
        memoryEnabled: true,
        requestText: 'hello',
        sessionId: 'session-1',
        history: [],
      },
    );

    expect(queueMemoryWriteBackImpl).not.toHaveBeenCalled();

    lifecycle.recordCompleted();
    lifecycle.recordAborted();
    lifecycle.recordFailed('boom');

    expect(queueMemoryWriteBackImpl).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        memoryEnabled: true,
        requestText: 'hello',
        sessionId: 'session-1',
        onCheckpoint: expect.any(Function),
      }),
    );
    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'memory-summary-refined-stored',
    }));
    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'post-finalization',
      runState: 'completed',
    }));
    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'run-aborted',
      runState: 'aborted',
    }));
    expect(reportRuntimeTrace).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: 'run-failed',
      runState: 'failed',
      note: 'boom',
    }));
  });

  it('drops queued memory write-back when the run aborts or fails before completion', () => {
    const queueMemoryWriteBackImpl = vi.fn();

    const lifecycle = createChatRuntimeLifecycle({
      queueMemoryWriteBackImpl: queueMemoryWriteBackImpl as any,
    });

    lifecycle.queueMemoryWriteBack(
      {
        buildDeterministicSessionSummary: vi.fn(() => 'summary'),
      },
      {
        memoryEnabled: true,
        requestText: 'hello',
        sessionId: 'session-1',
        history: [],
      },
    );
    lifecycle.recordAborted();
    lifecycle.recordFailed('boom');

    expect(queueMemoryWriteBackImpl).not.toHaveBeenCalled();
  });
});