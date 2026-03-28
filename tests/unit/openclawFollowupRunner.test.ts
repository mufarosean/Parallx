import { describe, expect, it, vi } from 'vitest';

import type { IOpenclawTurnResult } from '../../src/openclaw/openclawTurnRunner';
import {
  evaluateFollowup,
  createFollowupRunner,
  MAX_FOLLOWUP_DEPTH,
  FOLLOWUP_DELAY_MS,
  type IOpenclawFollowupRun,
} from '../../src/openclaw/openclawFollowupRunner';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTurnResult(overrides?: Partial<IOpenclawTurnResult>): IOpenclawTurnResult {
  return {
    markdown: 'Hello world',
    thinking: '',
    toolCallCount: 0,
    durationMs: 0,
    continuationRequested: false,
    ragSources: [],
    retrievedContextText: '',
    overflowCompactions: 0,
    timeoutCompactions: 0,
    transientRetries: 0,
    isSteeringTurn: false,
    isFollowupTurn: false,
    followupDepth: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluateFollowup tests
// ---------------------------------------------------------------------------

describe('evaluateFollowup', () => {
  it('returns turn-complete for a normal turn with no followup signals', () => {
    const result = evaluateFollowup(createTurnResult(), {
      currentDepth: 0,
    });

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('turn-complete');
  });

  it('suppresses followup when followupEnabled is false', () => {
    const result = evaluateFollowup(createTurnResult(), {
      currentDepth: 0,
      followupEnabled: false,
    });

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('followup-disabled');
  });

  it('suppresses followup for steering turns (D3 integration)', () => {
    const result = evaluateFollowup(
      createTurnResult({ isSteeringTurn: true }),
      { currentDepth: 0 },
    );

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('steer-suppressed');
  });

  it('suppresses followup when depth limit is reached', () => {
    const result = evaluateFollowup(createTurnResult(), {
      currentDepth: MAX_FOLLOWUP_DEPTH,
    });

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('depth-limit-reached');
  });

  it('suppresses followup when depth exceeds custom maxDepth', () => {
    const result = evaluateFollowup(createTurnResult(), {
      currentDepth: 3,
      maxDepth: 3,
    });

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('depth-limit-reached');
  });

  it('suppresses followup for empty responses', () => {
    const result = evaluateFollowup(
      createTurnResult({ markdown: '  ' }),
      { currentDepth: 0 },
    );

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('empty-response');
  });

  it('gate evaluation order: disabled > steer > depth > empty > signals', () => {
    // Disabled takes precedence even when steering and at depth limit
    const result = evaluateFollowup(
      createTurnResult({ isSteeringTurn: true, markdown: '', continuationRequested: true }),
      { currentDepth: MAX_FOLLOWUP_DEPTH, followupEnabled: false },
    );

    expect(result.reason).toBe('followup-disabled');
  });

  it('triggers followup when continuationRequested is true', () => {
    const result = evaluateFollowup(
      createTurnResult({ continuationRequested: true }),
      { currentDepth: 0 },
    );

    expect(result.shouldFollowup).toBe(true);
    expect(result.reason).toBe('tool-continuation');
    expect(result.message).toBeDefined();
  });

  it('does not trigger followup when continuationRequested is false', () => {
    const result = evaluateFollowup(
      createTurnResult({ continuationRequested: false }),
      { currentDepth: 0 },
    );

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('turn-complete');
  });

  it('steer still suppresses even with continuationRequested', () => {
    const result = evaluateFollowup(
      createTurnResult({ isSteeringTurn: true, continuationRequested: true }),
      { currentDepth: 0 },
    );

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('steer-suppressed');
  });

  it('depth limit still suppresses even with continuationRequested', () => {
    const result = evaluateFollowup(
      createTurnResult({ continuationRequested: true }),
      { currentDepth: MAX_FOLLOWUP_DEPTH },
    );

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('depth-limit-reached');
  });
});

// ---------------------------------------------------------------------------
// createFollowupRunner tests
// ---------------------------------------------------------------------------

describe('createFollowupRunner', () => {
  it('creates a runner function', () => {
    const sender = vi.fn();
    const runner = createFollowupRunner(sender);

    expect(typeof runner).toBe('function');
  });

  it('runner evaluates followup and returns evaluation', async () => {
    const sender = vi.fn();
    const runner = createFollowupRunner(sender);

    const evaluation = await runner(createTurnResult(), 0);

    expect(evaluation.shouldFollowup).toBe(false);
    expect(evaluation.reason).toBe('turn-complete');
  });

  it('runner respects followupEnabled option', async () => {
    const sender = vi.fn();
    const runner = createFollowupRunner(sender, { followupEnabled: false });

    const evaluation = await runner(createTurnResult(), 0);

    expect(evaluation.shouldFollowup).toBe(false);
    expect(evaluation.reason).toBe('followup-disabled');
    expect(sender).not.toHaveBeenCalled();
  });

  it('runner respects maxDepth option', async () => {
    const sender = vi.fn();
    const runner = createFollowupRunner(sender, { maxDepth: 2 });

    const evaluation = await runner(createTurnResult(), 2);

    expect(evaluation.shouldFollowup).toBe(false);
    expect(evaluation.reason).toBe('depth-limit-reached');
    expect(sender).not.toHaveBeenCalled();
  });

  it('runner calls sender when continuationRequested triggers followup', async () => {
    vi.useFakeTimers();
    const sender = vi.fn().mockResolvedValue(undefined);
    const runner = createFollowupRunner(sender);

    const promise = runner(createTurnResult({ continuationRequested: true }), 0);
    await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS);
    const evaluation = await promise;

    expect(evaluation.shouldFollowup).toBe(true);
    expect(evaluation.reason).toBe('tool-continuation');
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'tool-continuation',
        depth: 1,
        message: expect.any(String),
      }),
    );
    vi.useRealTimers();
  });

  it('runner applies FOLLOWUP_DELAY_MS before calling sender', async () => {
    vi.useFakeTimers();
    const sender = vi.fn().mockResolvedValue(undefined);
    const runner = createFollowupRunner(sender);

    const promise = runner(createTurnResult({ continuationRequested: true }), 0);

    // Sender should not be called yet (delay not elapsed)
    expect(sender).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS);
    await promise;

    expect(sender).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Constants tests
// ---------------------------------------------------------------------------

describe('followup constants', () => {
  it('MAX_FOLLOWUP_DEPTH is a reasonable limit', () => {
    expect(MAX_FOLLOWUP_DEPTH).toBeGreaterThanOrEqual(1);
    expect(MAX_FOLLOWUP_DEPTH).toBeLessThanOrEqual(20);
  });

  it('FOLLOWUP_DELAY_MS is a reasonable delay', () => {
    expect(FOLLOWUP_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(FOLLOWUP_DELAY_MS).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// D1 + D3 integration tests
// ---------------------------------------------------------------------------

describe('followup + steer integration', () => {
  it('steer turn always suppresses followup regardless of other conditions', () => {
    const result = evaluateFollowup(
      createTurnResult({ isSteeringTurn: true }),
      { currentDepth: 0, followupEnabled: true, maxDepth: 10 },
    );

    expect(result.shouldFollowup).toBe(false);
    expect(result.reason).toBe('steer-suppressed');
  });

  it('non-steer turn at depth 0 evaluates normally', () => {
    const result = evaluateFollowup(
      createTurnResult({ isSteeringTurn: false }),
      { currentDepth: 0 },
    );

    // Should reach the signal check, not be blocked by steer gate
    expect(result.reason).not.toBe('steer-suppressed');
  });
});
