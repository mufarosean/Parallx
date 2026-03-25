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
import { emitScopedParticipantRuntimeCheckpoint } from './chatScopedParticipantRuntime.js';

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
      emitScopedParticipantRuntimeCheckpoint({
        request,
        context,
        surface: options.surface,
        reportRuntimeTrace: options.services.reportRuntimeTrace,
        checkpoint: 'scoped-handler-start',
        runState: 'executing',
        note: `${options.surface} scoped participant dispatch`,
      });

      const result = await dispatchScopedParticipantCommand({
        ...options,
        request,
        context,
        response,
        token,
      });

      emitScopedParticipantRuntimeCheckpoint({
        request,
        context,
        surface: options.surface,
        reportRuntimeTrace: options.services.reportRuntimeTrace,
        checkpoint: 'scoped-handler-complete',
        runState: 'completed',
        note: `${options.surface} scoped participant dispatch`,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitScopedParticipantRuntimeCheckpoint({
        request,
        context,
        surface: options.surface,
        reportRuntimeTrace: options.services.reportRuntimeTrace,
        checkpoint: 'scoped-handler-error',
        runState: 'failed',
        note: message,
      });
      return { errorDetails: { message, responseIsIncomplete: true } };
    }
  };
}