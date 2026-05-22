/**
 * Scoring rubrics for tool/skill/chain evaluations.
 *
 * Verdicts:
 *   correct      — the expected tool was called (first relevant call)
 *   wrong_tool   — a different tool was called instead
 *   no_tool      — no tool calls at all
 *   hallucinated — a tool name was emitted that doesn't exist in the manifest
 *   partial      — chain expected N tools, model used fewer-but-relevant
 */
import type { ToolInvocationRecord } from './chat.js';

export type ToolCallVerdict = 'correct' | 'wrong_tool' | 'no_tool' | 'hallucinated' | 'partial';

export interface SingleToolEvalCase {
  id: string;
  prompt: string;
  expectedTool: string;
  /** Optional alternative tool names that also count as correct. */
  allowedTools?: string[];
}

export interface ChainEvalCase {
  id: string;
  prompt: string;
  /** Ordered expected tool sequence. */
  expectedChain: string[];
  /** If true, order does not matter — set comparison instead. */
  unordered?: boolean;
}

export interface EvalResult {
  caseId: string;
  prompt: string;
  verdict: ToolCallVerdict;
  expected: string[];
  observed: string[];
  assistantText: string;
  durationMs: number;
  notes?: string;
}

export function scoreSingleTool(
  testCase: SingleToolEvalCase,
  observedTools: ToolInvocationRecord[],
  knownToolNames: Set<string>,
  assistantText: string,
  durationMs: number,
): EvalResult {
  const observed = observedTools.map((t) => t.toolName);
  const allowed = new Set<string>([testCase.expectedTool, ...(testCase.allowedTools || [])]);

  let verdict: ToolCallVerdict;
  if (observed.length === 0) {
    verdict = 'no_tool';
  } else if (observed.some((n) => allowed.has(n))) {
    verdict = 'correct';
  } else if (observed.every((n) => !knownToolNames.has(n))) {
    verdict = 'hallucinated';
  } else {
    verdict = 'wrong_tool';
  }

  return {
    caseId: testCase.id,
    prompt: testCase.prompt,
    verdict,
    expected: [testCase.expectedTool, ...(testCase.allowedTools || [])],
    observed,
    assistantText,
    durationMs,
  };
}

export function scoreChain(
  testCase: ChainEvalCase,
  observedTools: ToolInvocationRecord[],
  knownToolNames: Set<string>,
  assistantText: string,
  durationMs: number,
): EvalResult {
  const observed = observedTools.map((t) => t.toolName);
  const expected = testCase.expectedChain;

  let verdict: ToolCallVerdict;
  if (observed.length === 0) {
    verdict = 'no_tool';
  } else if (testCase.unordered) {
    const expSet = new Set(expected);
    const hit = observed.filter((n) => expSet.has(n));
    if (hit.length >= expected.length) verdict = 'correct';
    else if (hit.length > 0) verdict = 'partial';
    else if (observed.every((n) => !knownToolNames.has(n))) verdict = 'hallucinated';
    else verdict = 'wrong_tool';
  } else {
    // Ordered: observed must contain expected as a subsequence.
    let ei = 0;
    for (const o of observed) {
      if (o === expected[ei]) ei++;
      if (ei >= expected.length) break;
    }
    if (ei >= expected.length) verdict = 'correct';
    else if (ei > 0) verdict = 'partial';
    else if (observed.every((n) => !knownToolNames.has(n))) verdict = 'hallucinated';
    else verdict = 'wrong_tool';
  }

  return {
    caseId: testCase.id,
    prompt: testCase.prompt,
    verdict,
    expected,
    observed,
    assistantText,
    durationMs,
  };
}

export interface EvalSummary {
  total: number;
  correct: number;
  wrong_tool: number;
  no_tool: number;
  hallucinated: number;
  partial: number;
  passRate: number;
  results: EvalResult[];
}

export function summarize(results: EvalResult[]): EvalSummary {
  const tally = { correct: 0, wrong_tool: 0, no_tool: 0, hallucinated: 0, partial: 0 };
  for (const r of results) tally[r.verdict]++;
  return {
    total: results.length,
    ...tally,
    passRate: results.length === 0 ? 0 : tally.correct / results.length,
    results,
  };
}
