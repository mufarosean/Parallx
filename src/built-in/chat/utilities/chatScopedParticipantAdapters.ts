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
  readonly listFiles?: IWorkspaceParticipantServices['listFiles'];
  readonly readFileContent?: IWorkspaceParticipantServices['readFileContent'];
  readonly reportRetrievalDebug?: IWorkspaceParticipantServices['reportRetrievalDebug'];
}

export interface IChatCanvasParticipantAdapterDeps {
  readonly sendChatRequest: ICanvasParticipantServices['sendChatRequest'];
  readonly getActiveModel: ICanvasParticipantServices['getActiveModel'];
  readonly getWorkspaceName: ICanvasParticipantServices['getWorkspaceName'];
  readonly getCurrentPageId: ICanvasParticipantServices['getCurrentPageId'];
  readonly getCurrentPageTitle: ICanvasParticipantServices['getCurrentPageTitle'];
  readonly getPageStructure: ICanvasParticipantServices['getPageStructure'];
  readonly reportRetrievalDebug?: ICanvasParticipantServices['reportRetrievalDebug'];
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
    listFiles: deps.listFiles,
    readFileContent: deps.readFileContent,
    reportRetrievalDebug: deps.reportRetrievalDebug,
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
    reportRetrievalDebug: deps.reportRetrievalDebug,
  };
}