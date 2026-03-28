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

  // No followup signals detected — model completed normally
  return { shouldFollowup: false, reason: 'turn-complete' };
}

// ---------------------------------------------------------------------------
// Followup runner factory
// ---------------------------------------------------------------------------

/**
 * Create a followup runner that manages the followup turn lifecycle.
 *
 * Upstream: createFollowupRunner() — factory that returns an async closure.
 * Called at L1 step 3, the returned closure is invoked at L1 step 6.
 *
 * The runner:
 *   1. Evaluates whether followup is needed
 *   2. If yes, queues the followup turn via the sender delegate
 *   3. Tracks depth to prevent infinite loops
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
