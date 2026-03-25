import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import { getModeCapabilities } from '../config/chatModeCapabilities.js';
import type {
  IDefaultParticipantServices,
} from '../chatTypes.js';
import type {
  IResolvedDefaultChatTurnInterpretation,
} from './chatDefaultTurnInterpretation.js';
import { interpretChatParticipantRequest } from './chatParticipantInterpretation.js';
import { tryHandleWorkspaceDocumentListing } from './chatWorkspaceDocumentListing.js';
import { resolveDefaultChatTurnInterpretation } from './chatDefaultTurnInterpretation.js';
import { tryHandleDefaultCompactCommand, tryHandleDefaultContextCommand, tryHandleDefaultInitCommand } from './chatDefaultEarlyCommands.js';

const DEFAULT_MAX_ITERATIONS = 10;
const ASK_MODE_MAX_ITERATIONS = 5;

type IDefaultRuntimeInterpretationStageServices = Pick<
  IDefaultParticipantServices,
  | 'sendChatRequest'
  | 'maxIterations'
  | 'getWorkspaceName'
  | 'getToolDefinitions'
  | 'getReadOnlyToolDefinitions'
  | 'listFilesRelative'
  | 'readFileRelative'
  | 'writeFileRelative'
  | 'existsRelative'
  | 'invalidatePromptFiles'
  | 'readFileContent'
  | 'listFolderFiles'
  | 'retrieveContext'
  | 'getTerminalOutput'
  | 'isRAGAvailable'
  | 'getModelContextLength'
  | 'reportRuntimeTrace'
  | 'reportRetrievalDebug'
  | 'reportResponseDebug'
  | 'reportSystemPromptReport'
  | 'sendSummarizationRequest'
  | 'compactSession'
  | 'getWorkflowSkillCatalog'
  | 'getSkillManifest'
  | 'getLastSystemPromptReport'
>;

export interface IRunDefaultRuntimeInterpretationStageInput {
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly parseSlashCommand: (text: string) => import('../chatTypes.js').IParsedSlashCommand;
}

export type DefaultRuntimeInterpretationStageResult =
  | {
      readonly kind: 'handled';
      readonly result: IChatParticipantResult;
    }
  | {
      readonly kind: 'continue';
      readonly capabilities: ReturnType<typeof getModeCapabilities>;
      readonly maxIterations: number;
      readonly turn: IResolvedDefaultChatTurnInterpretation;
    };

export async function runDefaultRuntimeInterpretationStage(
  services: IDefaultRuntimeInterpretationStageServices,
  input: IRunDefaultRuntimeInterpretationStageInput,
): Promise<DefaultRuntimeInterpretationStageResult> {
  const interpretation = interpretChatParticipantRequest('default', input.request);
  const capabilities = getModeCapabilities(input.request.mode);
  const configMaxIterations = services.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxIterations = capabilities.canAutonomous
    ? configMaxIterations
    : Math.min(configMaxIterations, ASK_MODE_MAX_ITERATIONS);

  const initResult = await tryHandleDefaultInitCommand(services, interpretation.commandName, input.response);
  if (initResult) {
    return { kind: 'handled', result: initResult };
  }

  if (await tryHandleDefaultContextCommand(services, {
    command: input.request.command,
    text: input.request.text,
    mode: input.request.mode,
  }, input.response)) {
    return { kind: 'handled', result: {} };
  }

  if (await tryHandleWorkspaceDocumentListing({
    text: interpretation.effectiveText,
    listFiles: services.listFilesRelative,
    response: input.response,
    token: input.token,
    workspaceName: services.getWorkspaceName(),
  })) {
    return { kind: 'handled', result: {} };
  }

  const turn = await resolveDefaultChatTurnInterpretation(services, {
    request: input.request,
    context: input.context,
    response: input.response,
    token: input.token,
    parseSlashCommand: input.parseSlashCommand,
  });

  if (await tryHandleDefaultCompactCommand(services, {
    activeCommand: turn.activeCommand,
    slashSpecialHandler: turn.slashResult.command?.specialHandler,
    context: input.context,
    response: input.response,
  })) {
    return { kind: 'handled', result: {} };
  }

  if (turn.handledEarlyAnswer) {
    return { kind: 'handled', result: {} };
  }

  return {
    kind: 'continue',
    capabilities,
    maxIterations,
    turn,
  };
}