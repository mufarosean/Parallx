import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatParticipantResult,
  IChatResponseStream,
  ICancellationToken,
} from '../../../services/chatTypes.js';
import type { IChatParticipantRuntime } from '../chatTypes.js';
import { interpretChatParticipantRequest } from './chatParticipantInterpretation.js';
import { buildParticipantRuntimeTrace } from './chatParticipantRuntimeTrace.js';

export function createBridgeParticipantRuntime(options: {
  participantId: string;
  handler: (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ) => Promise<IChatParticipantResult>;
}): IChatParticipantRuntime {
  return {
    kind: 'claw',
    handleTurn: async (request, context, response, token) => {
      const interpretation = interpretChatParticipantRequest('bridge', request);
      const normalizedRequest: IChatParticipantRequest = {
        ...request,
        text: interpretation.effectiveText,
        command: interpretation.commandName,
        interpretation: {
          surface: interpretation.surface,
          rawText: interpretation.rawText,
          effectiveText: interpretation.effectiveText,
          commandName: interpretation.commandName,
          hasExplicitCommand: interpretation.hasExplicitCommand,
          kind: interpretation.kind,
          semantics: interpretation.semantics,
        },
      };

      const startTrace = buildParticipantRuntimeTrace(normalizedRequest, context, {
        phase: 'execution',
        checkpoint: 'bridge-handler-start',
        runState: 'executing',
        note: `bridge:${options.participantId}`,
      });
      if (startTrace) {
        context.runtime?.reportTrace?.(startTrace);
      }

      try {
        const result = await options.handler(normalizedRequest, context, response, token);
        const completionTrace = buildParticipantRuntimeTrace(normalizedRequest, context, {
          phase: 'execution',
          checkpoint: 'bridge-handler-complete',
          runState: 'completed',
          note: `bridge:${options.participantId}`,
        });
        if (completionTrace) {
          context.runtime?.reportTrace?.(completionTrace);
        }
        return withBridgeCompatibilityBoundary(result, options.participantId);
      } catch (error) {
        const errorTrace = buildParticipantRuntimeTrace(normalizedRequest, context, {
          phase: 'execution',
          checkpoint: 'bridge-handler-error',
          runState: 'failed',
          note: error instanceof Error ? error.message : String(error),
        });
        if (errorTrace) {
          context.runtime?.reportTrace?.(errorTrace);
        }
        throw error;
      }
    },
  };
}

function withBridgeCompatibilityBoundary(
  result: IChatParticipantResult,
  participantId: string,
): IChatParticipantResult {
  const runtimeBoundary = {
    type: 'bridge-compatibility',
    participantId,
    runtime: 'claw' as const,
  };

  if (!result.metadata || typeof result.metadata !== 'object' || Array.isArray(result.metadata)) {
    return {
      ...result,
      metadata: {
        runtimeBoundary,
      },
    };
  }

  return {
    ...result,
    metadata: {
      ...(result.metadata as Record<string, unknown>),
      runtimeBoundary,
    },
  };
}