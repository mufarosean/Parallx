import { isChatImageAttachment } from '../../../services/chatTypes.js';
import type {
  ICancellationToken,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IChatTurnRoute,
  IParsedSlashCommand,
} from '../chatTypes.js';
import { handlePreparedContextDeterministicAnswer } from './chatDeterministicResponse.js';
import { applyChatTurnBudgeting } from './chatTurnBudgeting.js';
import { composeChatUserContent } from './chatUserContentComposer.js';
import { buildChatTurnExecutionConfig } from './chatTurnExecutionConfig.js';
import { executePreparedChatTurn } from './chatTurnSynthesis.js';

export interface IExecuteDefaultPreparedTurnOptions {
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly messages: Awaited<ReturnType<typeof import('./chatTurnMessageAssembly.js').assembleChatTurnMessages>>['messages'];
  readonly slashResult: IParsedSlashCommand;
  readonly turnRoute: IChatTurnRoute;
  readonly effectiveText: string;
  readonly userText: string;
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
  readonly applyCommandTemplate: (command: import('../chatTypes.js').IChatSlashCommand, input: string, contextContent: string) => string;
  readonly buildEvidenceResponseConstraint: (query: string, assessment: import('./chatContextAssembly.js').IChatEvidenceAssessment, coverageRecord?: import('../chatTypes.js').ICoverageRecord) => string;
  readonly repairMarkdown: (markdown: string, userContent: string) => string;
  readonly buildExtractiveFallbackAnswer: (query: string, contextText: string) => string | undefined;
  readonly buildMissingCitationFooter: (ragSources: Array<{ uri: string; label: string; index?: number }>) => string;
  readonly buildDeterministicSessionSummary: (messages: readonly import('../../../services/chatTypes.js').IChatMessage[]) => string | undefined;
  readonly parseEditResponse: (text: string) => import('./chatResponseParsingHelpers.js').IParsedEditResponse | undefined;
  readonly extractToolCallsFromText: (text: string) => readonly import('./chatResponseParsingHelpers.js').IExtractedToolCall[];
  readonly stripToolNarration: (text: string) => string;
  readonly categorizeError: (error: unknown) => import('./chatRequestErrorCategorizer.js').IChatRequestErrorCategory;
}

export function executeDefaultPreparedTurn(
  services: IDefaultParticipantServices,
  options: IExecuteDefaultPreparedTurnOptions,
): Promise<IChatParticipantResult> | IChatParticipantResult {
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

  const userContent = composeChatUserContent(
    {
      applyCommandTemplate: options.applyCommandTemplate,
      buildEvidenceResponseConstraint: options.buildEvidenceResponseConstraint,
    },
    {
      slashResult: options.slashResult,
      effectiveText: options.effectiveText,
      userText: options.userText,
      contextParts: options.contextParts,
      retrievalPlan: options.retrievalPlan,
      evidenceAssessment: options.evidenceAssessment,
      coverageRecord: options.coverageRecord,
    },
  );

  options.messages.push({
    role: 'user',
    content: userContent,
    images: options.request.attachments?.filter(isChatImageAttachment),
  });

  const { synthesisDeps, synthesisOptions } = buildChatTurnExecutionConfig(services, {
    requestMode: options.request.mode,
    requestText: options.resolvedRequestText,
    capabilities: options.capabilities,
    messages: options.messages,
    userContent,
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
    repairMarkdown: (markdown) => options.repairMarkdown(markdown, userContent),
    buildExtractiveFallbackAnswer: options.buildExtractiveFallbackAnswer,
    buildMissingCitationFooter: options.buildMissingCitationFooter,
    buildDeterministicSessionSummary: options.buildDeterministicSessionSummary,
    parseEditResponse: options.parseEditResponse,
    extractToolCallsFromText: options.extractToolCallsFromText,
    stripToolNarration: options.stripToolNarration,
    categorizeError: options.categorizeError,
  });

  return executePreparedChatTurn(synthesisDeps, synthesisOptions);
}