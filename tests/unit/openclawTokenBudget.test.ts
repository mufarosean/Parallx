import { describe, expect, it } from 'vitest';

import {
  computeTokenBudget,
  computeElasticBudget,
} from '../../src/openclaw/openclawTokenBudget';

// ---------------------------------------------------------------------------
// computeElasticBudget
// ---------------------------------------------------------------------------

describe('computeElasticBudget', () => {
  it('with no actuals = fixed split (matches computeTokenBudget)', () => {
    const fixed = computeTokenBudget(4096);
    const elastic = computeElasticBudget({ contextWindow: 4096 });
    expect(elastic.total).toBe(fixed.total);
    expect(elastic.system).toBe(fixed.system);
    expect(elastic.rag).toBe(fixed.rag);
    expect(elastic.history).toBe(fixed.history);
    expect(elastic.user).toBe(fixed.user);
  });

  it('redistributes system surplus to RAG', () => {
    const result = computeElasticBudget({
      contextWindow: 4096,
      systemActual: 100,
    });
    const fixedRag = Math.floor(4096 * 0.30);
    expect(result.system).toBe(100);
    expect(result.rag).toBeGreaterThan(fixedRag);
  });

  it('redistributes history surplus to RAG', () => {
    const result = computeElasticBudget({
      contextWindow: 4096,
      historyActual: 50,
    });
    const fixedRag = Math.floor(4096 * 0.30);
    expect(result.history).toBe(50);
    expect(result.rag).toBeGreaterThan(fixedRag);
  });

  it('redistributes user surplus to RAG', () => {
    const result = computeElasticBudget({
      contextWindow: 4096,
      userActual: 50,
    });
    const fixedRag = Math.floor(4096 * 0.30);
    expect(result.user).toBe(50);
    expect(result.rag).toBeGreaterThan(fixedRag);
  });

  it('combined surplus — all three underutilize → big RAG boost', () => {
    const result = computeElasticBudget({
      contextWindow: 4096,
      systemActual: 50,
      historyActual: 100,
      userActual: 100,
    });
    // System ceiling: 409, History ceiling: 1228, User ceiling: 1228
    // Surplus = (409-50) + (1228-100) + (1228-100) = 359 + 1128 + 1128 = 2615
    // RAG = 1228 + 2615 = 3843
    const fixedRag = Math.floor(4096 * 0.30);
    expect(result.rag).toBeGreaterThan(fixedRag * 2);
  });

  it('never exceeds total — system + rag + history + user ≤ total', () => {
    const scenarios = [
      { contextWindow: 4096 },
      { contextWindow: 4096, systemActual: 100, historyActual: 200, userActual: 300 },
      { contextWindow: 8192, systemActual: 0, historyActual: 0, userActual: 0 },
      { contextWindow: 2048, systemActual: 500, historyActual: 500, userActual: 500 },
    ];
    for (const params of scenarios) {
      const b = computeElasticBudget(params);
      expect(b.system + b.rag + b.history + b.user).toBeLessThanOrEqual(b.total);
    }
  });

  it('zero window — all zeros', () => {
    const result = computeElasticBudget({ contextWindow: 0 });
    expect(result.total).toBe(0);
    expect(result.system).toBe(0);
    expect(result.rag).toBe(0);
    expect(result.history).toBe(0);
    expect(result.user).toBe(0);
  });

  it('4096-token model realistic — 2-turn history, short prompt', () => {
    // 2-turn history ≈ 4 messages × (4 overhead + 50 content) ≈ 216 tokens
    // Short prompt ≈ 20 tokens
    const result = computeElasticBudget({
      contextWindow: 4096,
      historyActual: 216,
      userActual: 20,
    });
    const fixedRag = Math.floor(4096 * 0.30);
    // History and user under ceiling → surplus flows to RAG
    expect(result.rag).toBeGreaterThan(fixedRag);
    expect(result.history).toBe(216);
    expect(result.user).toBe(20);
  });

  it('actuals exceed ceiling — clamped, no negative surplus', () => {
    const result = computeElasticBudget({
      contextWindow: 4096,
      systemActual: 5000, // way over the 409 ceiling
      historyActual: 5000,
      userActual: 5000,
    });
    // All actuals clamped to ceilings → no surplus → RAG = ragCeil
    const systemCeil = Math.floor(4096 * 0.10);
    const ragCeil = Math.floor(4096 * 0.30);
    const historyCeil = Math.floor(4096 * 0.30);
    const userCeil = Math.floor(4096 * 0.30);
    expect(result.system).toBe(systemCeil);
    expect(result.rag).toBe(ragCeil);
    expect(result.history).toBe(historyCeil);
    expect(result.user).toBe(userCeil);
  });
});

// ---------------------------------------------------------------------------
// computeTokenBudget — regression guard
// ---------------------------------------------------------------------------

describe('computeTokenBudget unchanged', () => {
  it('still produces correct 10/30/30/30 split', () => {
    const budget = computeTokenBudget(8192);
    expect(budget.total).toBe(8192);
    expect(budget.system).toBe(819);
    expect(budget.rag).toBe(2457);
    expect(budget.history).toBe(2457);
    expect(budget.user).toBe(2457);
  });

  it('handles zero', () => {
    const budget = computeTokenBudget(0);
    expect(budget.total).toBe(0);
    expect(budget.system).toBe(0);
    expect(budget.rag).toBe(0);
    expect(budget.history).toBe(0);
    expect(budget.user).toBe(0);
  });
});
