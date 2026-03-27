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
import { activateSkill, detectFreeTextSkillName } from './chatSkillMatcher.js';
import { determineChatTurnRoute } from './chatTurnRouter.js';
import { prepareChatTurnPrelude } from './chatTurnPrelude.js';
import { createChatContextPlan } from './chatContextPlanner.js';
import { extractMentions, resolveMentions } from './chatMentionResolver.js';
import { resolveChatTurnEntryRouting } from './chatTurnEntryRouting.js';
import { resolveQueryScope } from './chatScopeResolver.js';

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
  }, {
    requestText: input.request.text,
    requestCommand: interpretation.commandName,
    semantics: interpretation.semantics,
    isRagReady: earlyIsRagReady,
  });

  const prelude = input.request.turnState
    ? await (async () => {
        const turnState = input.request.turnState!;
        const mentions = turnState.mentions ?? extractMentions(input.request.text);
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

        const isRagReady = turnState.isRagReady ?? (services.isRAGAvailable?.() ?? false);
        const shouldRefreshQueryScope = !turnState.queryScope?.pathPrefixes?.length
          && turnState.queryScope?.level === 'workspace'
          && turnState.queryScope?.derivedFrom === 'contextual'
          && !!services.listFilesRelative;
        const queryScope = shouldRefreshQueryScope
          ? await resolveQueryScope(turnState.userText, {
              folders: mentions
                .filter((mention): mention is typeof mention & { kind: 'folder'; path: string } => mention.kind === 'folder' && typeof mention.path === 'string')
                .map((mention) => mention.path),
              files: mentions
                .filter((mention): mention is typeof mention & { kind: 'file'; path: string } => mention.kind === 'file' && typeof mention.path === 'string')
                .map((mention) => mention.path),
            }, {
              listFilesRelative: services.listFilesRelative,
            })
          : turnState.queryScope as any;
        const contextPlan = createChatContextPlan(turnState.turnRoute as any, {
          hasActiveSlashCommand: turnState.hasActiveSlashCommand,
          isRagReady,
        });

        return {
          mentionPills,
          mentionContextBlocks,
          userText: turnState.userText,
          contextQueryText: turnState.contextQueryText,
          hasActiveSlashCommand: turnState.hasActiveSlashCommand,
          isRagReady,
          turnRoute: turnState.turnRoute as any,
          contextPlan,
          retrievalPlan: contextPlan.retrievalPlan,
          isConversationalTurn: turnState.isConversationalTurn,
          queryScope,
          semanticFallback: turnState.semanticFallback as any,
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

  const isSkillSlashCommand = slashResult.command?.specialHandler === 'skill';
  let activatedSkill: IActivatedSkill | undefined;

  if (isSkillSlashCommand && slashResult.commandName) {
    // Path 1: Explicit slash command — e.g. /deep-research
    const manifest = services.getSkillManifest?.(slashResult.commandName);
    if (manifest) {
      activatedSkill = activateSkill(manifest, effectiveText, 'user', prelude.queryScope);
    }
  } else if (!hasActiveSlashCommand) {
    // Path 2: Free-text skill mention — e.g. "use the deep-research skill"
    // Upstream OpenClaw pattern: detect skill name in free text, load manifest,
    // inject body into system prompt so the model follows it.
    const catalog = services.getWorkflowSkillCatalog?.() ?? [];
    const detectedName = detectFreeTextSkillName(effectiveText, catalog);
    if (detectedName) {
      const manifest = services.getSkillManifest?.(detectedName);
      if (manifest) {
        activatedSkill = activateSkill(manifest, effectiveText, 'user', prelude.queryScope);
      }
    }
  }

  return {
    interpretation,
    slashResult,
    effectiveText,
    activeCommand,
    handledEarlyAnswer: handled,
    activatedSkill,
    ...prelude,
  };
}