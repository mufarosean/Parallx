// tokenBudgetService.test.ts — the surviving estimator.
//
// The TokenBudgetService class (legacy fixed-split allocation) was deleted
// by the Retirement phase — openclawTokenBudget.ts is the live elastic
// implementation, and only estimateTokens was ever imported in production.
// This file pins the one export that remains.

import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../src/services/tokenBudgetService.js';

describe('estimateTokens', () => {
  it('estimates chars / 4, rounded up', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});
