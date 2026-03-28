/**
 * Followup Runner — D1: Self-Continuation mechanism.
 *
 * Upstream evidence:
 *   - followup-runner.ts:1-412 — createFollowupRunner factory
 *   - agent-runner.ts step 3: creates followup runner
 *   - agent-runner.ts step 6: evaluates shouldFollowup, queues FollowupRun
 *
 * Parallx adaptation:
 *   - Single-user desktop: no channel routing, no session key routing
 *   - Followup turn is queued into the chat service as a normal turn
 *   - Steer turns suppress followup (D3 integration)
 *   - Maximum followup depth prevents infinite loops
 *   - Followup signal extracted from model response or tool results
 */

import type { IOpenclawTurnResult } from './openclawTurnRunner.js';

// ---------------------------------------------------------------------------
// Constants (from upstream)
// ---------------------------------------------------------------------------

/**
 * Maximum consecutive followup turns before the runner stops.
 * Upstream: no explicit cap, but queue policy limits depth implicitly.
 * Parallx: explicit depth limit for safety.
 */
export const MAX_FOLLOWUP_DEPTH = 5;

/**
 * Minimum delay between followup turns to avoid overwhelming the model.
 * Upstream: followup-runner.ts schedules with a natural delay from queue processing.
 */
export const FOLLOWUP_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A queued followup request — mirrors upstream FollowupRun.
 *
 * Upstream: FollowupRun { message, sessionKey, reason }
 */
export interface IOpenclawFollowupRun {
  /** The followup message or instruction for the next turn. */
  readonly message: string;
  /** Why this followup was triggered. */
  readonly reason: string;
  /** Current depth in the followup chain (0 = first followup). */
  readonly depth: number;
}

/**
 * Delegate that queues a followup turn for execution.
 * Parallx adaptation: maps to chatService.sendRequest() or
 * chatService.queueRequest() depending on turn state.
 */
export type FollowupTurnSender = (followup: IOpenclawFollowupRun) => Promise<void>;

/**
 * Result of evaluating whether a followup should be triggered.
 */
export interface IFollowupEvaluation {
  /** Whether a followup turn should be queued. */
  readonly shouldFollowup: boolean;
  /** The message to send as the followup turn (if shouldFollowup is true). */
  readonly message?: string;
  /** Why the followup was triggered or suppressed. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Followup evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a completed turn should trigger a followup.
 *
 * Upstream: L1 step 6 evaluates shouldFollowup based on:
 *   - Agent config (followup enabled)
 *   - Tool results signaling continuation
 *   - Model not explicitly finishing
 *
 * Parallx adaptation:
 *   - Followup is signaled through structured tool results, not heuristic
 *     analysis of model output text
 *   - Steer turns never trigger followup (D3 contract)
 *   - Depth limit enforced
 */
export function evaluateFollowup(
  turnResult: IOpenclawTurnResult,
  options: {
    currentDepth: number;
    maxDepth?: number;
    followupEnabled?: boolean;
  },
): IFollowupEvaluation {
  const maxDepth = options.maxDepth ?? MAX_FOLLOWUP_DEPTH;
  const followupEnabled = options.followupEnabled ?? true;

  // Gate 1: Followup disabled by config
  if (!followupEnabled) {
    return { shouldFollowup: false, reason: 'followup-disabled' };
  }

  // Gate 2: Steer turns suppress followup (D3 integration)
  // Upstream: if (steered && !shouldFollowup) { cleanup and return }
  if (turnResult.isSteeringTurn) {
    return { shouldFollowup: false, reason: 'steer-suppressed' };
  }

  // Gate 3: Depth limit exceeded
  if (options.currentDepth >= maxDepth) {
    return { shouldFollowup: false, reason: 'depth-limit-reached' };
  }

  // Gate 4: Empty response — nothing to follow up on
  if (!turnResult.markdown.trim()) {
    return { shouldFollowup: false, reason: 'empty-response' };
  }

  // Gate 5: tool continuation signal — upstream: enqueueFollowupRun (agent-runner.ts:236-244)
  // When the tool loop hits the iteration cap while the model still wants to
  // call tools, the turn result carries continuationRequested = true.
  // Upstream: finalizeWithFollowup (agent-runner-helpers.ts:55-58) always
  // schedules a drain; if the queue has items, the drain executes them.
  // Parallx: continuationRequested is the single-user equivalent of
  // "queue has pending items".
  if (turnResult.continuationRequested) {
    return {
      shouldFollowup: true,
      message: 'Continue processing from where you left off.',
      reason: 'tool-continuation',
    };
  }

  // No followup signals detected — model completed normally
  return { shouldFollowup: false, reason: 'turn-complete' };
}

// ---------------------------------------------------------------------------
// Followup runner factory
// ---------------------------------------------------------------------------

/**
 * Create a followup runner that evaluates and dispatches followup turns.
 *
 * Upstream: createFollowupRunner (followup-runner.ts:42-412)
 * Upstream factory captures full runtime context and self-contains the
 * entire followup turn execution lifecycle (~370 lines): model call with
 * fallback, payload sanitization, reply routing, compaction tracking,
 * usage persistence, typing cleanup, and session refresh.
 *
 * Parallx adaptation — evaluation + dispatch, not execution:
 * The Parallx factory returns an evaluator, not an executor. Turn execution
 * is delegated to the platform via FollowupTurnSender, which maps to
 * chatService.sendRequest() or chatService.queueRequest(). This separation
 * is intentional for VS Code architecture where the participant runtime owns
 * turn execution. The runner owns the decision (should we follow up?) and the
 * caller owns the execution (how to send the turn).
 *
 * The upstream pattern inlines execution because it owns the full gateway
 * stack (typing, routing, session persistence). Parallx delegates these to
 * the VS Code chat participant API.
 *
 * @param sender Delegate that sends the followup turn to the chat service
 * @param options Configuration for followup behavior
 * @returns Async function that evaluates and optionally queues a followup
 */
export function createFollowupRunner(
  sender: FollowupTurnSender,
  options?: {
    maxDepth?: number;
    followupEnabled?: boolean;
  },
): (turnResult: IOpenclawTurnResult, currentDepth: number) => Promise<IFollowupEvaluation> {
  const maxDepth = options?.maxDepth ?? MAX_FOLLOWUP_DEPTH;
  const followupEnabled = options?.followupEnabled ?? true;

  return async (turnResult: IOpenclawTurnResult, currentDepth: number): Promise<IFollowupEvaluation> => {
    const evaluation = evaluateFollowup(turnResult, {
      currentDepth,
      maxDepth,
      followupEnabled,
    });

    if (evaluation.shouldFollowup && evaluation.message) {
      // Upstream: queue debounce via DEFAULT_QUEUE_DEBOUNCE_MS (queue/state.ts:18)
      // and waitForQueueDebounce in drain.ts prevents rapid-fire followup turns.
      // Parallx: explicit delay since we have no queue drain mechanism.
      await new Promise<void>(resolve => setTimeout(resolve, FOLLOWUP_DELAY_MS));

      const followupRun: IOpenclawFollowupRun = {
        message: evaluation.message,
        reason: evaluation.reason,
        depth: currentDepth + 1,
      };

      await sender(followupRun);
    }

    return evaluation;
  };
}
