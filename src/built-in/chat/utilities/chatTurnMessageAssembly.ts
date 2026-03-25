import type {
  IDefaultParticipantServices,
  ISystemPromptContext,
} from '../chatTypes.js';
import type {
  ChatMode,
  IChatRequestResponsePair,
} from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../config/chatSystemPrompts.js';
import { buildRuntimePromptSeedMessages } from './chatRuntimePromptMessages.js';

type IChatTurnMessageAssemblyDeps = Pick<
  IDefaultParticipantServices,
  | 'getWorkspaceName'
  | 'getPageCount'
  | 'getCurrentPageTitle'
  | 'getFileCount'
  | 'getPromptOverlay'
  | 'getWorkspaceDigest'
  | 'getPreferencesForPrompt'
  | 'isRAGAvailable'
  | 'isIndexing'
  | 'unifiedConfigService'
  | 'getWorkflowSkillCatalog'
>;

export type { IChatTurnMessageAssemblyDeps };

export interface IAssembleChatTurnMessagesInput {
  readonly mode: ChatMode;
  readonly history: readonly IChatRequestResponsePair[];
}

export async function assembleChatTurnMessages(
  services: IChatTurnMessageAssemblyDeps,
  input: IAssembleChatTurnMessagesInput,
): Promise<{ messages: ReturnType<typeof buildRuntimePromptSeedMessages> }> {
  const [pageCount, fileCount, promptOverlayFromFiles, workspaceDigest, prefsBlock] = await Promise.all([
    services.getPageCount().catch(() => 0),
    services.getFileCount ? services.getFileCount().catch(() => 0) : Promise.resolve(undefined),
    services.getPromptOverlay ? services.getPromptOverlay().catch(() => undefined) : Promise.resolve(undefined),
    services.getWorkspaceDigest ? services.getWorkspaceDigest().catch(() => undefined) : Promise.resolve(undefined),
    services.getPreferencesForPrompt ? services.getPreferencesForPrompt().catch(() => undefined) : Promise.resolve(undefined),
  ]);

  const effectiveConfig = services.unifiedConfigService?.getEffectiveConfig();
  const promptOverlay = effectiveConfig?.chat.systemPrompt || promptOverlayFromFiles;
  const workspaceDescription = effectiveConfig?.chat.workspaceDescription ?? '';

  const promptContext: ISystemPromptContext = {
    workspaceName: services.getWorkspaceName(),
    pageCount,
    currentPageTitle: services.getCurrentPageTitle(),
    tools: undefined,
    fileCount,
    isRAGAvailable: services.isRAGAvailable?.() ?? false,
    isIndexing: services.isIndexing?.() ?? false,
    promptOverlay,
    workspaceDigest,
    workspaceDescription,
    skillCatalog: services.getWorkflowSkillCatalog?.(),
  };

  const systemPrompt = buildSystemPrompt(input.mode, promptContext);
  const finalSystemPrompt = prefsBlock
    ? systemPrompt + '\n\n' + prefsBlock
    : systemPrompt;

  const messages = buildRuntimePromptSeedMessages({
    systemPrompt: finalSystemPrompt,
    history: input.history,
  });

  return { messages };
}