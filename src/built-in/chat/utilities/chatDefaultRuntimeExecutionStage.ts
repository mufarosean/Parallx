import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
} from '../chatTypes.js';
import type {
  IResolvedDefaultChatTurnInterpretation,
} from './chatDefaultTurnInterpretation.js';
import type {
  IDefaultRuntimeContextStageResult,
} from './chatDefaultRuntimeContextStage.js';
import { applyChatAnswerRepairPipeline } from './chatAnswerRepairPipeline.js';
import {
  buildDeterministicSessionSummary as _buildDeterministicSessionSummary,
  buildEvidenceResponseConstraint as _buildEvidenceResponseConstraint,
  buildExtractiveFallbackAnswer as _buildExtractiveFallbackAnswer,
} from './chatGroundedResponseHelpers.js';
import { buildDefaultRuntimePromptEnvelope } from './chatDefaultRuntimePromptStage.js';
import {
  buildMissingCitationFooter as _buildMissingCitationFooter,
  extractToolCallsFromText as _extractToolCallsFromText,
  parseEditResponse as _parseEditResponse,
  stripToolNarration as _stripToolNarration,
} from './chatResponseParsingHelpers.js';
import {
  repairAgentContactAnswer as _repairAgentContactAnswer,
  repairDeductibleConflictAnswer as _repairDeductibleConflictAnswer,
  repairGroundedAnswerTypography as _repairGroundedAnswerTypography,
  repairGroundedCodeAnswer as _repairGroundedCodeAnswer,
  repairTotalLossThresholdAnswer as _repairTotalLossThresholdAnswer,
  repairUnsupportedSpecificCoverageAnswer as _repairUnsupportedSpecificCoverageAnswer,
  repairUnsupportedWorkspaceTopicAnswer as _repairUnsupportedWorkspaceTopicAnswer,
  repairVehicleInfoAnswer as _repairVehicleInfoAnswer,
} from './chatGroundedAnswerRepairs.js';
import { categorizeChatRequestError } from './chatRequestErrorCategorizer.js';
import { createDefaultCommandRegistry } from './chatDefaultCommandRegistry.js';
import { executeDefaultPreparedTurn } from './chatDefaultTurnExecution.js';

type IDefaultRuntimeExecutionStageServices = Pick<
  IDefaultParticipantServices,
  | 'sendChatRequest'
  | 'invokeTool'
  | 'extractPreferences'
  | 'storeSessionMemory'
  | 'storeConceptsFromSession'
  | 'isSessionEligibleForSummary'
  | 'getSessionMemoryMessageCount'
  | 'sendSummarizationRequest'
  | 'reportResponseDebug'
  | 'reportRuntimeTrace'
  | 'reportBudget'
  | 'getModelContextLength'
  | 'unifiedConfigService'
  | 'networkTimeout'
  | 'sessionManager'
>;

export interface IRunDefaultRuntimeExecutionStageInput {
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly maxIterations: number;
  readonly capabilities: ReturnType<typeof import('../config/chatModeCapabilities.js').getModeCapabilities>;
  readonly turn: IResolvedDefaultChatTurnInterpretation;
  readonly preparedContext: IDefaultRuntimeContextStageResult;
  readonly commandRegistry: ReturnType<typeof createDefaultCommandRegistry>;
}

export function runDefaultRuntimeExecutionStage(
  services: IDefaultRuntimeExecutionStageServices,
  input: IRunDefaultRuntimeExecutionStageInput,
): Promise<IChatParticipantResult> | IChatParticipantResult {
  const promptEnvelope = buildDefaultRuntimePromptEnvelope({
    request: input.request,
    turn: input.turn,
    preparedContext: input.preparedContext,
    applyCommandTemplate: (command, userInput, contextContent) => input.commandRegistry.applyCommandTemplate(command, userInput, contextContent) ?? userInput,
    buildEvidenceResponseConstraint: _buildEvidenceResponseConstraint,
  });

  return executeDefaultPreparedTurn(services as IDefaultParticipantServices, {
    request: input.request,
    context: input.context,
    response: input.response,
    token: input.token,
    messages: promptEnvelope.messages,
    turnRoute: input.preparedContext.turnRoute,
    contextPlan: input.preparedContext.contextPlan,
    userText: input.turn.userText,
    userContent: promptEnvelope.userContent,
    contextParts: input.preparedContext.contextParts,
    retrievalPlan: input.turn.retrievalPlan,
    evidenceAssessment: input.preparedContext.evidenceAssessment,
    coverageRecord: input.preparedContext.coverageRecord,
    resolvedRequestText: input.turn.interpretation.rawText,
    capabilities: input.capabilities,
    retrievedContextText: input.preparedContext.retrievedContextText,
    memoryResult: input.preparedContext.memoryResult,
    isConversationalTurn: input.turn.isConversationalTurn,
    citationMode: input.preparedContext.contextPlan.citationMode,
    ragSources: input.preparedContext.ragSources,
    maxIterations: input.maxIterations,
    hasActiveSlashCommand: input.turn.hasActiveSlashCommand,
    isRagReady: input.turn.isRagReady,
    repairMarkdown: (markdown: string, userContent: string) => applyChatAnswerRepairPipeline(
      {
        repairGroundedAnswerTypography: _repairGroundedAnswerTypography,
        repairUnsupportedWorkspaceTopicAnswer: _repairUnsupportedWorkspaceTopicAnswer,
        repairUnsupportedSpecificCoverageAnswer: _repairUnsupportedSpecificCoverageAnswer,
        repairVehicleInfoAnswer: _repairVehicleInfoAnswer,
        repairAgentContactAnswer: _repairAgentContactAnswer,
        repairDeductibleConflictAnswer: _repairDeductibleConflictAnswer,
        repairTotalLossThresholdAnswer: _repairTotalLossThresholdAnswer,
        repairGroundedCodeAnswer: _repairGroundedCodeAnswer,
      },
      {
        query: input.request.text,
        markdown,
        retrievedContextText: input.preparedContext.retrievedContextText || userContent,
        evidenceAssessment: input.preparedContext.evidenceAssessment,
        coverageRecord: input.preparedContext.coverageRecord,
      },
    ),
    buildExtractiveFallbackAnswer: _buildExtractiveFallbackAnswer,
    buildMissingCitationFooter: _buildMissingCitationFooter,
    buildDeterministicSessionSummary: _buildDeterministicSessionSummary,
    parseEditResponse: _parseEditResponse,
    extractToolCallsFromText: _extractToolCallsFromText,
    stripToolNarration: _stripToolNarration,
    categorizeError: categorizeChatRequestError,
  });
}