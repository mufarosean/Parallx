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
import type { IBootstrapFile, IOpenclawRuntimeInfo, IOpenclawLinkContractDescriptor } from './openclawSystemPrompt.js';
import type { IChatRuntimeToolInvocationObserver } from './openclawTypes.js';
import type { IOpenclawBootstrapDebugReport, IOpenclawSystemPromptReport } from '../services/chatRuntimeTypes.js';
import { ChatToolLoopSafety } from '../services/chatToolLoopSafety.js';
import { estimateMessagesTokens, estimateTokens } from './openclawTokenBudget.js';
import type { IOpenclawRuntimeSkillState } from './openclawSkillState.js';
import { buildOpenclawPromptArtifacts } from './openclawPromptArtifacts.js';
import type { IOpenclawRuntimeToolState } from './openclawToolState.js';
import type { IResolvedAgentConfig } from './agents/openclawAgentConfig.js';
import { resolveModelTier } from './openclawModelTier.js';
import { validateCitations } from './openclawResponseValidation.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on characters per tool result before truncation.
 * 100 000 chars ≈ 25 000 tokens — large enough for bulk-fetch tools
 * (e.g. Gmail returning 25+ messages with bodies) on big-context models.
 *
 * NOTE: this is only the upper bound. The effective cap applied per turn is
 * budget-aware (`toolResultCharCap`, computed from `context.tokenBudget`) so a
 * single tool result can never exceed a fraction of the model's context
 * window. Without that, a runaway / bulk tool result could overflow a small
 * window — and the mid-loop compaction can't reclaim it because the recent
 * tool exchange is preserved verbatim, which would then poison every future
 * turn once persisted to history.
 */
const MAX_TOOL_RESULT_CHARS = 100_000;

/**
 * Defensive normalizer for `IToolResult.content` that came in from an
 * extension or built-in tool. Parallx's contract is `content: string`, but
 * a few extension authors return MCP-shape `[{ type: 'text', text }, …]`
 * instead — that array then propagates into `role: 'tool'` message content
 * and trips Ollama's HTTP 400. This unwraps the MCP shape into a string and
 * logs a one-line warning so the misbehaving tool can be fixed at the
 * source. Strings (the contract) pass through untouched.
 */
export function normalizeToolResultContent(content: unknown, toolName: string): string {
  if (typeof content === 'string') { return content; }
  if (Array.isArray(content)) {
    const parts = content.map((c) => {
      if (c && typeof c === 'object' && 'type' in c && (c as { type: unknown }).type === 'text'
          && 'text' in c && typeof (c as { text: unknown }).text === 'string') {
        return (c as { text: string }).text;
      }
      return JSON.stringify(c);
    });
    console.warn(
      `[openclawAttempt] Tool "${toolName}" returned MCP-shape array content; `
      + `expected Parallx-shape string. Unwrapping to string.`,
    );
    return parts.join('\n');
  }
  if (content == null) { return ''; }
  console.warn(
    `[openclawAttempt] Tool "${toolName}" returned non-string content (typeof=${typeof content}); `
    + `coercing via JSON.stringify.`,
  );
  return JSON.stringify(content);
}

/**
 * Escape a string for safe inclusion in a `RegExp` body. Used by
 * `_detectHallucinatedToolCall` so user-defined tool names that happen
 * to contain regex metacharacters can't blow up the matcher.
 */
function _escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * M67 follow-up — detect model text that narrates a tool call without
 * the corresponding `tool_calls` structure being emitted. Two patterns
 * cover the dominant failure mode for OSS models:
 *
 *   Pattern A: "I (just )?(called|ran|invoked|executed) <tool_name>"
 *   Pattern B: "(used|using|with) (the )?<tool_name> tool"
 *
 * Matching is name-aware — the regex is built from the actually-
 * available tool catalog so it can't false-positive on natural-language
 * past tense like "I read the docs" or "I used the search bar."
 *
 * Returns the matched tool name (verbatim from the model's text) or
 * null when no hallucination is detected. Caller is responsible for
 * surfacing the warning to the user; this function is pure.
 *
 * Exported for unit testing only.
 */
export function _detectHallucinatedToolCall(
  markdown: string,
  availableToolNames: readonly string[],
): string | null {
  if (!markdown || availableToolNames.length === 0) return null;
  const namesAlt = availableToolNames.map(_escapeRegExp).join('|');
  // `\\b` word boundaries on both ends keep `fs_read_file` from matching
  // inside `pre_read_filefoo`; the alternation captures the tool name.
  const verbsPast = '(?:called|ran|just\\s+ran|invoked|executed|just\\s+used|queried|queries)';
  const patternA = new RegExp(
    `\\bI\\s+(?:just\\s+)?${verbsPast}\\s+\`?(${namesAlt})\\b`,
    'i',
  );
  const patternB = new RegExp(
    `\\b(?:used|using|with)\\s+(?:the\\s+)?\`?(${namesAlt})\`?\\s+tool\\b`,
    'i',
  );
  const m = patternA.exec(markdown) || patternB.exec(markdown);
  return m ? m[1] : null;
}

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

  /** Resolved agent configuration for this turn. */
  readonly agentConfig?: IResolvedAgentConfig;

  // M2: Mention context blocks to inject
  readonly mentionContextBlocks?: readonly string[];

  /**
   * M85 — reads the session's CURRENT plan, formatted for the prompt.
   * A getter (not a snapshot) so mid-turn re-assembly after compaction picks
   * up plan_update calls made earlier in the same tool loop.
   */
  readonly getPlanText?: () => string | undefined;

  /** MIND continuity (beliefs/threads) for interactive turns — a getter for
   *  the same mid-turn-freshness reason as getPlanText. */
  readonly getMindText?: () => string | undefined;

  /** HARNESS.md §3.5 — workspace activity since the session's previous turn
   *  (assistant's own actions excluded). A snapshot: "since last turn" is
   *  fixed at turn start. */
  readonly sinceLastTurnText?: string;

  // Model parameters from config
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** When false, skip workspace retrieval (RAG). Defaults to true. */
  readonly autoRag?: boolean;

  // Autonomy flags (D3: steer check — upstream L1 runReplyAgent)
  /**
   * Whether this turn was triggered by a steering message that interrupted
   * a previous active turn. Upstream: `shouldSteer` in L1 runReplyAgent.
   * When true, followup continuation is suppressed.
   */
  readonly isSteeringTurn?: boolean;
  /**
   * Whether this turn is a self-initiated followup continuation.
   * Upstream: `followupRun` flag in L1 runReplyAgent.
   * When true, this turn was triggered by the followup runner, not the user.
   */
  readonly isFollowupTurn?: boolean;
  /** Current depth in the followup chain (0 = user-initiated turn). */
  readonly followupDepth?: number;
  /** D5: Whether this turn has image attachments requiring vision support. */
  readonly supportsVision?: boolean;

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
    sessionId?: string,
  ) => Promise<IToolResult>;
  /** D4: Optional tool invocation observer for runtime hooks. */
  readonly toolObserver?: IChatRuntimeToolInvocationObserver;
  /** D4: Optional message lifecycle observer for runtime hooks. */
  readonly messageObserver?: import('../services/serviceTypes.js').IChatRuntimeMessageObserver;
  /** M66 — Registered `parallx://` link contracts for prompt auto-injection. */
  readonly linkContracts?: readonly IOpenclawLinkContractDescriptor[];
}

/**
 * Result from a single attempt execution.
 */
// ---------------------------------------------------------------------------
// Empty-response salvage (reasoning-only outputs)
// ---------------------------------------------------------------------------
//
// Thinking models (qwen3.x, DeepSeek-R1 class) sometimes answer the question
// INSIDE their reasoning and then stop without emitting any visible content:
// EOS straight after </think>, or the stream ends inside an unclosed think
// tag so the provider routes everything to `thinking`. The user sees an empty
// bubble and has to regenerate. The recovery is a harness concern, not a
// model-settings concern — whatever the upstream cause, the fix is the same:
// carry the reasoning forward as plain assistant text and ask for the final
// answer. Model-agnostic by design; touches no sampling knobs.

/** Max continuation nudges per attempt when the model answers only inside its reasoning. */
const MAX_EMPTY_RESPONSE_CONTINUATIONS = 2;

/** Tail of the reasoning carried into the continuation request (chars). */
const EMPTY_RESPONSE_THINKING_CARRY_CHARS = 6_000;

const EMPTY_RESPONSE_NUDGE =
  'Your previous reply contained only internal reasoning — the user saw no answer. '
  + 'Based on that reasoning, write your final answer now. State the answer directly; '
  + 'do not repeat the reasoning and do not call tools.';

export interface IOpenclawAttemptResult {
  readonly markdown: string;
  readonly thinking: string;
  readonly toolCallCount: number;
  /** True when the tool loop hit the iteration cap while the model still wanted to call tools. */
  readonly continuationRequested: boolean;
  /** Continuation nudges issued because the model answered only inside its reasoning (absent when none). */
  readonly emptyResponseContinuations?: number;
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
    agentIdentity: context.agentConfig?.identity,
    agentSystemPromptOverlay: context.agentConfig?.systemPromptOverlay,
    supportsVision: context.supportsVision,
    hasExplicitAttachments: (context.mentionContextBlocks?.length ?? 0) > 0
      && request.attachments?.some(a => a.kind === 'file' || a.kind === 'selection'),
    linkContracts: context.linkContracts,
    promptProvenance: {
      rawUserInput: request.text,
      parsedUserText: request.text,
      contextQueryText: request.text,
      participantId: context.participantId,
      command: request.command,
      attachmentCount: request.attachments?.length ?? 0,
      historyTurns: Math.floor(context.history.length / 2),
      seedMessageCount: assembled.messages.length + 2,
      modelMessageCount: assembled.messages.length + 2,
      modelMessageRoles: [
        'system',
        ...assembled.messages.map((message) => message.role),
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

  // 4. Build messages: [system, ...context history, user (with mention context prepended)]
  //    M2: Merge mention context blocks INTO the user message to avoid consecutive
  //    user-role messages.  Ollama/LLMs expect alternating user/assistant turns;
  //    two consecutive user messages causes models to ignore the first one (the
  //    attachment content).  Prepending to the user message ensures the model
  //    sees attachment context and query in a single turn.
  let userContent = request.text;
  if (context.mentionContextBlocks?.length) {
    const contextSection = context.mentionContextBlocks.join('\n\n---\n\n');
    console.log(`[OpenClaw:Attempt] Prepending ${context.mentionContextBlocks.length} mention/attachment context block(s) to user message, total chars: ${contextSection.length}`);
    userContent = contextSection + '\n\n---\n\n' + request.text;
  }

  const messages: IChatMessage[] = [
    { role: 'system', content: effectiveSystemPrompt },
    ...assembled.messages,
    { role: 'user', content: userContent, images: request.attachments?.filter(a => a.kind === 'image') },
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
  let markdownFlushedThisRound = false;
  let thinking = '';
  let toolCallCount = 0;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let currentMessages = messages;
  let iterations = 0;
  let lastHadToolCalls = false;
  let loopBlocked = false;
  let emptyResponseContinuations = 0;
  let salvagedThinking = '';

  // Budget-aware per-tool-result cap. A single tool result must never be
  // allowed to exceed a fraction of the model's context window. The mid-loop
  // compaction below preserves the most-recent tool exchange VERBATIM, so an
  // oversized result cannot be reclaimed by compaction — it overflows the
  // window on the next model call and (once persisted via afterTurn) poisons
  // every subsequent turn. Cap each result at the smaller of the fixed ceiling
  // and ~40% of the window (tokens→chars at the chars/4 estimate), with a floor
  // so tiny budgets still yield usable output.
  const toolResultCharCap = context.tokenBudget > 0
    ? Math.min(MAX_TOOL_RESULT_CHARS, Math.max(4_000, Math.floor(context.tokenBudget * 0.40) * 4))
    : MAX_TOOL_RESULT_CHARS;

  try {
  while (!token.isCancellationRequested && iterations < context.maxToolIterations + 1) {
    // D4: Fire before-model-call hook
    const hookMessages = context.messageObserver ? currentMessages.map(m => ({ role: m.role, content: m.content })) : undefined;
    if (context.messageObserver?.onBeforeModelCall && hookMessages) {
      try { context.messageObserver.onBeforeModelCall(hookMessages, context.runtimeInfo.model); } catch (e) { console.warn('[D4] Message hook error:', e); }
    }
    const modelCallStart = Date.now();
    // Execute model call
    const turnResult = await executeModelStream(
      context.sendChatRequest,
      currentMessages,
      requestOptions,
      response,
      token,
    );
    // D4: Fire after-model-call hook (reuses snapshot from before-hook)
    if (context.messageObserver?.onAfterModelCall && hookMessages) {
      try { context.messageObserver.onAfterModelCall(hookMessages, context.runtimeInfo.model, Date.now() - modelCallStart); } catch (e) { console.warn('[D4] Message hook error:', e); }
    }

    markdown = turnResult.markdown;
    thinking = turnResult.thinking;
    promptTokens = turnResult.promptTokens;
    completionTokens = turnResult.completionTokens;

    // No tool calls → done
    if (turnResult.toolCalls.length === 0) {
      // ── Empty-response salvage — see the constants block up top ──
      //
      // The model produced reasoning but no visible answer and requested no
      // tools. Instead of surfacing an empty bubble, append the reasoning as
      // a plain assistant message plus a nudge to answer, and give it another
      // model call. Bounded by MAX_EMPTY_RESPONSE_CONTINUATIONS (this path
      // does not consume tool iterations); the exchange stays in
      // currentMessages so afterTurn records an honest transcript of how the
      // final answer was obtained.
      if (
        markdown.trim().length === 0 &&
        thinking.trim().length > 0 &&
        emptyResponseContinuations < MAX_EMPTY_RESPONSE_CONTINUATIONS &&
        !token.isCancellationRequested
      ) {
        emptyResponseContinuations++;
        salvagedThinking = salvagedThinking ? `${salvagedThinking}\n\n${thinking}` : thinking;
        try {
          response.progress(
            `Model answered only inside its reasoning — requesting the final answer (${emptyResponseContinuations}/${MAX_EMPTY_RESPONSE_CONTINUATIONS})...`,
          );
        } catch { /* progress emission shouldn't break the loop */ }
        console.warn(
          `[openclawAttempt] Reasoning-only response: ${thinking.length} thinking chars, zero content, zero tool calls. `
          + `Model: ${context.runtimeInfo.model}. Continuation ${emptyResponseContinuations}/${MAX_EMPTY_RESPONSE_CONTINUATIONS}.`,
        );
        const carry = thinking.length > EMPTY_RESPONSE_THINKING_CARRY_CHARS
          ? `[reasoning truncated]\n${thinking.slice(-EMPTY_RESPONSE_THINKING_CARRY_CHARS)}`
          : thinking;
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: `(internal reasoning — no answer was given)\n${carry}` },
          { role: 'user', content: EMPTY_RESPONSE_NUDGE },
        ];
        continue;
      }

      // ── Hallucinated-tool-call guard (M67 follow-up — tool-error reliability) ──
      //
      // Local models with weak tool-use training sometimes narrate a tool
      // call in their text response WITHOUT actually emitting a tool_call
      // structure. The runner sees zero tool_calls and exits; the user
      // reads "I called fs_read_file and got…" and believes a tool actually
      // ran. Claude almost never does this (strong native tool-use
      // training); smaller/quantized OSS models do. The system-prompt
      // rule in SOUL.md tells the model not to do this, but the rule is
      // soft — we add a visible warning when we detect the pattern so
      // the user can see the lie even if the model still produces it.
      //
      // The detector is name-aware (uses the actually-available tool
      // catalog) so it can't false-positive on natural-language past
      // tense like "I read the docs" — only matches tool names that
      // exist in this turn's tool surface.
      const hallucinatedToolName = _detectHallucinatedToolCall(
        markdown,
        context.toolState.availableDefinitions.map((t) => t.name),
      );
      if (hallucinatedToolName) {
        try {
          response.warning(
            `It looks like the model narrated a call to \`${hallucinatedToolName}\` `
            + `but no tool was actually invoked this turn. Treat the claims above with caution `
            + `— the action probably did not run.`,
          );
        } catch { /* warning emission shouldn't break the loop */ }
        console.warn(
          `[openclawAttempt] Hallucinated tool call detected: model claimed to call "${hallucinatedToolName}" with zero tool_calls emitted. `
          + `Model: ${context.runtimeInfo.model}.`,
        );
      }

      lastHadToolCalls = false;
      break;
    }
    lastHadToolCalls = true;

    // Stream this round's narration BEFORE its tool calls so the transcript
    // reads chronologically, Claude-style: thinking → text → tools → next
    // round. Previously this text was silently dropped (`markdown = ''` at
    // the end of each round streamed only the FINAL round's text), so
    // between-tool narration never rendered. The `markdown` variable itself
    // stays intact — the next round's history message still needs it.
    if (markdown.trim().length > 0) {
      response.markdown(markdown);
      markdownFlushedThisRound = true;
    }

    // Process tool calls
    if (!context.invokeToolWithRuntimeControl) {
      break; // No tool execution capability
    }

    // Collect all tool results first, then batch-append to messages.
    // This avoids duplicating the assistant message for each tool result
    // when the model returns multiple tool calls in a single turn.
    const toolResultMessages: IChatMessage[] = [];
    loopBlocked = false;

    for (const toolCall of turnResult.toolCalls) {
      if (token.isCancellationRequested) break;

      // Safety: detect infinite tool loops
      const safety = loopSafety.record(toolCall.function.name, toolCall.function.arguments);
      if (safety.blocked) {
        loopBlocked = true;
        break;
      }

      // Execute the tool
      const toolCallId = `${toolCall.function.name}-${toolCallCount}`;
      response.beginToolInvocation(
        toolCallId,
        toolCall.function.name,
        toolCall.function.arguments,
      );
      response.updateToolInvocation(toolCallId, { status: 'running' });

      // Only tools this turn OFFERED may run (the API-level rule every
      // frontier harness enforces: an unknown tool name is an error, not a
      // registry lookup). A 'reader' subagent, a readonly participant, or a
      // profile allowlist filtered the catalog — dispatch must honour that
      // filter, or a model that knows a write tool's name from training
      // walks straight past it. (Review fix 2026-09-02.)
      // (An empty catalog carries no filter: nothing was offered, so
      // nothing was withheld; the PDP alone gates that path.)
      const offered = context.toolState.availableDefinitions;
      const toolResult = offered.length === 0 || offered.some((d) => d.name === toolCall.function.name)
        ? await context.invokeToolWithRuntimeControl(
          toolCall.function.name,
          toolCall.function.arguments,
          token,
          context.toolObserver,
          context.sessionId,
        )
        : {
          content: `Tool "${toolCall.function.name}" is not available in this session. Use only the tools offered to you.`,
          isError: true,
        };
      toolCallCount++;

      const toolStatus = toolResult.isError
        ? (toolResult.content.includes('rejected by user') ? 'rejected' : 'error')
        : 'completed';
      response.updateToolInvocation(toolCallId, {
        status: toolStatus,
        isComplete: true,
        isError: toolResult.isError,
        result: toolResult,
      });

      // ── Tool result formatting (M67 follow-up — tool-error reliability) ──
      //
      // The Claude API has a typed `is_error: true` on every tool_result
      // block; the model reads that flag directly and can't gloss over
      // failures. Ollama's `/api/chat` does NOT carry a typed error flag
      // on tool messages — they're plain `role: 'tool'` + content — so
      // the model has nothing to read except prose. Result: when a tool
      // returned `{ content: "File not found", isError: true }`, we kept
      // the flag locally (UI badge / taint gate) and sent the model only
      // "File not found", which small/quantized models routinely
      // misinterpret as success and narrate accordingly.
      //
      // Fix: bake the error signal INTO the content with a marker no
      // tool-result content can legitimately produce on its own. The
      // marker is what Claude's typed flag would be if Ollama supported
      // it, plus an instruction the model can act on directly. This is
      // the documented workaround for backends that lack a typed
      // is_error: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
      //
      // Truncation: long success outputs keep the head (typical case —
      // a stack trace lives near the bottom anyway, and head-truncating
      // a 100kB file dump still gives the model useful surface area).
      // For errors, the diagnostic info lives at the END (stack frames,
      // root cause), so truncate from the head and keep the tail when
      // isError is set.
      // Defensive: extensions occasionally return the MCP tool-result shape
      // `{ content: [{ type: 'text', text }, ...] }` instead of Parallx's
      // `{ content: string }`. An array would propagate to `role: 'tool'`
      // message content and trip Ollama's HTTP 400 ("cannot unmarshal array
      // into Go struct field ChatRequest.messages.content of type string").
      // Normalize here so a single misbehaving extension can't break the
      // whole chat turn.
      let resultContent = normalizeToolResultContent(toolResult.content, toolCall.function.name);
      if (resultContent.length > toolResultCharCap) {
        if (toolResult.isError) {
          // Tail-keep: preserve the last toolResultCharCap chars so the
          // error message + stack frames survive.
          resultContent =
            `(truncated head, ${resultContent.length - toolResultCharCap} chars omitted)\n\n`
            + resultContent.slice(resultContent.length - toolResultCharCap);
        } else {
          resultContent = resultContent.slice(0, toolResultCharCap)
            + `\n\n... (truncated, ${resultContent.length} chars total)`;
        }
      }

      const formattedContent = toolResult.isError
        ? `[TOOL ERROR] The "${toolCall.function.name}" tool FAILED. `
          + `Do not claim this action succeeded. State to the user that the call failed and `
          + `(when reasonable) what went wrong.\n\n`
          + `Failure detail:\n${resultContent}`
        : resultContent;

      toolResultMessages.push({
        role: 'tool',
        content: formattedContent,
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

    // Mid-loop budget check: if accumulated messages exceed budget, compact
    // before the next model call. Upstream: re-budgets after each tool call.
    //
    // HARNESS.md §1.4 — real token accounting. The provider just reported the
    // TRUE prompt size of this round (promptTokens counts everything the
    // estimate can't see: tool schemas, system prompt, provider framing, and
    // real tokenization instead of chars/4 — which under-counts code by
    // 20-50%). Use it as the base and only estimate this round's additions;
    // fall back to the full estimate when the provider reported nothing.
    // This round's completion (narration + tool-call JSON) is covered by the
    // provider's completionTokens when reported — estimating the assistant
    // message on top of it would double-count. Tool results are never in
    // either provider figure, so they are always estimated.
    const completionEstimate = turnResult.completionTokens
      ?? estimateMessagesTokens([{ role: 'assistant', content: markdown, toolCalls: turnResult.toolCalls }]);
    // Review fix 2026-09-02: provider prompt counts EXCLUDE cached-prefix
    // tokens (Ollama prompt_eval_count reports only newly evaluated tokens;
    // Anthropic input_tokens excludes cache reads, which the provider now
    // adds back). On a warm tool loop — the normal case, and what §3.4's
    // stable prefix maximises — the anchored figure can be a tiny per-round
    // delta. Neither figure is a ceiling on its own, so the check takes the
    // larger: the provider wins on cold rounds (real tokenisation), the
    // estimate wins on warm ones (it cannot see the cache either way).
    const anchoredEstimate = promptTokens != null && promptTokens > 0
      ? promptTokens + completionEstimate + estimateMessagesTokens(toolResultMessages)
      : 0;
    const loopTokenEstimate = Math.max(anchoredEstimate, estimateMessagesTokens(currentMessages));
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
          planText: context.getPlanText?.(),
          mindText: context.getMindText?.(),
          sinceLastTurnText: context.sinceLastTurnText,
        });
        // Rebuild messages: system prompt stays, use re-assembled history,
        // keep recent tool exchange, add user message (with context prepended)
        currentMessages = [
          currentMessages[0], // system prompt
          ...reAssembled.messages,
          { role: 'user', content: userContent, images: request.attachments?.filter(a => a.kind === 'image') },
          { role: 'assistant', content: markdown, toolCalls: turnResult.toolCalls },
          ...toolResultMessages,
        ];
      } catch (compactErr) {
        console.error('[OpenClaw] Mid-loop compaction failed, continuing without compaction:', compactErr);
      }
    }

    iterations++;
    // Reset for the next round — this round's text is already streamed (the
    // pre-tool flush above) and already captured in the history messages.
    markdown = '';
    markdownFlushedThisRound = false;
  }

  // Salvage exhausted: the model answered inside its reasoning on every
  // attempt. Say so instead of rendering a silent empty bubble — the
  // reasoning already streamed, so point the user at it.
  if (emptyResponseContinuations > 0 && markdown.trim().length === 0 && !token.isCancellationRequested) {
    try {
      response.warning(
        `The model put its answer inside its reasoning and never produced a final response, `
        + `even after ${emptyResponseContinuations} follow-up request(s). `
        + `Its reasoning is shown above — the answer is likely in there.`,
      );
    } catch { /* diagnostics must not break the return path */ }
  }

  // 6. Validate citations before streaming — remap mismatched indices
  //    so the displayed markdown matches the citation metadata.
  const validated = validateCitations(markdown, [...assembled.ragSources]);
  const displayMarkdown = validated.markdown;

  // 7. Stream final markdown to response — unless this exact text already
  // streamed via the pre-tool flush and the loop exited before its reset
  // (cancellation / loop-safety break). Streaming it again would duplicate
  // the visible paragraph.
  if (displayMarkdown && !markdownFlushedThisRound) {
    response.markdown(displayMarkdown);
  }

  // 8. Report token usage
  if (promptTokens != null && completionTokens != null) {
    response.reportTokenUsage(promptTokens, completionTokens);
  }

  // A salvage round overwrote `thinking` with the continuation round's
  // (possibly empty) reasoning — recombine so the archived transcript keeps
  // the original burst that actually contains the model's work.
  const combinedThinking = salvagedThinking
    ? [salvagedThinking, thinking].filter((s) => s.trim().length > 0).join('\n\n')
    : thinking;

  return {
    markdown: displayMarkdown,
    thinking: combinedThinking,
    toolCallCount,
    continuationRequested: lastHadToolCalls && !loopBlocked,
    emptyResponseContinuations: emptyResponseContinuations > 0 ? emptyResponseContinuations : undefined,
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
