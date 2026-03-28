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
import { isContextOverflow, isModelError, isTimeoutError, isTransientError } from './openclawErrorClassification.js';

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
  readonly validatedCitations?: readonly { uri: string; label: string; index: number }[];
  readonly retrievedContextText: string;
  readonly overflowCompactions: number;
  readonly timeoutCompactions: number;
  readonly transientRetries: number;
  /** Whether this turn was a steering turn (interrupted a previous turn). */
  readonly isSteeringTurn: boolean;
  /** Whether this turn was a self-initiated followup continuation. */
  readonly isFollowupTurn: boolean;
  /** Current depth in the followup chain (0 = user-initiated turn). */
  readonly followupDepth: number;
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

  const steered = context.isSteeringTurn === true;
  const isFollowup = context.isFollowupTurn === true;
  const followupDepth = context.followupDepth ?? 0;

  // D3 Steer check — upstream L1 runReplyAgent step 1:
  //   if (steered && !shouldFollowup) { cleanup and return }
  // In Parallx, a steering turn means this message interrupted a previous turn.
  // The previous turn's cancellation has already been triggered by the queue.
  // We log the steer and proceed — followup suppression is enforced by evaluateFollowup (D1).
  if (steered) {
    response.progress('Processing steering message...');
  }

  // Bootstrap context engine once before retry loop
  // Upstream: runAttemptContextEngineBootstrap (attempt.context-engine-helpers.ts)
  if (context.engine.bootstrap) {
    await context.engine.bootstrap({
      sessionId: context.sessionId,
      tokenBudget: context.tokenBudget,
      autoRag: context.autoRag,
    });
  }

  // Proactive context maintenance — trims verbose tool results, removes redundant
  // acks, and collapses duplicate summaries before the retry loop.
  // Upstream: context-engine-maintenance.ts lifecycle hook
  if (context.engine.maintain) {
    await context.engine.maintain({
      sessionId: context.sessionId,
      tokenBudget: context.tokenBudget,
      history: context.history,
    });
  }

  let overflowAttempts = 0;
  let proactiveCompactions = 0;
  let timeoutAttempts = 0;
  let transientRetries = 0;
  let fallbackIndex = 0;
  let currentContext = context;

  while (!token.isCancellationRequested) {
    // 1. Assemble context
    const assembled = await currentContext.engine.assemble({
      sessionId: currentContext.sessionId,
      history: currentContext.history,
      tokenBudget: currentContext.tokenBudget,
      prompt: request.text,
    });

    // 1b. Auto-compact when assembled context is near capacity (>80% of budget)
    //     Parallx-specific optimization (upstream only compacts on post-error overflow).
    //     Uses independent counter to avoid consuming error-path retry budget.
    if (assembled.estimatedTokens > currentContext.tokenBudget * 0.8 && proactiveCompactions < MAX_OVERFLOW_COMPACTION) {
      response.progress(`Context near capacity (${assembled.estimatedTokens}/${currentContext.tokenBudget} tokens), auto-compacting...`);
      try {
        await currentContext.engine.compact({
          sessionId: currentContext.sessionId,
          tokenBudget: currentContext.tokenBudget,
        });
      } catch (compactErr) {
        console.error('[OpenClaw] Auto-compact failed:', compactErr);
      }
      proactiveCompactions++;
      continue; // Re-assemble with compacted history
    }

    try {
      // 2. Execute attempt
      const result = await executeOpenclawAttempt(
        request,
        currentContext,
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
        isSteeringTurn: steered,
        isFollowupTurn: isFollowup,
        followupDepth,
      };
    } catch (error) {
      // 3a. Context overflow → compact → retry
      if (isContextOverflow(error) && overflowAttempts < MAX_OVERFLOW_COMPACTION) {
        response.progress(`Context overflow detected, compacting (attempt ${overflowAttempts + 1}/${MAX_OVERFLOW_COMPACTION})...`);
        try {
          await currentContext.engine.compact({
            sessionId: currentContext.sessionId,
            tokenBudget: currentContext.tokenBudget,
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
          await currentContext.engine.compact({
            sessionId: currentContext.sessionId,
            tokenBudget: currentContext.tokenBudget,
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

      // 3d. Model failure → try next fallback model
      //     Upstream: runWithModelFallback wraps the full inner execution, so each
      //     model candidate gets fresh retry counters. We reset counters here.
      if (isModelError(error) && currentContext.fallbackModels && currentContext.rebuildSendChatRequest && fallbackIndex < currentContext.fallbackModels.length) {
        const nextModel = currentContext.fallbackModels[fallbackIndex];
        response.progress(`Model error, falling back to ${nextModel}...`);
        currentContext = { ...currentContext, sendChatRequest: currentContext.rebuildSendChatRequest(nextModel) };
        fallbackIndex++;
        // Reset retry counters — each model candidate gets fresh retries (upstream pattern)
        overflowAttempts = 0;
        proactiveCompactions = 0;
        timeoutAttempts = 0;
        transientRetries = 0;
        continue;
      }

      // 3e. Unrecoverable error
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
    isSteeringTurn: steered,
    isFollowupTurn: isFollowup,
    followupDepth,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
