import type {
  ICancellationToken,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  IActivatedSkill,
  IDefaultParticipantServices,
  IParsedSlashCommand,
  IPreparedChatTurnPrelude,
} from '../chatTypes.js';
import { interpretChatParticipantRequest } from './chatParticipantInterpretation.js';
import { buildFollowUpRetrievalQuery } from './chatGroundedResponseHelpers.js';
import { handleEarlyDeterministicAnswer } from './chatDeterministicResponse.js';
import { matchWorkflowSkill, activateSkill } from './chatSkillMatcher.js';
import { determineChatTurnRoute } from './chatTurnRouter.js';
import { prepareChatTurnPrelude } from './chatTurnPrelude.js';
import { createChatContextPlan } from './chatContextPlanner.js';
import { extractMentions, resolveMentions } from './chatMentionResolver.js';
import { resolveChatTurnEntryRouting } from './chatTurnEntryRouting.js';

type IDefaultTurnInterpretationServices = Pick<
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
  | 'getWorkflowSkillCatalog'
  | 'getSkillManifest'
>;

export interface IResolveDefaultChatTurnInterpretationInput {
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly parseSlashCommand: (text: string) => IParsedSlashCommand;
}

export interface IResolvedDefaultChatTurnInterpretation extends IPreparedChatTurnPrelude {
  readonly interpretation: ReturnType<typeof interpretChatParticipantRequest>;
  readonly slashResult: IParsedSlashCommand;
  readonly effectiveText: string;
  readonly activeCommand?: string;
  readonly hasActiveSlashCommand: boolean;
  readonly handledEarlyAnswer: boolean;
  readonly activatedSkill?: IActivatedSkill;
}

export async function resolveDefaultChatTurnInterpretation(
  services: IDefaultTurnInterpretationServices,
  input: IResolveDefaultChatTurnInterpretationInput,
): Promise<IResolvedDefaultChatTurnInterpretation> {
  const interpretation = interpretChatParticipantRequest('default', input.request);
  const earlyIsRagReady = services.isRAGAvailable?.() ?? false;

  const {
    slashResult,
    effectiveText,
    activeCommand,
    hasActiveSlashCommand,
    handled,
  } = resolveChatTurnEntryRouting({
    parseSlashCommand: input.parseSlashCommand,
    determineChatTurnRoute,
    handleEarlyDeterministicAnswer: (options) => handleEarlyDeterministicAnswer({
      ...options,
      sessionId: options.sessionId ?? input.context.sessionId,
    }),
  }, {
    requestText: input.request.text,
    requestCommand: interpretation.commandName,
    semantics: interpretation.semantics,
    isRagReady: earlyIsRagReady,
    sessionId: input.context.sessionId,
    response: input.response,
    token: input.token,
    reportRuntimeTrace: services.reportRuntimeTrace,
    reportResponseDebug: services.reportResponseDebug,
  });

  const prelude = input.request.turnState
    ? await (async () => {
        const mentions = input.request.turnState?.mentions ?? extractMentions(input.request.text);
        let mentionPills: IPreparedChatTurnPrelude['mentionPills'] = [];
        let mentionContextBlocks: IPreparedChatTurnPrelude['mentionContextBlocks'] = [];

        if (mentions.length > 0) {
          const mentionResult = await resolveMentions(
            input.request.text,
            mentions as any,
            {
              readFileContent: services.readFileContent
                ? (path: string) => services.readFileContent!(path)
                : undefined,
              listFolderFiles: services.listFolderFiles
                ? (folderPath: string) => services.listFolderFiles!(folderPath)
                : undefined,
              retrieveContext: services.retrieveContext
                ? (query: string) => services.retrieveContext!(query)
                : undefined,
              getTerminalOutput: services.getTerminalOutput
                ? () => services.getTerminalOutput!()
                : undefined,
            },
          );
          mentionPills = mentionResult.pills;
          mentionContextBlocks = mentionResult.contextBlocks;
        }

        const isRagReady = input.request.turnState.isRagReady ?? (services.isRAGAvailable?.() ?? false);
        const contextPlan = createChatContextPlan(input.request.turnState.turnRoute as any, {
          hasActiveSlashCommand: input.request.turnState.hasActiveSlashCommand,
          isRagReady,
        });

        return {
          mentionPills,
          mentionContextBlocks,
          userText: input.request.turnState.userText,
          contextQueryText: input.request.turnState.contextQueryText,
          isRagReady,
          turnRoute: input.request.turnState.turnRoute as any,
          contextPlan,
          retrievalPlan: contextPlan.retrievalPlan,
          isConversationalTurn: input.request.turnState.isConversationalTurn,
          queryScope: input.request.turnState.queryScope as any,
          semanticFallback: input.request.turnState.semanticFallback as any,
        } satisfies IPreparedChatTurnPrelude;
      })()
    : await prepareChatTurnPrelude(
        services,
        {
          buildFollowUpRetrievalQuery,
        },
        {
          requestText: input.request.text,
          history: input.context.history,
          sessionId: input.context.sessionId,
          hasActiveSlashCommand,
        },
      );

  const skillCatalog = services.getWorkflowSkillCatalog?.() ?? [];
  const isSkillSlashCommand = slashResult.command?.specialHandler === 'skill';
  let activatedSkill: IActivatedSkill | undefined;

  if (isSkillSlashCommand && slashResult.commandName) {
    const manifest = services.getSkillManifest?.(slashResult.commandName);
    if (manifest) {
      activatedSkill = activateSkill(manifest, effectiveText, 'user', prelude.queryScope);
    }
  } else if (skillCatalog.length > 0) {
    const skillMatch = matchWorkflowSkill(prelude.userText, prelude.turnRoute, prelude.queryScope, skillCatalog);
    if (skillMatch.matched && skillMatch.skill) {
      const manifest = services.getSkillManifest?.(skillMatch.skill.name);
      if (manifest) {
        activatedSkill = activateSkill(manifest, prelude.userText, 'planner', prelude.queryScope);
      }
    }
  }

  return {
    interpretation,
    slashResult,
    effectiveText,
    activeCommand,
    hasActiveSlashCommand,
    handledEarlyAnswer: handled,
    activatedSkill,
    ...prelude,
  };
}