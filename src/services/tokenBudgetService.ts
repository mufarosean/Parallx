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

const DEFAULT_ELASTIC_CONFIG: IElasticBudgetConfig = {
  trimPriority: {
    systemPrompt: 3,  // trim last (important system context)
    ragContext: 2,     // trim second
    history: 1,        // trim first (oldest messages most expendable)
    userMessage: 4,    // never trim (current request)
  },
  minPercent: {
    systemPrompt: 5,   // always keep at least 5% for system prompt
    ragContext: 0,
    history: 0,
    userMessage: 0,
  },
};

/** Slot → trim direction mapping. */
const TRIM_DIRECTION: Record<BudgetSlotName, 'start' | 'end'> = {
  systemPrompt: 'start', // keep beginning of system prompt
  ragContext: 'start',    // keep highest-scored chunks (first)
  history: 'end',         // keep most recent messages (last)
  userMessage: 'start',   // keep beginning of user message
};

// ── Legacy defaults (for backward-compatible getConfig) ──

const DEFAULT_LEGACY_BUDGET: ITokenBudgetConfig = {
  systemPrompt: 10,
  ragContext: 30,
  history: 30,
  userMessage: 30,
};

// ── Service ──

/**
 * Token budget manager.
 *
 * Allocates context window using elastic demand-driven logic. Each slot gets
 * its full demand when the context window has capacity. When over budget, slots
 * are trimmed in priority order (lowest first) until the total fits.
 */
export class TokenBudgetService {

  private _legacyConfig: ITokenBudgetConfig = DEFAULT_LEGACY_BUDGET;
  private _elasticConfig: IElasticBudgetConfig = DEFAULT_ELASTIC_CONFIG;

  /**
   * Update budget configuration.
   *
   * Accepts either legacy percentage config (backward compat) or elastic config.
   * If a legacy config is provided, it is stored for `getConfig()` but does NOT
   * affect allocation — the elastic allocator is always used.
   */
  setConfig(config: Partial<ITokenBudgetConfig>): void {
    this._legacyConfig = {
      systemPrompt: config.systemPrompt ?? DEFAULT_LEGACY_BUDGET.systemPrompt,
      ragContext: config.ragContext ?? DEFAULT_LEGACY_BUDGET.ragContext,
      history: config.history ?? DEFAULT_LEGACY_BUDGET.history,
      userMessage: config.userMessage ?? DEFAULT_LEGACY_BUDGET.userMessage,
    };
  }

  /** Update elastic budget configuration (M20 Phase G). */
  setElasticConfig(config: Partial<IElasticBudgetConfig>): void {
    this._elasticConfig = {
      trimPriority: { ...DEFAULT_ELASTIC_CONFIG.trimPriority, ...config.trimPriority },
      minPercent: { ...DEFAULT_ELASTIC_CONFIG.minPercent, ...config.minPercent },
    };
  }

  /** Get current elastic config. */
  getElasticConfig(): Readonly<IElasticBudgetConfig> {
    return this._elasticConfig;
  }

  /** Get legacy budget configuration (backward compat). */
  getConfig(): Readonly<ITokenBudgetConfig> {
    return this._legacyConfig;
  }

  /**
   * Estimate tokens from a string using the chars/4 heuristic.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Allocate content to budget slots using elastic demand-driven logic.
   *
   * 1. If total demand ≤ context window → return everything (no trimming).
   * 2. If over → trim slots in priority order (lowest priority first).
   * 3. Each slot is trimmed to free tokens for over-budget total.
   * 4. Min-percent floors are respected (slot keeps at least that % of window).
   *
   * @param contextWindow Total context window size in tokens (0 = no limit).
   * @param systemPrompt System prompt content.
   * @param ragContext RAG context content.
   * @param history Conversation history content.
   * @param userMessage Current user message + attachments.
   * @returns Budget allocation result with potentially trimmed content.
   */
  allocate(
    contextWindow: number,
    systemPrompt: string,
    ragContext: string,
    history: string,
    userMessage: string,
  ): IBudgetResult {
    const slots: Record<string, string> = {
      systemPrompt,
      ragContext,
      history,
      userMessage,
    };

    const tokenEstimates: Record<string, number> = {
      systemPrompt: this.estimateTokens(systemPrompt),
      ragContext: this.estimateTokens(ragContext),
      history: this.estimateTokens(history),
      userMessage: this.estimateTokens(userMessage),
    };

    const totalTokens = Object.values(tokenEstimates).reduce((a, b) => a + b, 0);

    // No context window limit — return as-is
    if (contextWindow <= 0) {
      return {
        wasTrimmed: false,
        slots,
        tokenEstimates,
        totalTokens,
        contextWindow: 0,
      };
    }

    // Under budget — return as-is (elastic: everyone gets what they need)
    if (totalTokens <= contextWindow) {
      return {
        wasTrimmed: false,
        slots,
        tokenEstimates,
        totalTokens,
        contextWindow,
      };
    }

    // ── Over budget: elastic trimming ──
    //
    // Sort trimmable slots by priority (lowest = trimmed first).
    // For each slot in order, compute how much to trim to bring total
    // within the window, respecting the min-percent floor.

    const { trimPriority, minPercent } = this._elasticConfig;
    const slotNames: BudgetSlotName[] = ['systemPrompt', 'ragContext', 'history', 'userMessage'];

    // Sort by trim priority (ascending = trimmed first)
    const trimOrder = slotNames
      .filter(name => trimPriority[name] < 4) // priority 4 = never trim (user message)
      .sort((a, b) => trimPriority[a] - trimPriority[b]);

    let wasTrimmed = false;

    for (const slotName of trimOrder) {
      const currentTotal = Object.values(tokenEstimates).reduce((a, b) => a + b, 0);
      if (currentTotal <= contextWindow) break; // We fit now

      const excess = currentTotal - contextWindow;
      const currentTokens = tokenEstimates[slotName];
      const floor = Math.floor(contextWindow * minPercent[slotName] / 100);
      const maxTrimmable = Math.max(0, currentTokens - floor);

      if (maxTrimmable <= 0) continue; // Already at or below floor

      // Trim this slot by min(excess, maxTrimmable)
      const trimAmount = Math.min(excess, maxTrimmable);
      const targetTokens = currentTokens - trimAmount;
      const direction = TRIM_DIRECTION[slotName];

      const trimmed = this._trimToTokenBudget(slots[slotName], targetTokens, direction);
      slots[slotName] = trimmed;
      tokenEstimates[slotName] = this.estimateTokens(trimmed);
      wasTrimmed = true;
    }

    // Check final total
    const finalTotal = Object.values(tokenEstimates).reduce((a, b) => a + b, 0);
    let warning: string | undefined;
    if (finalTotal > contextWindow) {
      warning = `Context exceeds model limit (${finalTotal} / ${contextWindow} tokens). Older messages were trimmed.`;
    }

    return {
      wasTrimmed,
      slots,
      tokenEstimates,
      totalTokens: finalTotal,
      contextWindow,
      warning,
    };
  }

  /**
   * Get a breakdown of token usage for display purposes.
   */
  getBreakdown(result: IBudgetResult): Array<{ name: string; tokens: number; percentage: number }> {
    const total = result.totalTokens || 1;
    return [
      { name: 'System Prompt', tokens: result.tokenEstimates.systemPrompt, percentage: Math.round(result.tokenEstimates.systemPrompt / total * 100) },
      { name: 'RAG Context', tokens: result.tokenEstimates.ragContext, percentage: Math.round(result.tokenEstimates.ragContext / total * 100) },
      { name: 'History', tokens: result.tokenEstimates.history, percentage: Math.round(result.tokenEstimates.history / total * 100) },
      { name: 'User Message', tokens: result.tokenEstimates.userMessage, percentage: Math.round(result.tokenEstimates.userMessage / total * 100) },
    ];
  }

  // ── Private helpers ──

  /**
   * Trim text to fit within a token budget.
   *
   * @param keepFrom `'end'` keeps the LAST paragraphs (for history — most recent messages).
   *                 `'start'` keeps the FIRST paragraphs (for RAG — highest-scored chunks).
   */
  private _trimToTokenBudget(text: string, maxTokens: number, keepFrom: 'start' | 'end' = 'end'): string {
    const targetChars = maxTokens * 4; // Reverse chars/4 heuristic
    if (text.length <= targetChars) {
      return text;
    }

    // Try to trim at paragraph boundaries (double newline)
    const paragraphs = text.split('\n\n');
    const kept: string[] = [];

    if (keepFrom === 'start') {
      // Keep from the START for RAG (highest-scored chunks first)
      for (let i = 0; i < paragraphs.length; i++) {
        const candidate = [...kept, paragraphs[i]].join('\n\n');
        if (candidate.length > targetChars) {
          break;
        }
        kept.push(paragraphs[i]);
      }
    } else {
      // Keep from the END for history (most recent messages)
      for (let i = paragraphs.length - 1; i >= 0; i--) {
        const candidate = [paragraphs[i], ...kept].join('\n\n');
        if (candidate.length > targetChars) {
          break;
        }
        kept.unshift(paragraphs[i]);
      }
    }

    let result = kept.join('\n\n');
    if (result.length === 0 && text.length > 0) {
      // Fallback: hard-truncate from the appropriate end
      if (targetChars <= 0) {
        return '';
      }
      result = keepFrom === 'start'
        ? text.slice(0, targetChars)
        : text.slice(-targetChars);
    }

    return result;
  }
}
