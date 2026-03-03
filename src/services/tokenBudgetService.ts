// tokenBudgetService.ts — Token budget manager (M11 Task 1.8)
//
// Allocates the model's context window into priority-based slots:
//   System prompt (SOUL.md + AGENTS.md + TOOLS.md + rules): 10%
//   RAG context (auto-retrieved + @mentions):               30%
//   Conversation history:                                   30%
//   User message (current message + explicit attachments):  30%
//
// When a slot overflows, content is trimmed with this priority:
//   1. Trim history (oldest first)
//   2. Trim RAG results (lowest-scoring first)
//   3. Warn user (never trim system prompt or current message)
//
// Token estimation uses chars/4 heuristic (same as VS Code).
//
// VS Code reference:
//   VS Code doesn't have a formal budget manager — it uses ad-hoc token counting
//   in chatAgents.ts. This service centralizes the logic.

// ── Types ──

/**
 * Token budget configuration.
 * Each field is a percentage (0-100) of the total context window.
 * Must sum to 100.
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
 * A content slot to be budgeted.
 */
export interface IBudgetSlot {
  /** Slot identifier. */
  readonly name: 'systemPrompt' | 'ragContext' | 'history' | 'userMessage';
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
  /** Token estimates per slot. */
  readonly tokenEstimates: Record<string, number>;
  /** Total estimated tokens. */
  readonly totalTokens: number;
  /** Context window size. */
  readonly contextWindow: number;
  /** Warning message if budget was exceeded. */
  readonly warning?: string;
}

// ── Constants ──

const DEFAULT_BUDGET: ITokenBudgetConfig = {
  systemPrompt: 10,
  ragContext: 30,
  history: 30,
  userMessage: 30,
};

// ── Service ──

/**
 * Token budget manager.
 *
 * Allocates context window into prioritized slots, trims overflowing content,
 * and provides token estimates for transparency.
 */
export class TokenBudgetService {

  private _config: ITokenBudgetConfig = DEFAULT_BUDGET;

  /** Update budget configuration. */
  setConfig(config: Partial<ITokenBudgetConfig>): void {
    this._config = {
      systemPrompt: config.systemPrompt ?? DEFAULT_BUDGET.systemPrompt,
      ragContext: config.ragContext ?? DEFAULT_BUDGET.ragContext,
      history: config.history ?? DEFAULT_BUDGET.history,
      userMessage: config.userMessage ?? DEFAULT_BUDGET.userMessage,
    };
  }

  /** Get current budget configuration. */
  getConfig(): Readonly<ITokenBudgetConfig> {
    return this._config;
  }

  /**
   * Estimate tokens from a string using the chars/4 heuristic.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Allocate content to budget slots and trim if necessary.
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

    // Under budget — return as-is
    if (totalTokens <= contextWindow) {
      return {
        wasTrimmed: false,
        slots,
        tokenEstimates,
        totalTokens,
        contextWindow,
      };
    }

    // Over budget — trim in priority order
    // Priority: history first (lowest priority), then RAG, then warn
    const budget = {
      systemPrompt: Math.floor(contextWindow * this._config.systemPrompt / 100),
      ragContext: Math.floor(contextWindow * this._config.ragContext / 100),
      history: Math.floor(contextWindow * this._config.history / 100),
      userMessage: Math.floor(contextWindow * this._config.userMessage / 100),
    };

    let wasTrimmed = false;
    let warning: string | undefined;

    // System prompt: never trim, but can overflow into other slots
    // User message: never trim — this is the current user's request

    // 1. Trim history to fit budget
    if (tokenEstimates.history > budget.history) {
      const trimmed = this._trimToTokenBudget(history, budget.history);
      slots.history = trimmed;
      tokenEstimates.history = this.estimateTokens(trimmed);
      wasTrimmed = true;
    }

    // 2. Trim RAG context if still over budget
    const afterHistoryTrim = tokenEstimates.systemPrompt + tokenEstimates.ragContext + tokenEstimates.history + tokenEstimates.userMessage;
    if (afterHistoryTrim > contextWindow && tokenEstimates.ragContext > budget.ragContext) {
      const trimmed = this._trimToTokenBudget(ragContext, budget.ragContext);
      slots.ragContext = trimmed;
      tokenEstimates.ragContext = this.estimateTokens(trimmed);
      wasTrimmed = true;
    }

    // 3. Check final total
    const finalTotal = Object.values(tokenEstimates).reduce((a, b) => a + b, 0);
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
   * For history: removes oldest messages (from the start).
   * For RAG: removes text from the end (lowest-scoring chunks are typically last).
   */
  private _trimToTokenBudget(text: string, maxTokens: number): string {
    const targetChars = maxTokens * 4; // Reverse chars/4 heuristic
    if (text.length <= targetChars) {
      return text;
    }

    // Try to trim at paragraph boundaries (double newline)
    const paragraphs = text.split('\n\n');
    let result = '';
    // Keep from the END for history (most recent messages)
    // Build from the end to keep the most recent content
    const kept: string[] = [];
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const candidate = [paragraphs[i], ...kept].join('\n\n');
      if (candidate.length > targetChars) {
        break;
      }
      kept.unshift(paragraphs[i]);
    }

    result = kept.join('\n\n');
    if (result.length === 0 && text.length > 0) {
      // Fallback: hard-truncate from the end
      result = text.slice(-targetChars);
    }

    return result;
  }
}
