import type {
  IChatParticipantContext,
  IChatParticipantRequest,
} from '../../../services/chatTypes.js';
import type { IChatRuntimeTrace } from '../chatTypes.js';

function mapParticipantWorkflowIntent(
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

function resolveParticipantWorkflowType(turnState: IChatParticipantRequest['turnState']): 'generic-grounded' | 'folder-summary' | 'exhaustive-extraction' {
  if (turnState?.turnRoute.workflowType === 'exhaustive-extraction') {
    return 'exhaustive-extraction';
  }

  if (turnState?.turnRoute.kind === 'grounded' && (turnState.turnRoute.coverageMode === 'exhaustive' || turnState.turnRoute.coverageMode === 'enumeration')) {
    return 'folder-summary';
  }

  return 'generic-grounded';
}

export function buildParticipantRuntimeTrace(
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  patch: Partial<IChatRuntimeTrace>,
  options?: {
    useCurrentPage?: boolean;
    useConceptRecall?: boolean;
  },
): IChatRuntimeTrace | undefined {
  const turnState = request.turnState;
  if (!turnState) {
    return undefined;
  }

  const workflowType = resolveParticipantWorkflowType(turnState);
  const retrievalPlan = {
    intent: mapParticipantWorkflowIntent(workflowType),
    reasoning: turnState.turnRoute.reason,
    needsRetrieval: turnState.turnRoute.kind === 'grounded',
    queries: [turnState.contextQueryText],
    coverageMode: turnState.turnRoute.coverageMode,
  };

  return {
    route: turnState.turnRoute,
    contextPlan: {
      route: turnState.turnRoute.kind,
      intent: retrievalPlan.intent,
      useRetrieval: retrievalPlan.needsRetrieval,
      useMemoryRecall: turnState.turnRoute.kind === 'memory-recall',
      useTranscriptRecall: turnState.turnRoute.kind === 'transcript-recall',
      useConceptRecall: options?.useConceptRecall ?? false,
      useCurrentPage: options?.useCurrentPage ?? false,
      citationMode: turnState.turnRoute.kind === 'grounded' ? 'required' : 'disabled',
      reasoning: turnState.turnRoute.reason,
      retrievalPlan,
    },
    queryScope: turnState.queryScope,
    semanticFallback: turnState.semanticFallback,
    sessionId: context.sessionId,
    hasActiveSlashCommand: turnState.hasActiveSlashCommand,
    isRagReady: turnState.isRagReady,
    runtime: 'claw',
    ...patch,
  };
}