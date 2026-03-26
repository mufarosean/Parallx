/**
 * Turn-level retry loop for the OpenClaw execution pipeline (Layer 1).
 *
 * Merges upstream L2 (error recovery) + L3 (iteration bounds) into one layer.
 *
 * Upstream evidence:
 *   - agent-runner-execution.ts:113-763 — overflow/transient retry
 *   - run.ts:879-1860 — MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3, MAX_TIMEOUT_COMPACTION_ATTEMPTS = 2
 *   - agent-runner-execution.ts — transient retry delay: 2500ms
 *
 * Parallx adaptation:
 *   - Single-user (no queue/steer from L1)
 *   - Wraps executeOpenclawAttempt in error-handling retry loop
 *   - Context overflow → compact → re-assemble → retry (max 3)
 *   - Timeout → compact(force) → re-assemble → retry (max 2)
 *   - Transient → delay(2500ms) → retry
 *   - Unrecoverable errors → throw
 */

import type {
  IChatParticipantRequest,
  IChatResponseStream,
  ICancellationToken,
} from '../services/chatTypes.js';
import type { IOpenclawTurnContext } from './openclawAttempt.js';
import { executeOpenclawAttempt } from './openclawAttempt.js';
import { isContextOverflow, isTimeoutError, isTransientError } from './openclawErrorClassification.js';

// ---------------------------------------------------------------------------
// Constants (from upstream)
// ---------------------------------------------------------------------------

/** Max overflow compaction retries — from run.ts */
const MAX_OVERFLOW_COMPACTION = 3;
/** Max timeout compaction retries — from run.ts */
const MAX_TIMEOUT_COMPACTION = 2;
/** Transient retry base delay in ms */
const TRANSIENT_BASE_DELAY = 2500;
/** Max transient retry delay cap in ms */
const TRANSIENT_MAX_DELAY = 15000;
/** Max transient retries before giving up */
const MAX_TRANSIENT_RETRIES = 3;

/** Exponential backoff: 2500 → 5000 → 10000 (capped at 15000) */
function transientDelay(attempt: number): number {
  return Math.min(TRANSIENT_BASE_DELAY * Math.pow(2, attempt), TRANSIENT_MAX_DELAY);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IOpenclawTurnResult {
  readonly markdown: string;
  readonly thinking: string;
  readonly toolCallCount: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly ragSources: readonly { uri: string; label: string; index: number }[];
  readonly retrievedContextText: string;
  readonly overflowCompactions: number;
  readonly timeoutCompactions: number;
  readonly transientRetries: number;
}

// ---------------------------------------------------------------------------
// Turn runner
// ---------------------------------------------------------------------------

/**
 * Execute a full turn with error recovery and retry logic.
 *
 * Upstream: runAgentTurnWithFallback + runEmbeddedPiAgent
 *
 * Lifecycle:
 *   1. Assemble context (via engine)
 *   2. Attempt execution (via executeOpenclawAttempt)
 *   3. On error:
 *      - Context overflow → compact → re-assemble → retry
 *      - Timeout → compact(force) → re-assemble → retry
 *      - Transient → delay → retry
 *      - Unrecoverable → throw
 */
export async function runOpenclawTurn(
  request: IChatParticipantRequest,
  context: IOpenclawTurnContext,
  response: IChatResponseStream,
  token: ICancellationToken,
): Promise<IOpenclawTurnResult> {

  // Bootstrap context engine once before retry loop
  // Upstream: runAttemptContextEngineBootstrap (attempt.context-engine-helpers.ts)
  if (context.engine.bootstrap) {
    await context.engine.bootstrap({
      sessionId: context.sessionId,
      tokenBudget: context.tokenBudget,
    });
  }

  let overflowAttempts = 0;
  let timeoutAttempts = 0;
  let transientRetries = 0;

  while (!token.isCancellationRequested) {
    // 1. Assemble context
    const assembled = await context.engine.assemble({
      sessionId: context.sessionId,
      history: context.history,
      tokenBudget: context.tokenBudget,
      prompt: request.text,
    });

    // 1b. Auto-compact when assembled context is near capacity (>80% of budget)
    //     Upstream: overflow detection triggers compaction before model call
    if (assembled.estimatedTokens > context.tokenBudget * 0.8 && overflowAttempts < MAX_OVERFLOW_COMPACTION) {
      response.progress(`Context near capacity (${assembled.estimatedTokens}/${context.tokenBudget} tokens), auto-compacting...`);
      try {
        await context.engine.compact({
          sessionId: context.sessionId,
          tokenBudget: context.tokenBudget,
        });
      } catch (compactErr) {
        console.error('[OpenClaw] Auto-compact failed:', compactErr);
      }
      overflowAttempts++;
      continue; // Re-assemble with compacted history
    }

    try {
      // 2. Execute attempt
      const result = await executeOpenclawAttempt(
        request,
        context,
        assembled,
        response,
        token,
      );

      return {
        ...result,
        retrievedContextText: assembled.retrievedContextText,
        overflowCompactions: overflowAttempts,
        timeoutCompactions: timeoutAttempts,
        transientRetries,
      };
    } catch (error) {
      // 3a. Context overflow → compact → retry
      if (isContextOverflow(error) && overflowAttempts < MAX_OVERFLOW_COMPACTION) {
        response.progress(`Context overflow detected, compacting (attempt ${overflowAttempts + 1}/${MAX_OVERFLOW_COMPACTION})...`);
        try {
          await context.engine.compact({
            sessionId: context.sessionId,
            tokenBudget: context.tokenBudget,
          });
        } catch (compactErr) {
          console.error('[OpenClaw] Overflow compact failed, re-throwing original error:', compactErr);
          throw error;
        }
        overflowAttempts++;
        continue;
      }

      // 3b. Timeout → compact(force) → retry
      if (isTimeoutError(error) && timeoutAttempts < MAX_TIMEOUT_COMPACTION) {
        response.progress(`Timeout detected, compacting (attempt ${timeoutAttempts + 1}/${MAX_TIMEOUT_COMPACTION})...`);
        try {
          await context.engine.compact({
            sessionId: context.sessionId,
            tokenBudget: context.tokenBudget,
            force: true,
          });
        } catch (compactErr) {
          console.error('[OpenClaw] Timeout compact failed, re-throwing original error:', compactErr);
          throw error;
        }
        timeoutAttempts++;
        continue;
      }

      // 3c. Transient → exponential backoff → retry
      if (isTransientError(error) && transientRetries < MAX_TRANSIENT_RETRIES) {
        const backoff = transientDelay(transientRetries);
        response.progress(`Transient error, retrying in ${backoff}ms...`);
        await delay(backoff);
        transientRetries++;
        continue;
      }

      // 3d. Unrecoverable error
      throw error;
    }
  }

  // Cancelled — return empty result
  return {
    markdown: '',
    thinking: '',
    toolCallCount: 0,
    ragSources: [],
    retrievedContextText: '',
    overflowCompactions: overflowAttempts,
    timeoutCompactions: timeoutAttempts,
    transientRetries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
