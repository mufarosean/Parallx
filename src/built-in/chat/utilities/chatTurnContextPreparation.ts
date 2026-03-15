import type {
  IChatAttachment,
  IChatMessage,
  IChatProvenanceEntry,
  IChatResponseStream,
  IContextPill,
} from '../../../services/chatTypes.js';
import type {
  IChatContextPlan,
  IDefaultParticipantServices,
  IEvidenceBundle,
} from '../chatTypes.js';
import { assembleChatContext, type IChatEvidenceAssessment } from './chatContextAssembly.js';
import { loadChatContextSources } from './chatContextSourceLoader.js';

const MAX_PAGE_CONTEXT_CHARS = 16_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const MAX_TRANSCRIPT_CONTEXT_CHARS = 4_000;
const MAX_CONCEPT_CONTEXT_CHARS = 2_000;

export interface IPrepareChatTurnContextDeps {
  readonly getCurrentPageContent?: IDefaultParticipantServices['getCurrentPageContent'];
  readonly retrieveContext?: IDefaultParticipantServices['retrieveContext'];
  readonly recallMemories?: IDefaultParticipantServices['recallMemories'];
  readonly recallTranscripts?: IDefaultParticipantServices['recallTranscripts'];
  readonly recallConcepts?: IDefaultParticipantServices['recallConcepts'];
  readonly readFileContent?: IDefaultParticipantServices['readFileContent'];
  readonly reportRetrievalDebug?: IDefaultParticipantServices['reportRetrievalDebug'];
  readonly reportContextPills?: IDefaultParticipantServices['reportContextPills'];
  readonly getExcludedContextIds?: IDefaultParticipantServices['getExcludedContextIds'];
  readonly assessEvidenceSufficiency: (
    query: string,
    retrievedContextText: string,
    ragSources: readonly { uri: string; label: string; index?: number }[],
  ) => IChatEvidenceAssessment;
  readonly buildRetrieveAgainQuery: (query: string, retrievedContextText: string) => string | undefined;
}

export interface IPrepareChatTurnContextOptions {
  readonly contextQueryText: string;
  readonly sessionId: string;
  readonly attachments?: readonly IChatAttachment[];
  readonly messages: readonly IChatMessage[];
  readonly mentionPills: readonly IContextPill[];
  readonly mentionContextBlocks: readonly string[];
  readonly contextPlan: IChatContextPlan;
  readonly hasActiveSlashCommand: boolean;
  readonly isRagReady: boolean;
  /** M38: Pre-gathered evidence bundle from the execution planner. */
  readonly evidenceBundle?: IEvidenceBundle;
}

export interface IPreparedChatTurnContext {
  readonly contextParts: string[];
  readonly ragSources: Array<{ uri: string; label: string; index?: number }>;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatEvidenceAssessment;
  readonly provenance: IChatProvenanceEntry[];
  readonly memoryResult: string | null;
  readonly transcriptResult: string | null;
  readonly conceptResult: string | null;
}

export async function prepareChatTurnContext(
  deps: IPrepareChatTurnContextDeps,
  options: IPrepareChatTurnContextOptions,
): Promise<IPreparedChatTurnContext> {

  // M38: When the evidence bundle already contains semantic evidence,
  // suppress the initial retrieval to avoid duplicate retrieveContext calls.
  // The semantic evidence is forwarded as the ragResult so that
  // assembleChatContext can assess sufficiency and still "retrieve again"
  // when the initial evidence is insufficient.
  const semanticItem = options.evidenceBundle?.items.find(i => i.kind === 'semantic') as
    | import('../chatTypes.js').ISemanticEvidence
    | undefined;
  const evidenceHasSemantics = !!semanticItem;
  const effectiveUseRetrieval = evidenceHasSemantics ? false : options.contextPlan.useRetrieval;

  const {
    pageResult,
    ragResult,
    memoryResult,
    conceptResult,
    attachmentResults,
    transcriptResult,
  } = await loadChatContextSources(
    {
      getCurrentPageContent: deps.getCurrentPageContent,
      retrieveContext: deps.retrieveContext,
      recallMemories: deps.recallMemories,
      recallTranscripts: deps.recallTranscripts,
      recallConcepts: deps.recallConcepts,
      readFileContent: deps.readFileContent,
      reportRetrievalDebug: deps.reportRetrievalDebug,
    },
    {
      userText: options.contextQueryText,
      sessionId: options.sessionId,
      attachments: options.attachments,
      useCurrentPage: options.contextPlan.useCurrentPage,
      useRetrieval: effectiveUseRetrieval,
      useMemoryRecall: options.contextPlan.useMemoryRecall,
      useTranscriptRecall: options.contextPlan.useTranscriptRecall,
      useConceptRecall: options.contextPlan.useConceptRecall,
      hasActiveSlashCommand: options.hasActiveSlashCommand,
      isRagReady: options.isRagReady,
    },
  );

  // When standard retrieval was suppressed, forward the semantic evidence
  // as ragResult so assembleChatContext can evaluate sufficiency normally.
  const effectiveRagResult = ragResult ?? (semanticItem
    ? { text: semanticItem.text, sources: [...semanticItem.sources] }
    : null);

  const {
    contextParts: assembledContextParts,
    ragSources,
    retrievedContextText,
    evidenceAssessment,
    provenance,
  } = await assembleChatContext(
    {
      retrieveContext: deps.retrieveContext,
      reportContextPills: deps.reportContextPills,
      getExcludedContextIds: deps.getExcludedContextIds,
      assessEvidenceSufficiency: deps.assessEvidenceSufficiency,
      buildRetrieveAgainQuery: deps.buildRetrieveAgainQuery,
    },
    {
      userText: options.contextQueryText,
      messages: options.messages,
      attachments: options.attachments,
      mentionPills: options.mentionPills,
      useRetrieval: options.contextPlan.useRetrieval,
      maxMemoryContextChars: MAX_MEMORY_CONTEXT_CHARS,
      maxTranscriptContextChars: MAX_TRANSCRIPT_CONTEXT_CHARS,
      maxConceptContextChars: MAX_CONCEPT_CONTEXT_CHARS,
      pageResult: pageResult && pageResult.textContent
        ? {
            ...pageResult,
            textContent: pageResult.textContent.length > MAX_PAGE_CONTEXT_CHARS
              ? pageResult.textContent.slice(0, MAX_PAGE_CONTEXT_CHARS) + '\n[…truncated — use read_current_page for full content]'
              : pageResult.textContent,
          }
        : pageResult,
      ragResult: effectiveRagResult,
      memoryResult,
      transcriptResult,
      conceptResult,
      attachmentResults,
      evidenceBundle: options.evidenceBundle,
    },
  );

  return {
    contextParts: [...options.mentionContextBlocks, ...assembledContextParts],
    ragSources,
    retrievedContextText,
    evidenceAssessment,
    provenance,
    memoryResult,
    transcriptResult,
    conceptResult,
  };
}

export function writeChatProvenanceToResponse(
  response: IChatResponseStream,
  provenance: readonly IChatProvenanceEntry[],
): void {
  for (const entry of provenance) {
    if (!entry.uri) {
      continue;
    }
    const provenanceWriter = (response as { provenance?: (payload: IChatProvenanceEntry) => void }).provenance;
    if (typeof provenanceWriter === 'function') {
      provenanceWriter(entry);
    } else {
      response.reference(entry.uri, entry.label, entry.index);
    }
  }
}
