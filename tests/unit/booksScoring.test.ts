import { describe, expect, it } from 'vitest';

import { evaluatePipelineMetrics, summarizePipelineMetrics } from '../../src/../tests/ai-eval/booksScoring';

describe('booksScoring', () => {
  it('scores expected source hits and route alignment from debug state', () => {
    const metrics = evaluatePipelineMetrics(
      {
        ragSources: [{ uri: 'a', label: 'How Change Happens.pdf', index: 1 }],
        contextPills: [{ id: '1', label: 'How Change Happens.pdf', type: 'rag', removable: true }],
        isRAGAvailable: true,
        isIndexing: false,
        retrievalGate: {
          hasActiveSlashCommand: false,
          isRagReady: true,
          needsRetrieval: true,
          attempted: true,
          returnedSources: 1,
        },
        runtimeTrace: {
          route: { kind: 'grounded', reason: 'test' },
          contextPlan: {
            route: 'grounded',
            intent: 'question',
            useRetrieval: true,
            useMemoryRecall: false,
            useConceptRecall: false,
            useCurrentPage: false,
            citationMode: 'required',
            reasoning: 'test',
            retrievalPlan: {
              intent: 'question',
              reasoning: 'test',
              needsRetrieval: true,
              queries: [],
              coverageMode: 'representative',
            },
          },
          hasActiveSlashCommand: false,
          isRagReady: true,
        },
      },
      {
        expectedSources: ['How Change Happens.pdf'],
        expectedRouteKind: 'grounded',
        expectedIntent: 'question',
        expectedCoverageMode: 'representative',
        requireRetrievalAttempted: true,
        minReturnedSources: 1,
      },
    );

    expect(metrics.expectedSourceHitRate).toBe(1);
    expect(metrics.routeMatched).toBe(true);
    expect(metrics.intentMatched).toBe(true);
    expect(metrics.coverageModeMatched).toBe(true);
    expect(metrics.retrievalAttemptMatched).toBe(true);
    expect(metrics.returnedSourcesMatched).toBe(true);
  });

  it('aggregates pipeline metrics across turns', () => {
    const summary = summarizePipelineMetrics([
      {
        id: 'BW01',
        name: 'test',
        dimension: 'detail-retrieval',
        score: 1,
        turns: [
          {
            prompt: 'a',
            response: 'b',
            latencyMs: 1,
            assertions: [],
            score: 1,
            pipelineMetrics: {
              expectedSourceHitRate: 1,
              expectedSourcesSeen: ['x'],
              missingSources: [],
              routeKind: 'grounded',
              routeMatched: true,
              intent: 'question',
              intentMatched: true,
              coverageMode: 'representative',
              coverageModeMatched: true,
              retrievalAttempted: true,
              retrievalAttemptMatched: true,
              returnedSources: 1,
              returnedSourcesMatched: true,
            },
          },
          {
            prompt: 'c',
            response: 'd',
            latencyMs: 1,
            assertions: [],
            score: 1,
            pipelineMetrics: {
              expectedSourceHitRate: 0.5,
              expectedSourcesSeen: ['x'],
              missingSources: ['y'],
              routeKind: 'grounded',
              routeMatched: true,
              intent: 'exploration',
              intentMatched: false,
              coverageMode: 'representative',
              coverageModeMatched: false,
              retrievalAttempted: true,
              retrievalAttemptMatched: true,
              returnedSources: 1,
              returnedSourcesMatched: false,
            },
          },
        ],
      },
    ]);

    expect(summary).toBeTruthy();
    expect(summary?.turnCount).toBe(2);
    expect(summary?.avgExpectedSourceHitRate).toBe(0.75);
    expect(summary?.routeMatchRate).toBe(1);
    expect(summary?.intentMatchRate).toBe(0.5);
    expect(summary?.coverageModeMatchRate).toBe(0.5);
    expect(summary?.returnedSourcesMatchRate).toBe(0.5);
  });
});