import { describe, expect, it } from 'vitest';

import { CLAW_PARITY_SCENARIOS } from '../../tests/ai-eval/clawParityBenchmark';

describe('claw parity benchmark catalog', () => {
  it('covers the required NemoClaw behavior areas with unique scenario ids', () => {
    const scenarioIds = new Set<string>();
    const coveredAreas = new Set(CLAW_PARITY_SCENARIOS.map((scenario) => scenario.area));

    for (const scenario of CLAW_PARITY_SCENARIOS) {
      expect(scenarioIds.has(scenario.id)).toBe(false);
      scenarioIds.add(scenario.id);
      expect(scenario.requiredSignals.length).toBeGreaterThan(0);
      expect(scenario.prompt.trim().length).toBeGreaterThan(0);
    }

    expect(coveredAreas).toEqual(new Set([
      'autonomy',
      'memory',
      'skills',
      'tools',
      'approvals',
      'prompt-authority',
      'checkpoints',
      'traceability',
      'customizability',
      'extensibility',
    ]));
  });
});