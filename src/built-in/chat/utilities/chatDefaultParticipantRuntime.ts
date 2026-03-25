import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import type {
  ChatRuntimeKind,
  IChatParticipantRuntime,
  IDefaultParticipantServices,
} from '../chatTypes.js';
import { createDefaultCommandRegistry } from './chatDefaultCommandRegistry.js';
import { runDefaultRuntimeInterpretationStage } from './chatDefaultRuntimeInterpretationStage.js';
import { runDefaultRuntimeContextStage } from './chatDefaultRuntimeContextStage.js';
import { runDefaultRuntimeExecutionStage } from './chatDefaultRuntimeExecutionStage.js';

interface IRuntimeTraceState {
  phase?: 'interpretation' | 'context' | 'execution';
  checkpoint?: string;
  runState?: import('../chatTypes.js').ChatRuntimeRunState;
}

export function createDefaultChatParticipantRuntime(
  services: IDefaultParticipantServices,
): IChatParticipantRuntime {
  const kind = resolveDefaultChatRuntimeKind();
  const commandRegistry = createDefaultCommandRegistry(services);

  return {
    kind,
    handleTurn: (request, context, response, token) => {
      const runId = generateRuntimeRunId();
      const traceState: IRuntimeTraceState = { runState: 'prepared' };
      const tracedServices = withRuntimeTraceMetadata(services, kind, runId, traceState);
      return executeDefaultParticipantTurn(
        tracedServices,
        commandRegistry,
        request,
        context,
        response,
        token,
        traceState,
      );
    },
  };
}

export function resolveDefaultChatRuntimeKind(): ChatRuntimeKind {
  return 'claw';
}

async function executeDefaultParticipantTurn(
  services: IDefaultParticipantServices,
  commandRegistry: ReturnType<typeof createDefaultCommandRegistry>,
  request: IChatParticipantRequest,
  context: IChatParticipantContext,
  response: IChatResponseStream,
  token: ICancellationToken,
  traceState?: IRuntimeTraceState,
): Promise<IChatParticipantResult> {
  setTraceState(traceState, 'interpretation', 'resolve-turn');
  const interpretationStage = await runDefaultRuntimeInterpretationStage(services, {
    request,
    context,
    response,
    token,
    parseSlashCommand: commandRegistry.parseSlashCommand,
  });

  if (interpretationStage.kind === 'handled') {
    return interpretationStage.result;
  }

  setTraceState(traceState, 'context', 'prepare-context');
  const contextAssemblyStart = performance.now();
  const preparedContext = await runDefaultRuntimeContextStage(services, {
    request,
    context,
    response,
    token,
    turn: interpretationStage.turn,
  });

  const contextAssemblyEnd = performance.now();
  console.debug(`[Parallx:latency] Context assembly: ${(contextAssemblyEnd - contextAssemblyStart).toFixed(1)}ms`);

  setTraceState(traceState, 'execution', 'execute-turn', 'executing');
  return runDefaultRuntimeExecutionStage(services, {
    request,
    context,
    response,
    token,
    maxIterations: interpretationStage.maxIterations,
    capabilities: interpretationStage.capabilities,
    turn: interpretationStage.turn,
    preparedContext,
    commandRegistry,
  });
}

function withRuntimeTraceMetadata(
  services: IDefaultParticipantServices,
  runtime: ChatRuntimeKind,
  runId: string,
  traceState: IRuntimeTraceState,
): IDefaultParticipantServices {
  if (!services.reportRuntimeTrace) {
    return services;
  }

  return {
    ...services,
    reportRuntimeTrace: (trace) => services.reportRuntimeTrace?.({
      ...trace,
      runtime,
      runId,
      phase: traceState.phase,
      checkpoint: traceState.checkpoint,
      runState: traceState.runState,
    }),
  };
}

function setTraceState(
  traceState: IRuntimeTraceState | undefined,
  phase: 'interpretation' | 'context' | 'execution',
  checkpoint: string,
  runState?: import('../chatTypes.js').ChatRuntimeRunState,
): void {
  if (!traceState) {
    return;
  }

  traceState.phase = phase;
  traceState.checkpoint = checkpoint;
  if (runState) {
    traceState.runState = runState;
  }
}

function generateRuntimeRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `runtime-${Math.random().toString(36).slice(2, 10)}`;
}