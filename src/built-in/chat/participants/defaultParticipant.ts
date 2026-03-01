// defaultParticipant.ts — Default chat participant (M9 Cap 3 + Cap 4 mode system)
//
// The default agent that handles messages when no @mention is specified.
// Sends the conversation to ILanguageModelsService and streams the response
// back through the IChatResponseStream.
//
// Cap 4 additions: mode-aware system prompts, mode capability enforcement.
//
// VS Code reference:
//   Built-in chat participant registered in chat.contribution.ts

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
} from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../chatSystemPrompts.js';
import type { ISystemPromptContext } from '../chatSystemPrompts.js';
import { getModeCapabilities, shouldIncludeTools, shouldUseStructuredOutput } from '../chatModeCapabilities.js';

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
      // Stream the response
      const stream = services.sendChatRequest(messages, options, abortController.signal);

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
        }

        // Tool calls — only in Agent mode (Cap 6 implements the full agentic loop)
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          if (capabilities.canInvokeTools) {
            // Agent mode: tool invocation handled by agentic loop (Cap 6)
            for (const toolCall of chunk.toolCalls) {
              response.warning(`Tool call requested: ${toolCall.function.name} (agentic loop not yet wired)`);
            }
          } else {
            // Non-agent mode: ignore tool calls (should not happen with correct mode enforcement)
            response.warning('Tool calls are not available in this mode.');
          }
        }
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
