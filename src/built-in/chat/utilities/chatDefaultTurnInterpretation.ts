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

  const prelude = await prepareChatTurnPrelude(
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