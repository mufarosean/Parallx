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

export interface TurnResult {
  prompt: string;
  response: string;
  latencyMs: number;
  assertions: AssertionResult[];
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
  tests: TestCaseResult[];
  /** Pretty-printed text summary for console/file output. */
  summary: string;
}

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

export function buildReport(tests: TestCaseResult[], model: string): EvalReport {
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

  const summary = formatReport({ overallScore, grade, dimensionScores, tests, model });

  return {
    timestamp: new Date().toISOString(),
    model,
    workspaceName: 'demo-workspace (insurance)',
    overallScore,
    grade,
    dimensionScores,
    tests,
    summary,
  };
}

// ── Pretty Report Formatter ──────────────────────────────────────────────────

function formatReport(opts: {
  overallScore: number;
  grade: Grade;
  dimensionScores: Record<string, DimensionScore>;
  tests: TestCaseResult[];
  model: string;
}): string {
  const { overallScore, grade, dimensionScores, tests, model } = opts;
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
