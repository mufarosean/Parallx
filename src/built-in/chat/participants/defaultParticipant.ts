// defaultParticipant.ts — Default chat participant (M9 Cap 3 + Cap 4 + Cap 6 agentic loop)
//
// The default agent that handles messages when no @mention is specified.
// Sends the conversation to ILanguageModelsService and streams the response
// back through the IChatResponseStream.
//
// Cap 4 additions: mode-aware system prompts, mode capability enforcement.
// Cap 6 additions: agentic loop — tool call → execute → feed back → repeat.
//
// VS Code reference:
//   Built-in chat participant registered in chat.contribution.ts
//   Agent loop: chatAgents.ts — processes tool_calls, feeds results back

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  IToolCall,
  IToolResult,
  IChatEditProposalContent,
  EditProposalOperation,
} from '../../../services/chatTypes.js';
import { ChatContentPartKind } from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../chatSystemPrompts.js';
import type { ISystemPromptContext } from '../chatSystemPrompts.js';
import { getModeCapabilities, shouldIncludeTools, shouldUseStructuredOutput } from '../chatModeCapabilities.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;
/** Default network timeout in milliseconds. */
const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;
/** Context overflow threshold — warn at this fraction of context length. */
const CONTEXT_OVERFLOW_WARN_THRESHOLD = 0.8;

/**
 * Rough token estimation: chars / 4.
 * This is the same heuristic used by VS Code's chat implementation.
 */
function estimateTokens(messages: readonly IChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Categorize a fetch/network error into a user-friendly message.
 */
function categorizeError(err: unknown): { message: string; isNetworkError: boolean } {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { message: '', isNetworkError: false }; // Handled separately
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return {
      message: 'Request timed out. The model may be loading or the Ollama server is unresponsive. Try again or check that Ollama is running.',
      isNetworkError: true,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Detect "Ollama not running" — fetch to localhost fails
  if (msg.includes('Failed to fetch') || msg.includes('ECONNREFUSED') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
    return {
      message: 'Ollama is not running. Install and start Ollama from https://ollama.com, then try again.',
      isNetworkError: true,
    };
  }
  // Detect "model not found" — Ollama returns 404 with specific message
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('404'))) {
    // Extract model name if possible
    const modelMatch = msg.match(/model\s+['"]?([^\s'"]+)/i);
    const modelName = modelMatch?.[1] ?? 'the requested model';
    return {
      message: `Model "${modelName}" not found. Run \`ollama pull ${modelName}\` to download it.`,
      isNetworkError: false,
    };
  }
  return { message: msg, isNetworkError: false };
}

/**
 * Service accessor for the default participant.
 * Passed in from the activation layer — avoids importing service implementations.
 */
export interface IDefaultParticipantServices {
  sendChatRequest(
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;
  getActiveModel(): string | undefined;
  /** Workspace name for system prompt context. */
  getWorkspaceName(): string;
  /** Page count for system prompt context. */
  getPageCount(): Promise<number>;
  /** Current page title, if any. */
  getCurrentPageTitle(): string | undefined;
  /** Available tool definitions (for Agent mode system prompt + request). */
  getToolDefinitions(): readonly IToolDefinition[];
  /**
   * Invoke a tool by name with confirmation gate (Cap 6).
   * Returns the tool result (may include user rejection).
   */
  invokeTool?(
    name: string,
    args: Record<string, unknown>,
    token: ICancellationToken,
  ): Promise<IToolResult>;
  /** Max agentic loop iterations (default: 10). */
  maxIterations?: number;
  /** Network timeout in milliseconds (default: 60000). */
  networkTimeout?: number;
  /** Context length of the active model (tokens). 0 = unknown. */
  getModelContextLength?(): number;
  /** Send a summarization request to compress conversation history. */
  sendSummarizationRequest?(
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk>;

  // ── Data context (prevents LLM hallucination) ──

  /** List page titles (up to ~20) for system prompt grounding. */
  listPageNames?(): Promise<readonly string[]>;
  /** List file/dir names at workspace root for system prompt grounding. */
  listFileNames?(): Promise<readonly string[]>;
  /** Read a file's text content by path (for attachment context injection). */
  readFileContent?(fullPath: string): Promise<string>;
}

/** Default participant ID — must match ChatAgentService's DEFAULT_AGENT_ID. */
const DEFAULT_PARTICIPANT_ID = 'parallx.chat.default';

/**
 * Create the default chat participant.
 *
 * Returns an IDisposable that holds the participant descriptor.
 * The caller (chatTool.ts) registers this with IChatAgentService.
 */
export function createDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {

  const maxIterations = services.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {

    // ── Mode capability enforcement ──

    const capabilities = getModeCapabilities(request.mode);

    // ── Build system prompt with workspace context ──

    const pageCount = await services.getPageCount().catch(() => 0);

    // Gather actual page/file names so the LLM doesn't hallucinate
    const pageNames = services.listPageNames
      ? await services.listPageNames().catch(() => [] as readonly string[])
      : undefined;
    const fileNames = services.listFileNames
      ? await services.listFileNames().catch(() => [] as readonly string[])
      : undefined;

    const promptContext: ISystemPromptContext = {
      workspaceName: services.getWorkspaceName(),
      pageCount,
      currentPageTitle: services.getCurrentPageTitle(),
      tools: shouldIncludeTools(request.mode) ? services.getToolDefinitions() : undefined,
      pageNames: pageNames?.length ? pageNames : undefined,
      fileNames: fileNames?.length ? fileNames : undefined,
    };

    const systemPrompt = buildSystemPrompt(request.mode, promptContext);

    // Build the message list from conversation history + current request
    const messages: IChatMessage[] = [];

    // System prompt (mode-aware)
    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // History (previous request/response pairs)
    for (const pair of context.history) {
      messages.push({
        role: 'user',
        content: pair.request.text,
      });

      // Extract text from response parts
      const responseText = pair.response.parts
        .map((part) => {
          if ('content' in part && typeof part.content === 'string') {
            return part.content;
          }
          if ('code' in part && typeof part.code === 'string') {
            return '```\n' + part.code + '\n```';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');

      if (responseText) {
        messages.push({
          role: 'assistant',
          content: responseText,
        });
      }
    }

    // Current user message — with attached file context
    if (request.attachments?.length && services.readFileContent) {
      // Read attached file contents and inject as context before the user's question
      const fileContextParts: string[] = [];
      for (const attachment of request.attachments) {
        try {
          const content = await services.readFileContent(attachment.fullPath);
          fileContextParts.push(`File: ${attachment.name}\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          fileContextParts.push(`File: ${attachment.name}\n[Could not read file]`);
        }
      }
      const contextPrefix = fileContextParts.join('\n\n');
      messages.push({
        role: 'user',
        content: `${contextPrefix}\n\n${request.text}`,
      });
    } else {
      messages.push({
        role: 'user',
        content: request.text,
      });
    }

    // ── Context overflow detection & LLM-based summarization ──

    const contextLength = services.getModelContextLength?.() ?? 0;
    if (contextLength > 0) {
      const tokenEstimate = estimateTokens(messages);
      const warnThreshold = Math.floor(contextLength * CONTEXT_OVERFLOW_WARN_THRESHOLD);

      if (tokenEstimate > contextLength && services.sendSummarizationRequest) {
        // Exceeded context — summarize older messages (invisible to user)
        try {
          const historyToSummarize = messages.slice(1, -1); // exclude system + current user
          if (historyToSummarize.length > 2) {
            const summaryPrompt: IChatMessage[] = [
              {
                role: 'system',
                content:
                  'You are a conversation summarizer. Condense the following conversation history into a concise context message. ' +
                  'Preserve all key facts, decisions, and code references. Output ONLY the summary, no preamble.',
              },
              {
                role: 'user',
                content: historyToSummarize.map((m) => `[${m.role}]: ${m.content}`).join('\n\n'),
              },
            ];

            let summaryText = '';
            for await (const chunk of services.sendSummarizationRequest(summaryPrompt)) {
              if (chunk.content) { summaryText += chunk.content; }
            }

            if (summaryText) {
              // Replace history with summary — keep system prompt + summary + current user msg
              const systemMsg = messages[0];
              const currentMsg = messages[messages.length - 1];
              messages.length = 0;
              messages.push(systemMsg);
              messages.push({ role: 'assistant', content: `[Conversation summary]: ${summaryText}` });
              messages.push(currentMsg);
            }
          }
        } catch {
          // Summarization failed — proceed with full history (best effort)
        }
      } else if (tokenEstimate > warnThreshold) {
        response.warning(
          `Approaching context limit (${tokenEstimate} / ${contextLength} estimated tokens). ` +
          'Older messages may be summarized automatically if the conversation continues.',
        );
      }
    }

    // Build request options (mode-aware)
    const options: IChatRequestOptions = {
      // Agent mode: include tool definitions in the request
      tools: shouldIncludeTools(request.mode) ? services.getToolDefinitions() : undefined,
      // Edit mode: use JSON structured output
      format: shouldUseStructuredOutput(request.mode) ? { type: 'object' } : undefined,
    };

    // Create an AbortController linked to the cancellation token
    const abortController = new AbortController();
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    const cancelListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    // Network timeout — abort if no response within configured time
    const timeoutMs = services.networkTimeout ?? DEFAULT_NETWORK_TIMEOUT_MS;
    let networkTimeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      networkTimeoutId = setTimeout(() => {
        abortController.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, timeoutMs);
    }

    try {
      // ── Agentic loop (Cap 6 Task 6.2) ──
      //
      // When the model returns tool_calls, we:
      // 1. Render tool invocation cards (pending)
      // 2. Invoke each tool via ILanguageModelToolsService
      // 3. Update card status (running → completed/rejected)
      // 4. Append tool result messages
      // 5. Re-send the updated history back to the model
      // 6. Repeat until no more tool_calls or max iterations reached
      //
      // For non-Agent modes, tool calls are ignored (should not occur
      // because tools are not sent in the request).

      const canInvokeTools = capabilities.canInvokeTools && !!services.invokeTool;
      const isEditMode = capabilities.canProposeEdits && !capabilities.canAutonomous;
      let producedContent = false;

      for (let iteration = 0; iteration <= maxIterations; iteration++) {
        // Collect content and tool calls from the current LLM turn
        let turnContent = '';
        const turnToolCalls: IToolCall[] = [];
        let turnPromptTokens = 0;
        let turnCompletionTokens = 0;

        const stream = services.sendChatRequest(
          messages,
          options,
          abortController.signal,
        );

        for await (const chunk of stream) {
          if (token.isCancellationRequested) {
            break;
          }

          // Thinking content
          if (chunk.thinking) {
            response.thinking(chunk.thinking);
          }

          // Regular content — in Edit mode, buffer instead of streaming
          if (chunk.content) {
            if (!isEditMode) {
              response.markdown(chunk.content);
            }
            turnContent += chunk.content;
            producedContent = true;
          }

          // Collect tool calls from the response
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              turnToolCalls.push(tc);
            }
          }

          // Capture real token counts from Ollama's final chunk
          if (chunk.promptEvalCount) { turnPromptTokens = chunk.promptEvalCount; }
          if (chunk.evalCount) { turnCompletionTokens = chunk.evalCount; }
        }

        // Report token usage from this turn to the response stream
        if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
          response.reportTokenUsage(turnPromptTokens, turnCompletionTokens);
        }

        // If cancelled, break out
        if (token.isCancellationRequested) {
          break;
        }

        // ── Edit mode: parse JSON structured output into edit proposals ──
        if (isEditMode && turnContent) {
          _parseEditResponse(turnContent, response);
          break; // Edit mode is single-turn (no tool calls)
        }

        // No tool calls → model gave a final answer, done
        if (turnToolCalls.length === 0) {
          break;
        }

        // Tool calls but not in Agent mode or no invokeTool wired
        if (!canInvokeTools) {
          response.warning('Tool calls are not available in this mode.');
          break;
        }

        // Guard against exceeding max iterations (the last iteration
        // should be the model's final response without tool calls)
        if (iteration === maxIterations) {
          response.warning(`Agentic loop reached maximum iterations (${maxIterations}). Stopping.`);
          break;
        }

        // Append the assistant message (with content + tool_calls) to history
        // so the model sees its own tool call + results on the next turn.
        // Note: Ollama expects the assistant message to be present before tool results.
        if (turnContent) {
          messages.push({ role: 'assistant', content: turnContent });
        }

        // ── Process each tool call ──

        for (const toolCall of turnToolCalls) {
          const tcName = toolCall.function.name;
          const tcArgs = toolCall.function.arguments;
          const toolCallId = `${tcName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

          // 1. Render pending tool card
          response.beginToolInvocation(toolCallId, tcName, tcArgs);
          producedContent = true;

          // 2. Update status to running
          response.updateToolInvocation(toolCallId, { status: 'running' });

          // 3. Invoke the tool
          let result: IToolResult;
          try {
            result = await services.invokeTool!(tcName, tcArgs, token);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            result = { content: `Tool "${tcName}" failed: ${errMsg}`, isError: true };
          }

          // 4. Update card with result
          if (result.isError && result.content === 'Tool execution rejected by user') {
            response.updateToolInvocation(toolCallId, {
              status: 'rejected',
              isComplete: true,
              isConfirmed: false,
              result,
            });
          } else {
            response.updateToolInvocation(toolCallId, {
              status: result.isError ? 'rejected' : 'completed',
              isComplete: true,
              isConfirmed: !result.isError,
              isError: result.isError,
              result,
            });
          }

          // 5. Append tool result message for the model
          messages.push({
            role: 'tool',
            content: result.content,
            toolName: tcName,
          });
        }

        // Loop continues: messages now include tool results,
        // next iteration sends the full history back to the model.
      }

      // Clear network timeout since we got a response
      if (networkTimeoutId !== undefined) { clearTimeout(networkTimeoutId); }

      // ── Empty response detection ──
      if (!producedContent && !token.isCancellationRequested) {
        response.warning('The model returned an empty response. Try rephrasing your question or selecting a different model.');
      }

      return {};
    } catch (err) {
      // Clear network timeout on error
      if (networkTimeoutId !== undefined) { clearTimeout(networkTimeoutId); }

      if (err instanceof DOMException && err.name === 'AbortError') {
        // User-initiated cancellation — not an error
        return {};
      }

      // Categorize the error for user-friendly messaging
      const { message, isNetworkError: _isNetworkError } = categorizeError(err);
      return {
        errorDetails: {
          message,
          responseIsIncomplete: true,
        },
      };
    } finally {
      cancelListener.dispose();
    }
  };

  // Build participant descriptor
  const participant: IChatParticipant & IDisposable = {
    id: DEFAULT_PARTICIPANT_ID,
    displayName: 'Chat',
    description: 'Default chat participant — sends messages to the active language model.',
    commands: [],
    handler,
    dispose: () => {
      // No-op cleanup — the participant is just a descriptor
    },
  };

  return participant;
}

// ── Edit mode JSON parser ──

/** Valid edit operations. */
const VALID_OPERATIONS = new Set<string>(['insert', 'update', 'delete']);

/**
 * Parse JSON structured output from Edit mode and emit edit proposals.
 *
 * Expected schema:
 * ```json
 * {
 *   "explanation": "Brief description of the changes",
 *   "edits": [{ "pageId", "blockId?", "operation", "content" }]
 * }
 * ```
 *
 * Falls back gracefully: shows raw response + warning if parsing fails.
 */
function _parseEditResponse(rawContent: string, response: IChatResponseStream): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // JSON parse failed — show raw content with warning
    response.warning('Edit mode: failed to parse model response as JSON. Showing raw output.');
    response.markdown(rawContent);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    response.warning('Edit mode: model response is not a JSON object. Showing raw output.');
    response.markdown(rawContent);
    return;
  }

  const obj = parsed as Record<string, unknown>;

  // Extract explanation
  const explanation = typeof obj['explanation'] === 'string' ? obj['explanation'] : '';

  // Extract and validate edits array
  const editsRaw = obj['edits'];
  if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
    // No edits — show explanation as markdown + warning
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: no edits found in model response.');
    return;
  }

  // Validate and build edit proposals
  const proposals: IChatEditProposalContent[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < editsRaw.length; i++) {
    const entry = editsRaw[i];
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Edit ${i + 1}: not a valid object, skipped.`);
      continue;
    }

    const e = entry as Record<string, unknown>;
    const pageId = typeof e['pageId'] === 'string' ? e['pageId'] : '';
    const blockId = typeof e['blockId'] === 'string' ? e['blockId'] : undefined;
    const operation = typeof e['operation'] === 'string' ? e['operation'] : '';
    const content = typeof e['content'] === 'string' ? e['content'] : '';

    if (!pageId) {
      warnings.push(`Edit ${i + 1}: missing pageId, skipped.`);
      continue;
    }
    if (!VALID_OPERATIONS.has(operation)) {
      warnings.push(`Edit ${i + 1}: invalid operation "${operation}", skipped.`);
      continue;
    }

    proposals.push({
      kind: ChatContentPartKind.EditProposal,
      pageId,
      blockId,
      operation: operation as EditProposalOperation,
      after: content,
      status: 'pending',
    });
  }

  // Emit warnings for invalid entries
  for (const w of warnings) {
    response.warning(w);
  }

  if (proposals.length === 0) {
    if (explanation) {
      response.markdown(explanation);
    }
    response.warning('Edit mode: all proposed edits were invalid.');
    return;
  }

  // Emit edit batch (explanation + proposals)
  response.editBatch(explanation, proposals);
}
