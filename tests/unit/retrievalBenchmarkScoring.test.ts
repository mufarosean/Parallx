import { describe, expect, it } from 'vitest';
import {
  evaluateRetrievalMetrics,
  buildReport,
  type TestCaseResult,
} from '../ai-eval/scoring';
import { getRetrievalBenchmarkById, RETRIEVAL_BENCHMARKS } from '../ai-eval/retrievalBenchmark';

describe('retrieval benchmark definitions', () => {
  it('defines benchmark cases for the measurement-first retrieval slice', () => {
    expect(RETRIEVAL_BENCHMARKS.length).toBeGreaterThanOrEqual(6);
    expect(getRetrievalBenchmarkById('T01')?.category).toBe('exact-identifier');
    expect(getRetrievalBenchmarkById('T05')?.turns[0]?.expectedSources).toContain('Claims Guide.md');
  });
});

describe('evaluateRetrievalMetrics', () => {
  it('computes expected-source and term coverage from a grounded response', () => {
    const metrics = evaluateRetrievalMetrics(
      'According to Auto Insurance Policy.md, your collision deductible is $500.',
      {
        expectedSources: ['Auto Insurance Policy.md'],
        requiredTerms: ['collision', '$500'],
      },
    );

    expect(metrics.expectedSourceHitRate).toBe(1);
    expect(metrics.requiredTermCoverage).toBe(1);
    expect(metrics.forbiddenTermViolationCount).toBe(0);
    expect(metrics.missingSources).toEqual([]);
  });

  it('records missing sources, missing terms, and forbidden term violations', () => {
    const metrics = evaluateRetrievalMetrics(
      'Your deductible is $750.',
      {
        expectedSources: ['Auto Insurance Policy.md'],
        requiredTerms: ['collision', '$500'],
        forbiddenTerms: ['$750'],
        requireCitation: true,
      },
    );

    expect(metrics.expectedSourceHitRate).toBe(0);
    expect(metrics.requiredTermCoverage).toBe(0);
    expect(metrics.forbiddenTermViolationCount).toBe(1);
    expect(metrics.citationPresent).toBe(false);
    expect(metrics.missingSources).toContain('Auto Insurance Policy.md');
  });
});

describe('buildReport retrieval summary', () => {
  it('aggregates retrieval metrics into the final evaluation report', () => {
    const tests: TestCaseResult[] = [
      {
        id: 'T01',
        name: 'Collision deductible exact retrieval',
        dimension: 'factual-recall',
        score: 1,
        turns: [
          {
            prompt: 'What is my collision deductible?',
            response: 'According to Auto Insurance Policy.md, your collision deductible is $500 [1].',
            latencyMs: 1000,
            assertions: [],
            score: 1,
            retrievalMetrics: evaluateRetrievalMetrics(
              'According to Auto Insurance Policy.md, your collision deductible is $500 [1].',
              {
                expectedSources: ['Auto Insurance Policy.md'],
                requiredTerms: ['collision', '$500'],
                requireCitation: true,
              },
            ),
          },
        ],
      },
    ];

    const report = buildReport(tests, 'test-model');

    expect(report.retrievalSummary).toBeDefined();
    expect(report.retrievalSummary?.turnCount).toBe(1);
    expect(report.retrievalSummary?.avgExpectedSourceHitRate).toBe(1);
    expect(report.summary).toContain('RETRIEVAL BASELINE');
  });
});
