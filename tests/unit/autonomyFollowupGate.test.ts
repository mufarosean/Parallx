// autonomyFollowupGate.test.ts — M60 §3.7 (cancellation) + §3.8 (followup
// flag enforcement) + §3.10 (event emit).
//
// Scope: unit tests around the FollowupRunner factory itself; the
// integration with the participant is exercised by openclawFollowupWiring
// (kept untouched).

import { describe, expect, it, vi } from 'vitest';
import {
  createFollowupRunner,
  FOLLOWUP_DELAY_MS,
} from '../../src/openclaw/openclawFollowupRunner';
import type { IOpenclawTurnResult } from '../../src/openclaw/openclawTurnRunner';

function turnResult(overrides?: Partial<IOpenclawTurnResult>): IOpenclawTurnResult {
  return {
    markdown: 'reply',
    thinking: '',
    toolCallCount: 0,
    durationMs: 1,
    ragSources: [],
    retrievedContextText: '',
    overflowCompactions: 0,
    timeoutCompactions: 0,
    transientRetries: 0,
    isSteeringTurn: false,
    isFollowupTurn: false,
    followupDepth: 0,
    continuationRequested: false,
    ...overrides,
  };
}

describe('FollowupRunner cancellation (M60 §3.7)', () => {
  it('refuses to evaluate when the token is already cancelled', async () => {
    const sender = vi.fn();
    const run = createFollowupRunner(sender);
    const evaluation = await run(
      turnResult({ continuationRequested: true }),
      0,
      { isCancellationRequested: true },
    );
    expect(evaluation.shouldFollowup).toBe(false);
    expect(evaluation.reason).toBe('cancelled');
    expect(sender).not.toHaveBeenCalled();
  });

  it('aborts the FOLLOWUP_DELAY_MS wait and skips dispatch when cancelled mid-flight', async () => {
    vi.useFakeTimers();
    try {
      const sender = vi.fn();
      const run = createFollowupRunner(sender);
      const token = { isCancellationRequested: false };

      const promise = run(
        turnResult({ continuationRequested: true }),
        0,
        token,
      );

      // Advance partway, then trip cancellation.
      await vi.advanceTimersByTimeAsync(100);
      token.isCancellationRequested = true;
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS);

      const evaluation = await promise;
      expect(evaluation.shouldFollowup).toBe(false);
      expect(evaluation.reason).toBe('cancelled');
      expect(sender).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FollowupRunner gating (M60 §3.8)', () => {
  it('returns followup-disabled and never sleeps when followupEnabled=false', async () => {
    vi.useFakeTimers();
    try {
      const sender = vi.fn();
      const run = createFollowupRunner(sender, { followupEnabled: false });
      const promise = run(
        turnResult({ continuationRequested: true }),
        0,
      );
      // Should resolve without advancing timers, because the gate kicks in
      // before the FOLLOWUP_DELAY_MS wait.
      const evaluation = await promise;
      expect(evaluation.shouldFollowup).toBe(false);
      expect(evaluation.reason).toBe('followup-disabled');
      expect(sender).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
