/**
 * AI Quality Evaluation — Scoring Framework
 *
 * Defines the assertion system, score calculation, grade thresholds,
 * and report generation for evaluating Parallx AI chat quality.
 *
 * "Excellent" (≥ 85%) is the ChatGPT bar: accurate facts, natural
 * conversation, proper source attribution, seamless follow-ups,
 * and cross-session memory recall.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Dimension =
  | 'factual-recall'
  | 'detail-retrieval'
  | 'summary'
  | 'multi-doc-synthesis'
  | 'source-attribution'
  | 'conversational'
  | 'air-behavior'
  | 'follow-up'
  | 'cross-session-memory'
  | 'data-freshness'
  | 'memory-vs-rag'
  | 'hallucination-guard'
  | 'disambiguation'
  | 'deep-retrieval'
  | 'user-correction';

export interface Assertion {
  /** Human-readable description of what is being checked. */
  name: string;
  /** Relative weight (1–3). Higher = more impact on score. */
  weight: number;
  /** Returns true if the assertion passes against the response text. */
  check: (responseText: string) => boolean;
}

export interface AssertionResult {
  name: string;
  weight: number;
  passed: boolean;
}

export interface RetrievalMetrics {
  expectedSourceHitRate: number;
  requiredTermCoverage: number;
  forbiddenTermViolationCount: number;
  citationPresent: boolean;
  expectedSourcesMentioned: string[];
  missingSources: string[];
  matchedRequiredTerms: string[];
  missingRequiredTerms: string[];
}

export interface RetrievalExpectation {
  expectedSources: string[];
  requiredTerms?: string[];
  forbiddenTerms?: string[];
  requireCitation?: boolean;
}

export interface RetrievalSummary {
  turnCount: number;
  avgExpectedSourceHitRate: number;
  avgRequiredTermCoverage: number;
  citationRate: number;
  avgForbiddenTermViolations: number;
}

export interface RetrievalRolloutThresholds {
  minExpectedSourceHitRate: number;
  minRequiredTermCoverage: number;
  minCitationRate: number;
  maxAvgForbiddenTermViolations: number;
  minOverallScore: number;
}

export interface RetrievalRolloutGate {
  thresholds: RetrievalRolloutThresholds;
  passesThresholds: boolean;
  manualReviewApproved: boolean;
  rolloutAllowed: boolean;
  reasons: string[];
}

export type AutonomyScenarioCategory = 'boundary' | 'approval' | 'completion' | 'trace';

export interface AutonomyScenarioResult {
  id: string;
  name: string;
  category: AutonomyScenarioCategory;
  passed: boolean;
  detail?: string;
}

export interface AutonomySummary {
  scenarioCount: number;
  boundaryPassRate: number;
  approvalPassRate: number;
  completionPassRate: number;
  traceCompletenessRate: number;
}

export interface AutonomyRolloutThresholds {
  minBoundaryPassRate: number;
  minApprovalPassRate: number;
  minCompletionPassRate: number;
  minTraceCompletenessRate: number;
  minOverallScore: number;
}

export interface AutonomyRolloutGate {
  thresholds: AutonomyRolloutThresholds;
  passesThresholds: boolean;
  manualReviewApproved: boolean;
  rolloutAllowed: boolean;
  reasons: string[];
}

export interface AirBehaviorSummary {
  testCount: number;
  overallScore: number;
  benchmarkScores: Record<string, number>;
  autonomyCommunicationScore: number;
}

export interface AirBehaviorRolloutThresholds {
  minIdentityCleanlinessScore: number;
  minGroundedSocialScore: number;
  minWeakEvidenceHonestyScore: number;
  minWorkspaceBoundaryScore: number;
  minApprovalScopeScore: number;
  minBlockedRecoveryScore: number;
  minArtifactGuidanceScore: number;
  minTraceExplanationScore: number;
  minAutonomyCommunicationScore: number;
  minOverallAirScore: number;
  minOverallScore: number;
}

export interface AirBehaviorRolloutGate {
  thresholds: AirBehaviorRolloutThresholds;
  passesThresholds: boolean;
  manualReviewApproved: boolean;
  rolloutAllowed: boolean;
  reasons: string[];
}

export interface TurnResult {
  prompt: string;
  response: string;
  latencyMs: number;
  assertions: AssertionResult[];
  retrievalMetrics?: RetrievalMetrics;
  debug?: {
    query?: string;
    retrievedContextText?: string;
    ragSources?: Array<{ uri: string; label: string; index: number }>;
    contextPills?: Array<{ id: string; label: string; type: string; removable: boolean; index?: number; tokens?: number }>;
    retrievalTrace?: unknown;
    isRAGAvailable?: boolean;
    isIndexing?: boolean;
    retrievalGate?: {
      hasActiveSlashCommand: boolean;
      isRagReady: boolean;
      needsRetrieval: boolean;
      attempted: boolean;
      returnedSources?: number;
    };
    retrievalError?: string;
  };
  /** Weighted score for this turn: 0–1. */
  score: number;
}

export interface TestCaseResult {
  id: string;
  name: string;
  dimension: Dimension;
  turns: TurnResult[];
  /** Aggregate score across all turns: 0–1. */
  score: number;
}

export interface DimensionScore {
  score: number;
  testCount: number;
}

export type Grade = 'Excellent' | 'Good' | 'Needs Work' | 'Poor';

export interface EvalReport {
  timestamp: string;
  model: string;
  workspaceName: string;
  overallScore: number;
  grade: Grade;
  dimensionScores: Record<string, DimensionScore>;
  retrievalSummary?: RetrievalSummary;
  retrievalRolloutGate?: RetrievalRolloutGate;
  autonomySummary?: AutonomySummary;
  autonomyRolloutGate?: AutonomyRolloutGate;
  airBehaviorSummary?: AirBehaviorSummary;
  airBehaviorRolloutGate?: AirBehaviorRolloutGate;
  tests: TestCaseResult[];
  /** Pretty-printed text summary for console/file output. */
  summary: string;
}

export const RETRIEVAL_ROLLOUT_THRESHOLDS: RetrievalRolloutThresholds = {
  minExpectedSourceHitRate: 1.0,
  minRequiredTermCoverage: 0.95,
  minCitationRate: 1.0,
  maxAvgForbiddenTermViolations: 0,
  minOverallScore: 0.85,
};

export const AUTONOMY_ROLLOUT_THRESHOLDS: AutonomyRolloutThresholds = {
  minBoundaryPassRate: 1.0,
  minApprovalPassRate: 1.0,
  minCompletionPassRate: 1.0,
  minTraceCompletenessRate: 1.0,
  minOverallScore: 0.85,
};

export const AIR_BEHAVIOR_BENCHMARK_LABELS = {
  T22: 'identity cleanliness',
  T23: 'grounded to social follow-up',
  T24: 'weak-evidence honesty',
  T25: 'workspace boundary explanation',
  T26: 'approval scope explanation',
  T27: 'blocked-task recovery guidance',
  T28: 'completed-artifact guidance',
  T29: 'task-trace explanation',
} as const;

export const AIR_AUTONOMY_COMMUNICATION_BENCHMARK_IDS = ['T26', 'T27', 'T28', 'T29'] as const;

export const AIR_BEHAVIOR_ROLLOUT_THRESHOLDS: AirBehaviorRolloutThresholds = {
  minIdentityCleanlinessScore: 0.85,
  minGroundedSocialScore: 0.85,
  minWeakEvidenceHonestyScore: 0.85,
  minWorkspaceBoundaryScore: 0.85,
  minApprovalScopeScore: 0.85,
  minBlockedRecoveryScore: 0.85,
  minArtifactGuidanceScore: 0.85,
  minTraceExplanationScore: 0.85,
  minAutonomyCommunicationScore: 0.9,
  minOverallAirScore: 0.9,
  minOverallScore: 0.85,
};

// ── Grade Thresholds ─────────────────────────────────────────────────────────

export const GRADE_THRESHOLDS: { min: number; grade: Grade }[] = [
  { min: 0.85, grade: 'Excellent' },
  { min: 0.70, grade: 'Good' },
  { min: 0.50, grade: 'Needs Work' },
  { min: 0.00, grade: 'Poor' },
];

// ── Assertion Builders ───────────────────────────────────────────────────────

/** At least ONE keyword appears in the response (case-insensitive). */
export function containsAny(keywords: string[]): (r: string) => boolean {
  return (r) => {
    const lower = r.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
  };
}

/** ALL keywords appear in the response (case-insensitive). */
export function containsAll(keywords: string[]): (r: string) => boolean {
  return (r) => {
    const lower = r.toLowerCase();
    return keywords.every((k) => lower.includes(k.toLowerCase()));
  };
}

/** NONE of the keywords appear (case-insensitive). Useful for hallucination checks. */
export function containsNone(keywords: string[]): (r: string) => boolean {
  return (r) => {
    const lower = r.toLowerCase();
    return keywords.every((k) => !lower.includes(k.toLowerCase()));
  };
}

/** Response character length is within [min, max]. */
export function lengthBetween(min: number, max: number): (r: string) => boolean {
  return (r) => r.length >= min && r.length <= max;
}

/** Response contains at least one `[N]` citation marker. */
export function hasCitationMarkers(): (r: string) => boolean {
  return (r) => /\[\d+\]/.test(r);
}

/** Response matches a regex pattern. */
export function matchesPattern(pattern: RegExp): (r: string) => boolean {
  return (r) => pattern.test(r);
}

export function evaluateRetrievalMetrics(
  response: string,
  expectation: RetrievalExpectation,
): RetrievalMetrics {
  const lower = response.toLowerCase();

  const expectedSourcesMentioned = expectation.expectedSources.filter((source) => {
    const baseName = source.replace(/\.md$/i, '');
    const normalized = baseName.toLowerCase();
    const tokens = normalized
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);

    return lower.includes(normalized) || tokens.some((token) => lower.includes(token));
  });
  const missingSources = expectation.expectedSources.filter(
    (source) => !expectedSourcesMentioned.includes(source),
  );

  const requiredTerms = expectation.requiredTerms ?? [];
  const matchedRequiredTerms = requiredTerms.filter((term) => lower.includes(term.toLowerCase()));
  const missingRequiredTerms = requiredTerms.filter((term) => !matchedRequiredTerms.includes(term));

  const forbiddenTerms = expectation.forbiddenTerms ?? [];
  const forbiddenTermViolationCount = forbiddenTerms.filter(
    (term) => lower.includes(term.toLowerCase()),
  ).length;

  const citationPresent = hasCitationMarkers()(response)
    || /(?:source|sources|agent contacts|claims guide|vehicle info|insurance policy)/i.test(response)
    || /[¹²³⁴⁵⁶⁷⁸⁹]/.test(response);

  return {
    expectedSourceHitRate: expectation.expectedSources.length > 0
      ? expectedSourcesMentioned.length / expectation.expectedSources.length
      : 0,
    requiredTermCoverage: requiredTerms.length > 0
      ? matchedRequiredTerms.length / requiredTerms.length
      : 1,
    forbiddenTermViolationCount,
    citationPresent,
    expectedSourcesMentioned,
    missingSources,
    matchedRequiredTerms,
    missingRequiredTerms,
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Weighted score: sum(weight × pass) / sum(weight). Returns 0–1. */
export function scoreTurn(results: AssertionResult[]): number {
  const totalWeight = results.reduce((s, r) => s + r.weight, 0);
  if (totalWeight === 0) return 0;
  return results.reduce((s, r) => s + (r.passed ? r.weight : 0), 0) / totalWeight;
}

/** Map a 0–1 score to a letter grade. */
export function gradeFromScore(score: number): Grade {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade;
  }
  return 'Poor';
}

/** Run all assertions against a response, returning results with pass/fail. */
export function evaluateAssertions(response: string, assertions: Assertion[]): AssertionResult[] {
  return assertions.map((a) => ({
    name: a.name,
    weight: a.weight,
    passed: a.check(response),
  }));
}

// ── Report Builder ───────────────────────────────────────────────────────────

export function buildReport(
  tests: TestCaseResult[],
  model: string,
  opts?: { autonomyScenarios?: readonly AutonomyScenarioResult[]; workspaceName?: string },
): EvalReport {
  // Aggregate by dimension
  const dimMap: Record<string, { total: number; count: number }> = {};
  for (const t of tests) {
    if (!dimMap[t.dimension]) dimMap[t.dimension] = { total: 0, count: 0 };
    dimMap[t.dimension].total += t.score;
    dimMap[t.dimension].count += 1;
  }

  const dimensionScores: Record<string, DimensionScore> = {};
  for (const [dim, data] of Object.entries(dimMap)) {
    dimensionScores[dim] = {
      score: data.count > 0 ? data.total / data.count : 0,
      testCount: data.count,
    };
  }

  const overallScore = tests.length > 0
    ? tests.reduce((s, t) => s + t.score, 0) / tests.length
    : 0;
  const grade = gradeFromScore(overallScore);

  const retrievalTurns = tests.flatMap((test) => test.turns)
    .map((turn) => turn.retrievalMetrics)
    .filter((metrics): metrics is RetrievalMetrics => !!metrics);

  const retrievalSummary: RetrievalSummary | undefined = retrievalTurns.length > 0
    ? {
        turnCount: retrievalTurns.length,
        avgExpectedSourceHitRate: retrievalTurns.reduce((sum, metrics) => sum + metrics.expectedSourceHitRate, 0) / retrievalTurns.length,
        avgRequiredTermCoverage: retrievalTurns.reduce((sum, metrics) => sum + metrics.requiredTermCoverage, 0) / retrievalTurns.length,
        citationRate: retrievalTurns.filter((metrics) => metrics.citationPresent).length / retrievalTurns.length,
        avgForbiddenTermViolations: retrievalTurns.reduce((sum, metrics) => sum + metrics.forbiddenTermViolationCount, 0) / retrievalTurns.length,
      }
    : undefined;

  const retrievalRolloutGate = retrievalSummary
    ? evaluateRetrievalRolloutGate({
        overallScore,
        retrievalSummary,
        manualReviewApproved: process.env.PARALLX_RETRIEVAL_MANUAL_REVIEW_APPROVED === '1',
      })
    : undefined;

  const autonomySummary = opts?.autonomyScenarios && opts.autonomyScenarios.length > 0
    ? summarizeAutonomyScenarios(opts.autonomyScenarios)
    : undefined;

  const autonomyRolloutGate = autonomySummary
    ? evaluateAutonomyRolloutGate({
        overallScore,
        autonomySummary,
        manualReviewApproved: process.env.PARALLX_AUTONOMY_MANUAL_REVIEW_APPROVED === '1',
      })
    : undefined;

  const airBehaviorSummary = summarizeAirBehaviorTests(tests);
  const airBehaviorRolloutGate = airBehaviorSummary
    ? evaluateAirBehaviorRolloutGate({
        overallScore,
        airBehaviorSummary,
        manualReviewApproved: process.env.PARALLX_AIR_MANUAL_REVIEW_APPROVED === '1',
      })
    : undefined;

  const summary = formatReport({
    overallScore,
    grade,
    dimensionScores,
    retrievalSummary,
    retrievalRolloutGate,
    autonomySummary,
    autonomyRolloutGate,
    airBehaviorSummary,
    airBehaviorRolloutGate,
    tests,
    model,
  });

  return {
    timestamp: new Date().toISOString(),
    model,
    workspaceName: opts?.workspaceName || 'demo-workspace (insurance)',
    overallScore,
    grade,
    dimensionScores,
    retrievalSummary,
    retrievalRolloutGate,
    autonomySummary,
    autonomyRolloutGate,
    airBehaviorSummary,
    airBehaviorRolloutGate,
    tests,
    summary,
  };
}

export function evaluateRetrievalRolloutGate(opts: {
  overallScore: number;
  retrievalSummary: RetrievalSummary;
  manualReviewApproved?: boolean;
  thresholds?: RetrievalRolloutThresholds;
}): RetrievalRolloutGate {
  const thresholds = opts.thresholds ?? RETRIEVAL_ROLLOUT_THRESHOLDS;
  const manualReviewApproved = opts.manualReviewApproved ?? false;
  const reasons: string[] = [];

  if (opts.retrievalSummary.avgExpectedSourceHitRate < thresholds.minExpectedSourceHitRate) {
    reasons.push(`expected-source hit rate ${(opts.retrievalSummary.avgExpectedSourceHitRate * 100).toFixed(0)}% < ${(thresholds.minExpectedSourceHitRate * 100).toFixed(0)}%`);
  }
  if (opts.retrievalSummary.avgRequiredTermCoverage < thresholds.minRequiredTermCoverage) {
    reasons.push(`required-term coverage ${(opts.retrievalSummary.avgRequiredTermCoverage * 100).toFixed(0)}% < ${(thresholds.minRequiredTermCoverage * 100).toFixed(0)}%`);
  }
  if (opts.retrievalSummary.citationRate < thresholds.minCitationRate) {
    reasons.push(`citation rate ${(opts.retrievalSummary.citationRate * 100).toFixed(0)}% < ${(thresholds.minCitationRate * 100).toFixed(0)}%`);
  }
  if (opts.retrievalSummary.avgForbiddenTermViolations > thresholds.maxAvgForbiddenTermViolations) {
    reasons.push(`avg forbidden violations ${opts.retrievalSummary.avgForbiddenTermViolations.toFixed(2)} > ${thresholds.maxAvgForbiddenTermViolations.toFixed(2)}`);
  }
  if (opts.overallScore < thresholds.minOverallScore) {
    reasons.push(`overall score ${(opts.overallScore * 100).toFixed(1)}% < ${(thresholds.minOverallScore * 100).toFixed(1)}%`);
  }
  if (!manualReviewApproved) {
    reasons.push('manual regression review not yet approved');
  }

  const passesThresholds = reasons.every((reason) => reason === 'manual regression review not yet approved') || reasons.length === 0;

  return {
    thresholds,
    passesThresholds,
    manualReviewApproved,
    rolloutAllowed: passesThresholds && manualReviewApproved,
    reasons,
  };
}

export function summarizeAutonomyScenarios(scenarios: readonly AutonomyScenarioResult[]): AutonomySummary {
  const byCategory = (category: AutonomyScenarioCategory) => scenarios.filter((scenario) => scenario.category === category);
  const passRate = (category: AutonomyScenarioCategory) => {
    const matches = byCategory(category);
    if (matches.length === 0) {
      return 0;
    }
    return matches.filter((scenario) => scenario.passed).length / matches.length;
  };

  return {
    scenarioCount: scenarios.length,
    boundaryPassRate: passRate('boundary'),
    approvalPassRate: passRate('approval'),
    completionPassRate: passRate('completion'),
    traceCompletenessRate: passRate('trace'),
  };
}

export function evaluateAutonomyRolloutGate(opts: {
  overallScore: number;
  autonomySummary: AutonomySummary;
  manualReviewApproved?: boolean;
  thresholds?: AutonomyRolloutThresholds;
}): AutonomyRolloutGate {
  const thresholds = opts.thresholds ?? AUTONOMY_ROLLOUT_THRESHOLDS;
  const manualReviewApproved = opts.manualReviewApproved ?? false;
  const reasons: string[] = [];

  if (opts.autonomySummary.boundaryPassRate < thresholds.minBoundaryPassRate) {
    reasons.push(`boundary pass rate ${(opts.autonomySummary.boundaryPassRate * 100).toFixed(0)}% < ${(thresholds.minBoundaryPassRate * 100).toFixed(0)}%`);
  }
  if (opts.autonomySummary.approvalPassRate < thresholds.minApprovalPassRate) {
    reasons.push(`approval pass rate ${(opts.autonomySummary.approvalPassRate * 100).toFixed(0)}% < ${(thresholds.minApprovalPassRate * 100).toFixed(0)}%`);
  }
  if (opts.autonomySummary.completionPassRate < thresholds.minCompletionPassRate) {
    reasons.push(`completion pass rate ${(opts.autonomySummary.completionPassRate * 100).toFixed(0)}% < ${(thresholds.minCompletionPassRate * 100).toFixed(0)}%`);
  }
  if (opts.autonomySummary.traceCompletenessRate < thresholds.minTraceCompletenessRate) {
    reasons.push(`trace completeness rate ${(opts.autonomySummary.traceCompletenessRate * 100).toFixed(0)}% < ${(thresholds.minTraceCompletenessRate * 100).toFixed(0)}%`);
  }
  if (opts.overallScore < thresholds.minOverallScore) {
    reasons.push(`overall score ${(opts.overallScore * 100).toFixed(1)}% < ${(thresholds.minOverallScore * 100).toFixed(1)}%`);
  }
  if (!manualReviewApproved) {
    reasons.push('manual autonomy regression review not yet approved');
  }

  const passesThresholds = reasons.every((reason) => reason === 'manual autonomy regression review not yet approved') || reasons.length === 0;

  return {
    thresholds,
    passesThresholds,
    manualReviewApproved,
    rolloutAllowed: passesThresholds && manualReviewApproved,
    reasons,
  };
}

export function summarizeAirBehaviorTests(tests: readonly TestCaseResult[]): AirBehaviorSummary | undefined {
  const airTests = tests.filter((test) => test.dimension === 'air-behavior');
  if (airTests.length === 0) {
    return undefined;
  }

  const benchmarkScores = Object.fromEntries(
    airTests.map((test) => [test.id, test.score]),
  );
  const overallScore = airTests.reduce((sum, test) => sum + test.score, 0) / airTests.length;
  const autonomyCommunicationTests = airTests.filter((test) =>
    AIR_AUTONOMY_COMMUNICATION_BENCHMARK_IDS.includes(test.id as (typeof AIR_AUTONOMY_COMMUNICATION_BENCHMARK_IDS)[number]),
  );
  const autonomyCommunicationScore = autonomyCommunicationTests.length > 0
    ? autonomyCommunicationTests.reduce((sum, test) => sum + test.score, 0) / autonomyCommunicationTests.length
    : 0;

  return {
    testCount: airTests.length,
    overallScore,
    benchmarkScores,
    autonomyCommunicationScore,
  };
}

export function evaluateAirBehaviorRolloutGate(opts: {
  overallScore: number;
  airBehaviorSummary: AirBehaviorSummary;
  manualReviewApproved?: boolean;
  thresholds?: AirBehaviorRolloutThresholds;
}): AirBehaviorRolloutGate {
  const thresholds = opts.thresholds ?? AIR_BEHAVIOR_ROLLOUT_THRESHOLDS;
  const manualReviewApproved = opts.manualReviewApproved ?? false;
  const reasons: string[] = [];
  const benchmarkChecks: Array<{ id: keyof typeof AIR_BEHAVIOR_BENCHMARK_LABELS; minScore: number }> = [
    { id: 'T22', minScore: thresholds.minIdentityCleanlinessScore },
    { id: 'T23', minScore: thresholds.minGroundedSocialScore },
    { id: 'T24', minScore: thresholds.minWeakEvidenceHonestyScore },
    { id: 'T25', minScore: thresholds.minWorkspaceBoundaryScore },
    { id: 'T26', minScore: thresholds.minApprovalScopeScore },
    { id: 'T27', minScore: thresholds.minBlockedRecoveryScore },
    { id: 'T28', minScore: thresholds.minArtifactGuidanceScore },
    { id: 'T29', minScore: thresholds.minTraceExplanationScore },
  ];

  for (const benchmark of benchmarkChecks) {
    const score = opts.airBehaviorSummary.benchmarkScores[benchmark.id];
    if (typeof score !== 'number') {
      reasons.push(`missing AIR benchmark ${benchmark.id} (${AIR_BEHAVIOR_BENCHMARK_LABELS[benchmark.id]})`);
      continue;
    }
    if (score < benchmark.minScore) {
      reasons.push(`${AIR_BEHAVIOR_BENCHMARK_LABELS[benchmark.id]} ${(score * 100).toFixed(0)}% < ${(benchmark.minScore * 100).toFixed(0)}%`);
    }
  }

  if (opts.airBehaviorSummary.autonomyCommunicationScore < thresholds.minAutonomyCommunicationScore) {
    reasons.push(`autonomy communication score ${(opts.airBehaviorSummary.autonomyCommunicationScore * 100).toFixed(0)}% < ${(thresholds.minAutonomyCommunicationScore * 100).toFixed(0)}%`);
  }
  if (opts.airBehaviorSummary.overallScore < thresholds.minOverallAirScore) {
    reasons.push(`overall AIR score ${(opts.airBehaviorSummary.overallScore * 100).toFixed(0)}% < ${(thresholds.minOverallAirScore * 100).toFixed(0)}%`);
  }
  if (opts.overallScore < thresholds.minOverallScore) {
    reasons.push(`overall score ${(opts.overallScore * 100).toFixed(1)}% < ${(thresholds.minOverallScore * 100).toFixed(1)}%`);
  }
  if (!manualReviewApproved) {
    reasons.push('manual AIR behavior review not yet approved');
  }

  const passesThresholds = reasons.every((reason) => reason === 'manual AIR behavior review not yet approved') || reasons.length === 0;

  return {
    thresholds,
    passesThresholds,
    manualReviewApproved,
    rolloutAllowed: passesThresholds && manualReviewApproved,
    reasons,
  };
}

// ── Pretty Report Formatter ──────────────────────────────────────────────────

function formatReport(opts: {
  overallScore: number;
  grade: Grade;
  dimensionScores: Record<string, DimensionScore>;
  retrievalSummary?: RetrievalSummary;
  retrievalRolloutGate?: RetrievalRolloutGate;
  autonomySummary?: AutonomySummary;
  autonomyRolloutGate?: AutonomyRolloutGate;
  airBehaviorSummary?: AirBehaviorSummary;
  airBehaviorRolloutGate?: AirBehaviorRolloutGate;
  tests: TestCaseResult[];
  model: string;
}): string {
  const {
    overallScore,
    grade,
    dimensionScores,
    retrievalSummary,
    retrievalRolloutGate,
    autonomySummary,
    autonomyRolloutGate,
    airBehaviorSummary,
    airBehaviorRolloutGate,
    tests,
    model,
  } = opts;
  const W = 64;
  const sep = '='.repeat(W);
  const thin = '-'.repeat(W);

  const lines: string[] = [
    '',
    sep,
    '  PARALLX AI QUALITY EVALUATION',
    sep,
    `  Model:     ${model}`,
    `  Date:      ${new Date().toISOString()}`,
    `  Tests:     ${tests.length}`,
    '',
    `  OVERALL SCORE: ${(overallScore * 100).toFixed(1)}%  --  ${grade}`,
    '',
    '  What "Excellent" (>= 85%) looks like:',
    '  A ChatGPT-quality assistant that retrieves accurate facts,',
    '  cites sources, handles follow-ups naturally, and remembers',
    '  context across sessions.',
    sep,
    '',
    '  DIMENSION BREAKDOWN',
    thin,
  ];

  const dimOrder: Dimension[] = [
    'factual-recall',
    'detail-retrieval',
    'summary',
    'multi-doc-synthesis',
    'source-attribution',
    'conversational',
    'air-behavior',
    'follow-up',
    'cross-session-memory',
    'data-freshness',
    'memory-vs-rag',
    'hallucination-guard',
    'disambiguation',
    'deep-retrieval',
    'user-correction',
  ];

  for (const dim of dimOrder) {
    const data = dimensionScores[dim];
    if (!data) continue;
    const filled = Math.round(data.score * 20);
    const bar = '#'.repeat(filled) + '.'.repeat(20 - filled);
    lines.push(`    ${dim.padEnd(24)} [${bar}] ${(data.score * 100).toFixed(0)}%`);
  }

  if (retrievalSummary) {
    lines.push('');
    lines.push('  RETRIEVAL BASELINE');
    lines.push(thin);
    lines.push(`    Turns with retrieval metrics  ${String(retrievalSummary.turnCount).padStart(6)}`);
    lines.push(`    Expected-source hit rate      ${(retrievalSummary.avgExpectedSourceHitRate * 100).toFixed(0)}%`);
    lines.push(`    Required-term coverage       ${(retrievalSummary.avgRequiredTermCoverage * 100).toFixed(0)}%`);
    lines.push(`    Citation presence rate       ${(retrievalSummary.citationRate * 100).toFixed(0)}%`);
    lines.push(`    Avg forbidden violations     ${retrievalSummary.avgForbiddenTermViolations.toFixed(2)}`);
  }

  if (retrievalRolloutGate) {
    lines.push('');
    lines.push('  RETRIEVAL ROLLOUT GATE');
    lines.push(thin);
    lines.push(`    Thresholds passed            ${retrievalRolloutGate.passesThresholds ? 'YES' : 'NO'}`);
    lines.push(`    Manual review approved       ${retrievalRolloutGate.manualReviewApproved ? 'YES' : 'NO'}`);
    lines.push(`    Default rollout allowed      ${retrievalRolloutGate.rolloutAllowed ? 'YES' : 'NO'}`);
    if (retrievalRolloutGate.reasons.length > 0) {
      lines.push('    Blocking reasons:');
      for (const reason of retrievalRolloutGate.reasons) {
        lines.push(`      - ${reason}`);
      }
    }
  }

  if (autonomySummary) {
    lines.push('');
    lines.push('  AUTONOMY BASELINE');
    lines.push(thin);
    lines.push(`    Scenario count               ${String(autonomySummary.scenarioCount).padStart(6)}`);
    lines.push(`    Boundary pass rate           ${(autonomySummary.boundaryPassRate * 100).toFixed(0)}%`);
    lines.push(`    Approval pass rate           ${(autonomySummary.approvalPassRate * 100).toFixed(0)}%`);
    lines.push(`    Completion pass rate         ${(autonomySummary.completionPassRate * 100).toFixed(0)}%`);
    lines.push(`    Trace completeness rate      ${(autonomySummary.traceCompletenessRate * 100).toFixed(0)}%`);
  }

  if (autonomyRolloutGate) {
    lines.push('');
    lines.push('  AUTONOMY ROLLOUT GATE');
    lines.push(thin);
    lines.push(`    Thresholds passed            ${autonomyRolloutGate.passesThresholds ? 'YES' : 'NO'}`);
    lines.push(`    Manual review approved       ${autonomyRolloutGate.manualReviewApproved ? 'YES' : 'NO'}`);
    lines.push(`    Default rollout allowed      ${autonomyRolloutGate.rolloutAllowed ? 'YES' : 'NO'}`);
    if (autonomyRolloutGate.reasons.length > 0) {
      lines.push('    Blocking reasons:');
      for (const reason of autonomyRolloutGate.reasons) {
        lines.push(`      - ${reason}`);
      }
    }
  }

  if (airBehaviorSummary) {
    lines.push('');
    lines.push('  AIR BEHAVIOR SUMMARY');
    lines.push(thin);
    lines.push(`    AIR benchmark count          ${String(airBehaviorSummary.testCount).padStart(6)}`);
    lines.push(`    Overall AIR score            ${(airBehaviorSummary.overallScore * 100).toFixed(0)}%`);
    lines.push(`    Autonomy communication       ${(airBehaviorSummary.autonomyCommunicationScore * 100).toFixed(0)}%`);
    for (const benchmarkId of Object.keys(AIR_BEHAVIOR_BENCHMARK_LABELS) as Array<keyof typeof AIR_BEHAVIOR_BENCHMARK_LABELS>) {
      const score = airBehaviorSummary.benchmarkScores[benchmarkId];
      const display = typeof score === 'number' ? `${(score * 100).toFixed(0)}%` : 'MISSING';
      lines.push(`    ${`${benchmarkId} ${AIR_BEHAVIOR_BENCHMARK_LABELS[benchmarkId]}`.padEnd(28)} ${display}`);
    }
  }

  if (airBehaviorRolloutGate) {
    lines.push('');
    lines.push('  AIR BEHAVIOR ROLLOUT GATE');
    lines.push(thin);
    lines.push(`    Thresholds passed            ${airBehaviorRolloutGate.passesThresholds ? 'YES' : 'NO'}`);
    lines.push(`    Manual review approved       ${airBehaviorRolloutGate.manualReviewApproved ? 'YES' : 'NO'}`);
    lines.push(`    Default rollout allowed      ${airBehaviorRolloutGate.rolloutAllowed ? 'YES' : 'NO'}`);
    if (airBehaviorRolloutGate.reasons.length > 0) {
      lines.push('    Blocking reasons:');
      for (const reason of airBehaviorRolloutGate.reasons) {
        lines.push(`      - ${reason}`);
      }
    }
  }

  lines.push('');
  lines.push('  TEST RESULTS');
  lines.push(thin);

  for (const t of tests) {
    const icon = t.score >= 0.85 ? 'PASS' : t.score >= 0.5 ? 'PART' : 'FAIL';
    const avgLatency = t.turns.length > 0
      ? Math.round(t.turns.reduce((s, turn) => s + turn.latencyMs, 0) / t.turns.length)
      : 0;
    lines.push(`  [${icon}] ${t.id}: ${t.name}`);
    lines.push(`         Score: ${(t.score * 100).toFixed(0)}%  |  Avg latency: ${avgLatency}ms`);

    for (const turn of t.turns) {
      if (t.turns.length > 1) {
        const truncPrompt = turn.prompt.length > 55
          ? turn.prompt.substring(0, 55) + '...'
          : turn.prompt;
        lines.push(`    Turn: "${truncPrompt}"`);
      }
      for (const a of turn.assertions) {
        lines.push(`      ${a.passed ? '[OK]' : '[X] '} ${a.name} (w:${a.weight})`);
      }
    }
    lines.push('');
  }

  lines.push(sep);
  lines.push('');

  return lines.join('\n');
}
