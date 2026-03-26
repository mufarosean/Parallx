import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
} from '../chatTypes.js';
import type {
  IResolvedDefaultChatTurnInterpretation,
} from './chatDefaultTurnInterpretation.js';
import {
  assessEvidenceSufficiency as _assessEvidenceSufficiency,
  buildRetrieveAgainQuery as _buildRetrieveAgainQuery,
} from './chatGroundedResponseHelpers.js';
import { buildDefaultRuntimePromptSeed } from './chatDefaultRuntimePromptStage.js';
import { writeChatProvenanceToResponse } from './chatTurnContextPreparation.js';
import { resolveDefaultPreparedTurnContext } from './chatDefaultPreparedTurnContext.js';

type IDefaultRuntimeContextStageServices = Pick<
  IDefaultParticipantServices,
  | 'getWorkspaceName'
  | 'getPageCount'
  | 'getCurrentPageTitle'
  | 'getFileCount'
  | 'getPromptOverlay'
  | 'getWorkspaceDigest'
  | 'getPreferencesForPrompt'
  | 'isRAGAvailable'
  | 'isIndexing'
  | 'unifiedConfigService'
  | 'getWorkflowSkillCatalog'
  | 'listFilesRelative'
  | 'readFileRelative'
  | 'retrieveContext'
  | 'getCurrentPageContent'
  | 'recallMemories'
  | 'recallTranscripts'
  | 'recallConcepts'
  | 'readFileContent'
  | 'reportRetrievalDebug'
  | 'reportContextPills'
  | 'getExcludedContextIds'
  | 'reportRuntimeTrace'
>;

export interface IRunDefaultRuntimeContextStageInput {
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly turn: IResolvedDefaultChatTurnInterpretation;
}

export interface IDefaultRuntimeContextStageResult {
  readonly messages: Awaited<ReturnType<typeof buildDefaultRuntimePromptSeed>>['messages'];
  readonly turnRoute: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['turnRoute'];
  readonly contextPlan: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['contextPlan'];
  readonly contextParts: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['contextParts'];
  readonly ragSources: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['ragSources'];
  readonly retrievedContextText: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['retrievedContextText'];
  readonly evidenceAssessment: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['evidenceAssessment'];
  readonly memoryResult: Awaited<ReturnType<typeof resolveDefaultPreparedTurnContext>>['memoryResult'];
}

export async function runDefaultRuntimeContextStage(
  services: IDefaultRuntimeContextStageServices,
  input: IRunDefaultRuntimeContextStageInput,
): Promise<IDefaultRuntimeContextStageResult> {
  const { messages } = await buildDefaultRuntimePromptSeed(services, {
    mode: input.request.mode,
    history: input.context.history,
  });

  const preparedContext = await resolveDefaultPreparedTurnContext(services as any, {
    mentionPills: input.turn.mentionPills,
    mentionContextBlocks: input.turn.mentionContextBlocks,
    userText: input.turn.userText,
    contextQueryText: input.turn.contextQueryText,
    hasActiveSlashCommand: input.turn.hasActiveSlashCommand,
    isRagReady: input.turn.isRagReady,
    turnRoute: input.turn.turnRoute,
    contextPlan: input.turn.contextPlan,
    retrievalPlan: input.turn.retrievalPlan,
    isConversationalTurn: input.turn.isConversationalTurn,
    queryScope: input.turn.queryScope,
    semanticFallback: input.turn.semanticFallback,
    sessionId: input.context.sessionId,
    messages,
    attachments: input.request.attachments,
    activatedSkill: input.turn.activatedSkill,
    assessEvidenceSufficiency: _assessEvidenceSufficiency,
    buildRetrieveAgainQuery: _buildRetrieveAgainQuery,
  } as any);
  writeChatProvenanceToResponse(input.response, preparedContext.provenance);

  return {
    messages,
    turnRoute: preparedContext.turnRoute,
    contextPlan: preparedContext.contextPlan,
    contextParts: preparedContext.contextParts,
    ragSources: preparedContext.ragSources,
    retrievedContextText: preparedContext.retrievedContextText,
    evidenceAssessment: preparedContext.evidenceAssessment,
    memoryResult: preparedContext.memoryResult,
  };
}