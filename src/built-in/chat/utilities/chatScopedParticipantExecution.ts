import type {
  ICancellationToken,
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantResult,
  IChatResponseStream,
  IChatResponseChunk,
} from '../../../services/chatTypes.js';

export function appendScopedParticipantHistory(
  messages: IChatMessage[],
  context: IChatParticipantContext,
): void {
  for (const pair of context.history) {
    messages.push({ role: 'user', content: pair.request.text });
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
      messages.push({ role: 'assistant', content: responseText });
    }
  }
}

export function createScopedParticipantMessages(
  systemContent: string,
  userContent: string,
  context?: IChatParticipantContext,
): IChatMessage[] {
  const messages: IChatMessage[] = [
    { role: 'system', content: systemContent },
  ];

  if (context) {
    appendScopedParticipantHistory(messages, context);
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}

export async function streamScopedParticipantLLMResponse(
  messages: IChatMessage[],
  response: IChatResponseStream,
  token: ICancellationToken,
  sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: unknown,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>,
): Promise<IChatParticipantResult> {
  const abortController = new AbortController();
  if (token.isCancellationRequested) {
    abortController.abort();
  }
  const cancelListener = token.onCancellationRequested(() => abortController.abort());

  try {
    const stream = sendChatRequest(messages, undefined, abortController.signal);

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        break;
      }
      if (chunk.thinking) {
        response.thinking(chunk.thinking);
      }
      if (chunk.content) {
        response.markdown(chunk.content);
      }
    }

    return {};
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {};
    }
    const message = err instanceof Error ? err.message : String(err);
    return { errorDetails: { message, responseIsIncomplete: true } };
  } finally {
    cancelListener.dispose();
  }
}