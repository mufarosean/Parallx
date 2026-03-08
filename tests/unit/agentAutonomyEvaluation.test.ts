import { describe, expect, it } from 'vitest';
import { summarizeAutonomyScenarios } from '../ai-eval/scoring';
import { runAutonomyBenchmarkScenarios } from '../ai-eval/autonomyScenarioRunner';

describe('agent autonomy evaluation scenarios', () => {
  it('covers the milestone boundary, approval, completion, and trace scenarios', async () => {
    const scenarios = await runAutonomyBenchmarkScenarios();

    expect(scenarios).toHaveLength(5);
    expect(scenarios.every((scenario) => scenario.passed)).toBe(true);

    const summary = summarizeAutonomyScenarios(scenarios);
    expect(summary.boundaryPassRate).toBe(1);
    expect(summary.approvalPassRate).toBe(1);
    expect(summary.completionPassRate).toBe(1);
    expect(summary.traceCompletenessRate).toBe(1);
  });
});