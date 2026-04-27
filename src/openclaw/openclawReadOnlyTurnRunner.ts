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
import { ChatToolLoopSafety } from '../services/chatToolLoopSafety.js';

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
    observer?: import('../services/chatRuntimeTypes.js').IChatRuntimeToolInvocationObserver,
    sessionId?: string,
  ) => Promise<IToolResult>;
  /** D4: Optional tool invocation observer for runtime hooks. */
  readonly toolObserver?: import('../services/chatRuntimeTypes.js').IChatRuntimeToolInvocationObserver;
  /** D4: Optional message lifecycle observer for runtime hooks. */
  readonly messageObserver?: import('../services/serviceTypes.js').IChatRuntimeMessageObserver;
  /** Model name for message hook metadata. */
  readonly modelName?: string;
  /** Caller session id — forwarded to the permission gate for heartbeat-aware routing. */
  readonly sessionId?: string;
}

export interface IReadOnlyTurnResult {
  readonly markdown: string;
  readonly thinking: string;
  readonly toolCallCount: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly durationMs: number;
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

  const turnStartMs = Date.now();
  let transientRetries = 0;
  let timeoutRetries = 0;
  let totalToolCalls = 0;
  const loopSafety = new ChatToolLoopSafety();

  let iterationsRemaining = maxIterations;
  while (iterationsRemaining >= 0 && !token.isCancellationRequested) {
    let markdown = '';
    let thinking = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    const toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];

    try {
      // D4: Fire before-model-call hook
      const modelName = options.modelName ?? 'unknown';
      const hookMessages = options.messageObserver ? messages.map(m => ({ role: m.role, content: m.content })) : undefined;
      if (options.messageObserver?.onBeforeModelCall && hookMessages) {
        try { options.messageObserver.onBeforeModelCall(hookMessages, modelName); } catch (e) { console.warn('[D4] Message hook error:', e); }
      }
      const modelCallStart = Date.now();
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
      // D4: Fire after-model-call hook (reuses snapshot from before-hook)
      if (options.messageObserver?.onAfterModelCall && hookMessages) {
        try { options.messageObserver.onAfterModelCall(hookMessages, modelName, Date.now() - modelCallStart); } catch (e) { console.warn('[D4] Message hook error:', e); }
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
        durationMs: Date.now() - turnStartMs,
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
        durationMs: Date.now() - turnStartMs,
        transientRetries,
        timeoutRetries,
        completed: false,
      };
    }

    // Execute tool calls and feed results back
    // Batch-collect results before appending to messages to avoid partial state
    // if loop safety blocks mid-iteration (matches openclawAttempt.ts pattern).
    const toolResultMessages: IChatMessage[] = [];
    let loopBlocked = false;

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;

      // Safety: detect infinite tool loops
      const safety = loopSafety.record(toolName, toolCall.function.arguments);
      if (safety.blocked) {
        response.warning(`Stopped: repeated identical ${toolName} calls detected.`);
        loopBlocked = true;
        break;
      }

      totalToolCalls++;
      // D4: Fire before-tool hook
      // INVARIANT: Readonly tools are always-allowed with no approval flow — only onValidated + onExecuted fire.
      const hookMetadata = { name: toolName, permissionLevel: 'always-allowed' as const, enabled: true, requiresApproval: false, autoApproved: true, approvalSource: 'default' as const, source: 'built-in' as const };
      if (options.toolObserver?.onValidated) {
        try { options.toolObserver.onValidated(hookMetadata); } catch (e) { console.warn('[D4] Readonly tool hook error:', e); }
      }
      const toolResult = await options.invokeToolWithRuntimeControl(toolName, toolCall.function.arguments, token, undefined, options.sessionId);
      // D4: Fire after-tool hook (approval hooks skipped — readonly tools have no approval flow)
      if (options.toolObserver?.onExecuted) {
        try { options.toolObserver.onExecuted(hookMetadata, toolResult); } catch (e) { console.warn('[D4] Readonly tool hook error:', e); }
      }
      toolResultMessages.push({ role: 'tool', content: toolResult.content, toolName });
    }

    // Batch-append: one assistant message + all collected tool result messages
    if (toolResultMessages.length > 0) {
      messages.push({
        role: 'assistant',
        content: markdown,
        toolCalls,
        thinking,
      });
      messages.push(...toolResultMessages);
    }

    if (loopBlocked) {
      break;
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
    durationMs: Date.now() - turnStartMs,
    transientRetries,
    timeoutRetries,
    completed: false,
  };
}
