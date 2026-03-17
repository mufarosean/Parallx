import type {
  ICancellationToken,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
} from '../../../services/chatTypes.js';
import type {
  ICanvasParticipantServices,
  IChatParticipantInterpretation,
  IWorkspaceParticipantServices,
} from '../chatTypes.js';
import { interpretChatParticipantRequest } from './chatParticipantInterpretation.js';

type ParticipantServicesWithRetrievalDebug = Pick<
  IWorkspaceParticipantServices | ICanvasParticipantServices,
  'reportRetrievalDebug'
>;

export type ScopedParticipantHandler<TServices> = (
  interpretation: IChatParticipantInterpretation,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  services: TServices,
) => Promise<IChatParticipantResult>;

export interface IScopedParticipantDispatchOptions<TServices extends ParticipantServicesWithRetrievalDebug> {
  readonly surface: 'workspace' | 'canvas';
  readonly request: IChatParticipantRequest;
  readonly context: IChatParticipantContext;
  readonly response: IChatResponseStream;
  readonly token: ICancellationToken;
  readonly services: TServices;
  readonly handlers: Readonly<Record<string, ScopedParticipantHandler<TServices>>>;
  readonly defaultHandler: ScopedParticipantHandler<TServices>;
}

export async function dispatchScopedParticipantCommand<TServices extends ParticipantServicesWithRetrievalDebug>(
  options: IScopedParticipantDispatchOptions<TServices>,
): Promise<IChatParticipantResult> {
  const interpretation = interpretChatParticipantRequest(options.surface, options.request);

  options.services.reportRetrievalDebug?.({
    hasActiveSlashCommand: interpretation.hasExplicitCommand,
    isRagReady: false,
    needsRetrieval: false,
    attempted: false,
  });

  const handler = interpretation.commandName
    ? options.handlers[interpretation.commandName]
    : undefined;

  return (handler ?? options.defaultHandler)(
    interpretation,
    options.request,
    options.context,
    options.response,
    options.token,
    options.services,
  );
}