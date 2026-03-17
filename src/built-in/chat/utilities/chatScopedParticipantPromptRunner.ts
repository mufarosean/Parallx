import type {
  ICancellationToken,
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  IChatRequestOptions,
} from '../../../services/chatTypes.js';
import {
  buildScopedParticipantUserContent,
  createScopedParticipantMessages,
  streamScopedParticipantLLMResponse,
} from './chatScopedParticipantExecution.js';

export async function runScopedParticipantPrompt(options: {
  systemPrompt: string;
  userText: string;
  request: IChatParticipantRequest;
  context: IChatParticipantContext | undefined;
  response: IChatResponseStream;
  token: ICancellationToken;
  sendChatRequest: (
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ) => AsyncIterable<IChatResponseChunk>;
  readFileContent?: (relativePath: string) => Promise<string>;
  reportParticipantDebug?: (debug: {
    surface: 'workspace' | 'canvas';
    usedSharedTurnState: boolean;
    attachmentCount: number;
    fileAttachmentCount: number;
    imageAttachmentCount: number;
    queryScopeLevel?: string;
    semanticFallbackKind?: string;
  }) => void;
  surface: 'workspace' | 'canvas';
}): Promise<{}> {
  const userContent = await buildScopedParticipantUserContent({
    request: options.request,
    userText: options.userText,
    readFileContent: options.readFileContent,
    reportParticipantDebug: options.reportParticipantDebug,
    surface: options.surface,
  });
  const messages = createScopedParticipantMessages(options.systemPrompt, userContent, options.request, options.context);
  return await streamScopedParticipantLLMResponse(messages, options.response, options.token, options.sendChatRequest);
}