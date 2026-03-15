import type {
  IDefaultParticipantServices,
  ISystemPromptContext,
} from '../chatTypes.js';
import type {
  ChatMode,
  IChatMessage,
  IChatRequestResponsePair,
} from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../config/chatSystemPrompts.js';

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
  | 'aiSettingsService'
  | 'unifiedConfigService'
  | 'getWorkflowSkillCatalog'
>;

export interface IAssembleChatTurnMessagesInput {
  readonly mode: ChatMode;
  readonly history: readonly IChatRequestResponsePair[];
}

function getHistoryResponseText(pair: IChatRequestResponsePair): string {
  return pair.response.parts
    .map((part) => {
      if ('content' in part && typeof part.content === 'string') {
        return part.content;
      }
      if ('code' in part && typeof part.code === 'string') {
        return '```\n' + part.code + '\n```';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export async function assembleChatTurnMessages(
  services: IChatTurnMessageAssemblyDeps,
  input: IAssembleChatTurnMessagesInput,
): Promise<{ messages: IChatMessage[] }> {
  const [pageCount, fileCount, promptOverlayFromFiles, workspaceDigest, prefsBlock] = await Promise.all([
    services.getPageCount().catch(() => 0),
    services.getFileCount ? services.getFileCount().catch(() => 0) : Promise.resolve(undefined),
    services.getPromptOverlay ? services.getPromptOverlay().catch(() => undefined) : Promise.resolve(undefined),
    services.getWorkspaceDigest ? services.getWorkspaceDigest().catch(() => undefined) : Promise.resolve(undefined),
    services.getPreferencesForPrompt ? services.getPreferencesForPrompt().catch(() => undefined) : Promise.resolve(undefined),
  ]);

  const aiProfile = services.aiSettingsService?.getActiveProfile();
  const promptOverlay = aiProfile?.chat.systemPrompt || promptOverlayFromFiles;
  const workspaceDescription = services.unifiedConfigService?.getEffectiveConfig().chat.workspaceDescription ?? '';

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

  const messages: IChatMessage[] = [{
    role: 'system',
    content: finalSystemPrompt,
  }];

  for (const pair of input.history) {
    messages.push({
      role: 'user',
      content: pair.request.text,
    });

    const responseText = getHistoryResponseText(pair);
    if (!responseText) {
      continue;
    }

    messages.push({
      role: 'assistant',
      content: responseText,
    });
  }

  return { messages };
}