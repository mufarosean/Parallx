import type {
  IChatAttachment,
  IChatMessage,
} from '../../../services/chatTypes.js';
import type {
  ICoverageRecord,
  IDefaultParticipantServices,
  IPreparedChatTurnPrelude,
  IActivatedSkill,
} from '../chatTypes.js';
import type { IChatEvidenceAssessment } from './chatContextAssembly.js';
import { gatherEvidence, computeCoverage } from './chatEvidenceGatherer.js';
import { buildExecutionPlan } from './chatExecutionPlanner.js';
import { buildExecutionPlanPromptSection, buildSkillInstructionSection } from '../config/chatSystemPrompts.js';
import { prepareChatTurnContext } from './chatTurnContextPreparation.js';

type IDefaultPreparedTurnContextServices = Pick<
  IDefaultParticipantServices,
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
>;

export interface IResolveDefaultPreparedTurnContextInput extends IPreparedChatTurnPrelude {
  readonly sessionId: string;
  readonly messages: IChatMessage[];
  readonly attachments?: readonly IChatAttachment[];
  readonly activatedSkill?: IActivatedSkill;
  readonly assessEvidenceSufficiency: (
    query: string,
    retrievedContextText: string,
    ragSources: readonly { uri: string; label: string; index?: number }[],
  ) => IChatEvidenceAssessment;
  readonly buildRetrieveAgainQuery: (query: string, retrievedContextText: string) => string | undefined;
}

export interface IResolvedDefaultPreparedTurnContext {
  readonly contextParts: string[];
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatEvidenceAssessment;
  readonly provenance: Awaited<ReturnType<typeof prepareChatTurnContext>>['provenance'];
  readonly memoryResult: string | null;
  readonly coverageRecord: ICoverageRecord | undefined;
}

export async function resolveDefaultPreparedTurnContext(
  services: IDefaultPreparedTurnContextServices,
  input: IResolveDefaultPreparedTurnContextInput,
): Promise<IResolvedDefaultPreparedTurnContext> {
  const executionPlan = buildExecutionPlan(input.turnRoute, input.queryScope);
  const isPlannedWorkflow = executionPlan.workflowType !== 'generic-grounded';

  const evidenceBundle = isPlannedWorkflow
    ? await gatherEvidence(executionPlan, input.contextQueryText, {
        listFilesRelative: services.listFilesRelative,
        readFileRelative: services.readFileRelative,
        retrieveContext: services.retrieveContext,
      })
    : undefined;

  const coverageRecord = evidenceBundle
    ? computeCoverage(evidenceBundle)
    : undefined;

  const planPromptSection = buildExecutionPlanPromptSection(executionPlan, input.queryScope, coverageRecord);
  if (planPromptSection && input.messages.length > 0 && input.messages[0].role === 'system') {
    input.messages[0] = { ...input.messages[0], content: input.messages[0].content + planPromptSection };
  }

  if (input.activatedSkill && input.messages.length > 0 && input.messages[0].role === 'system') {
    input.messages[0] = {
      ...input.messages[0],
      content: input.messages[0].content + buildSkillInstructionSection(input.activatedSkill),
    };
  }

  const preparedContext = await prepareChatTurnContext(
    {
      getCurrentPageContent: services.getCurrentPageContent,
      retrieveContext: services.retrieveContext,
      recallMemories: services.recallMemories,
      recallTranscripts: services.recallTranscripts,
      recallConcepts: services.recallConcepts,
      readFileContent: services.readFileContent,
      reportRetrievalDebug: services.reportRetrievalDebug,
      reportContextPills: services.reportContextPills,
      getExcludedContextIds: services.getExcludedContextIds,
      assessEvidenceSufficiency: input.assessEvidenceSufficiency,
      buildRetrieveAgainQuery: input.buildRetrieveAgainQuery,
    },
    {
      contextQueryText: input.contextQueryText,
      sessionId: input.sessionId,
      attachments: input.attachments,
      messages: input.messages,
      mentionPills: input.mentionPills,
      mentionContextBlocks: input.mentionContextBlocks,
      contextPlan: input.contextPlan,
      hasActiveSlashCommand: input.hasActiveSlashCommand,
      isRagReady: input.isRagReady,
      evidenceBundle,
    },
  );

  return {
    contextParts: preparedContext.contextParts,
    ragSources: preparedContext.ragSources,
    retrievedContextText: preparedContext.retrievedContextText,
    evidenceAssessment: preparedContext.evidenceAssessment,
    provenance: preparedContext.provenance,
    memoryResult: preparedContext.memoryResult,
    coverageRecord,
  };
}