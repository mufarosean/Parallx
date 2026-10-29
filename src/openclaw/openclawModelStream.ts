// openclawModelStream.ts — one model call, streamed to the response.
//
// Split from openclawAttempt.ts, whose tool loop calls it once per round.

import type {
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolCall,
} from '../services/chatTypes.js';

// ---------------------------------------------------------------------------
// Model execution helper
// ---------------------------------------------------------------------------

/**
 * Execute a single model call and stream the response.
 *
 * Adapted from the first model-turn runner in openclawParticipantRuntime.ts,
 * but simplified: handles streaming, collects markdown/thinking/toolCalls/tokens.
 *
 * The answer streams to the response as it is written, like the reasoning:
 * a round followed by tool calls shows its text before its tool cards. When
 * the call fails partway, the text it streamed is taken back so a retry does
 * not show it twice. Stop keeps what was written.
 */
export async function executeModelStream(
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
  doneReason?: string;
}> {
  let markdown = '';
  let thinking = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let doneReason: string | undefined;
  const toolCalls: IToolCall[] = [];

  // The turn's cancel reaches the model call: Stop or a timeout closes the
  // HTTP request, so the engine is free at once instead of generating on
  // unseen until the step would have finished.
  const abort = new AbortController();
  if (token.isCancellationRequested) abort.abort();
  const cancelSub = token.onCancellationRequested?.(() => abort.abort());
  try {
    for await (const chunk of sendChatRequest(messages, options, abort.signal)) {
      if (token.isCancellationRequested) break;

      if (chunk.content) {
        markdown += chunk.content;
        response.markdown(chunk.content);
      }
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
      if (chunk.doneReason) doneReason = chunk.doneReason;
    }
  } catch (error) {
    if (markdown) {
      try { response.replaceMarkdownTail?.(markdown, ''); } catch { /* a closed stream keeps its text */ }
    }
    throw error;
  } finally {
    cancelSub?.dispose();
  }

  // An answer that ran out of room (the output limit, or the context window)
  // stops mid-sentence and reads as finished. Say so where it ends.
  if (doneReason === 'length' && markdown.trim() && !token.isCancellationRequested) {
    try { response.warning('The model ran out of room and stopped here: the answer above is cut off.'); } catch { /* a closed stream */ }
  }

  return { markdown, thinking, toolCalls, promptTokens, completionTokens, doneReason };
}
