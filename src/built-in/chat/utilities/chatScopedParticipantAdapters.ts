import type {
  ICanvasParticipantServices,
  IWorkspaceParticipantServices,
} from '../chatTypes.js';

export interface IChatWorkspaceParticipantAdapterDeps {
  readonly sendChatRequest: IWorkspaceParticipantServices['sendChatRequest'];
  readonly getActiveModel: IWorkspaceParticipantServices['getActiveModel'];
  readonly getWorkspaceName: IWorkspaceParticipantServices['getWorkspaceName'];
  readonly listPages: IWorkspaceParticipantServices['listPages'];
  readonly searchPages: IWorkspaceParticipantServices['searchPages'];
  readonly getPageContent: IWorkspaceParticipantServices['getPageContent'];
  readonly getPageTitle: IWorkspaceParticipantServices['getPageTitle'];
  readonly getReadOnlyToolDefinitions?: IWorkspaceParticipantServices['getReadOnlyToolDefinitions'];
  readonly invokeToolWithRuntimeControl?: IWorkspaceParticipantServices['invokeToolWithRuntimeControl'];
  readonly listFiles?: IWorkspaceParticipantServices['listFiles'];
  readonly readFileContent?: IWorkspaceParticipantServices['readFileContent'];
  readonly reportParticipantDebug?: IWorkspaceParticipantServices['reportParticipantDebug'];
  readonly reportRetrievalDebug?: IWorkspaceParticipantServices['reportRetrievalDebug'];
  readonly reportRuntimeTrace?: IWorkspaceParticipantServices['reportRuntimeTrace'];
  readonly reportBootstrapDebug?: IWorkspaceParticipantServices['reportBootstrapDebug'];
}

export interface IChatCanvasParticipantAdapterDeps {
  readonly sendChatRequest: ICanvasParticipantServices['sendChatRequest'];
  readonly getActiveModel: ICanvasParticipantServices['getActiveModel'];
  readonly getWorkspaceName: ICanvasParticipantServices['getWorkspaceName'];
  readonly getCurrentPageId: ICanvasParticipantServices['getCurrentPageId'];
  readonly getCurrentPageTitle: ICanvasParticipantServices['getCurrentPageTitle'];
  readonly getPageStructure: ICanvasParticipantServices['getPageStructure'];
  readonly getReadOnlyToolDefinitions?: ICanvasParticipantServices['getReadOnlyToolDefinitions'];
  readonly invokeToolWithRuntimeControl?: ICanvasParticipantServices['invokeToolWithRuntimeControl'];
  readonly readFileContent?: ICanvasParticipantServices['readFileContent'];
  readonly reportParticipantDebug?: ICanvasParticipantServices['reportParticipantDebug'];
  readonly reportRetrievalDebug?: ICanvasParticipantServices['reportRetrievalDebug'];
  readonly reportRuntimeTrace?: ICanvasParticipantServices['reportRuntimeTrace'];
  readonly reportBootstrapDebug?: ICanvasParticipantServices['reportBootstrapDebug'];
}

export function buildChatWorkspaceParticipantServices(
  deps: IChatWorkspaceParticipantAdapterDeps,
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
    invokeToolWithRuntimeControl: deps.invokeToolWithRuntimeControl,
    listFiles: deps.listFiles,
    readFileContent: deps.readFileContent,
    reportParticipantDebug: deps.reportParticipantDebug,
    reportRetrievalDebug: deps.reportRetrievalDebug,
    reportRuntimeTrace: deps.reportRuntimeTrace,
    reportBootstrapDebug: deps.reportBootstrapDebug,
  };
}

export function buildChatCanvasParticipantServices(
  deps: IChatCanvasParticipantAdapterDeps,
): ICanvasParticipantServices {
  return {
    sendChatRequest: deps.sendChatRequest,
    getActiveModel: deps.getActiveModel,
    getWorkspaceName: deps.getWorkspaceName,
    getCurrentPageId: deps.getCurrentPageId,
    getCurrentPageTitle: deps.getCurrentPageTitle,
    getPageStructure: deps.getPageStructure,
    getReadOnlyToolDefinitions: deps.getReadOnlyToolDefinitions,
    invokeToolWithRuntimeControl: deps.invokeToolWithRuntimeControl,
    readFileContent: deps.readFileContent,
    reportParticipantDebug: deps.reportParticipantDebug,
    reportRetrievalDebug: deps.reportRetrievalDebug,
    reportRuntimeTrace: deps.reportRuntimeTrace,
    reportBootstrapDebug: deps.reportBootstrapDebug,
  };
}