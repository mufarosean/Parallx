import type { IChatRequestResponsePair } from '../../../services/chatTypes.js';
import type {
  IChatContextPlan,
  IChatTurnRoute,
  IDefaultParticipantServices,
  IChatSemanticFallbackDecision,
  IQueryScope,
  IRetrievalPlan,
  IMentionResolutionServices,
} from '../chatTypes.js';
import { extractMentions, resolveMentions } from './chatMentionResolver.js';
import { resolveQueryScope } from './chatScopeResolver.js';
import { determineChatTurnRoute } from './chatTurnRouter.js';
import { analyzeChatTurnSemantics } from './chatTurnSemantics.js';
import { applyChatSemanticFallback, resolveChatSemanticFallback } from './chatSemanticFallback.js';
import { createChatContextPlan, createChatRuntimeTrace } from './chatContextPlanner.js';

type IChatTurnPreludeDeps = Pick<
  IDefaultParticipantServices,
  | 'readFileContent'
  | 'listFilesRelative'
  | 'listFolderFiles'
  | 'retrieveContext'
  | 'getTerminalOutput'
  | 'isRAGAvailable'
  | 'reportRuntimeTrace'
  | 'reportRetrievalDebug'
  | 'reportResponseDebug'
>;

export interface IPrepareChatTurnPreludeHelpers {
  readonly buildFollowUpRetrievalQuery: (
    query: string,
    history: readonly IChatRequestResponsePair[],
  ) => string;
}

export interface IPrepareChatTurnPreludeInput {
  readonly requestText: string;
  readonly history: readonly IChatRequestResponsePair[];
  readonly sessionId: string;
  readonly hasActiveSlashCommand: boolean;
}

export interface IPreparedChatTurnPrelude {
  readonly mentionPills: Awaited<ReturnType<typeof resolveMentions>>['pills'];
  readonly mentionContextBlocks: Awaited<ReturnType<typeof resolveMentions>>['contextBlocks'];
  readonly userText: string;
  readonly contextQueryText: string;
  readonly isRagReady: boolean;
  readonly turnRoute: IChatTurnRoute;
  readonly contextPlan: IChatContextPlan;
  readonly retrievalPlan: IRetrievalPlan;
  readonly isConversationalTurn: boolean;
  readonly queryScope: IQueryScope;
  readonly semanticFallback?: IChatSemanticFallbackDecision;
}

function createMentionResolutionServices(deps: IChatTurnPreludeDeps): IMentionResolutionServices {
  return {
    readFileContent: deps.readFileContent
      ? (path: string) => deps.readFileContent!(path)
      : undefined,
    listFolderFiles: deps.listFolderFiles
      ? (folderPath: string) => deps.listFolderFiles!(folderPath)
      : undefined,
    retrieveContext: deps.retrieveContext
      ? (query: string) => deps.retrieveContext!(query)
      : undefined,
    getTerminalOutput: deps.getTerminalOutput
      ? () => deps.getTerminalOutput!()
      : undefined,
  };
}

export async function prepareChatTurnPrelude(
  deps: IChatTurnPreludeDeps,
  helpers: IPrepareChatTurnPreludeHelpers,
  input: IPrepareChatTurnPreludeInput,
): Promise<IPreparedChatTurnPrelude> {
  const mentions = extractMentions(input.requestText);
  let mentionPills: IPreparedChatTurnPrelude['mentionPills'] = [];
  let mentionContextBlocks: IPreparedChatTurnPrelude['mentionContextBlocks'] = [];
  let userText = input.requestText;

  if (mentions.length > 0) {
    const mentionResult = await resolveMentions(
      input.requestText,
      mentions,
      createMentionResolutionServices(deps),
    );
    mentionPills = mentionResult.pills;
    mentionContextBlocks = mentionResult.contextBlocks;
    userText = mentionResult.cleanText;
  }

  const contextQueryText = helpers.buildFollowUpRetrievalQuery(userText, input.history);
  const isRagReady = deps.isRAGAvailable?.() ?? false;
  const turnSemantics = analyzeChatTurnSemantics(userText);
  const initialTurnRoute = determineChatTurnRoute(turnSemantics, { hasActiveSlashCommand: input.hasActiveSlashCommand });

  // ── Scope resolution ────
  const mentionScope = {
    folders: mentions
      .filter((m): m is typeof m & { kind: 'folder'; path: string } => m.kind === 'folder' && 'path' in m)
      .map((m) => m.path),
    files: mentions
      .filter((m): m is typeof m & { kind: 'file'; path: string } => m.kind === 'file' && 'path' in m)
      .map((m) => m.path),
  };
  const queryScope = await resolveQueryScope(userText, mentionScope, {
    listFilesRelative: deps.listFilesRelative,
  });

  const semanticFallback = resolveChatSemanticFallback(
    userText,
    turnSemantics,
    initialTurnRoute,
    queryScope,
    { hasActiveSlashCommand: input.hasActiveSlashCommand },
  );
  const turnRoute = applyChatSemanticFallback(initialTurnRoute, semanticFallback);
  const contextPlan = createChatContextPlan(turnRoute, {
    hasActiveSlashCommand: input.hasActiveSlashCommand,
    isRagReady,
  });
  const retrievalPlan = contextPlan.retrievalPlan;
  const isConversationalTurn = turnRoute.kind === 'conversational';

  if (semanticFallback) {
    deps.reportResponseDebug?.({
      phase: 'semantic-fallback',
      markdownLength: 0,
      yielded: false,
      cancelled: false,
      retrievedContextLength: 0,
      note: `${semanticFallback.kind}:${semanticFallback.confidence.toFixed(2)}`,
    });
  }

  deps.reportRuntimeTrace?.(createChatRuntimeTrace(
    turnRoute,
    contextPlan,
    {
      sessionId: input.sessionId,
      hasActiveSlashCommand: input.hasActiveSlashCommand,
      isRagReady,
      semanticFallback,
    },
  ));

  deps.reportRetrievalDebug?.({
    hasActiveSlashCommand: input.hasActiveSlashCommand,
    isRagReady,
    needsRetrieval: contextPlan.useRetrieval,
    attempted: false,
  });

  return {
    mentionPills,
    mentionContextBlocks,
    userText,
    contextQueryText,
    isRagReady,
    turnRoute,
    contextPlan,
    retrievalPlan,
    isConversationalTurn,
    queryScope,
    semanticFallback,
  };
}