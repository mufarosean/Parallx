import type { IChatMessage, IChatResponseStream } from '../../../services/chatTypes.js';
import { TokenBudgetService, type IElasticBudgetConfig } from '../../../services/tokenBudgetService.js';

const BUDGET_FALLBACK_CTX = 8192;
const CONTEXT_OVERFLOW_WARN_THRESHOLD = 0.8;

function estimateTokens(messages: readonly IChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += message.content.length;
  }
  return Math.ceil(chars / 4);
}

export interface IApplyChatTurnBudgetingOptions {
  readonly messages: IChatMessage[];
  readonly contextParts: string[];
  readonly userText: string;
  readonly response: IChatResponseStream;
  readonly contextWindow?: number;
  readonly elasticBudget?: IElasticBudgetConfig;
  readonly reportBudget?: (slots: ReadonlyArray<{ label: string; used: number; allocated: number; color: string }>) => void;
}

export function applyChatTurnBudgeting(options: IApplyChatTurnBudgetingOptions): void {
  const contextWindow = options.contextWindow || BUDGET_FALLBACK_CTX;

  if (options.contextParts.length > 0) {
    const budgetService = new TokenBudgetService();
    if (options.elasticBudget) {
      budgetService.setElasticConfig({
        trimPriority: options.elasticBudget.trimPriority,
        minPercent: options.elasticBudget.minPercent,
      });
    }

    const ragContent = options.contextParts.join('\n\n');
    const historyContent = options.messages
      .filter((message) => message.role !== 'system')
      .map((message) => message.content)
      .join('\n');

    const budgetResult = budgetService.allocate(
      contextWindow,
      options.messages[0]?.content ?? '',
      ragContent,
      historyContent,
      options.userText,
    );

    if (budgetResult.wasTrimmed && budgetResult.slots['ragContext'] !== ragContent) {
      options.contextParts.length = 0;
      const trimmed = budgetResult.slots['ragContext'];
      if (trimmed) {
        options.contextParts.push(trimmed);
      }
    }

    if (budgetResult.wasTrimmed && budgetResult.slots['history'] !== historyContent) {
      const trimmedHistory = budgetResult.slots['history'];
      while (options.messages.length > 1) {
        options.messages.pop();
      }
      if (trimmedHistory) {
        options.messages.push({
          role: 'user',
          content: '[Summarized conversation context]\n' + trimmedHistory,
        });
        options.messages.push({
          role: 'assistant',
          content: 'Understood, I have the context.',
        });
      }
    }

    if (budgetResult.warning) {
      options.response.progress(budgetResult.warning);
    }

    options.reportBudget?.([
      {
        label: 'System',
        used: Math.ceil((options.messages[0]?.content ?? '').length / 4),
        allocated: Math.ceil((options.messages[0]?.content ?? '').length / 4),
        color: '#6c71c4',
      },
      {
        label: 'RAG',
        used: Math.ceil((budgetResult.slots['ragContext'] ?? ragContent).length / 4),
        allocated: Math.ceil((budgetResult.slots['ragContext'] ?? ragContent).length / 4),
        color: '#268bd2',
      },
      {
        label: 'History',
        used: Math.ceil((budgetResult.slots['history'] ?? historyContent).length / 4),
        allocated: Math.ceil((budgetResult.slots['history'] ?? historyContent).length / 4),
        color: '#859900',
      },
      {
        label: 'User',
        used: Math.ceil(options.userText.length / 4),
        allocated: Math.ceil(options.userText.length / 4),
        color: '#cb4b16',
      },
    ]);
  }

  const warnThreshold = Math.floor(contextWindow * CONTEXT_OVERFLOW_WARN_THRESHOLD);
  let tokenEstimate = estimateTokens(options.messages);

  if (tokenEstimate > contextWindow) {
    while (tokenEstimate > contextWindow && options.messages.length > 2) {
      options.messages.splice(1, 1);
      tokenEstimate = estimateTokens(options.messages);
    }

    if (options.messages.length <= 2) {
      options.response.warning(
        `Context window full (${tokenEstimate} / ${contextWindow} estimated tokens). `
        + 'All previous conversation history has been dropped. Use /compact to manage context.',
      );
    }
  } else if (tokenEstimate > warnThreshold) {
    options.response.warning(
      `Approaching context limit (${tokenEstimate} / ${contextWindow} estimated tokens). `
      + 'Older messages may be dropped automatically if the conversation continues.',
    );
  }
}