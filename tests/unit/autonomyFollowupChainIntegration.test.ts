// autonomyFollowupChainIntegration.test.ts — M60 §3.10 + §3.11 DoD
//
// End-to-end (within renderer-process boundaries) integration: a followup
// chain runs, every post-turn evaluation emits an autonomy event record,
// and the records reflect the chain shape (completed → completed → ... →
// completed-without-continuation OR cancelled).

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IOpenclawTurnResult } from '../../src/openclaw/openclawTurnRunner';

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
import { FOLLOWUP_DELAY_MS } from '../../src/openclaw/openclawFollowupRunner';
import type { IAutonomyEventInput, IAutonomyEventRecord } from '../../src/services/autonomyEventLog';

function createResponse(): IChatResponseStream {
  const acc: string[] = [];
  return {
    markdown: vi.fn((v: string) => { acc.push(v); }),
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
    getMarkdownText: vi.fn(() => acc.join('')),
  };
}

function createToken(): ICancellationToken & { trip: () => void } {
  let cancelled = false;
  return {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested: (() => ({ dispose: vi.fn() })) as never,
    trip: () => { cancelled = true; },
  } as unknown as ICancellationToken & { trip: () => void };
}

async function* streamChunks(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> {
  for (const c of chunks) yield c;
}

function turn(overrides?: Partial<IOpenclawTurnResult>): IOpenclawTurnResult {
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

interface IHarness {
  participant: ReturnType<typeof createOpenclawDefaultParticipant>;
  events: IAutonomyEventRecord[];
  flagsOn: { followup: boolean };
  queue: ReturnType<typeof vi.fn>;
}

function createHarness(opts?: { followupOn?: boolean }): IHarness {
  const events: IAutonomyEventRecord[] = [];
  const flagsOn = { followup: opts?.followupOn ?? true };
  const queue = vi.fn();
  let seq = 0;
  const services: IDefaultParticipantServices = {
    sendChatRequest: () => streamChunks([{ content: '', done: true }]),
    getActiveModel: () => 'm',
    getWorkspaceName: () => 'W',
    getPageCount: vi.fn(async () => 0),
    getCurrentPageTitle: () => undefined,
    getToolDefinitions: () => [],
    getReadOnlyToolDefinitions: () => [],
    readFileRelative: vi.fn(async () => null),
    unifiedConfigService: { getEffectiveConfig: () => ({ chat: {}, model: { temperature: 0.2, maxTokens: 256 } }) } as never,
    getModelContextLength: () => 32000,
    reportRuntimeTrace: vi.fn(),
    queueFollowupRequest: queue,
    isAutonomyFlagEnabled: (id: string) => id === 'autonomy.followup.enabled' ? flagsOn.followup : true,
    emitAutonomyEvent: (input: IAutonomyEventInput) => {
      events.push({
        id: `e-${++seq}`,
        triggeredAt: new Date().toISOString(),
        ...input,
      });
    },
  } as IDefaultParticipantServices;
  const participant = createOpenclawDefaultParticipant(services);
  return { participant, events, flagsOn, queue };
}

async function runOne(participant: IHarness['participant'], token: ICancellationToken): Promise<void> {
  const request = { text: 'go', requestId: `r-${Math.random().toString(36).slice(2, 8)}`, mode: ChatMode.Agent, modelId: 'm', attempt: 0 } as IChatParticipantRequest;
  const context = { sessionId: 's', history: [] } as IChatParticipantContext;
  await participant.handler(request, context, createResponse(), token);
}

describe('Autonomy followup chain integration (M60 §3.10 + §3.11)', () => {
  beforeEach(() => {
    runOpenclawTurnMock.mockReset();
  });

  it('emits one event per turn across a 2-turn followup chain', async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness();
      runOpenclawTurnMock
        .mockResolvedValueOnce(turn({ continuationRequested: true }))
        .mockResolvedValueOnce(turn({ continuationRequested: false }));

      const t = createToken();
      const p1 = runOne(h.participant, t);
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 20);
      await p1;
      expect(h.queue).toHaveBeenCalledTimes(1);

      const p2 = runOne(h.participant, t);
      await vi.advanceTimersByTimeAsync(FOLLOWUP_DELAY_MS + 20);
      await p2;

      expect(h.events).toHaveLength(2);
      expect(h.events[0].outcome).toBe('completed');
      expect(h.events[0].trigger.kind).toBe('followup');
      expect(h.events[1].outcome).toBe('completed');
      // Second event's note records the no-followup reason.
      expect(h.events[1].note).toBe('turn-complete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits a gated event when autonomy.followup.enabled=false (no FOLLOWUP_DELAY_MS wait)', async () => {
    const h = createHarness({ followupOn: false });
    runOpenclawTurnMock.mockResolvedValueOnce(turn({ continuationRequested: true }));

    const t = createToken();
    await runOne(h.participant, t);

    expect(h.queue).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(1);
    expect(h.events[0].outcome).toBe('gated');
    expect(h.events[0].note).toMatch(/autonomy\.followup\.enabled=false/);
  });

  it('emits a cancelled event when the token trips before evaluation', async () => {
    const h = createHarness();

    const t = createToken();
    // Trip cancellation before the participant returns from runOpenclawTurn.
    runOpenclawTurnMock.mockImplementationOnce(async () => {
      t.trip();
      return turn({ continuationRequested: true });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await runOne(h.participant, t);
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(h.queue).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(1);
    expect(h.events[0].outcome).toBe('cancelled');
  });
});
