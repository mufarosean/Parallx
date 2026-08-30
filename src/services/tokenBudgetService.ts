// tokenBudgetService.ts — Token budget manager (M11 Task 1.8, M20 Phase G)
//
// M20 Phase G rewrote the allocator from fixed-percentage ceilings to elastic
// demand-driven allocation:
//
//   1. Compute each slot's actual token demand.
//   2. If total demand ≤ context window → return everything (no trimming).
//   3. If over → trim in priority order (lowest priority first) until it fits.
//      Default: History (1) → RAG (2) → SystemPrompt (3). User message is
//      never trimmed.
//
// The old percentage-based `ITokenBudgetConfig` is still accepted by
// `setConfig()` for backward compatibility but is no longer used for
// allocation. The elastic config (`IElasticBudgetConfig`) controls trim
// priorities and optional per-slot minimum floors.
//
// Token estimation uses chars/4 heuristic (same as VS Code).
//
// VS Code reference:
//   VS Code doesn't have a formal budget manager — it uses ad-hoc token counting
//   in chatAgents.ts. This service centralizes the logic.

// ── Types ──

/**
 * Legacy token budget configuration (percentage-based).
 * Kept for backward compatibility with `setConfig()`.
 * No longer used for allocation — elastic config takes priority.
 */
export interface ITokenBudgetConfig {
  /** Budget for system prompt (SOUL.md / AGENTS.md / TOOLS.md / rules). Default: 10 */
  readonly systemPrompt: number;
  /** Budget for RAG context + @mentions. Default: 30 */
  readonly ragContext: number;
  /** Budget for conversation history. Default: 30 */
  readonly history: number;
  /** Budget for user message + explicit attachments. Default: 30 */
  readonly userMessage: number;
}

/**
 * Elastic budget configuration (M20 Phase G).
 *
 * Instead of fixed percentage ceilings, the allocator gives each slot its full
 * demand when the window has capacity. When over budget, it trims slots in
 * priority order (lower number = trimmed first).
 */
export interface IElasticBudgetConfig {
  /** Trim priority per slot (lower = trimmed first). */
  readonly trimPriority: {
    readonly systemPrompt: number;
    readonly ragContext: number;
    readonly history: number;
    readonly userMessage: number;
  };
  /**
   * Minimum percentage floor per slot (0–100). Even when trimming aggressively,
   * each slot keeps at least this percentage of the context window.
   * Default: { systemPrompt: 5, ragContext: 0, history: 0, userMessage: 0 }
   */
  readonly minPercent: {
    readonly systemPrompt: number;
    readonly ragContext: number;
    readonly history: number;
    readonly userMessage: number;
  };
}

/** Slot name literals. */
export type BudgetSlotName = 'systemPrompt' | 'ragContext' | 'history' | 'userMessage';

/**
 * A content slot to be budgeted.
 */
export interface IBudgetSlot {
  /** Slot identifier. */
  readonly name: BudgetSlotName;
  /** The content to budget. */
  readonly content: string;
  /** Whether this content can be trimmed. System prompt and user message are typically not trimmable. */
  readonly trimmable: boolean;
  /** Priority for trimming (lower = trimmed first). History=1, RAG=2, System=3, User=4. */
  readonly trimPriority: number;
}

/**
 * Result of budget allocation.
 */
export interface IBudgetResult {
  /** Whether any content was trimmed. */
  readonly wasTrimmed: boolean;
  /** Trimmed content per slot. */
  readonly slots: Record<string, string>;
  /** Token estimates per slot (post-trim). */
  readonly tokenEstimates: Record<string, number>;
  /** Total estimated tokens (post-trim). */
  readonly totalTokens: number;
  /** Context window size. */
  readonly contextWindow: number;
  /** Warning message if budget was exceeded. */
  readonly warning?: string;
}

// ── Constants ──



// ── Legacy defaults (for backward-compatible getConfig) ──


// ── Service ──

/**
 * Estimate tokens from a string using the chars/4 heuristic (M9 spec).
 *
 * Standalone function for use outside the TokenBudgetService class.
 * Both OpenClaw and built-in chat import this shared estimator.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// (TokenBudgetService class and its config/slot/result interfaces were
// deleted by the Retirement phase: openclawTokenBudget.ts is the live
// elastic-budget implementation and only estimateTokens above was ever
// imported in production.)
