import type {
  ICancellationToken,
  IChatMessage,
  IChatParticipantContext,
  IChatResponseChunk,
  IChatResponseStream,
  IChatRequestOptions,
} from '../../../services/chatTypes.js';
import { createScopedParticipantMessages, streamScopedParticipantLLMResponse } from './chatScopedParticipantExecution.js';

export async function runScopedParticipantPrompt(
  systemPrompt: string,
  userText: string,
  context: IChatParticipantContext | undefined,
  response: IChatResponseStream,
  token: ICancellationToken,
  sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>,
): Promise<{}> {
  const messages = createScopedParticipantMessages(systemPrompt, userText, context);
  return await streamScopedParticipantLLMResponse(messages, response, token, sendChatRequest);
}