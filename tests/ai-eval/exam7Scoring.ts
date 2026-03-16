import type { ChatEvalDebugSnapshot } from './ai-eval-fixtures';
import {
  buildReport,
  type EvalReport,
  type TestCaseResult,
} from './scoring';
import { normalizeMatchText } from './exam7GroundTruth';

export interface PipelineExpectation {
  expectedSources?: string[];
  expectedRouteKind?: string;
  expectedIntent?: string;
  expectedCoverageMode?: 'representative' | 'exhaustive' | 'enumeration';
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

export interface Exam7TurnResult {
  prompt: string;
  response: string;
  latencyMs: number;
  assertions: Array<{ name: string; weight: number; passed: boolean }>;
  score: number;
  retrievalMetrics?: import('./scoring').RetrievalMetrics;
  pipelineMetrics?: PipelineMetrics;
  debug?: ChatEvalDebugSnapshot;
}

export interface Exam7TestCaseResult extends Omit<TestCaseResult, 'turns'> {
  turns: Exam7TurnResult[];
}

export interface Exam7EvalReport extends EvalReport {
  pipelineSummary?: PipelineSummary;
}

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

export function summarizePipelineMetrics(tests: readonly Exam7TestCaseResult[]): PipelineSummary | undefined {
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

export function buildExam7EvalReport(
  tests: readonly Exam7TestCaseResult[],
  model: string,
  opts?: Parameters<typeof buildReport>[2],
): Exam7EvalReport {
  const baseReport = buildReport(tests, model, opts);
  const pipelineSummary = summarizePipelineMetrics(tests);

  const extraLines: string[] = [];
  if (pipelineSummary) {
    extraLines.push('');
    extraLines.push('  EXAM 7 PIPELINE BASELINE');
    extraLines.push('  ----------------------------------------------------------------');
    extraLines.push(`    Turns with pipeline metrics   ${String(pipelineSummary.turnCount).padStart(6)}`);
    extraLines.push(`    Expected-source hit rate      ${(pipelineSummary.avgExpectedSourceHitRate * 100).toFixed(0)}%`);
    extraLines.push(`    Route match rate              ${(pipelineSummary.routeMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Intent match rate             ${(pipelineSummary.intentMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Coverage-mode match rate      ${(pipelineSummary.coverageModeMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Retrieval-attempt match rate  ${(pipelineSummary.retrievalAttemptMatchRate * 100).toFixed(0)}%`);
    extraLines.push(`    Returned-sources match rate   ${(pipelineSummary.returnedSourcesMatchRate * 100).toFixed(0)}%`);
  }

  return {
    ...baseReport,
    pipelineSummary,
    summary: baseReport.summary + extraLines.join('\n'),
  };
}