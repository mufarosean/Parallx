import type { ChatEvalDebugSnapshot } from './ai-eval-fixtures';
import {
  buildReport,
  type EvalReport,
  type TestCaseResult,
} from './scoring';
import { normalizeMatchText } from './booksGroundTruth';

export interface PipelineExpectation {
  expectedSources?: string[];
  expectedRouteKind?: string;
  expectedIntent?: string;
  expectedCoverageMode?: 'representative' | 'exhaustive';
  requireRetrievalAttempted?: boolean;
  minReturnedSources?: number;
}

export interface PipelineMetrics {
  expectedSourceHitRate: number;
  expectedSourcesSeen: string[];
  missingSources: string[];
  routeKind?: string;
  routeMatched: boolean;
  intent?: string;
  intentMatched: boolean;
  coverageMode?: string;
  coverageModeMatched: boolean;
  retrievalAttempted: boolean;
  retrievalAttemptMatched: boolean;
  returnedSources: number;
  returnedSourcesMatched: boolean;
}

export interface PipelineSummary {
  turnCount: number;
  avgExpectedSourceHitRate: number;
  routeMatchRate: number;
  intentMatchRate: number;
  coverageModeMatchRate: number;
  retrievalAttemptMatchRate: number;
  returnedSourcesMatchRate: number;
}

export interface PipelineRolloutThresholds {
  minExpectedSourceHitRate: number;
  minRouteMatchRate: number;
  minIntentMatchRate: number;
  minCoverageModeMatchRate: number;
  minRetrievalAttemptMatchRate: number;
  minReturnedSourcesMatchRate: number;
  minOverallScore: number;
}

export interface PipelineRolloutGate {
  thresholds: PipelineRolloutThresholds;
  passesThresholds: boolean;
  manualReviewApproved: boolean;
  rolloutAllowed: boolean;
  reasons: string[];
}

export interface BooksTurnResult {
  prompt: string;
  response: string;
  latencyMs: number;
  assertions: Array<{ name: string; weight: number; passed: boolean }>;
  score: number;
  retrievalMetrics?: import('./scoring').RetrievalMetrics;
  pipelineMetrics?: PipelineMetrics;
  debug?: ChatEvalDebugSnapshot;
}

export interface BooksTestCaseResult extends Omit<TestCaseResult, 'turns'> {
  turns: BooksTurnResult[];
}

export interface BooksEvalReport extends EvalReport {
  pipelineSummary?: PipelineSummary;
  pipelineRolloutGate?: PipelineRolloutGate;
}

export const PIPELINE_ROLLOUT_THRESHOLDS: PipelineRolloutThresholds = {
  minExpectedSourceHitRate: 0.9,
  minRouteMatchRate: 1.0,
  minIntentMatchRate: 1.0,
  minCoverageModeMatchRate: 1.0,
  minRetrievalAttemptMatchRate: 1.0,
  minReturnedSourcesMatchRate: 0.9,
  minOverallScore: 0.85,
};

function labelsMatch(expectedSource: string, candidateLabel: string): boolean {
  const expected = normalizeMatchText(expectedSource);
  const candidate = normalizeMatchText(candidateLabel);
  return candidate.includes(expected) || expected.includes(candidate);
}

export function evaluatePipelineMetrics(
  debug: ChatEvalDebugSnapshot | undefined,
  expectation: PipelineExpectation,
): PipelineMetrics {
  const candidateLabels = [
    ...(debug?.ragSources ?? []).map((source) => source.label),
    ...(debug?.contextPills ?? []).map((pill) => pill.label),
  ];

  const expectedSourcesSeen = (expectation.expectedSources ?? []).filter((expectedSource) => {
    return candidateLabels.some((candidateLabel) => labelsMatch(expectedSource, candidateLabel));
  });
  const missingSources = (expectation.expectedSources ?? []).filter((expectedSource) => {
    return !expectedSourcesSeen.includes(expectedSource);
  });

  const routeKind = debug?.runtimeTrace?.route?.kind;
  const intent = debug?.runtimeTrace?.contextPlan?.retrievalPlan?.intent;
  const coverageMode = (debug?.runtimeTrace?.contextPlan?.retrievalPlan as { coverageMode?: string } | undefined)?.coverageMode;
  const retrievalAttempted = debug?.retrievalGate?.attempted ?? false;
  const returnedSources = debug?.retrievalGate?.returnedSources ?? debug?.ragSources?.length ?? 0;

  return {
    expectedSourceHitRate: (expectation.expectedSources?.length ?? 0) > 0
      ? expectedSourcesSeen.length / (expectation.expectedSources?.length ?? 1)
      : 1,
    expectedSourcesSeen,
    missingSources,
    routeKind,
    routeMatched: expectation.expectedRouteKind ? routeKind === expectation.expectedRouteKind : true,
    intent,
    intentMatched: expectation.expectedIntent ? intent === expectation.expectedIntent : true,
    coverageMode,
    coverageModeMatched: expectation.expectedCoverageMode ? coverageMode === expectation.expectedCoverageMode : true,
    retrievalAttempted,
    retrievalAttemptMatched: expectation.requireRetrievalAttempted != null
      ? retrievalAttempted === expectation.requireRetrievalAttempted
      : true,
    returnedSources,
    returnedSourcesMatched: expectation.minReturnedSources != null
      ? returnedSources >= expectation.minReturnedSources
      : true,
  };
}

export function summarizePipelineMetrics(tests: readonly BooksTestCaseResult[]): PipelineSummary | undefined {
  const pipelineTurns = tests
    .flatMap((test) => test.turns)
    .map((turn) => turn.pipelineMetrics)
    .filter((metrics): metrics is PipelineMetrics => !!metrics);

  if (pipelineTurns.length === 0) {
    return undefined;
  }

  const average = (selector: (metrics: PipelineMetrics) => number): number => {
    return pipelineTurns.reduce((sum, metrics) => sum + selector(metrics), 0) / pipelineTurns.length;
  };

  return {
    turnCount: pipelineTurns.length,
    avgExpectedSourceHitRate: average((metrics) => metrics.expectedSourceHitRate),
    routeMatchRate: average((metrics) => metrics.routeMatched ? 1 : 0),
    intentMatchRate: average((metrics) => metrics.intentMatched ? 1 : 0),
    coverageModeMatchRate: average((metrics) => metrics.coverageModeMatched ? 1 : 0),
    retrievalAttemptMatchRate: average((metrics) => metrics.retrievalAttemptMatched ? 1 : 0),
    returnedSourcesMatchRate: average((metrics) => metrics.returnedSourcesMatched ? 1 : 0),
  };
}

export function evaluatePipelineRolloutGate(opts: {
  overallScore: number;
  pipelineSummary: PipelineSummary;
  manualReviewApproved?: boolean;
  thresholds?: PipelineRolloutThresholds;
}): PipelineRolloutGate {
  const thresholds = opts.thresholds ?? PIPELINE_ROLLOUT_THRESHOLDS;
  const manualReviewApproved = opts.manualReviewApproved ?? false;
  const reasons: string[] = [];

  if (opts.pipelineSummary.avgExpectedSourceHitRate < thresholds.minExpectedSourceHitRate) {
    reasons.push(`pipeline expected-source hit rate ${(opts.pipelineSummary.avgExpectedSourceHitRate * 100).toFixed(0)}% < ${(thresholds.minExpectedSourceHitRate * 100).toFixed(0)}%`);
  }
  if (opts.pipelineSummary.routeMatchRate < thresholds.minRouteMatchRate) {
    reasons.push(`route match rate ${(opts.pipelineSummary.routeMatchRate * 100).toFixed(0)}% < ${(thresholds.minRouteMatchRate * 100).toFixed(0)}%`);
  }
  if (opts.pipelineSummary.intentMatchRate < thresholds.minIntentMatchRate) {
    reasons.push(`intent match rate ${(opts.pipelineSummary.intentMatchRate * 100).toFixed(0)}% < ${(thresholds.minIntentMatchRate * 100).toFixed(0)}%`);
  }
  if (opts.pipelineSummary.coverageModeMatchRate < thresholds.minCoverageModeMatchRate) {
    reasons.push(`coverage-mode match rate ${(opts.pipelineSummary.coverageModeMatchRate * 100).toFixed(0)}% < ${(thresholds.minCoverageModeMatchRate * 100).toFixed(0)}%`);
  }
  if (opts.pipelineSummary.retrievalAttemptMatchRate < thresholds.minRetrievalAttemptMatchRate) {
    reasons.push(`retrieval-attempt match rate ${(opts.pipelineSummary.retrievalAttemptMatchRate * 100).toFixed(0)}% < ${(thresholds.minRetrievalAttemptMatchRate * 100).toFixed(0)}%`);
  }
  if (opts.pipelineSummary.returnedSourcesMatchRate < thresholds.minReturnedSourcesMatchRate) {
    reasons.push(`returned-sources match rate ${(opts.pipelineSummary.returnedSourcesMatchRate * 100).toFixed(0)}% < ${(thresholds.minReturnedSourcesMatchRate * 100).toFixed(0)}%`);
  }
  if (opts.overallScore < thresholds.minOverallScore) {
    reasons.push(`overall score ${(opts.overallScore * 100).toFixed(1)}% < ${(thresholds.minOverallScore * 100).toFixed(1)}%`);
  }
  if (!manualReviewApproved) {
    reasons.push('manual books pipeline review not yet approved');
  }

  const passesThresholds = reasons.every((reason) => reason === 'manual books pipeline review not yet approved') || reasons.length === 0;

  return {
    thresholds,
    passesThresholds,
    manualReviewApproved,
    rolloutAllowed: passesThresholds && manualReviewApproved,
    reasons,
  };
}

export function buildBooksEvalReport(
  tests: readonly BooksTestCaseResult[],
  model: string,
  opts?: Parameters<typeof buildReport>[2],
): BooksEvalReport {
  const baseReport = buildReport(tests, model, opts);
  const pipelineSummary = summarizePipelineMetrics(tests);
  const pipelineRolloutGate = pipelineSummary
    ? evaluatePipelineRolloutGate({
        overallScore: baseReport.overallScore,
        pipelineSummary,
        manualReviewApproved: process.env.PARALLX_BOOKS_PIPELINE_MANUAL_REVIEW_APPROVED === '1',
      })
    : undefined;

  const extraLines: string[] = [];
  if (pipelineSummary) {
    extraLines.push('');
    extraLines.push('  BOOKS PIPELINE BASELINE');
    extraLines.push('  ----------------------------------------------------------------');
    extraLines.push(`    Turns with pipeline metrics   ${String(pipelineSummary.turnCount).padStart(6)}`);
    extraLines.push(`    Expected-source hit rate      ${(pipelineSummary.avgExpectedSourceHitRate * 100).toFixed(0)}%`);
    extraLines.push(`    Route match rate              ${(pipelineSummary.routeMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Intent match rate             ${(pipelineSummary.intentMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Coverage-mode match rate      ${(pipelineSummary.coverageModeMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Retrieval-attempt match rate  ${(pipelineSummary.retrievalAttemptMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Returned-sources match rate   ${(pipelineSummary.returnedSourcesMatchRate * 100).toFixed(0)}%`);
  }
  if (pipelineRolloutGate) {
    extraLines.push('');
    extraLines.push('  BOOKS PIPELINE ROLLOUT GATE');
    extraLines.push('  ----------------------------------------------------------------');
    extraLines.push(`    Thresholds passed            ${pipelineRolloutGate.passesThresholds ? 'YES' : 'NO'}`);
    extraLines.push(`    Manual review approved       ${pipelineRolloutGate.manualReviewApproved ? 'YES' : 'NO'}`);
    extraLines.push(`    Default rollout allowed      ${pipelineRolloutGate.rolloutAllowed ? 'YES' : 'NO'}`);
    if (pipelineRolloutGate.reasons.length > 0) {
      extraLines.push('    Blocking reasons:');
      for (const reason of pipelineRolloutGate.reasons) {
        extraLines.push(`      - ${reason}`);
      }
    }
  }

  return {
    ...baseReport,
    pipelineSummary,
    pipelineRolloutGate,
    summary: `${baseReport.summary}${extraLines.join('\n')}${extraLines.length > 0 ? '\n' : ''}`,
  };
}