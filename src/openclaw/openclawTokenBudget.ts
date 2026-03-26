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
  return {
    text: text.slice(-maxChars), // keep the end (most recent)
    trimmed: true,
  };
}
