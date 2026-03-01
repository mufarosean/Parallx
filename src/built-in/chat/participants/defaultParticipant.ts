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
} from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../chatSystemPrompts.js';
import type { ISystemPromptContext } from '../chatSystemPrompts.js';
import { getModeCapabilities, shouldIncludeTools, shouldUseStructuredOutput } from '../chatModeCapabilities.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;

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
    const promptContext: ISystemPromptContext = {
      workspaceName: services.getWorkspaceName(),
      pageCount,
      currentPageTitle: services.getCurrentPageTitle(),
      tools: shouldIncludeTools(request.mode) ? services.getToolDefinitions() : undefined,
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

    // Current user message
    messages.push({
      role: 'user',
      content: request.text,
    });

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

      for (let iteration = 0; iteration <= maxIterations; iteration++) {
        // Collect content and tool calls from the current LLM turn
        let turnContent = '';
        const turnToolCalls: IToolCall[] = [];

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

          // Regular content
          if (chunk.content) {
            response.markdown(chunk.content);
            turnContent += chunk.content;
          }

          // Collect tool calls from the response
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              turnToolCalls.push(tc);
            }
          }
        }

        // If cancelled, break out
        if (token.isCancellationRequested) {
          break;
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

      return {};
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled — not an error
        return {};
      }

      const message = err instanceof Error ? err.message : String(err);
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
