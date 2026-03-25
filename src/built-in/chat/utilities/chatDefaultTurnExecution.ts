import type {
  ICancellationToken,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IChatContextPlan,
  IChatTurnRoute,
} from '../chatTypes.js';
import { handlePreparedContextDeterministicAnswer } from './chatDeterministicResponse.js';
import { applyChatTurnBudgeting } from './chatTurnBudgeting.js';
import { buildChatTurnExecutionConfig } from './chatTurnExecutionConfig.js';
import { executePreparedChatTurn } from './chatTurnSynthesis.js';
import type { IExecutePreparedChatTurnDeps } from './chatTurnSynthesis.js';

export interface IExecuteDefaultPreparedTurnOptions {
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly messages: import('../../../services/chatTypes.js').IChatMessage[];
  readonly turnRoute: IChatTurnRoute;
  readonly contextPlan: IChatContextPlan;
  readonly userText: string;
  readonly userContent: string;
  readonly contextParts: string[];
  readonly retrievalPlan: import('../chatTypes.js').IRetrievalPlan;
  readonly evidenceAssessment: import('./chatContextAssembly.js').IChatEvidenceAssessment;
  readonly coverageRecord: import('../chatTypes.js').ICoverageRecord | undefined;
  readonly resolvedRequestText: string;
  readonly capabilities: ReturnType<typeof import('../config/chatModeCapabilities.js').getModeCapabilities>;
  readonly retrievedContextText: string;
  readonly memoryResult: string | null;
  readonly isConversationalTurn: boolean;
  readonly citationMode: import('../chatTypes.js').IChatContextPlan['citationMode'];
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly maxIterations: number;
  readonly hasActiveSlashCommand: boolean;
  readonly isRagReady: boolean;
  readonly repairMarkdown: (markdown: string, userContent: string) => string;
  readonly buildExtractiveFallbackAnswer: IExecutePreparedChatTurnDeps['buildExtractiveFallbackAnswer'];
  readonly buildMissingCitationFooter: IExecutePreparedChatTurnDeps['buildMissingCitationFooter'];
  readonly buildDeterministicSessionSummary: IExecutePreparedChatTurnDeps['buildDeterministicSessionSummary'];
  readonly parseEditResponse: IExecutePreparedChatTurnDeps['parseEditResponse'];
  readonly extractToolCallsFromText: IExecutePreparedChatTurnDeps['extractToolCallsFromText'];
  readonly stripToolNarration: (text: string) => string;
  readonly categorizeError: IExecutePreparedChatTurnDeps['categorizeError'];
}

export async function executeDefaultPreparedTurn(
  services: IDefaultParticipantServices,
  options: IExecuteDefaultPreparedTurnOptions,
): Promise<IChatParticipantResult> {
  if (handlePreparedContextDeterministicAnswer({
    route: options.turnRoute,
    query: options.userText,
    evidenceAssessment: options.evidenceAssessment,
    retrievedContextText: options.retrievedContextText,
    memoryResult: options.memoryResult,
    ragSources: options.ragSources,
    response: options.response,
    token: options.token,
    reportResponseDebug: services.reportResponseDebug,
  })) {
    return {};
  }

  applyChatTurnBudgeting({
    messages: options.messages,
    contextParts: options.contextParts,
    userText: options.userText,
    response: options.response,
    contextWindow: services.getModelContextLength?.(),
    elasticBudget: services.unifiedConfigService?.getEffectiveConfig().retrieval.contextBudget,
    reportBudget: services.reportBudget,
  });

  const { synthesisDeps, synthesisOptions } = await buildChatTurnExecutionConfig(services, {
    requestMode: options.request.mode,
    requestText: options.resolvedRequestText,
    capabilities: options.capabilities,
    messages: options.messages,
    userContent: options.userContent,
    retrievedContextText: options.retrievedContextText,
    evidenceAssessment: options.evidenceAssessment,
    isConversationalTurn: options.isConversationalTurn,
    citationMode: options.citationMode,
    ragSources: options.ragSources,
    retrievalPlan: options.retrievalPlan,
    sessionId: options.context.sessionId,
    history: options.context.history,
    response: options.response,
    token: options.token,
    maxIterations: options.maxIterations,
    repairMarkdown: (markdown) => options.repairMarkdown(markdown, options.userContent),
    buildExtractiveFallbackAnswer: options.buildExtractiveFallbackAnswer,
    buildMissingCitationFooter: options.buildMissingCitationFooter,
    buildDeterministicSessionSummary: options.buildDeterministicSessionSummary,
    parseEditResponse: options.parseEditResponse,
    extractToolCallsFromText: options.extractToolCallsFromText,
    stripToolNarration: options.stripToolNarration,
    categorizeError: options.categorizeError,
  });

  return executePreparedChatTurn(synthesisDeps, {
    ...synthesisOptions,
    runtimeTraceSeed: {
      route: options.turnRoute,
      contextPlan: options.contextPlan,
      hasActiveSlashCommand: options.hasActiveSlashCommand,
      isRagReady: options.isRagReady,
    },
  });
}