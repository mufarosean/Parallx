import type {
  IChatParticipantContext,
  IChatParticipantResult,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IInitCommandServices,
} from '../chatTypes.js';
import { executeInitCommand } from '../commands/initCommand.js';
import { tryExecuteCompactChatCommand } from './chatCompactCommand.js';

export async function tryHandleDefaultInitCommand(
  services: Pick<
    IDefaultParticipantServices,
    'sendChatRequest' | 'getWorkspaceName' | 'listFilesRelative' | 'readFileRelative' | 'writeFileRelative' | 'existsRelative' | 'invalidatePromptFiles'
  >,
  requestCommandName: string | undefined,
  response: IChatResponseStream,
): Promise<IChatParticipantResult | undefined> {
  if (requestCommandName !== 'init') {
    return undefined;
  }

  const initServices: IInitCommandServices = {
    sendChatRequest: services.sendChatRequest,
    getWorkspaceName: services.getWorkspaceName,
    listFiles: services.listFilesRelative
      ? (rel) => services.listFilesRelative!(rel)
      : undefined,
    readFile: services.readFileRelative
      ? (rel) => services.readFileRelative!(rel)
      : undefined,
    writeFile: services.writeFileRelative
      ? (rel, content) => services.writeFileRelative!(rel, content)
      : undefined,
    exists: services.existsRelative
      ? (rel) => services.existsRelative!(rel)
      : undefined,
    invalidatePromptFiles: services.invalidatePromptFiles,
  };

  await executeInitCommand(initServices, response);
  return {};
}

export async function tryHandleDefaultCompactCommand(
  services: Pick<IDefaultParticipantServices, 'sendSummarizationRequest' | 'compactSession'>,
  options: {
    readonly activeCommand?: string;
    readonly slashSpecialHandler?: string;
    readonly context: IChatParticipantContext;
    readonly response: IChatResponseStream;
  },
): Promise<boolean> {
  return tryExecuteCompactChatCommand({
    sendSummarizationRequest: services.sendSummarizationRequest,
    compactSession: services.compactSession,
  }, {
    isCompactCommand: options.activeCommand === 'compact' || options.slashSpecialHandler === 'compact',
    sessionId: options.context.sessionId,
    history: options.context.history,
    response: options.response,
  });
}

export async function tryHandleDefaultContextCommand(
  _services: Pick<
    IDefaultParticipantServices,
    | 'getWorkspaceName'
    | 'readFileRelative'
    | 'unifiedConfigService'
    | 'getToolDefinitions'
    | 'getReadOnlyToolDefinitions'
    | 'getWorkflowSkillCatalog'
    | 'getModelContextLength'
    | 'getLastSystemPromptReport'
    | 'reportSystemPromptReport'
  >,
  request: Pick<import('../../../services/chatTypes.js').IChatParticipantRequest, 'command' | 'text' | 'mode'>,
  response: IChatResponseStream,
): Promise<boolean> {
  if (request.command !== 'context') {
    return false;
  }

  response.markdown([
    'The legacy claw comparison lane does not own `/context` diagnostics anymore.',
    'Use the OpenClaw default lane to inspect runtime context and system-prompt composition.',
  ].join('\n\n'));
  return true;
}