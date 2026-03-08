import { describe, expect, it } from 'vitest';
import {
  AUTONOMY_ROLLOUT_THRESHOLDS,
  buildReport,
  evaluateAutonomyRolloutGate,
  summarizeAutonomyScenarios,
  type AutonomyScenarioResult,
  type TestCaseResult,
} from '../ai-eval/scoring';
import { AUTONOMY_BENCHMARKS, getAutonomyBenchmarkById } from '../ai-eval/autonomyBenchmark';

describe('autonomy benchmark definitions', () => {
  it('defines the representative autonomy rollout scenarios for Milestone 24', () => {
    expect(AUTONOMY_BENCHMARKS.length).toBeGreaterThanOrEqual(5);
    expect(getAutonomyBenchmarkById('A01')?.category).toBe('boundary');
    expect(getAutonomyBenchmarkById('A04')?.category).toBe('completion');
  });
});

describe('summarizeAutonomyScenarios', () => {
  it('aggregates autonomy pass rates by category', () => {
    const summary = summarizeAutonomyScenarios([
      { id: 'A01', name: 'boundary', category: 'boundary', passed: true },
      { id: 'A02', name: 'approval', category: 'approval', passed: true },
      { id: 'A03', name: 'approval', category: 'approval', passed: false },
      { id: 'A04', name: 'completion', category: 'completion', passed: true },
      { id: 'A05', name: 'trace', category: 'trace', passed: true },
    ]);

    expect(summary.scenarioCount).toBe(5);
    expect(summary.boundaryPassRate).toBe(1);
    expect(summary.approvalPassRate).toBe(0.5);
    expect(summary.completionPassRate).toBe(1);
    expect(summary.traceCompletenessRate).toBe(1);
  });
});

describe('evaluateAutonomyRolloutGate', () => {
  it('passes when autonomy metrics and manual review meet the rollout bar', () => {
    const gate = evaluateAutonomyRolloutGate({
      overallScore: AUTONOMY_ROLLOUT_THRESHOLDS.minOverallScore,
      autonomySummary: {
        scenarioCount: 5,
        boundaryPassRate: 1,
        approvalPassRate: 1,
        completionPassRate: 1,
        traceCompletenessRate: 1,
      },
      manualReviewApproved: true,
    });

    expect(gate.passesThresholds).toBe(true);
    expect(gate.rolloutAllowed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it('blocks rollout when autonomy metrics miss thresholds or review is pending', () => {
    const gate = evaluateAutonomyRolloutGate({
      overallScore: 0.8,
      autonomySummary: {
        scenarioCount: 5,
        boundaryPassRate: 1,
        approvalPassRate: 0.5,
        completionPassRate: 1,
        traceCompletenessRate: 0,
      },
      manualReviewApproved: false,
    });

    expect(gate.passesThresholds).toBe(false);
    expect(gate.rolloutAllowed).toBe(false);
    expect(gate.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('approval pass rate'),
      expect.stringContaining('trace completeness rate'),
      expect.stringContaining('overall score'),
      'manual autonomy regression review not yet approved',
    ]));
  });
});

describe('buildReport autonomy summary', () => {
  it('includes autonomy rollout status in the evaluation report when autonomy scenarios are present', () => {
    const tests: TestCaseResult[] = [
      {
        id: 'T01',
        name: 'placeholder',
        dimension: 'summary',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
    ];
    const scenarios: AutonomyScenarioResult[] = [
      { id: 'A01', name: 'boundary', category: 'boundary', passed: true },
      { id: 'A02', name: 'approval', category: 'approval', passed: true },
      { id: 'A04', name: 'completion', category: 'completion', passed: true },
      { id: 'A05', name: 'trace', category: 'trace', passed: true },
    ];

    const report = buildReport(tests, 'test-model', { autonomyScenarios: scenarios });

    expect(report.autonomySummary?.scenarioCount).toBe(4);
    expect(report.autonomyRolloutGate?.passesThresholds).toBe(true);
    expect(report.autonomyRolloutGate?.rolloutAllowed).toBe(false);
    expect(report.summary).toContain('AUTONOMY BASELINE');
    expect(report.summary).toContain('AUTONOMY ROLLOUT GATE');
  });
});