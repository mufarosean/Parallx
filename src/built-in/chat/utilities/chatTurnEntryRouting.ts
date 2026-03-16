import type {
  ICancellationToken,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IChatTurnRoute,
  IParsedSlashCommand,
  IChatTurnSemantics,
} from '../chatTypes.js';

export interface IChatTurnEntryRoutingDeps {
  readonly parseSlashCommand: (text: string) => IParsedSlashCommand;
  readonly determineChatTurnRoute: (semantics: IChatTurnSemantics, options: { hasActiveSlashCommand: boolean }) => IChatTurnRoute;
  readonly handleEarlyDeterministicAnswer: (options: {
    route: IChatTurnRoute;
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    sessionId?: string;
    response: IChatResponseStream;
    token: ICancellationToken;
    reportRuntimeTrace?: IDefaultParticipantServices['reportRuntimeTrace'];
    reportResponseDebug?: IDefaultParticipantServices['reportResponseDebug'];
  }) => boolean;
}

export interface IResolveChatTurnEntryRoutingInput {
  readonly requestText: string;
  readonly requestCommand?: string;
  readonly semantics: IChatTurnSemantics;
  readonly isRagReady: boolean;
  readonly sessionId?: string;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly reportRuntimeTrace?: IDefaultParticipantServices['reportRuntimeTrace'];
  readonly reportResponseDebug?: IDefaultParticipantServices['reportResponseDebug'];
}

export interface IResolveChatTurnEntryRoutingResult {
  readonly slashResult: IParsedSlashCommand;
  readonly effectiveText: string;
  readonly activeCommand?: string;
  readonly hasActiveSlashCommand: boolean;
  readonly earlyRoute: IChatTurnRoute;
  readonly handled: boolean;
}

export function resolveChatTurnEntryRouting(
  deps: IChatTurnEntryRoutingDeps,
  input: IResolveChatTurnEntryRoutingInput,
): IResolveChatTurnEntryRoutingResult {
  const slashResult = deps.parseSlashCommand(input.requestText);
  let effectiveText = input.requestText;
  let activeCommand = input.requestCommand;

  if (slashResult.command) {
    activeCommand = slashResult.commandName;
    if (
      slashResult.command.specialHandler !== 'compact'
      && slashResult.command.specialHandler !== 'init'
    ) {
      effectiveText = slashResult.remainingText;
    }
  }

  const hasActiveSlashCommand = !!(activeCommand && activeCommand !== 'compact');
  const earlyRoute = deps.determineChatTurnRoute(input.semantics, { hasActiveSlashCommand });
  const handled = deps.handleEarlyDeterministicAnswer({
    route: earlyRoute,
    hasActiveSlashCommand,
    isRagReady: input.isRagReady,
    sessionId: input.sessionId,
    response: input.response,
    token: input.token,
    reportRuntimeTrace: input.reportRuntimeTrace,
    reportResponseDebug: input.reportResponseDebug,
  });

  return {
    slashResult,
    effectiveText,
    activeCommand,
    hasActiveSlashCommand,
    earlyRoute,
    handled,
  };
}