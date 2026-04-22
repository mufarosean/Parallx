/**
 * W1 (M58) — Integration test for FollowupRunner wiring into the default
 * participant.
 *
 * Proves:
 *   1. A turn result with continuationRequested=true causes a queued
 *      followup message on the chat service.
 *   2. Depth increments per continuation; at MAX_FOLLOWUP_DEPTH no further
 *      queue call is made.
 *   3. A steering turn never queues a followup, even with
 *      continuationRequested=true.
 *   4. A non-continuation turn after a continuation chain resets depth.
 *   5. When queueFollowupRequest is not provided, the evaluator is not
 *      invoked and no followup fires (defensive default).
 *
 * Upstream: followup-runner.ts gates + agent-runner-helpers.ts
 * finalizeWithFollowup post-turn hook.
 */

import { describe, expect, it, vi } from 'vitest';

import type { IOpenclawTurnResult } from '../../src/openclaw/openclawTurnRunner';
import { MAX_FOLLOWUP_DEPTH, FOLLOWUP_DELAY_MS } from '../../src/openclaw/openclawFollowupRunner';

// Mock the turn runner module so we can return controllable turn results
// without standing up the full bootstrap/tool/context pipeline.
const runOpenclawTurnMock = vi.fn<
  (request: unknown, context: unknown, response: unknown, token: unknown) => Promise<IOpenclawTurnResult>
>();

vi.mock('../../src/openclaw/openclawTurnRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/openclaw/openclawTurnRunner')>();
  return {
    ...actual,
    runOpenclawTurn: (...args: unknown[]) => runOpenclawTurnMock(...(args as [unknown, unknown, unknown, unknown])),
  };
});

// Imports must come after the vi.mock declaration.
import { ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import { createOpenclawDefaultParticipant } from '../../src/openclaw/participants/openclawDefaultParticipant';
import type { IDefaultParticipantServices } from '../../src/openclaw/openclawTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createResponse(): IChatResponseStream {
  const markdownParts: string[] = [];
  return {
    markdown: vi.fn((value: string) => { markdownParts.push(value); }),
    codeBlock: vi.fn(),
    progress: vi.fn(),
    provenance: vi.fn(),
    reference: vi.fn(),
    thinking: vi.fn(),
    warning: vi.fn(),
    button: vi.fn(),
    confirmation: vi.fn(),
    beginToolInvocation: vi.fn(),
    updateToolInvocation: vi.fn(),
    editProposal: vi.fn(),
    editBatch: vi.fn(),
    push: vi.fn(),
    replaceLastMarkdown: vi.fn(),
    throwIfDone: vi.fn(),
    reportTokenUsage: vi.fn(),
    setCitations: vi.fn(),
    getMarkdownText: vi.fn(() => markdownParts.join('')),
  };
}

function createToken(): ICancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

async function* streamChunks(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> {
  for (const chunk of chunks) { yield chunk; }
}

function createTurnResult(overrides?: Partial<IOpenclawTurnResult>): IOpenclawTurnResult {
  return {
    markdown: 'assistant reply',
    thinking: '',
    toolCallCount: 0,
    durationMs: 10,
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

interface ITestHarness {
  services: IDefaultParticipantServices;
  participant: ReturnType<typeof createOpenclawDefaultParticipant>;
  queueFollowupRequest: ReturnType<typeof vi.fn>;
}

function createHarness(options?: { withQueue?: boolean }): ITestHarness {
  const withQueue = options?.withQueue ?? true;
  const queueFollowupRequest = vi.fn();
  const services: IDefaultParticipantServices = {
    sendChatRequest: () => streamChunks([{ content: 'unused', done: true }]),
    getActiveModel: () => 'test-model',
    getWorkspaceName: () => 'Demo',
    getPageCount: vi.fn(async () => 0),
    getCurrentPageTitle: () => undefined,
    getToolDefinitions: () => [],
    getReadOnlyToolDefinitions: () => [],
    readFileRelative: vi.fn(async () => null),
    unifiedConfigService: {
      getEffectiveConfig: () => ({ chat: {}, model: { temperature: 0.2, maxTokens: 512 } } as any),
    } as any,
    getModelContextLength: () => 32000,
    reportRuntimeTrace: vi.fn(),
    ...(withQueue ? { queueFollowupRequest } : {}),
  } as IDefaultParticipantServices;

  const participant = createOpenclawDefaultParticipant(services);
  return { services, participant, queueFollowupRequest };
}

async function runTurn(
  participant: ReturnType<typeof createOpenclawDefaultParticipant>,
  sessionId: string,
  overrides?: Partial<IChatParticipantRequest>,
): Promise<void> {
  const request: IChatParticipantRequest = {
    text: 'hello',
    requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    mode: ChatMode.Agent,
    modelId: 'test-model',
    attempt: 0,
    ...overrides,
  } as IChatParticipantRequest;
  const context: IChatParticipantContext = { sessionId, history: [] } as IChatParticipantContext;
  await participant.handler(request, context, createResponse(), createToken());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('W1 FollowupRunner wiring → default participant', () => {
  it('queues a followup when the turn reports continuationRequested', async () => {
    vi.useFakeTimers();
    try {
      const { participant, queueFollowupRequest } = createHarness();
      runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));

      const turn = runTurn(participant, 'sess-1');
      // Flush the FOLLOWUP_DELAY_MS inside the runner
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
      await turn;

      expect(queueFollowupRequest).toHaveBeenCalledTimes(1);
      expect(queueFollowupRequest).toHaveBeenCalledWith('sess-1', expect.any(String));
      expect(queueFollowupRequest.mock.calls[0][1].length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not queue a followup when continuationRequested is false', async () => {
    const { participant, queueFollowupRequest } = createHarness();
    runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: false }));

    await runTurn(participant, 'sess-2');

    expect(queueFollowupRequest).not.toHaveBeenCalled();
  });

  it('increments depth per continuation and stops at MAX_FOLLOWUP_DEPTH', async () => {
    vi.useFakeTimers();
    try {
      const { participant, queueFollowupRequest } = createHarness();

      // Drive MAX_FOLLOWUP_DEPTH+1 continuation turns in a single chain.
      // The first MAX_FOLLOWUP_DEPTH turns queue followups; the next turn
      // hits the depth cap and suppresses the followup (and simultaneously
      // ends the chain, resetting depth).
      for (let i = 0; i < MAX_FOLLOWUP_DEPTH + 1; i++) {
        runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));
        const turn = runTurn(participant, 'sess-cap');
        await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
        await turn;
      }

      expect(queueFollowupRequest).toHaveBeenCalledTimes(MAX_FOLLOWUP_DEPTH);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never queues a followup on a steering turn, even with continuationRequested', async () => {
    vi.useFakeTimers();
    try {
      const { participant, queueFollowupRequest } = createHarness();
      runOpenclawTurnMock.mockResolvedValueOnce(
        createTurnResult({ continuationRequested: true, isSteeringTurn: true }),
      );

      const turn = runTurn(participant, 'sess-steer', { isSteeringTurn: true });
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
      await turn;

      expect(queueFollowupRequest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets depth after a chain ends, allowing a fresh chain to reach the cap again', async () => {
    vi.useFakeTimers();
    try {
      const { participant, queueFollowupRequest } = createHarness();

      // Chain 1: MAX_FOLLOWUP_DEPTH continuations
      for (let i = 0; i < MAX_FOLLOWUP_DEPTH; i++) {
        runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));
        const turn = runTurn(participant, 'sess-reset');
        await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
        await turn;
      }
      // Chain 1 terminator: continuationRequested=false resets depth
      runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: false }));
      await runTurn(participant, 'sess-reset');

      const afterChain1 = queueFollowupRequest.mock.calls.length;
      expect(afterChain1).toBe(MAX_FOLLOWUP_DEPTH);

      // Chain 2: should be able to queue again because depth was reset
      runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));
      const turn2 = runTurn(participant, 'sess-reset');
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
      await turn2;

      expect(queueFollowupRequest).toHaveBeenCalledTimes(MAX_FOLLOWUP_DEPTH + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks depth per session independently', async () => {
    vi.useFakeTimers();
    try {
      const { participant, queueFollowupRequest } = createHarness();

      // Session A: reach the cap
      for (let i = 0; i < MAX_FOLLOWUP_DEPTH; i++) {
        runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));
        const turn = runTurn(participant, 'sess-A');
        await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
        await turn;
      }
      // Session A: at cap, next should NOT queue
      runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));
      const turnAtCap = runTurn(participant, 'sess-A');
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
      await turnAtCap;
      expect(queueFollowupRequest.mock.calls.filter(c => c[0] === 'sess-A').length)
        .toBe(MAX_FOLLOWUP_DEPTH);

      // Session B: should start at depth 0 and queue
      runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));
      const turnB = runTurn(participant, 'sess-B');
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 10);
      await turnB;
      expect(queueFollowupRequest.mock.calls.filter(c => c[0] === 'sess-B').length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when queueFollowupRequest is not wired (no chat service)', async () => {
    const { participant } = createHarness({ withQueue: false });
    runOpenclawTurnMock.mockResolvedValueOnce(createTurnResult({ continuationRequested: true }));

    // Should not throw and should return normally.
    await expect(runTurn(participant, 'sess-no-queue')).resolves.toBeUndefined();
  });
});
