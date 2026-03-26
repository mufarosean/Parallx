import type {
  IChatAttachment,
  IChatMessage,
} from '../../../services/chatTypes.js';
import type {
  IChatContextPlan,
  IDefaultParticipantServices,
  IPreparedChatTurnPrelude,
  IActivatedSkill,
} from '../chatTypes.js';
import type { IChatEvidenceAssessment } from './chatContextAssembly.js';
import { createChatContextPlan, createChatRuntimeTrace } from './chatContextPlanner.js';
import { buildSkillInstructionSection } from '../config/chatSystemPrompts.js';
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
  | 'reportRuntimeTrace'
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
  readonly turnRoute: IPreparedChatTurnPrelude['turnRoute'];
  readonly contextPlan: IChatContextPlan;
  readonly contextParts: string[];
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatEvidenceAssessment;
  readonly provenance: Awaited<ReturnType<typeof prepareChatTurnContext>>['provenance'];
  readonly memoryResult: string | null;
}

export async function resolveDefaultPreparedTurnContext(
  services: IDefaultPreparedTurnContextServices,
  input: IResolveDefaultPreparedTurnContextInput,
): Promise<IResolvedDefaultPreparedTurnContext> {
  if (input.semanticFallback && input.messages.length > 0 && input.messages[0].role === 'system') {
    input.messages[0] = {
      ...input.messages[0],
      content: [
        input.messages[0].content,
        '',
        'SEMANTIC FALLBACK GUIDANCE:',
        '- Treat this as a workspace-wide exhaustive summary request.',
        '- Enumerate the relevant files in scope and summarize the important content across them.',
        '- Prefer complete multi-file coverage over a representative subset.',
      ].join('\n'),
    };
  }

  const contextPlan = createChatContextPlan(input.turnRoute, {
    hasActiveSlashCommand: input.hasActiveSlashCommand,
    isRagReady: input.isRagReady,
  });

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
      contextPlan,
      hasActiveSlashCommand: input.hasActiveSlashCommand,
      isRagReady: input.isRagReady,
    },
  );

  services.reportRuntimeTrace?.(createChatRuntimeTrace(
    input.turnRoute,
    contextPlan,
    {
      sessionId: input.sessionId,
      hasActiveSlashCommand: input.hasActiveSlashCommand,
      isRagReady: input.isRagReady,
      semanticFallback: input.semanticFallback,
    },
  ));

  if (input.activatedSkill && input.messages.length > 0 && input.messages[0].role === 'system') {
    input.messages[0] = {
      ...input.messages[0],
      content: input.messages[0].content + buildSkillInstructionSection(input.activatedSkill),
    };
  }

  return {
    turnRoute: input.turnRoute,
    contextPlan,
    contextParts: preparedContext.contextParts,
    ragSources: preparedContext.ragSources,
    retrievedContextText: preparedContext.retrievedContextText,
    evidenceAssessment: preparedContext.evidenceAssessment,
    provenance: preparedContext.provenance,
    memoryResult: preparedContext.memoryResult,
  };
}