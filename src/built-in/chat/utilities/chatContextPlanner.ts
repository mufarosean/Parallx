import type {
  IChatContextPlan,
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
    case 'product-semantics':
    case 'off-topic':
      return {
        intent: 'question',
        reasoning: route.reason,
        needsRetrieval: false,
        queries: [],
      };
    case 'grounded':
    default:
      return {
        intent: route.coverageMode === 'exhaustive' ? 'exploration' : 'question',
        reasoning: options.hasActiveSlashCommand
          ? 'Slash command is active, so automatic retrieval stays off while normal execution continues.'
          : route.coverageMode === 'exhaustive'
            ? 'This request needs exhaustive file-by-file coverage. Use retrieval for discovery, but do not treat representative top-k context as full coverage.'
            : 'Direct retrieval uses embedding similarity to filter relevant workspace context.',
        needsRetrieval: options.isRagReady && !options.hasActiveSlashCommand,
        queries: [],
        coverageMode: route.coverageMode ?? 'representative',
      };
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
    case 'product-semantics':
    case 'off-topic':
      return {
        route: route.kind,
        intent: retrievalPlan.intent,
        useRetrieval: false,
        useMemoryRecall: false,
        useTranscriptRecall: false,
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
        citationMode: retrievalPlan.needsRetrieval ? 'required' : 'disabled',
        reasoning: route.reason,
        retrievalPlan,
      };
  }
}

export function createChatRuntimeTrace(
  route: IChatTurnRoute,
  contextPlan: IChatContextPlan,
  options: { sessionId?: string; hasActiveSlashCommand: boolean; isRagReady: boolean },
): IChatRuntimeTrace {
  return {
    route,
    contextPlan,
    sessionId: options.sessionId,
    hasActiveSlashCommand: options.hasActiveSlashCommand,
    isRagReady: options.isRagReady,
  };
}