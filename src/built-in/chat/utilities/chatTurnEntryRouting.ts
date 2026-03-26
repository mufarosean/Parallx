import type {
  IDefaultParticipantServices,
  IChatTurnRoute,
  IParsedSlashCommand,
  IChatTurnSemantics,
} from '../chatTypes.js';

export interface IChatTurnEntryRoutingDeps {
  readonly parseSlashCommand: (text: string) => IParsedSlashCommand;
  readonly determineChatTurnRoute: (textOrSemantics: string | IChatTurnSemantics, options: { hasActiveSlashCommand: boolean }) => IChatTurnRoute;
}

export interface IResolveChatTurnEntryRoutingInput {
  readonly requestText: string;
  readonly requestCommand?: string;
  readonly semantics?: IChatTurnSemantics;
  readonly isRagReady: boolean;
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
  const earlyRoute = deps.determineChatTurnRoute(input.semantics ?? effectiveText, { hasActiveSlashCommand });

  return {
    slashResult,
    effectiveText,
    activeCommand,
    hasActiveSlashCommand,
    earlyRoute,
    handled: false,
  };
}