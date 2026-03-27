// chatTurnExecutionConfig.ts — M14 session-aware turn execution configuration
//
// Assembles execution config for a chat turn with session guard integration.
// Ensures tool invocations and persist operations respect session boundaries.

import { captureSession } from '../../../workspace/staleGuard.js';
import type { ISessionManager } from '../../../services/serviceTypes.js';

export interface IChatTurnExecutionConfig {
  readonly toolGuard: { isValid(): boolean; sessionId: string };
  readonly sessionCancellationSignal: AbortSignal;
  readonly cancellationSignal: AbortSignal;
}

/**
 * Build an execution config that carries a session guard and cancellation signal.
 */
export function buildChatTurnExecutionConfig(services: {
  sessionManager: ISessionManager;
  abortSignal?: AbortSignal;
}): IChatTurnExecutionConfig {
  const guard = captureSession(services.sessionManager);
  const controller = new AbortController();

  const toolGuard = {
    isValid: () => guard.isValid(),
    sessionId: guard.sessionId,
  };

  // Link external abort to our controller
  if (services.abortSignal) {
    services.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return {
    toolGuard,
    sessionCancellationSignal: controller.signal,
    cancellationSignal: controller.signal,
  };
}
