import type {
  IChatMessage,
  IChatParticipantContext,
  IChatParticipantRequest,
} from '../../../services/chatTypes.js';
import type {
  ICanvasParticipantServices,
  IChatRuntimeTrace,
  IWorkspaceParticipantServices,
} from '../chatTypes.js';
import {
  buildScopedParticipantUserContent,
} from './chatScopedParticipantExecution.js';
import {
  buildRuntimePromptEnvelopeMessages,
  buildRuntimePromptSeedMessages,
} from './chatRuntimePromptMessages.js';

export type ScopedSurface = 'workspace' | 'canvas';

export function createScopedRuntimeTraceSeed(
  request: IChatParticipantRequest,
  surface: ScopedSurface,
): Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'> {
  const turnState = request.turnState;
  const route = turnState?.turnRoute ?? {
    kind: 'grounded' as const,
    reason: `${surface} scoped participant prompt stage`,
  };
  const retrievalPlan = {
    intent: 'question' as const,
    reasoning: route.reason,
    needsRetrieval: route.kind === 'grounded',
    queries: turnState ? [turnState.contextQueryText] : [request.text],
  };

  return {
    route,
    contextPlan: {
      route: route.kind,
      intent: retrievalPlan.intent,
      useRetrieval: retrievalPlan.needsRetrieval,
      useMemoryRecall: false,
      useTranscriptRecall: false,
      useConceptRecall: false,
      useCurrentPage: surface === 'canvas',
      citationMode: route.kind === 'grounded' ? 'required' : 'disabled',
      reasoning: route.reason,
      retrievalPlan,
    },
    hasActiveSlashCommand: turnState?.hasActiveSlashCommand ?? false,
    isRagReady: turnState?.isRagReady ?? false,
  };
}

export async function buildScopedRuntimePromptEnvelope(options: {
  systemPrompt: string;
  userText: string;
  request: IChatParticipantRequest;
  context?: IChatParticipantContext;
  readFileContent?: (relativePath: string) => Promise<string>;
  reportParticipantDebug?: IWorkspaceParticipantServices['reportParticipantDebug'] | ICanvasParticipantServices['reportParticipantDebug'];
  reportRuntimeTrace?: IWorkspaceParticipantServices['reportRuntimeTrace'] | ICanvasParticipantServices['reportRuntimeTrace'];
  surface: ScopedSurface;
}): Promise<{ messages: IChatMessage[]; userContent: string }> {
  const runtimeTraceSeed = createScopedRuntimeTraceSeed(options.request, options.surface);
  const seedMessages = buildRuntimePromptSeedMessages({
    systemPrompt: options.systemPrompt,
    history: options.context?.history,
  });

  options.reportRuntimeTrace?.({
    ...runtimeTraceSeed,
    checkpoint: 'prompt-seed',
    note: `${options.surface} scoped participant prompt seed`,
  });

  const userContent = await buildScopedParticipantUserContent({
    request: options.request,
    userText: options.userText,
    readFileContent: options.readFileContent,
    reportParticipantDebug: options.reportParticipantDebug,
    surface: options.surface,
  });

  const messages = buildRuntimePromptEnvelopeMessages({
    seedMessages,
    userContent,
    attachments: options.request.attachments,
  });

  options.reportRuntimeTrace?.({
    ...runtimeTraceSeed,
    checkpoint: 'prompt-envelope',
    note: `${options.surface} scoped participant prompt envelope`,
  });

  return { messages, userContent };
}