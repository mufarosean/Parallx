import { describe, expect, it } from 'vitest';
import {
  AIR_BEHAVIOR_ROLLOUT_THRESHOLDS,
  buildReport,
  evaluateAirBehaviorRolloutGate,
  summarizeAirBehaviorTests,
  type TestCaseResult,
} from '../ai-eval/scoring';

describe('summarizeAirBehaviorTests', () => {
  it('aggregates AIR benchmark scores and autonomy communication average', () => {
    const tests: TestCaseResult[] = [
      {
        id: 'T22',
        name: 'identity',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T26',
        name: 'approval',
        dimension: 'air-behavior',
        score: 0.75,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 0.75 }],
      },
      {
        id: 'T28',
        name: 'artifact',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T01',
        name: 'non-air control',
        dimension: 'summary',
        score: 0.5,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 0.5 }],
      },
    ];

    const summary = summarizeAirBehaviorTests(tests);

    expect(summary).toBeDefined();
    expect(summary?.testCount).toBe(3);
    expect(summary?.overallScore).toBeCloseTo((1 + 0.75 + 1) / 3, 5);
    expect(summary?.benchmarkScores.T22).toBe(1);
    expect(summary?.benchmarkScores.T26).toBe(0.75);
    expect(summary?.autonomyCommunicationScore).toBeCloseTo((0.75 + 1) / 2, 5);
  });
});

describe('evaluateAirBehaviorRolloutGate', () => {
  it('passes when all AIR benchmarks meet thresholds and review is approved', () => {
    const gate = evaluateAirBehaviorRolloutGate({
      overallScore: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minOverallScore,
      airBehaviorSummary: {
        testCount: 8,
        overallScore: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minOverallAirScore,
        autonomyCommunicationScore: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minAutonomyCommunicationScore,
        benchmarkScores: {
          T22: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minIdentityCleanlinessScore,
          T23: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minGroundedSocialScore,
          T24: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minWeakEvidenceHonestyScore,
          T25: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minWorkspaceBoundaryScore,
          T26: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minApprovalScopeScore,
          T27: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minBlockedRecoveryScore,
          T28: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minArtifactGuidanceScore,
          T29: AIR_BEHAVIOR_ROLLOUT_THRESHOLDS.minTraceExplanationScore,
        },
      },
      manualReviewApproved: true,
    });

    expect(gate.passesThresholds).toBe(true);
    expect(gate.rolloutAllowed).toBe(true);
    expect(gate.reasons).toEqual([]);
  });

  it('blocks rollout when AIR benchmarks are missing or below bar and review is pending', () => {
    const gate = evaluateAirBehaviorRolloutGate({
      overallScore: 0.8,
      airBehaviorSummary: {
        testCount: 5,
        overallScore: 0.82,
        autonomyCommunicationScore: 0.7,
        benchmarkScores: {
          T22: 1,
          T23: 0.84,
          T24: 1,
          T25: 1,
          T26: 0.7,
        },
      },
      manualReviewApproved: false,
    });

    expect(gate.passesThresholds).toBe(false);
    expect(gate.rolloutAllowed).toBe(false);
    expect(gate.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('grounded to social follow-up'),
      expect.stringContaining('approval scope explanation'),
      expect.stringContaining('missing AIR benchmark T27'),
      expect.stringContaining('missing AIR benchmark T28'),
      expect.stringContaining('missing AIR benchmark T29'),
      expect.stringContaining('autonomy communication score'),
      expect.stringContaining('overall AIR score'),
      expect.stringContaining('overall score'),
      'manual AIR behavior review not yet approved',
    ]));
  });
});

describe('buildReport AIR behavior summary', () => {
  it('includes AIR milestone summaries and rollout status in the final report', () => {
    const tests: TestCaseResult[] = [
      {
        id: 'T22',
        name: 'identity',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T23',
        name: 'grounded-social',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T24',
        name: 'honesty',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T25',
        name: 'boundary',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T26',
        name: 'approval',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T27',
        name: 'blocked',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T28',
        name: 'artifact',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
      {
        id: 'T29',
        name: 'trace',
        dimension: 'air-behavior',
        score: 1,
        turns: [{ prompt: 'p', response: 'r', latencyMs: 1, assertions: [], score: 1 }],
      },
    ];

    const previousValue = process.env.PARALLX_AIR_MANUAL_REVIEW_APPROVED;
    process.env.PARALLX_AIR_MANUAL_REVIEW_APPROVED = '1';

    try {
      const report = buildReport(tests, 'test-model');

      expect(report.airBehaviorSummary?.testCount).toBe(8);
      expect(report.airBehaviorSummary?.overallScore).toBe(1);
      expect(report.airBehaviorRolloutGate?.passesThresholds).toBe(true);
      expect(report.airBehaviorRolloutGate?.rolloutAllowed).toBe(true);
      expect(report.summary).toContain('AIR BEHAVIOR SUMMARY');
      expect(report.summary).toContain('AIR BEHAVIOR ROLLOUT GATE');
      expect(report.summary).toContain('T28 completed-artifact guidance');
      expect(report.summary).toContain('T29 task-trace explanation');
    } finally {
      if (typeof previousValue === 'string') {
        process.env.PARALLX_AIR_MANUAL_REVIEW_APPROVED = previousValue;
      } else {
        delete process.env.PARALLX_AIR_MANUAL_REVIEW_APPROVED;
      }
    }
  });
});