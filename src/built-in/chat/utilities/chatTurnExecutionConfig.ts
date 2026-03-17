import type {
  ICancellationToken,
  IChatMessage,
  IChatRequestResponsePair,
  IChatRequestOptions,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  IChatModeCapabilities,
  IDefaultParticipantServices,
  IRetrievalPlan,
} from '../chatTypes.js';
import type { IChatGroundedEvidenceAssessment } from './chatGroundedExecutor.js';
import type {
  IExecutePreparedChatTurnDeps,
  IExecutePreparedChatTurnOptions,
} from './chatTurnSynthesis.js';
import { shouldIncludeTools, shouldUseStructuredOutput } from '../config/chatModeCapabilities.js';
import { captureSession } from '../../../workspace/staleGuard.js';

const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;

export interface IBuildChatTurnExecutionConfigInput {
  readonly requestMode: import('../../../services/chatTypes.js').ChatMode;
  readonly requestText: string;
  readonly capabilities: IChatModeCapabilities;
  readonly messages: IChatMessage[];
  readonly userContent: string;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatGroundedEvidenceAssessment;
  readonly isConversationalTurn: boolean;
  readonly citationMode: 'required' | 'disabled';
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly retrievalPlan: IRetrievalPlan;
  readonly sessionId: string;
  readonly history: readonly IChatRequestResponsePair[];
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly maxIterations: number;
  readonly repairMarkdown: (markdown: string) => string;
  readonly buildExtractiveFallbackAnswer: IExecutePreparedChatTurnDeps['buildExtractiveFallbackAnswer'];
  readonly buildMissingCitationFooter: IExecutePreparedChatTurnDeps['buildMissingCitationFooter'];
  readonly buildDeterministicSessionSummary: IExecutePreparedChatTurnDeps['buildDeterministicSessionSummary'];
  readonly parseEditResponse: IExecutePreparedChatTurnDeps['parseEditResponse'];
  readonly extractToolCallsFromText: IExecutePreparedChatTurnDeps['extractToolCallsFromText'];
  readonly stripToolNarration: IExecutePreparedChatTurnDeps['stripToolNarration'];
  readonly categorizeError: IExecutePreparedChatTurnDeps['categorizeError'];
}

export function buildChatTurnExecutionConfig(
  services: IDefaultParticipantServices,
  input: IBuildChatTurnExecutionConfigInput,
): {
  synthesisDeps: IExecutePreparedChatTurnDeps;
  synthesisOptions: IExecutePreparedChatTurnOptions;
} {
  const effectiveConfig = services.unifiedConfigService?.getEffectiveConfig();
  const requestOptions: IChatRequestOptions = {
    tools: (!input.isConversationalTurn && shouldIncludeTools(input.requestMode))
      ? (input.capabilities.canAutonomous ? services.getToolDefinitions() : services.getReadOnlyToolDefinitions())
      : undefined,
    format: shouldUseStructuredOutput(input.requestMode) ? { type: 'object' } : undefined,
    think: true,
    temperature: effectiveConfig?.model.temperature,
    maxTokens: effectiveConfig?.model.maxTokens || undefined,
  };

  const canInvokeTools = input.capabilities.canInvokeTools && !!services.invokeTool;
  const isEditMode = input.capabilities.canProposeEdits && !input.capabilities.canAutonomous;
  const memoryEnabled = services.unifiedConfigService?.getEffectiveConfig().memory.memoryEnabled ?? true;

  return {
    synthesisDeps: {
      sendChatRequest: services.sendChatRequest,
      invokeTool: services.invokeTool,
      extractPreferences: services.extractPreferences,
      storeSessionMemory: services.storeSessionMemory,
      storeConceptsFromSession: services.storeConceptsFromSession,
      isSessionEligibleForSummary: services.isSessionEligibleForSummary,
      getSessionMemoryMessageCount: services.getSessionMemoryMessageCount,
      sendSummarizationRequest: services.sendSummarizationRequest,
      reportResponseDebug: services.reportResponseDebug,
      buildExtractiveFallbackAnswer: input.buildExtractiveFallbackAnswer,
      buildMissingCitationFooter: input.buildMissingCitationFooter,
      buildDeterministicSessionSummary: input.buildDeterministicSessionSummary,
      repairMarkdown: input.repairMarkdown,
      parseEditResponse: input.parseEditResponse,
      extractToolCallsFromText: input.extractToolCallsFromText,
      stripToolNarration: input.stripToolNarration,
      categorizeError: input.categorizeError,
    },
    synthesisOptions: {
      messages: input.messages,
      requestOptions,
      response: input.response,
      token: input.token,
      maxIterations: input.maxIterations,
      canInvokeTools,
      isEditMode,
      useModelOnlyExecution: requestOptions.tools === undefined && !input.capabilities.canAutonomous,
      requestText: input.requestText,
      userContent: input.userContent,
      retrievedContextText: input.retrievedContextText,
      evidenceAssessment: input.evidenceAssessment,
      isConversationalTurn: input.isConversationalTurn,
      citationMode: input.citationMode,
      ragSources: input.ragSources,
      retrievalPlan: input.retrievalPlan,
      memoryEnabled,
      sessionId: input.sessionId,
      history: input.history,
      networkTimeoutMs: services.networkTimeout ?? DEFAULT_NETWORK_TIMEOUT_MS,
      sessionCancellationSignal: services.sessionManager?.activeContext?.cancellationSignal,
      toolGuard: services.sessionManager
        ? captureSession(services.sessionManager)
        : undefined,
    },
  };
}