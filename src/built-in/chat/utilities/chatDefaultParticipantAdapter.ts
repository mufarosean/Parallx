import type {
  IChatRuntimeTrace,
  IContextPill,
  IDefaultParticipantServices,
  IUserCommandFileSystem,
} from '../chatTypes.js';

export interface IChatDefaultParticipantAdapterDeps {
  readonly sendChatRequest: IDefaultParticipantServices['sendChatRequest'];
  readonly getActiveModel: IDefaultParticipantServices['getActiveModel'];
  readonly getWorkspaceName: IDefaultParticipantServices['getWorkspaceName'];
  readonly getPageCount: IDefaultParticipantServices['getPageCount'];
  readonly getCurrentPageTitle: IDefaultParticipantServices['getCurrentPageTitle'];
  readonly getToolDefinitions: IDefaultParticipantServices['getToolDefinitions'];
  readonly getReadOnlyToolDefinitions: IDefaultParticipantServices['getReadOnlyToolDefinitions'];
  readonly invokeTool?: IDefaultParticipantServices['invokeTool'];
  readonly maxIterations?: number;
  readonly networkTimeout?: number;
  readonly getModelContextLength?: IDefaultParticipantServices['getModelContextLength'];
  readonly sendSummarizationRequest?: IDefaultParticipantServices['sendSummarizationRequest'];
  readonly getFileCount?: IDefaultParticipantServices['getFileCount'];
  readonly isRAGAvailable?: IDefaultParticipantServices['isRAGAvailable'];
  readonly isIndexing?: IDefaultParticipantServices['isIndexing'];
  readonly readFileContent?: IDefaultParticipantServices['readFileContent'];
  readonly getCurrentPageContent?: IDefaultParticipantServices['getCurrentPageContent'];
  readonly retrieveContext?: IDefaultParticipantServices['retrieveContext'];
  readonly recallMemories?: IDefaultParticipantServices['recallMemories'];
  readonly storeSessionMemory?: IDefaultParticipantServices['storeSessionMemory'];
  readonly storeConceptsFromSession?: IDefaultParticipantServices['storeConceptsFromSession'];
  readonly recallConcepts?: IDefaultParticipantServices['recallConcepts'];
  readonly isSessionEligibleForSummary?: IDefaultParticipantServices['isSessionEligibleForSummary'];
  readonly hasSessionMemory?: IDefaultParticipantServices['hasSessionMemory'];
  readonly getSessionMemoryMessageCount?: IDefaultParticipantServices['getSessionMemoryMessageCount'];
  readonly extractPreferences?: IDefaultParticipantServices['extractPreferences'];
  readonly getPreferencesForPrompt?: IDefaultParticipantServices['getPreferencesForPrompt'];
  readonly getPromptOverlay?: IDefaultParticipantServices['getPromptOverlay'];
  readonly listFilesRelative?: IDefaultParticipantServices['listFilesRelative'];
  readonly readFileRelative?: IDefaultParticipantServices['readFileRelative'];
  readonly writeFileRelative?: IDefaultParticipantServices['writeFileRelative'];
  readonly existsRelative?: IDefaultParticipantServices['existsRelative'];
  readonly invalidatePromptFiles?: IDefaultParticipantServices['invalidatePromptFiles'];
  readonly reportContextPills?: (pills: IContextPill[]) => void;
  readonly reportRetrievalDebug?: IDefaultParticipantServices['reportRetrievalDebug'];
  readonly reportResponseDebug?: IDefaultParticipantServices['reportResponseDebug'];
  readonly reportRuntimeTrace?: (trace: IChatRuntimeTrace) => void;
  readonly getExcludedContextIds?: IDefaultParticipantServices['getExcludedContextIds'];
  readonly reportBudget?: IDefaultParticipantServices['reportBudget'];
  readonly getTerminalOutput?: IDefaultParticipantServices['getTerminalOutput'];
  readonly listFolderFiles?: IDefaultParticipantServices['listFolderFiles'];
  readonly userCommandFileSystem?: IUserCommandFileSystem;
  readonly compactSession?: IDefaultParticipantServices['compactSession'];
  readonly getWorkspaceDigest?: IDefaultParticipantServices['getWorkspaceDigest'];
  readonly sessionManager?: IDefaultParticipantServices['sessionManager'];
  readonly aiSettingsService?: IDefaultParticipantServices['aiSettingsService'];
  readonly unifiedConfigService?: IDefaultParticipantServices['unifiedConfigService'];
}

export function buildChatDefaultParticipantServices(
  deps: IChatDefaultParticipantAdapterDeps,
): IDefaultParticipantServices {
  return {
    sendChatRequest: deps.sendChatRequest,
    getActiveModel: deps.getActiveModel,
    getWorkspaceName: deps.getWorkspaceName,
    getPageCount: deps.getPageCount,
    getCurrentPageTitle: deps.getCurrentPageTitle,
    getToolDefinitions: deps.getToolDefinitions,
    getReadOnlyToolDefinitions: deps.getReadOnlyToolDefinitions,
    invokeTool: deps.invokeTool,
    maxIterations: deps.maxIterations,
    networkTimeout: deps.networkTimeout,
    getModelContextLength: deps.getModelContextLength,
    sendSummarizationRequest: deps.sendSummarizationRequest,
    getFileCount: deps.getFileCount,
    isRAGAvailable: deps.isRAGAvailable,
    isIndexing: deps.isIndexing,
    readFileContent: deps.readFileContent,
    getCurrentPageContent: deps.getCurrentPageContent,
    retrieveContext: deps.retrieveContext,
    recallMemories: deps.recallMemories,
    storeSessionMemory: deps.storeSessionMemory,
    storeConceptsFromSession: deps.storeConceptsFromSession,
    recallConcepts: deps.recallConcepts,
    isSessionEligibleForSummary: deps.isSessionEligibleForSummary,
    hasSessionMemory: deps.hasSessionMemory,
    getSessionMemoryMessageCount: deps.getSessionMemoryMessageCount,
    extractPreferences: deps.extractPreferences,
    getPreferencesForPrompt: deps.getPreferencesForPrompt,
    getPromptOverlay: deps.getPromptOverlay,
    listFilesRelative: deps.listFilesRelative,
    readFileRelative: deps.readFileRelative,
    writeFileRelative: deps.writeFileRelative,
    existsRelative: deps.existsRelative,
    invalidatePromptFiles: deps.invalidatePromptFiles,
    reportContextPills: deps.reportContextPills,
    reportRetrievalDebug: deps.reportRetrievalDebug,
    reportResponseDebug: deps.reportResponseDebug,
    reportRuntimeTrace: deps.reportRuntimeTrace,
    getExcludedContextIds: deps.getExcludedContextIds,
    reportBudget: deps.reportBudget,
    getTerminalOutput: deps.getTerminalOutput,
    listFolderFiles: deps.listFolderFiles,
    userCommandFileSystem: deps.userCommandFileSystem,
    compactSession: deps.compactSession,
    getWorkspaceDigest: deps.getWorkspaceDigest,
    sessionManager: deps.sessionManager,
    aiSettingsService: deps.aiSettingsService,
    unifiedConfigService: deps.unifiedConfigService,
  };
}