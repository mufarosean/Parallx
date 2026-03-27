import type { ITokenStatusBarServices } from '../chatTypes.js';
import type { ChatWidget } from '../widgets/chatWidget.js';
import type { ChatMode, IToolDefinition } from '../../../services/chatTypes.js';
import type { IOpenclawSystemPromptReport } from '../../../services/chatRuntimeTypes.js';

export interface IChatTokenBarAdapterDeps {
  readonly getActiveWidget: () => ChatWidget | undefined;
  readonly getContextLength: () => Promise<number>;
  readonly getMode: () => ChatMode;
  readonly getWorkspaceName: () => string;
  readonly getPageCount: () => Promise<number>;
  readonly getCurrentPageTitle: () => string | undefined;
  readonly getToolDefinitions: () => readonly IToolDefinition[];
  readonly getFileCount: () => Promise<number>;
  readonly isRAGAvailable: () => boolean;
  readonly isIndexing: () => boolean;
  readonly getIndexingProgress: NonNullable<ITokenStatusBarServices['getIndexingProgress']>;
  readonly getIndexStats: NonNullable<ITokenStatusBarServices['getIndexStats']>;
  readonly getLastSystemPromptReport?: () => IOpenclawSystemPromptReport | undefined;
}

export function buildChatTokenBarServices(deps: IChatTokenBarAdapterDeps): ITokenStatusBarServices {
  return {
    getActiveSession: () => deps.getActiveWidget()?.getSession(),
    getContextLength: deps.getContextLength,
    getMode: deps.getMode,
    getWorkspaceName: deps.getWorkspaceName,
    getPageCount: deps.getPageCount,
    getCurrentPageTitle: deps.getCurrentPageTitle,
    getToolDefinitions: deps.getToolDefinitions,
    getFileCount: deps.getFileCount,
    isRAGAvailable: deps.isRAGAvailable,
    isIndexing: deps.isIndexing,
    getIndexingProgress: deps.getIndexingProgress,
    getIndexStats: deps.getIndexStats,
    getLastSystemPromptReport: deps.getLastSystemPromptReport,
  };
}