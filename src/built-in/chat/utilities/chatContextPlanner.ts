import type {
  IChatContextPlan,
  IChatSemanticFallbackDecision,
  IChatRuntimeTrace,
  IChatTurnRoute,
  IRetrievalPlan,
} from '../chatTypes.js';

function buildRetrievalPlan(
  route: IChatTurnRoute,
  options: { hasActiveSlashCommand: boolean; isRagReady: boolean },
): IRetrievalPlan {
  switch (route.kind) {
    case 'conversational':
      return {
        intent: 'conversational',
        reasoning: route.reason,
        needsRetrieval: false,
        queries: [],
      };
    case 'memory-recall':
    case 'transcript-recall':
      return {
        intent: 'question',
        reasoning: route.reason,
        needsRetrieval: false,
        queries: [],
      };
    case 'grounded':
    default: {
      return {
        intent: 'question',
        reasoning: options.hasActiveSlashCommand
          ? 'Slash command is active, so automatic retrieval stays off while normal execution continues.'
          : 'Direct retrieval uses embedding similarity to filter relevant workspace context.',
        needsRetrieval: options.isRagReady && !options.hasActiveSlashCommand,
        queries: [],
      };
    }
  }
}

export function createChatContextPlan(
  route: IChatTurnRoute,
  options: { hasActiveSlashCommand: boolean; isRagReady: boolean },
): IChatContextPlan {
  const retrievalPlan = buildRetrievalPlan(route, options);

  switch (route.kind) {
    case 'conversational':
      return {
        route: route.kind,
        intent: retrievalPlan.intent,
        useRetrieval: false,
        useMemoryRecall: false,
        useConceptRecall: false,
        useTranscriptRecall: false,
        useCurrentPage: false,
        citationMode: 'disabled',
        reasoning: route.reason,
        retrievalPlan,
      };
    case 'memory-recall':
      return {
        route: route.kind,
        intent: retrievalPlan.intent,
        useRetrieval: false,
        useMemoryRecall: true,
        useTranscriptRecall: false,
        useConceptRecall: false,
        useCurrentPage: false,
        citationMode: 'disabled',
        reasoning: route.reason,
        retrievalPlan,
      };
    case 'transcript-recall':
      return {
        route: route.kind,
        intent: retrievalPlan.intent,
        useRetrieval: false,
        useMemoryRecall: false,
        useTranscriptRecall: true,
        useConceptRecall: false,
        useCurrentPage: false,
        citationMode: 'disabled',
        reasoning: route.reason,
        retrievalPlan,
      };
    case 'grounded':
    default:
      return {
        route: route.kind,
        intent: retrievalPlan.intent,
        useRetrieval: retrievalPlan.needsRetrieval,
        useMemoryRecall: false,
        useTranscriptRecall: false,
        useConceptRecall: false,
        useCurrentPage: true,
        citationMode: 'required',
        reasoning: route.reason,
        retrievalPlan,
      };
  }
}

export function createChatRuntimeTrace(
  route: IChatTurnRoute,
  contextPlan: IChatContextPlan,
  options: { sessionId?: string; hasActiveSlashCommand: boolean; isRagReady: boolean; semanticFallback?: IChatSemanticFallbackDecision },
): IChatRuntimeTrace {
  return {
    route,
    contextPlan,
    semanticFallback: options.semanticFallback,
    sessionId: options.sessionId,
    hasActiveSlashCommand: options.hasActiveSlashCommand,
    isRagReady: options.isRagReady,
  };
}