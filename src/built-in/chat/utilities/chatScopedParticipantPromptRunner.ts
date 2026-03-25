import type {
  ICancellationToken,
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  IChatRequestOptions,
} from '../../../services/chatTypes.js';
import { streamScopedParticipantLLMResponse } from './chatScopedParticipantExecution.js';
import { buildScopedRuntimePromptEnvelope } from './chatScopedRuntimePromptStage.js';
import type { IChatRuntimeTrace } from '../chatTypes.js';
import { createScopedParticipantRuntimeReporter } from './chatScopedParticipantRuntime.js';

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
  reportRuntimeTrace?: (trace: IChatRuntimeTrace) => void;
  surface: 'workspace' | 'canvas';
}): Promise<{}> {
  const reportRuntimeTrace = createScopedParticipantRuntimeReporter({
    request: options.request,
    context: options.context,
    surface: options.surface,
    reportRuntimeTrace: options.reportRuntimeTrace,
  });

  const { messages } = await buildScopedRuntimePromptEnvelope({
    systemPrompt: options.systemPrompt,
    userText: options.userText,
    request: options.request,
    context: options.context,
    readFileContent: options.readFileContent,
    reportParticipantDebug: options.reportParticipantDebug,
    reportRuntimeTrace,
    surface: options.surface,
  });
  return await streamScopedParticipantLLMResponse(messages, options.response, options.token, options.sendChatRequest);
}