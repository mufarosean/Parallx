import type {
  IChatParticipantContext,
  IChatParticipantRequest,
} from '../../../services/chatTypes.js';
import type { IChatRuntimeTrace } from '../chatTypes.js';

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

  const retrievalPlan = {
    intent: 'question' as const,
    reasoning: turnState.turnRoute.reason,
    needsRetrieval: turnState.turnRoute.kind === 'grounded',
    queries: [turnState.contextQueryText],
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