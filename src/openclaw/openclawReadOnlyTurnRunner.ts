/**
 * Readonly turn runner for non-default OpenClaw participants.
 *
 * Provides the retry loop + tool policy filtering that workspace and canvas
 * participants were missing when they called executeOpenclawModelTurn directly.
 *
 * Upstream evidence:
 *   - agent-runner-execution.ts:113-380 — retry logic applies to ALL agents
 *   - run.ts:879-1860 — transient retry, timeout compaction
 *   - tool-policy-pipeline.ts:44-154 — tool filtering before model call
 *
 * Differences from full turn runner (openclawTurnRunner.ts):
 *   - No context engine lifecycle (no bootstrap/assemble/compact/afterTurn)
 *   - No overflow compaction (readonly participants have small context)
 *   - Transient + timeout retry only
 *   - Readonly tool profile enforced via applyOpenclawToolPolicy
 */

import type {
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolDefinition,
  IToolResult,
} from '../services/chatTypes.js';
import { applyOpenclawToolPolicy } from './openclawToolPolicy.js';
import { isTransientError, isTimeoutError } from './openclawErrorClassification.js';

// ---------------------------------------------------------------------------
// Constants (shared with openclawTurnRunner.ts)
// ---------------------------------------------------------------------------

const MAX_TRANSIENT_RETRIES = 3;
const TRANSIENT_BASE_DELAY = 2500;
const TRANSIENT_MAX_DELAY = 15000;
const MAX_TIMEOUT_RETRIES = 2;

function transientDelay(attempt: number): number {
  return Math.min(TRANSIENT_BASE_DELAY * Math.pow(2, attempt), TRANSIENT_MAX_DELAY);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IReadOnlyTurnOptions {
  /** Model execution function. */
  readonly sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;

  /** Pre-built message array (system + history + user). */
  readonly messages: IChatMessage[];

  /** Request options (temperature, maxTokens, think). Tools will be policy-filtered. */
  readonly requestOptions: Omit<IChatRequestOptions, 'tools'>;

  /** Raw tool definitions — will be filtered through readonly policy. */
  readonly tools: readonly IToolDefinition[];

  /** Response stream for progress/markdown/warnings. */
  readonly response: IChatResponseStream;

  /** Cancellation token. */
  readonly token: ICancellationToken;

  /** Max tool iteration rounds (from OPENCLAW_MAX_READONLY_ITERATIONS). */
  readonly maxIterations: number;

  /** Runtime-controlled tool invocation (required for tool calls). */
  readonly invokeToolWithRuntimeControl?: (
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ) => Promise<IToolResult>;
}

export interface IReadOnlyTurnResult {
  readonly markdown: string;
  readonly thinking: string;
  readonly toolCallCount: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly transientRetries: number;
  readonly timeoutRetries: number;
  readonly completed: boolean;
}

// ---------------------------------------------------------------------------
// Readonly turn runner
// ---------------------------------------------------------------------------

/**
 * Execute a readonly participant turn with retry logic and tool policy.
 *
 * This is the pipeline entry point for workspace and canvas participants.
 * It replaces the previous pattern of calling executeOpenclawModelTurn
 * in a bare loop without error recovery or tool filtering.
 */
export async function runOpenclawReadOnlyTurn(
  options: IReadOnlyTurnOptions,
): Promise<IReadOnlyTurnResult> {
  const { sendChatRequest, messages, requestOptions, response, token, maxIterations } = options;

  // Apply readonly tool policy (upstream: applyToolPolicyPipeline with minimal profile)
  const filteredTools = applyOpenclawToolPolicy({
    tools: options.tools,
    mode: 'readonly',
  });

  const effectiveRequestOptions: IChatRequestOptions = {
    ...requestOptions,
    tools: filteredTools.length > 0 ? filteredTools : undefined,
  };

  let transientRetries = 0;
  let timeoutRetries = 0;
  let totalToolCalls = 0;

  let iterationsRemaining = maxIterations;
  while (iterationsRemaining >= 0 && !token.isCancellationRequested) {
    let markdown = '';
    let thinking = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    const toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];

    try {
      for await (const chunk of sendChatRequest(messages, effectiveRequestOptions)) {
        if (token.isCancellationRequested) {
          break;
        }
        markdown += chunk.content;
        if (chunk.thinking) {
          thinking += chunk.thinking;
          response.thinking(chunk.thinking);
        }
        if (chunk.toolCalls) {
          toolCalls.push(...chunk.toolCalls);
        }
        if (typeof chunk.promptEvalCount === 'number') {
          promptTokens = chunk.promptEvalCount;
        }
        if (typeof chunk.evalCount === 'number') {
          completionTokens = chunk.evalCount;
        }
      }
    } catch (error) {
      // Transient → exponential backoff → retry
      if (isTransientError(error) && transientRetries < MAX_TRANSIENT_RETRIES) {
        const backoff = transientDelay(transientRetries);
        response.progress(`Transient error, retrying in ${backoff}ms...`);
        await delay(backoff);
        transientRetries++;
        continue;
      }

      // Timeout → retry (no compaction available for readonly participants)
      if (isTimeoutError(error) && timeoutRetries < MAX_TIMEOUT_RETRIES) {
        response.progress(`Timeout, retrying (${timeoutRetries + 1}/${MAX_TIMEOUT_RETRIES})...`);
        timeoutRetries++;
        continue;
      }

      throw error;
    }

    // Report token usage
    if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
      response.reportTokenUsage(promptTokens, completionTokens);
    }

    // No tool calls → turn complete
    if (toolCalls.length === 0) {
      if (markdown) {
        response.markdown(markdown);
      }
      return {
        markdown,
        thinking,
        toolCallCount: totalToolCalls,
        promptTokens,
        completionTokens,
        transientRetries,
        timeoutRetries,
        completed: true,
      };
    }

    // Tool calls present but no invocation handler
    if (!options.invokeToolWithRuntimeControl) {
      response.warning('Readonly participant received tool calls, but runtime-controlled tool invocation is not available.');
      if (markdown) {
        response.markdown(markdown);
      }
      return {
        markdown,
        thinking,
        toolCallCount: totalToolCalls,
        promptTokens,
        completionTokens,
        transientRetries,
        timeoutRetries,
        completed: false,
      };
    }

    // Execute tool calls and feed results back
    messages.push({
      role: 'assistant',
      content: markdown,
      toolCalls,
      thinking,
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      totalToolCalls++;
      const toolResult = await options.invokeToolWithRuntimeControl(toolName, toolCall.function.arguments, token);
      messages.push({ role: 'tool', content: toolResult.content, toolName });
    }

    iterationsRemaining -= 1;
  }

  // Iteration budget exhausted or cancelled
  if (!token.isCancellationRequested) {
    response.warning('Readonly participant stopped before completing the turn.');
  }

  return {
    markdown: '',
    thinking: '',
    toolCallCount: totalToolCalls,
    transientRetries,
    timeoutRetries,
    completed: false,
  };
}
