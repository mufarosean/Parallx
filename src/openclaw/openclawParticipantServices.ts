import type {
  ICanvasParticipantServices,
  IDefaultParticipantServices,
  IWorkspaceParticipantServices,
} from './openclawTypes.js';
import type { IContextPill } from '../services/chatTypes.js';

export interface IOpenclawDefaultParticipantAdapterDeps {
  readonly sendChatRequest: IDefaultParticipantServices['sendChatRequest'];
  readonly getActiveModel: IDefaultParticipantServices['getActiveModel'];
  readonly getWorkspaceName: IDefaultParticipantServices['getWorkspaceName'];
  readonly getPageCount: IDefaultParticipantServices['getPageCount'];
  readonly getCurrentPageTitle: IDefaultParticipantServices['getCurrentPageTitle'];
  readonly getToolDefinitions: IDefaultParticipantServices['getToolDefinitions'];
  readonly getReadOnlyToolDefinitions: IDefaultParticipantServices['getReadOnlyToolDefinitions'];
  readonly filterToolsForSession?: IDefaultParticipantServices['filterToolsForSession'];
  readonly invokeToolWithRuntimeControl?: IDefaultParticipantServices['invokeToolWithRuntimeControl'];
  readonly maxIterations?: IDefaultParticipantServices['maxIterations'];
  readonly networkTimeout?: IDefaultParticipantServices['networkTimeout'];
  readonly getModelContextLength?: IDefaultParticipantServices['getModelContextLength'];
  readonly sendSummarizationRequest?: IDefaultParticipantServices['sendSummarizationRequest'];
  readonly getFileCount?: IDefaultParticipantServices['getFileCount'];
  readonly isRAGAvailable?: IDefaultParticipantServices['isRAGAvailable'];
  readonly isIndexing?: IDefaultParticipantServices['isIndexing'];
  readonly readFileContent?: IDefaultParticipantServices['readFileContent'];
  readonly getCurrentPageContent?: IDefaultParticipantServices['getCurrentPageContent'];
  readonly retrieveContext?: IDefaultParticipantServices['retrieveContext'];
  readonly recallMemories?: IDefaultParticipantServices['recallMemories'];
  readonly recallTranscripts?: IDefaultParticipantServices['recallTranscripts'];
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
  readonly reportRuntimeTrace?: IDefaultParticipantServices['reportRuntimeTrace'];
  readonly reportBootstrapDebug?: IDefaultParticipantServices['reportBootstrapDebug'];
  readonly reportSystemPromptReport?: IDefaultParticipantServices['reportSystemPromptReport'];
  readonly getExcludedContextIds?: IDefaultParticipantServices['getExcludedContextIds'];
  readonly reportBudget?: IDefaultParticipantServices['reportBudget'];
  readonly getTerminalOutput?: IDefaultParticipantServices['getTerminalOutput'];
  readonly listFolderFiles?: IDefaultParticipantServices['listFolderFiles'];
  readonly userCommandFileSystem?: IDefaultParticipantServices['userCommandFileSystem'];
  readonly compactSession?: IDefaultParticipantServices['compactSession'];
  readonly getWorkspaceDigest?: IDefaultParticipantServices['getWorkspaceDigest'];
  readonly getLastSystemPromptReport?: IDefaultParticipantServices['getLastSystemPromptReport'];
  readonly sessionManager?: IDefaultParticipantServices['sessionManager'];
  readonly unifiedConfigService?: IDefaultParticipantServices['unifiedConfigService'];
  readonly queueFollowupRequest?: IDefaultParticipantServices['queueFollowupRequest'];
  readonly createAutonomyMirror?: IDefaultParticipantServices['createAutonomyMirror'];
  readonly getSkillCatalog?: IDefaultParticipantServices['getSkillCatalog'];
  readonly getToolPermissions?: IDefaultParticipantServices['getToolPermissions'];
  readonly getAvailableModelIds?: IDefaultParticipantServices['getAvailableModelIds'];
  readonly sendChatRequestForModel?: IDefaultParticipantServices['sendChatRequestForModel'];
  readonly agentRegistry?: IDefaultParticipantServices['agentRegistry'];
  // D2: Command service delegates
  readonly listModels?: IDefaultParticipantServices['listModels'];
  readonly checkProviderStatus?: IDefaultParticipantServices['checkProviderStatus'];
  readonly getSessionFlag?: IDefaultParticipantServices['getSessionFlag'];
  readonly setSessionFlag?: IDefaultParticipantServices['setSessionFlag'];
  readonly executeCommand?: IDefaultParticipantServices['executeCommand'];
  // D3: Diagnostics service
  readonly diagnosticsService?: IDefaultParticipantServices['diagnosticsService'];
  // D7: Observability service
  readonly observabilityService?: IDefaultParticipantServices['observabilityService'];
  // D4: Runtime hook registry
  readonly runtimeHookRegistry?: IDefaultParticipantServices['runtimeHookRegistry'];
  // D5: Vision model capability detection
  readonly getActiveModelCapabilities?: IDefaultParticipantServices['getActiveModelCapabilities'];
}

export interface IOpenclawWorkspaceParticipantAdapterDeps {
  readonly sendChatRequest: IWorkspaceParticipantServices['sendChatRequest'];
  readonly getActiveModel: IWorkspaceParticipantServices['getActiveModel'];
  readonly getWorkspaceName: IWorkspaceParticipantServices['getWorkspaceName'];
  readonly listPages: IWorkspaceParticipantServices['listPages'];
  readonly searchPages: IWorkspaceParticipantServices['searchPages'];
  readonly getPageContent: IWorkspaceParticipantServices['getPageContent'];
  readonly getPageTitle: IWorkspaceParticipantServices['getPageTitle'];
  readonly getReadOnlyToolDefinitions?: IWorkspaceParticipantServices['getReadOnlyToolDefinitions'];
  readonly filterToolsForSession?: IWorkspaceParticipantServices['filterToolsForSession'];
  readonly invokeToolWithRuntimeControl?: IWorkspaceParticipantServices['invokeToolWithRuntimeControl'];
  readonly listFiles?: IWorkspaceParticipantServices['listFiles'];
  readonly readFileContent?: IWorkspaceParticipantServices['readFileContent'];
  readonly reportParticipantDebug?: IWorkspaceParticipantServices['reportParticipantDebug'];
  readonly reportRetrievalDebug?: IWorkspaceParticipantServices['reportRetrievalDebug'];
  readonly reportRuntimeTrace?: IWorkspaceParticipantServices['reportRuntimeTrace'];
  readonly reportBootstrapDebug?: IWorkspaceParticipantServices['reportBootstrapDebug'];
  readonly observabilityService?: IWorkspaceParticipantServices['observabilityService'];
  // D4: Runtime hook registry
  readonly runtimeHookRegistry?: IWorkspaceParticipantServices['runtimeHookRegistry'];
}

export interface IOpenclawCanvasParticipantAdapterDeps {
  readonly sendChatRequest: ICanvasParticipantServices['sendChatRequest'];
  readonly getActiveModel: ICanvasParticipantServices['getActiveModel'];
  readonly getWorkspaceName: ICanvasParticipantServices['getWorkspaceName'];
  readonly getCurrentPageId: ICanvasParticipantServices['getCurrentPageId'];
  readonly getCurrentPageTitle: ICanvasParticipantServices['getCurrentPageTitle'];
  readonly getPageStructure: ICanvasParticipantServices['getPageStructure'];
  readonly getReadOnlyToolDefinitions?: ICanvasParticipantServices['getReadOnlyToolDefinitions'];
  readonly filterToolsForSession?: ICanvasParticipantServices['filterToolsForSession'];
  readonly invokeToolWithRuntimeControl?: ICanvasParticipantServices['invokeToolWithRuntimeControl'];
  readonly readFileContent?: ICanvasParticipantServices['readFileContent'];
  readonly reportParticipantDebug?: ICanvasParticipantServices['reportParticipantDebug'];
  readonly reportRetrievalDebug?: ICanvasParticipantServices['reportRetrievalDebug'];
  readonly reportRuntimeTrace?: ICanvasParticipantServices['reportRuntimeTrace'];
  readonly reportBootstrapDebug?: ICanvasParticipantServices['reportBootstrapDebug'];
  readonly observabilityService?: ICanvasParticipantServices['observabilityService'];
  // D4: Runtime hook registry
  readonly runtimeHookRegistry?: ICanvasParticipantServices['runtimeHookRegistry'];
}

export function buildOpenclawDefaultParticipantServices(
  deps: IOpenclawDefaultParticipantAdapterDeps,
): IDefaultParticipantServices {
  return {
    sendChatRequest: deps.sendChatRequest,
    getActiveModel: deps.getActiveModel,
    getWorkspaceName: deps.getWorkspaceName,
    getPageCount: deps.getPageCount,
    getCurrentPageTitle: deps.getCurrentPageTitle,
    getToolDefinitions: deps.getToolDefinitions,
    getReadOnlyToolDefinitions: deps.getReadOnlyToolDefinitions,
    filterToolsForSession: deps.filterToolsForSession,
    invokeToolWithRuntimeControl: deps.invokeToolWithRuntimeControl,
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
    recallTranscripts: deps.recallTranscripts,
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
    reportBootstrapDebug: deps.reportBootstrapDebug,
    reportSystemPromptReport: deps.reportSystemPromptReport,
    getExcludedContextIds: deps.getExcludedContextIds,
    reportBudget: deps.reportBudget,
    getTerminalOutput: deps.getTerminalOutput,
    listFolderFiles: deps.listFolderFiles,
    userCommandFileSystem: deps.userCommandFileSystem,
    compactSession: deps.compactSession,
    getWorkspaceDigest: deps.getWorkspaceDigest,
    getLastSystemPromptReport: deps.getLastSystemPromptReport,
    sessionManager: deps.sessionManager,
    unifiedConfigService: deps.unifiedConfigService,
    queueFollowupRequest: deps.queueFollowupRequest,
    createAutonomyMirror: deps.createAutonomyMirror,
    getSkillCatalog: deps.getSkillCatalog,
    getToolPermissions: deps.getToolPermissions,
    getAvailableModelIds: deps.getAvailableModelIds,
    sendChatRequestForModel: deps.sendChatRequestForModel,
    agentRegistry: deps.agentRegistry,
    // D2: Command service delegates
    listModels: deps.listModels,
    checkProviderStatus: deps.checkProviderStatus,
    getSessionFlag: deps.getSessionFlag,
    setSessionFlag: deps.setSessionFlag,
    executeCommand: deps.executeCommand,
    // D3: Diagnostics service
    diagnosticsService: deps.diagnosticsService,
    // D7: Observability service
    observabilityService: deps.observabilityService,
    // D4: Runtime hook registry
    runtimeHookRegistry: deps.runtimeHookRegistry,
    // D5: Vision model capability detection
    getActiveModelCapabilities: deps.getActiveModelCapabilities,
  };
}

export function buildOpenclawWorkspaceParticipantServices(
  deps: IOpenclawWorkspaceParticipantAdapterDeps,
): IWorkspaceParticipantServices {
  return {
    sendChatRequest: deps.sendChatRequest,
    getActiveModel: deps.getActiveModel,
    getWorkspaceName: deps.getWorkspaceName,
    listPages: deps.listPages,
    searchPages: deps.searchPages,
    getPageContent: deps.getPageContent,
    getPageTitle: deps.getPageTitle,
    getReadOnlyToolDefinitions: deps.getReadOnlyToolDefinitions,
    filterToolsForSession: deps.filterToolsForSession,
    invokeToolWithRuntimeControl: deps.invokeToolWithRuntimeControl,
    listFiles: deps.listFiles,
    readFileContent: deps.readFileContent,
    reportParticipantDebug: deps.reportParticipantDebug,
    reportRetrievalDebug: deps.reportRetrievalDebug,
    reportRuntimeTrace: deps.reportRuntimeTrace,
    reportBootstrapDebug: deps.reportBootstrapDebug,
    observabilityService: deps.observabilityService,
    runtimeHookRegistry: deps.runtimeHookRegistry,
  };
}

export function buildOpenclawCanvasParticipantServices(
  deps: IOpenclawCanvasParticipantAdapterDeps,
): ICanvasParticipantServices {
  return {
    sendChatRequest: deps.sendChatRequest,
    getActiveModel: deps.getActiveModel,
    getWorkspaceName: deps.getWorkspaceName,
    getCurrentPageId: deps.getCurrentPageId,
    getCurrentPageTitle: deps.getCurrentPageTitle,
    getPageStructure: deps.getPageStructure,
    getReadOnlyToolDefinitions: deps.getReadOnlyToolDefinitions,
    filterToolsForSession: deps.filterToolsForSession,
    invokeToolWithRuntimeControl: deps.invokeToolWithRuntimeControl,
    readFileContent: deps.readFileContent,
    reportParticipantDebug: deps.reportParticipantDebug,
    reportRetrievalDebug: deps.reportRetrievalDebug,
    reportRuntimeTrace: deps.reportRuntimeTrace,
    reportBootstrapDebug: deps.reportBootstrapDebug,
    observabilityService: deps.observabilityService,
    runtimeHookRegistry: deps.runtimeHookRegistry,
  };
}