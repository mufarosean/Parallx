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

function resolvePromptWorkflowType(route: IChatRuntimeTrace['route'] | undefined): 'generic-grounded' | 'folder-summary' | 'exhaustive-extraction' {
  if (route?.workflowType === 'exhaustive-extraction') {
    return 'exhaustive-extraction';
  }

  if (route?.kind === 'grounded' && (route.coverageMode === 'exhaustive' || route.coverageMode === 'enumeration')) {
    return 'folder-summary';
  }

  return 'generic-grounded';
}

function mapWorkflowTypeToRetrievalIntent(
  workflowType: 'generic-grounded' | 'folder-summary' | 'exhaustive-extraction',
): IChatRuntimeTrace['contextPlan']['intent'] {
  switch (workflowType) {
    case 'exhaustive-extraction':
      return 'task';
    case 'folder-summary':
    case 'generic-grounded':
    default:
      return 'question';
  }
}

export function createScopedRuntimeTraceSeed(
  request: IChatParticipantRequest,
  surface: ScopedSurface,
): Pick<IChatRuntimeTrace, 'route' | 'contextPlan' | 'hasActiveSlashCommand' | 'isRagReady'> {
  const turnState = request.turnState;
  const workflowType = resolvePromptWorkflowType(turnState?.turnRoute);
  const route = turnState?.turnRoute ?? {
    kind: 'grounded',
    reason: `${surface} scoped participant prompt stage`,
    workflowType,
  };
  const retrievalPlan = {
    intent: mapWorkflowTypeToRetrievalIntent(workflowType),
    reasoning: route.reason,
    needsRetrieval: route.kind === 'grounded',
    queries: turnState ? [turnState.contextQueryText] : [request.text],
    coverageMode: route.coverageMode,
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