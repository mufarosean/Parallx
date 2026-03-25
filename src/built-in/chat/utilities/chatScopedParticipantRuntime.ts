import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import type {
  ICanvasParticipantServices,
  IChatParticipantRuntime,
  IChatRuntimeTrace,
  IWorkspaceParticipantServices,
} from '../chatTypes.js';
import { createScopedRuntimeTraceSeed, type ScopedSurface } from './chatScopedRuntimePromptStage.js';
import { dispatchScopedParticipantCommand, type IScopedParticipantDispatchOptions } from './chatParticipantCommandDispatcher.js';

type ScopedRuntimeReporter = IWorkspaceParticipantServices['reportRuntimeTrace'] | ICanvasParticipantServices['reportRuntimeTrace'];
type ScopedParticipantServices = IWorkspaceParticipantServices | ICanvasParticipantServices;

export function createScopedParticipantRuntimeReporter(options: {
  request: IChatParticipantRequest;
  context: IChatParticipantContext | undefined;
  surface: ScopedSurface;
  reportRuntimeTrace?: ScopedRuntimeReporter;
}): ((trace: IChatRuntimeTrace) => void) | undefined {
  if (options.context?.runtime?.reportTrace) {
    return (trace) => options.context?.runtime?.reportTrace?.({
      ...trace,
      runtime: trace.runtime ?? 'claw',
      sessionId: trace.sessionId ?? options.context?.sessionId,
    });
  }

  if (options.reportRuntimeTrace) {
    return (trace) => options.reportRuntimeTrace?.({
      ...trace,
      runtime: trace.runtime ?? 'claw',
      sessionId: trace.sessionId ?? options.context?.sessionId,
    });
  }

  return undefined;
}

export function emitScopedParticipantRuntimeCheckpoint(options: {
  request: IChatParticipantRequest;
  context: IChatParticipantContext | undefined;
  surface: ScopedSurface;
  reportRuntimeTrace?: ScopedRuntimeReporter;
  checkpoint: string;
  runState: IChatRuntimeTrace['runState'];
  note: string;
  phase?: IChatRuntimeTrace['phase'];
}): void {
  const reporter = createScopedParticipantRuntimeReporter(options);
  if (!reporter) {
    return;
  }

  const seed = createScopedRuntimeTraceSeed(options.request, options.surface);
  reporter({
    ...seed,
    sessionId: options.context?.sessionId,
    runtime: 'claw',
    phase: options.phase ?? 'execution',
    checkpoint: options.checkpoint,
    runState: options.runState,
    note: options.note,
  });
}

export function createScopedChatParticipantRuntime<TServices extends ScopedParticipantServices>(
  options: Omit<IScopedParticipantDispatchOptions<TServices>, 'request' | 'context' | 'response' | 'token'>,
): IChatParticipantRuntime {
  return {
    kind: 'claw',
    handleTurn: async (
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
    },
  };
}