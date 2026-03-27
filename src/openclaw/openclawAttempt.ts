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
  IToolResult,
} from '../services/chatTypes.js';
import type { IOpenclawAssembleResult, IOpenclawContextEngine } from './openclawContextEngine.js';
import type { IBootstrapFile, IOpenclawRuntimeInfo } from './openclawSystemPrompt.js';
import type { IChatRuntimeToolInvocationObserver } from './openclawTypes.js';
import type { IOpenclawBootstrapDebugReport, IOpenclawSystemPromptReport } from '../services/chatRuntimeTypes.js';
import { ChatToolLoopSafety } from '../services/chatToolLoopSafety.js';
import { estimateMessagesTokens, estimateTokens } from './openclawTokenBudget.js';
import type { IOpenclawRuntimeSkillState } from './openclawSkillState.js';
import { buildOpenclawPromptArtifacts } from './openclawPromptArtifacts.js';
import type { IOpenclawRuntimeToolState } from './openclawToolState.js';
import { resolveModelTier } from './openclawModelTier.js';
import { validateCitations } from './openclawResponseValidation.js';

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
  readonly bootstrapDebugReport: IOpenclawBootstrapDebugReport;
  readonly workspaceDigest: string;
  readonly skillState: IOpenclawRuntimeSkillState;
  readonly runtimeInfo: IOpenclawRuntimeInfo;
  readonly preferencesPrompt?: string;
  readonly promptOverlay?: string;
  readonly reportSystemPromptReport?: (report: IOpenclawSystemPromptReport) => void;
  /** The participant handling this turn (e.g., 'parallx.chat.default'). */
  readonly participantId?: string;

  // M2: Mention context blocks to inject
  readonly mentionContextBlocks?: readonly string[];

  // Model parameters from config
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** When false, skip workspace retrieval (RAG). Defaults to true. */
  readonly autoRag?: boolean;

  // Tool inputs
  readonly toolState: IOpenclawRuntimeToolState;
  readonly maxToolIterations: number;

  // Model execution
  readonly sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  /** Ordered list of fallback model IDs to try if primary fails. */
  readonly fallbackModels?: readonly string[];
  /** Callback to rebuild sendChatRequest for a different model. */
  readonly rebuildSendChatRequest?: (modelId: string) => IOpenclawTurnContext['sendChatRequest'];
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
  readonly validatedCitations?: readonly { uri: string; label: string; index: number }[];
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

  const promptArtifacts = buildOpenclawPromptArtifacts({
    source: 'run',
    bootstrapFiles: context.bootstrapFiles,
    bootstrapReport: context.bootstrapDebugReport,
    workspaceDigest: context.workspaceDigest,
    skillState: context.skillState,
    toolState: context.toolState,
    runtimeInfo: context.runtimeInfo,
    systemPromptAddition: assembled.systemPromptAddition,
    preferencesPrompt: context.preferencesPrompt,
    promptOverlay: context.promptOverlay,
    modelTier: resolveModelTier(context.runtimeInfo.model),
    systemBudgetTokens: Math.floor(context.tokenBudget * 0.10),
    promptProvenance: {
      rawUserInput: request.text,
      parsedUserText: request.text,
      contextQueryText: request.text,
      participantId: context.participantId,
      command: request.command,
      attachmentCount: request.attachments?.length ?? 0,
      historyTurns: Math.floor(context.history.length / 2),
      seedMessageCount: assembled.messages.length + 2,
      modelMessageCount: assembled.messages.length + (context.mentionContextBlocks?.length ? 3 : 2),
      modelMessageRoles: [
        'system',
        ...assembled.messages.map((message) => message.role),
        ...(context.mentionContextBlocks?.length ? ['user'] : []),
        'user',
      ],
      finalUserMessage: request.text,
    },
  });
  const systemPrompt = promptArtifacts.systemPrompt;
  context.reportSystemPromptReport?.(promptArtifacts.report);

  // 2b. System prompt budget check (warning only).
  //     RAG content now flows through assembled.messages, not systemPromptAddition,
  //     so the system prompt should naturally fit within 10%. If it doesn't,
  //     log a warning — the overflow → compact → retry cycle handles oversize.
  const effectiveSystemPrompt = systemPrompt;
  const systemBudget = Math.floor(context.tokenBudget * 0.10);
  if (systemBudget > 0) {
    const systemTokens = estimateTokens(systemPrompt);
    if (systemTokens > systemBudget) {
      console.warn(
        `[OpenClaw] System prompt (${systemTokens} tokens) exceeds 10% budget (${systemBudget} tokens). Overflow cycle will handle if needed.`,
      );
    }
  }

  // 4. Build messages: [system, ...context history, mention context, user]
  //    M2: Inject mention context blocks between assembled context and user query
  const mentionMessages: IChatMessage[] = context.mentionContextBlocks?.length
    ? [{ role: 'user' as const, content: context.mentionContextBlocks.join('\n\n---\n\n') }]
    : [];

  const messages: IChatMessage[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...assembled.messages,
    ...mentionMessages,
    { role: 'user', content: request.text, images: request.attachments?.filter(a => a.kind === 'image') },
  ];

  // 5. Execute model turn with tool loop
  //    Upstream: wrapOllamaCompatNumCtx wraps stream to inject num_ctx
  //    Parallx: pass tokenBudget as numCtx so Ollama allocates matching KV cache
  const requestOptions: IChatRequestOptions = {
    think: true,
    tools: context.toolState.availableDefinitions.length > 0 ? context.toolState.availableDefinitions : undefined,
    numCtx: context.tokenBudget,
    temperature: context.temperature,
    maxTokens: context.maxTokens || undefined,
  };

  const loopSafety = new ChatToolLoopSafety();
  let markdown = '';
  let thinking = '';
  let toolCallCount = 0;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let currentMessages = messages;
  let iterations = 0;

  try {
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

    // Mid-loop budget check: estimate total token usage after tool results.
    // If accumulated messages exceed budget, compact before next model call.
    // Upstream: re-budgets after each tool call in loop.
    const loopTokenEstimate = estimateMessagesTokens(currentMessages);
    if (context.tokenBudget > 0 && loopTokenEstimate > context.tokenBudget * 0.85) {
      response.progress(`Tool loop context near capacity (${loopTokenEstimate}/${context.tokenBudget} tokens), compacting...`);
      try {
        await context.engine.compact({
          sessionId: context.sessionId,
          tokenBudget: context.tokenBudget,
        });
        // Re-assemble after compaction to get trimmed history
        const reAssembled = await context.engine.assemble({
          sessionId: context.sessionId,
          history: context.history,
          tokenBudget: context.tokenBudget,
          prompt: request.text,
        });
        // Rebuild messages: system prompt stays, use re-assembled history,
        // keep recent tool exchange, add user message
        currentMessages = [
          currentMessages[0], // system prompt
          ...reAssembled.messages,
          ...mentionMessages,
          { role: 'user', content: request.text, images: request.attachments?.filter(a => a.kind === 'image') },
          { role: 'assistant', content: markdown, toolCalls: turnResult.toolCalls },
          ...toolResultMessages,
        ];
      } catch (compactErr) {
        console.error('[OpenClaw] Mid-loop compaction failed, continuing without compaction:', compactErr);
      }
    }

    // Detect all-tools-failed: if every tool result was an error, stop looping
    // to avoid pointless retries that waste tokens.
    const allToolsFailed = toolResultMessages.length > 0
      && toolResultMessages.every(m => m.content.startsWith('Error:') || m.content.startsWith('error:'));
    if (allToolsFailed) {
      response.progress('All tool invocations returned errors, stopping tool loop.');
      break;
    }

    iterations++;
    // Preserve accumulated markdown for streaming; next iteration appends
    markdown = '';
  }

  // 6. Validate citations before streaming — remap mismatched indices
  //    so the displayed markdown matches the citation metadata.
  const validated = validateCitations(markdown, [...assembled.ragSources]);
  const displayMarkdown = validated.markdown;

  // 7. Stream final markdown to response
  if (displayMarkdown) {
    response.markdown(displayMarkdown);
  }

  // 8. Report token usage
  if (promptTokens != null && completionTokens != null) {
    response.reportTokenUsage(promptTokens, completionTokens);
  }

  return {
    markdown: displayMarkdown,
    thinking,
    toolCallCount,
    promptTokens,
    completionTokens,
    ragSources: assembled.ragSources,
    validatedCitations: validated.attributableSources,
  };
  } finally {
    // Finalize context engine turn — runs on ALL exit paths (success, error, cancellation)
    const finalMessages: IChatMessage[] = [
      ...currentMessages,
      ...(markdown ? [{ role: 'assistant' as const, content: markdown }] : []),
    ];
    try {
      await context.engine.afterTurn?.({
        sessionId: context.sessionId,
        messages: finalMessages,
      });
    } catch (afterTurnErr) {
      console.error('[OpenClaw] afterTurn failed:', afterTurnErr);
    }
  }
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
