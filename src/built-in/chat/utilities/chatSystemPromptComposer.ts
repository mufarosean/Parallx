import { ChatMode } from '../../../services/chatTypes.js';
import type { IToolDefinition } from '../../../services/chatTypes.js';
import { buildSystemPrompt } from '../config/chatSystemPrompts.js';

interface IPromptOverlayService {
  loadLayers(): Promise<unknown>;
  assemblePromptOverlay(layers: unknown, activeFilePath?: string): string;
}

export interface IChatSystemPromptComposerDeps {
  readonly workspaceName: string;
  readonly getPageCount: () => Promise<number>;
  readonly getFileCount: () => Promise<number>;
  readonly getToolDefinitions: () => readonly IToolDefinition[];
  readonly isRAGAvailable: boolean;
  readonly promptFileService?: IPromptOverlayService;
}

export async function composeChatSystemPrompt(
  deps: IChatSystemPromptComposerDeps,
): Promise<string> {
  let promptOverlay: string | undefined;
  if (deps.promptFileService) {
    try {
      const layers = await deps.promptFileService.loadLayers();
      promptOverlay = deps.promptFileService.assemblePromptOverlay(layers);
    } catch {
      promptOverlay = undefined;
    }
  }

  return buildSystemPrompt(ChatMode.Agent, {
    workspaceName: deps.workspaceName,
    pageCount: await deps.getPageCount(),
    currentPageTitle: undefined,
    tools: deps.getToolDefinitions(),
    fileCount: await deps.getFileCount(),
    isRAGAvailable: deps.isRAGAvailable,
    isIndexing: false,
    promptOverlay,
  });
}