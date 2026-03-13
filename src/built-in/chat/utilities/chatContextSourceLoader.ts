import { isChatFileAttachment } from '../../../services/chatTypes.js';
import type { IChatAttachment } from '../../../services/chatTypes.js';

export type ChatPageResult = { title: string; pageId: string; textContent: string } | null;
export type ChatRagResult = { text: string; sources: Array<{ uri: string; label: string; index?: number }> } | null;
export type ChatMemoryResult = string | null;
export type ChatTranscriptResult = string | null;
export type ChatConceptResult = string | null;
export type ChatAttachmentResult = { name: string; content: string | null };

export interface IChatContextSourceLoaderDeps {
  readonly getCurrentPageContent?: () => Promise<{ title: string; pageId: string; textContent: string } | undefined>;
  readonly retrieveContext?: (query: string) => Promise<{ text: string; sources: Array<{ uri: string; label: string; index?: number }> } | undefined>;
  readonly recallMemories?: (query: string, sessionId?: string) => Promise<string | undefined>;
  readonly recallTranscripts?: (query: string) => Promise<string | undefined>;
  readonly recallConcepts?: (query: string) => Promise<string | undefined>;
  readonly readFileContent?: (fullPath: string) => Promise<string>;
  readonly reportRetrievalDebug?: (debug: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  }) => void;
}

export interface IChatContextSourceLoadOptions {
  readonly userText: string;
  readonly sessionId: string;
  readonly attachments?: readonly IChatAttachment[];
  readonly useCurrentPage: boolean;
  readonly useRetrieval: boolean;
  readonly useMemoryRecall: boolean;
  readonly useTranscriptRecall: boolean;
  readonly useConceptRecall: boolean;
  readonly hasActiveSlashCommand: boolean;
  readonly isRagReady: boolean;
}

export interface IChatContextSourceLoadResult {
  readonly pageResult: ChatPageResult;
  readonly ragResult: ChatRagResult;
  readonly memoryResult: ChatMemoryResult;
  readonly transcriptResult: ChatTranscriptResult;
  readonly conceptResult: ChatConceptResult;
  readonly attachmentResults: ChatAttachmentResult[];
}

export async function loadChatContextSources(
  deps: IChatContextSourceLoaderDeps,
  options: IChatContextSourceLoadOptions,
): Promise<IChatContextSourceLoadResult> {
  const [pageResult, ragResult, memoryResult, transcriptResult, conceptResult, attachmentResults] = await Promise.all([
    options.useCurrentPage && deps.getCurrentPageContent
      ? deps.getCurrentPageContent().then((result): ChatPageResult => result ?? null).catch((): ChatPageResult => null)
      : Promise.resolve(null as ChatPageResult),

    options.useRetrieval && deps.retrieveContext
      ? deps.retrieveContext(options.userText)
          .then((result): ChatRagResult => {
            deps.reportRetrievalDebug?.({
              hasActiveSlashCommand: options.hasActiveSlashCommand,
              isRagReady: options.isRagReady,
              needsRetrieval: options.useRetrieval,
              attempted: true,
              returnedSources: result?.sources.length ?? 0,
            });
            return result ?? null;
          })
          .catch((): ChatRagResult => {
            deps.reportRetrievalDebug?.({
              hasActiveSlashCommand: options.hasActiveSlashCommand,
              isRagReady: options.isRagReady,
              needsRetrieval: options.useRetrieval,
              attempted: true,
              returnedSources: 0,
            });
            return null;
          })
      : Promise.resolve(null as ChatRagResult),

    options.useMemoryRecall && deps.recallMemories
      ? deps.recallMemories(options.userText, options.sessionId).then((result): ChatMemoryResult => result ?? null).catch((): ChatMemoryResult => null)
      : Promise.resolve(null as ChatMemoryResult),

    options.useTranscriptRecall && deps.recallTranscripts
      ? deps.recallTranscripts(options.userText).then((result): ChatTranscriptResult => result ?? null).catch((): ChatTranscriptResult => null)
      : Promise.resolve(null as ChatTranscriptResult),

    options.useConceptRecall && deps.recallConcepts
      ? deps.recallConcepts(options.userText).then((result): ChatConceptResult => result ?? null).catch((): ChatConceptResult => null)
      : Promise.resolve(null as ChatConceptResult),

    options.attachments?.length && deps.readFileContent
      ? Promise.all(options.attachments.filter(isChatFileAttachment).map(async (attachment): Promise<ChatAttachmentResult> => {
          try {
            const content = await deps.readFileContent!(attachment.fullPath);
            return { name: attachment.name, content };
          } catch {
            return { name: attachment.name, content: null };
          }
        }))
      : Promise.resolve([] as ChatAttachmentResult[]),
  ]);

  return {
    pageResult,
    ragResult,
    memoryResult,
    transcriptResult,
    conceptResult,
    attachmentResults,
  };
}