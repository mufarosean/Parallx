/**
 * Token budget management for the OpenClaw execution pipeline.
 *
 * Upstream evidence:
 *   - attempt.context-engine-helpers.ts:52-73 — tokenBudget passed to context engine
 *   - run.ts — agentCfgContextTokens used for context window size
 *
 * Parallx adaptation:
 *   - M11 spec: System 10%, RAG 30%, History 30%, User 30%
 *   - M9 spec: Token estimation = chars / 4
 */

import { estimateTokens } from '../services/tokenBudgetService.js';

// Re-export the shared estimator so existing OpenClaw consumers don't break.
export { estimateTokens };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IOpenclawTokenBudget {
  /** Total model context window (via num_ctx) */
  readonly total: number;
  /** 10% — system prompt + workspace digest + bootstrap files */
  readonly system: number;
  /** 30% — retrieved context from RAG */
  readonly rag: number;
  /** 30% — conversation history */
  readonly history: number;
  /** 30% — current prompt + tool call results */
  readonly user: number;
}

// ---------------------------------------------------------------------------
// Budget computation
// ---------------------------------------------------------------------------

/**
 * Compute the token budget split from a total context window size.
 *
 * Split: System 10%, RAG 30%, History 30%, User 30% (from M11 spec).
 *
 * @param contextWindow — the model's total context window in tokens
 */
export function computeTokenBudget(contextWindow: number): IOpenclawTokenBudget {
  const clamped = Math.max(0, Math.floor(contextWindow));
  return {
    total: clamped,
    system: Math.floor(clamped * 0.10),
    rag: Math.floor(clamped * 0.30),
    history: Math.floor(clamped * 0.30),
    user: Math.floor(clamped * 0.30),
  };
}

// ---------------------------------------------------------------------------
// Elastic budget computation
// ---------------------------------------------------------------------------

/**
 * Parameters for elastic (demand-driven) budget allocation.
 *
 * Upstream evidence:
 *   - context-engine-maintenance.ts — elastic budget redistributes unused
 *     lane capacity to RAG to maximise grounded context.
 */
export interface IOpenclawElasticBudgetParams {
  readonly contextWindow: number;
  readonly systemActual?: number;
  readonly historyActual?: number;
  readonly userActual?: number;
}

/**
 * Compute an elastic token budget that redistributes surplus to RAG.
 *
 * Fixed-percentage ceilings (10/30/30/30) set the maximum per lane.
 * When a lane's actual usage is below its ceiling, the surplus flows
 * to the RAG lane so retrieved context fills the freed capacity.
 *
 * @param params — context window size and actual token counts per lane
 */
export function computeElasticBudget(params: IOpenclawElasticBudgetParams): IOpenclawTokenBudget {
  const total = Math.max(0, Math.floor(params.contextWindow));
  if (total === 0) {
    return { total: 0, system: 0, rag: 0, history: 0, user: 0 };
  }

  // Fixed-percentage ceilings
  const systemCeil = Math.floor(total * 0.10);
  const ragCeil = Math.floor(total * 0.30);
  const historyCeil = Math.floor(total * 0.30);
  const userCeil = Math.floor(total * 0.30);

  // Actual usage (clamped to ceiling)
  const systemUsed = Math.min(params.systemActual ?? systemCeil, systemCeil);
  const historyUsed = Math.min(params.historyActual ?? historyCeil, historyCeil);
  const userUsed = Math.min(params.userActual ?? userCeil, userCeil);

  // Surplus redistributed to RAG
  const surplus = (systemCeil - systemUsed) + (historyCeil - historyUsed) + (userCeil - userUsed);

  return {
    total,
    system: systemUsed,
    rag: ragCeil + surplus,
    history: historyUsed,
    user: userUsed,
  };
}

// ---------------------------------------------------------------------------
// Token estimation (estimateTokens is re-exported from services/tokenBudgetService)
// ---------------------------------------------------------------------------

/**
 * Estimate token count from an array of chat messages.
 */
export function estimateMessagesTokens(
  messages: readonly { role: string; content: string }[],
): number {
  let total = 0;
  for (const msg of messages) {
    // Each message has role overhead (~4 tokens) + content
    total += 4 + estimateTokens(msg.content);
  }
  return total;
}

/**
 * Trim text to fit within a token budget.
 *
 * Removes from the beginning (oldest content first) to preserve recency.
 * Returns the trimmed text and whether trimming occurred.
 */
export function trimTextToBudget(
  text: string,
  budgetTokens: number,
): { text: string; trimmed: boolean } {
  const estimated = estimateTokens(text);
  if (estimated <= budgetTokens) {
    return { text, trimmed: false };
  }
  // chars / 4 = tokens → chars = tokens * 4
  const maxChars = Math.max(0, budgetTokens * 4);
  if (maxChars === 0) {
    return { text: '', trimmed: estimated > 0 };
  }
  return {
    text: text.slice(-maxChars), // keep the end (most recent)
    trimmed: true,
  };
}
