import type { IChatRequestResponsePair } from '../../../services/chatTypes.js';
import type {
  IChatContextPlan,
  IChatTurnRoute,
  IDefaultParticipantServices,
  IRetrievalPlan,
  IMentionResolutionServices,
} from '../chatTypes.js';
import { extractMentions, resolveMentions } from './chatMentionResolver.js';
import { determineChatTurnRoute } from './chatTurnRouter.js';
import { createChatContextPlan, createChatRuntimeTrace } from './chatContextPlanner.js';

type IChatTurnPreludeDeps = Pick<
  IDefaultParticipantServices,
  | 'readFileContent'
  | 'listFolderFiles'
  | 'retrieveContext'
  | 'getTerminalOutput'
  | 'isRAGAvailable'
  | 'reportRuntimeTrace'
  | 'reportRetrievalDebug'
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
  const turnRoute = determineChatTurnRoute(userText, { hasActiveSlashCommand: input.hasActiveSlashCommand });
  const contextPlan = createChatContextPlan(turnRoute, {
    hasActiveSlashCommand: input.hasActiveSlashCommand,
    isRagReady,
  });
  const retrievalPlan = contextPlan.retrievalPlan;
  const isConversationalTurn = turnRoute.kind === 'conversational';

  deps.reportRuntimeTrace?.(createChatRuntimeTrace(
    turnRoute,
    contextPlan,
    {
      sessionId: input.sessionId,
      hasActiveSlashCommand: input.hasActiveSlashCommand,
      isRagReady,
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
  };
}