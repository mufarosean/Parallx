/**
 * Single attempt execution for the OpenClaw execution pipeline (Layer 2).
 *
 * Upstream evidence:
 *   - attempt.ts:1672-3222 — runEmbeddedAttempt: single attempt lifecycle
 *   - attempt.ts — shouldInjectOllamaCompatNumCtx, wrapOllamaCompatNumCtx
 *
 * Parallx adaptation:
 *   - Builds system prompt (System 3: openclawSystemPrompt)
 *   - Filters tools (System 4: openclawToolPolicy)
 *   - Builds messages: [system, ...assembled, user]
 *   - Executes model turn with num_ctx + tool loop
 *   - Finalizes context engine turn
 */

import type {
  IChatMessage,
  IChatParticipantRequest,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolCall,
  IToolDefinition,
  IToolResult,
} from '../services/chatTypes.js';
import type { IOpenclawAssembleResult, IOpenclawContextEngine } from './openclawContextEngine.js';
import type { IOpenclawSystemPromptParams, IBootstrapFile, ISkillEntry, IToolSummary, IOpenclawRuntimeInfo } from './openclawSystemPrompt.js';
import type { IToolPermissions, OpenclawToolProfile } from './openclawToolPolicy.js';
import type { IChatRuntimeToolInvocationObserver } from './openclawTypes.js';
import { buildOpenclawSystemPrompt } from './openclawSystemPrompt.js';
import { applyOpenclawToolPolicy } from './openclawToolPolicy.js';
import { ChatToolLoopSafety } from '../services/chatToolLoopSafety.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum characters per tool result before truncation.
 * 20 000 chars ≈ 5 000 tokens — leaves room for multiple tool results per turn
 * without blowing out the context window.
 */
const MAX_TOOL_RESULT_CHARS = 20_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The full turn context needed by the execution pipeline.
 *
 * Built by the participant before calling runOpenclawTurn.
 * Every field must be available at turn start — no lazy resolution.
 */
export interface IOpenclawTurnContext {
  readonly sessionId: string;
  readonly history: readonly IChatMessage[];
  readonly tokenBudget: number;
  readonly engine: IOpenclawContextEngine;

  // System prompt inputs
  readonly bootstrapFiles: readonly IBootstrapFile[];
  readonly workspaceDigest: string;
  readonly skills: readonly ISkillEntry[];
  readonly runtimeInfo: IOpenclawRuntimeInfo;
  readonly preferencesPrompt?: string;
  readonly promptOverlay?: string;

  // Tool inputs
  readonly tools: readonly IToolDefinition[];
  readonly toolMode: OpenclawToolProfile;
  readonly toolPermissions?: IToolPermissions;
  readonly maxToolIterations: number;

  // Model execution
  readonly sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readonly invokeToolWithRuntimeControl?: (
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
    observer?: IChatRuntimeToolInvocationObserver,
  ) => Promise<IToolResult>;
}

/**
 * Result from a single attempt execution.
 */
export interface IOpenclawAttemptResult {
  readonly markdown: string;
  readonly thinking: string;
  readonly toolCallCount: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly ragSources: readonly { uri: string; label: string; index: number }[];
}

// ---------------------------------------------------------------------------
// Attempt execution
// ---------------------------------------------------------------------------

/**
 * Execute a single attempt in the pipeline.
 *
 * Upstream: runEmbeddedAttempt (attempt.ts:1672-3222)
 *
 * Lifecycle:
 *   1. Build system prompt (System 3)
 *   2. Filter tools (System 4)
 *   3. Build messages [system, ...assembled.messages, user]
 *   4. Execute model turn with num_ctx
 *   5. Handle tool calls in a loop (if model requests tools)
 *   6. Finalize context engine turn
 *   7. Return result
 */
export async function executeOpenclawAttempt(
  request: IChatParticipantRequest,
  context: IOpenclawTurnContext,
  assembled: IOpenclawAssembleResult,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IOpenclawAttemptResult> {

  // 1. Build tool summaries for prompt injection
  const toolSummaries: IToolSummary[] = context.tools.map(t => ({
    name: t.name,
    description: t.description,
  }));

  // 2. Build system prompt (System 3)
  const systemPromptParams: IOpenclawSystemPromptParams = {
    bootstrapFiles: context.bootstrapFiles,
    workspaceDigest: context.workspaceDigest,
    skills: context.skills,
    tools: toolSummaries,
    runtimeInfo: context.runtimeInfo,
    systemPromptAddition: assembled.systemPromptAddition,
    preferencesPrompt: context.preferencesPrompt,
    promptOverlay: context.promptOverlay,
  };
  const systemPrompt = buildOpenclawSystemPrompt(systemPromptParams);

  // 3. Filter tools (System 4)
  const allowedTools = applyOpenclawToolPolicy({
    tools: context.tools,
    mode: context.toolMode,
    permissions: context.toolPermissions,
  });

  // 4. Build messages: [system, ...context history, user]
  const messages: IChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...assembled.messages,
    { role: 'user', content: request.text, images: request.attachments?.filter(a => a.kind === 'image') },
  ];

  // 5. Execute model turn with tool loop
  //    Upstream: wrapOllamaCompatNumCtx wraps stream to inject num_ctx
  //    Parallx: pass tokenBudget as numCtx so Ollama allocates matching KV cache
  const requestOptions: IChatRequestOptions = {
    think: true,
    tools: allowedTools.length > 0 ? allowedTools : undefined,
    numCtx: context.tokenBudget,
  };

  const loopSafety = new ChatToolLoopSafety();
  let markdown = '';
  let thinking = '';
  let toolCallCount = 0;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let currentMessages = messages;
  let iterations = 0;

  while (!token.isCancellationRequested && iterations < context.maxToolIterations + 1) {
    // Execute model call
    const turnResult = await executeModelStream(
      context.sendChatRequest,
      currentMessages,
      requestOptions,
      response,
      token,
    );

    markdown = turnResult.markdown;
    thinking = turnResult.thinking;
    promptTokens = turnResult.promptTokens;
    completionTokens = turnResult.completionTokens;

    // No tool calls → done
    if (turnResult.toolCalls.length === 0) {
      break;
    }

    // Process tool calls
    if (!context.invokeToolWithRuntimeControl) {
      break; // No tool execution capability
    }

    // Collect all tool results first, then batch-append to messages.
    // This avoids duplicating the assistant message for each tool result
    // when the model returns multiple tool calls in a single turn.
    const toolResultMessages: IChatMessage[] = [];
    let loopBlocked = false;

    for (const toolCall of turnResult.toolCalls) {
      if (token.isCancellationRequested) break;

      // Safety: detect infinite tool loops
      const safety = loopSafety.record(toolCall.function.name, toolCall.function.arguments);
      if (safety.blocked) {
        loopBlocked = true;
        break;
      }

      // Execute the tool
      response.beginToolInvocation(
        `${toolCall.function.name}-${toolCallCount}`,
        toolCall.function.name,
        toolCall.function.arguments,
      );

      const toolResult = await context.invokeToolWithRuntimeControl(
        toolCall.function.name,
        toolCall.function.arguments,
        token,
      );
      toolCallCount++;

      response.updateToolInvocation(
        `${toolCall.function.name}-${toolCallCount - 1}`,
        { isComplete: true, isError: toolResult.isError, result: toolResult },
      );

      // Truncate oversized results to stay within token budget
      let resultContent = toolResult.content;
      if (resultContent.length > MAX_TOOL_RESULT_CHARS) {
        resultContent = resultContent.slice(0, MAX_TOOL_RESULT_CHARS)
          + `\n\n... (truncated, ${resultContent.length} chars total)`;
      }

      toolResultMessages.push({
        role: 'tool',
        content: resultContent,
        toolName: toolCall.function.name,
      });
    }

    // Batch-append: one assistant message + all tool result messages
    if (toolResultMessages.length > 0) {
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: markdown, toolCalls: turnResult.toolCalls },
        ...toolResultMessages,
      ];
    }

    if (loopBlocked) {
      break;
    }

    iterations++;
    // Reset markdown for next iteration — the model will produce a new response
    markdown = '';
  }

  // 6. Stream final markdown to response
  if (markdown) {
    response.markdown(markdown);
  }

  // 7. Finalize context engine turn
  const allMessages: IChatMessage[] = [
    ...currentMessages,
    { role: 'assistant', content: markdown },
  ];
  await context.engine.afterTurn?.({
    sessionId: context.sessionId,
    messages: allMessages,
  });

  // 8. Report token usage
  if (promptTokens != null && completionTokens != null) {
    response.reportTokenUsage(promptTokens, completionTokens);
  }

  return {
    markdown,
    thinking,
    toolCallCount,
    promptTokens,
    completionTokens,
    ragSources: assembled.ragSources,
  };
}

// ---------------------------------------------------------------------------
// Model execution helper
// ---------------------------------------------------------------------------

/**
 * Execute a single model call and stream the response.
 *
 * Adapted from the existing executeOpenclawModelTurn in openclawParticipantRuntime.ts,
 * but simplified: handles streaming, collects markdown/thinking/toolCalls/tokens.
 *
 * Note: markdown is NOT streamed to the response here — the caller handles
 * that after the tool loop completes, to avoid partial markdown from
 * iterations that will be followed by tool results.
 */
async function executeModelStream(
  sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>,
  messages: readonly IChatMessage[],
  options: IChatRequestOptions,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<{
  markdown: string;
  thinking: string;
  toolCalls: IToolCall[];
  promptTokens?: number;
  completionTokens?: number;
}> {
  let markdown = '';
  let thinking = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  const toolCalls: IToolCall[] = [];

  for await (const chunk of sendChatRequest(messages, options)) {
    if (token.isCancellationRequested) break;

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

  return { markdown, thinking, toolCalls, promptTokens, completionTokens };
}
