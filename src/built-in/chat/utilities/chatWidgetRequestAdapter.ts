import type { Event } from '../../../platform/events.js';
import type { ChatRequestQueueKind, IChatPendingRequest, IChatWidgetServices } from '../chatTypes.js';

export interface IChatWidgetRequestAdapterDeps {
  readonly sendRequest: (sessionId: string, message: string, attachments?: readonly unknown[]) => Promise<void>;
  readonly cancelRequest: (sessionId: string) => void;
  readonly createSession: () => unknown;
  readonly onDidChangeSession: Event<string>;
  readonly getProviderStatus: () => { available: boolean };
  readonly onDidChangeProviderStatus: Event<void>;
  readonly queueRequest: (sessionId: string, message: string, kind: ChatRequestQueueKind) => IChatPendingRequest;
  readonly removePendingRequest: (sessionId: string, requestId: string) => void;
  readonly requestYield: (sessionId: string) => void;
  readonly onDidChangePendingRequests: Event<string>;
}

export function buildChatWidgetRequestServices(
  deps: IChatWidgetRequestAdapterDeps,
): Pick<
  IChatWidgetServices,
  'sendRequest'
  | 'cancelRequest'
  | 'createSession'
  | 'onDidChangeSession'
  | 'getProviderStatus'
  | 'onDidChangeProviderStatus'
  | 'queueRequest'
  | 'removePendingRequest'
  | 'requestYield'
  | 'onDidChangePendingRequests'
> {
  return {
    sendRequest: (sessionId, message, attachments) => deps.sendRequest(sessionId, message, attachments),
    cancelRequest: deps.cancelRequest,
    createSession: deps.createSession as IChatWidgetServices['createSession'],
    onDidChangeSession: deps.onDidChangeSession,
    getProviderStatus: deps.getProviderStatus,
    onDidChangeProviderStatus: deps.onDidChangeProviderStatus,
    queueRequest: deps.queueRequest,
    removePendingRequest: deps.removePendingRequest,
    requestYield: deps.requestYield,
    onDidChangePendingRequests: deps.onDidChangePendingRequests,
  };
}