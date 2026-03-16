import type {
  IChatParticipantContext,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import type {
  ICanvasParticipantServices,
  IWorkspaceParticipantServices,
} from '../chatTypes.js';
import { dispatchScopedParticipantCommand, type IScopedParticipantDispatchOptions } from './chatParticipantCommandDispatcher.js';

type ScopedParticipantServices = IWorkspaceParticipantServices | ICanvasParticipantServices;

export function createScopedParticipantHandler<TServices extends ScopedParticipantServices>(
  options: Omit<IScopedParticipantDispatchOptions<TServices>, 'request' | 'context' | 'response' | 'token'>,
): IChatParticipantHandler {
  return async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {
    try {
      return await dispatchScopedParticipantCommand({
        ...options,
        request,
        context,
        response,
        token,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { errorDetails: { message, responseIsIncomplete: true } };
    }
  };
}