/**
 * W2-real (M58-real) — Real-turn HeartbeatTurnExecutor tests.
 *
 * Validates the §6.5-superseded reason→behavior matrix:
 *   - interval: status-only (no ephemeral session)
 *   - cron: no-op
 *   - system-event / wake / hook: real turn via substrate + debounce
 *     (system-event only) + origin-stamped chat delivery + purge-on-finally
 *
 * Upstream reference: heartbeat-runner.ts turn invocation; Parallx adapts
 * onto the W5 ephemeral substrate (see openclawSubagentExecutor.ts).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  createHeartbeatTurnExecutor,
  type IHeartbeatChatService,
} from '../../src/openclaw/openclawHeartbeatExecutor';
import {
  SurfaceRouterService,
  ORIGIN_HEARTBEAT,
  getDeliveryOrigin,
} from '../../src/services/surfaceRouterService';
import {
  SURFACE_STATUS,
  SURFACE_CHAT,
  type ISurfaceDelivery,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
} from '../../src/openclaw/openclawSurfacePlugin';
import type {
  HeartbeatReason,
  IHeartbeatSystemEvent,
} from '../../src/openclaw/openclawHeartbeatRunner';
import type {
  IEphemeralSessionHandle,
  IEphemeralSessionSeed,
} from '../../src/services/chatService';
import { ChatContentPartKind, type IChatContentPart } from '../../src/services/chatTypes';

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

class FakeSurfacePlugin implements ISurfacePlugin {
  readonly deliveries: ISurfaceDelivery[] = [];
  constructor(
    readonly id: string,
    readonly capabilities: ISurfaceCapabilities = {
      supportsText: true,
      supportsStructured: false,
      supportsBinary: false,
      supportsActions: false,
    },
  ) {}
  isAvailable(): boolean { return true; }
  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    this.deliveries.push(delivery);
    return true;
  }
  dispose(): void {}
}

interface IFakeSession {
  readonly id: string;
  readonly messages: { response: { parts: readonly IChatContentPart[] } }[];
}

function buildFakeChatService(opts: {
  parentId?: string;
  respondWith?: string;
  throwOnSend?: Error;
}): {
  chatService: IHeartbeatChatService;
  calls: {
    createEphemeralSession: { parentId: string; seed?: IEphemeralSessionSeed }[];
    sendRequest: { sessionId: string; message: string }[];
    purgeEphemeralSession: IEphemeralSessionHandle[];
  };
  sessions: Map<string, IFakeSession>;
} {
  const sessions = new Map<string, IFakeSession>();
  let counter = 0;
  const calls = {
    createEphemeralSession: [] as { parentId: string; seed?: IEphemeralSessionSeed }[],
    sendRequest: [] as { sessionId: string; message: string }[],
    purgeEphemeralSession: [] as IEphemeralSessionHandle[],
  };

  const chatService: IHeartbeatChatService = {
    createEphemeralSession(parentId, seed) {
      counter += 1;
      const sid = `eph-${counter}`;
      const session: IFakeSession = { id: sid, messages: [] };
      sessions.set(sid, session);
      calls.createEphemeralSession.push({ parentId, seed });
      return { sessionId: sid, parentId, seed: seed ?? {} };
    },
    purgeEphemeralSession(handle) {
      calls.purgeEphemeralSession.push(handle);
      sessions.delete(handle.sessionId);
    },
    async sendRequest(sessionId, message) {
      calls.sendRequest.push({ sessionId, message });
      if (opts.throwOnSend) throw opts.throwOnSend;
      const session = sessions.get(sessionId);
      if (session && opts.respondWith !== undefined) {
        session.messages.push({
          response: {
            parts: [
              { kind: ChatContentPartKind.Markdown, content: opts.respondWith } as IChatContentPart,
            ],
          },
        });
      }
      return {};
    },
    getSession(sid) {
      return sessions.get(sid);
    },
  };

  return { chatService, calls, sessions };
}

function buildHarness(overrides?: {
  parentId?: string | undefined;
  respondWith?: string;
  throwOnSend?: Error;
  reasons?: HeartbeatReason[];
  debounceMs?: number;
  nowRef?: { value: number };
}) {
  const router = new SurfaceRouterService();
  const status = new FakeSurfacePlugin(SURFACE_STATUS);
  const chat = new FakeSurfacePlugin(SURFACE_CHAT);
  router.registerSurface(status);
  router.registerSurface(chat);

  const parentId = overrides && 'parentId' in overrides ? overrides.parentId : 'parent-1';
  const chat_ = buildFakeChatService({
    parentId: parentId ?? undefined,
    respondWith: overrides?.respondWith ?? 'Investigated. All clear.',
    throwOnSend: overrides?.throwOnSend,
  });

  const reasons = overrides?.reasons ?? ['interval', 'system-event', 'cron', 'wake', 'hook'];
  const nowRef = overrides?.nowRef ?? { value: 1_000_000 };

  const executor = createHeartbeatTurnExecutor(
    router,
    () => ({ reasons }),
    {
      chatService: chat_.chatService,
      getParentSessionId: () => parentId ?? undefined,
      debounceMs: overrides?.debounceMs,
      now: () => nowRef.value,
    },
  );

  return { router, status, chat, executor, chat_, nowRef };
}

function mkEvent(path: string, type = 'file-change'): IHeartbeatSystemEvent {
  return { type, payload: { path }, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeartbeatTurnExecutor — real-turn retrofit (M58-real W2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('interval reason: status-only pulse, no ephemeral session created', async () => {
    const h = buildHarness();
    await h.executor([], 'interval');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
    expect(h.chat_.calls.sendRequest).toHaveLength(0);
    expect(h.chat.deliveries).toHaveLength(0);
    // status flash + idle = 2 deliveries
    expect(h.status.deliveries.length).toBe(2);
    for (const d of h.status.deliveries) {
      expect(getDeliveryOrigin(d)).toBe(ORIGIN_HEARTBEAT);
    }
  });

  it('cron reason: complete no-op (delegated)', async () => {
    const h = buildHarness();
    await h.executor([], 'cron');
    expect(h.status.deliveries).toHaveLength(0);
    expect(h.chat.deliveries).toHaveLength(0);
    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
  });

  it('system-event reason: creates ephemeral session, runs sendRequest, delivers result, purges', async () => {
    const h = buildHarness();
    await h.executor([mkEvent('/foo.ts')], 'system-event');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(1);
    expect(h.chat_.calls.createEphemeralSession[0].parentId).toBe('parent-1');
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
    expect(h.chat_.calls.purgeEphemeralSession).toHaveLength(1);

    const chatDeliveries = h.chat.deliveries;
    expect(chatDeliveries).toHaveLength(1);
    expect(chatDeliveries[0].content).toBe('Investigated. All clear.');
    const md = chatDeliveries[0].metadata as Record<string, unknown>;
    expect(md.heartbeatResult).toBe(true);
    expect(md.reason).toBe('system-event');
    expect(md.eventKind).toBe('file-change');
    expect(md.parentSessionId).toBe('parent-1');
    expect(getDeliveryOrigin(chatDeliveries[0])).toBe(ORIGIN_HEARTBEAT);
  });

  it('wake reason: runs real turn with user-intent framing', async () => {
    const h = buildHarness();
    await h.executor([], 'wake');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(1);
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
    expect(h.chat_.calls.sendRequest[0].message).toContain('[heartbeat wake]');
    expect(h.chat.deliveries).toHaveLength(1);
    expect((h.chat.deliveries[0].metadata as Record<string, unknown>).reason).toBe('wake');
  });

  it('hook reason: runs real turn', async () => {
    const h = buildHarness();
    await h.executor([], 'hook');
    expect(h.chat_.calls.createEphemeralSession).toHaveLength(1);
    expect((h.chat.deliveries[0].metadata as Record<string, unknown>).reason).toBe('hook');
  });

  it('debounce: same path fired twice within 30s → one real turn', async () => {
    const nowRef = { value: 1_000_000 };
    const h = buildHarness({ debounceMs: 30_000, nowRef });

    await h.executor([mkEvent('/a.ts')], 'system-event');
    nowRef.value += 10_000; // +10s
    await h.executor([mkEvent('/a.ts')], 'system-event');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(1);
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
  });

  it('debounce: different paths do not debounce each other', async () => {
    const nowRef = { value: 1_000_000 };
    const h = buildHarness({ debounceMs: 30_000, nowRef });

    await h.executor([mkEvent('/a.ts')], 'system-event');
    nowRef.value += 5_000;
    await h.executor([mkEvent('/b.ts')], 'system-event');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(2);
  });

  it('debounce: window expires → fires again', async () => {
    const nowRef = { value: 1_000_000 };
    const h = buildHarness({ debounceMs: 30_000, nowRef });

    await h.executor([mkEvent('/a.ts')], 'system-event');
    nowRef.value += 31_000;
    await h.executor([mkEvent('/a.ts')], 'system-event');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(2);
  });

  it('wake is not debounced', async () => {
    const nowRef = { value: 1_000_000 };
    const h = buildHarness({ debounceMs: 30_000, nowRef });

    await h.executor([], 'wake');
    await h.executor([], 'wake');
    expect(h.chat_.calls.sendRequest).toHaveLength(2);
  });

  it('no active parent session: skip real turn cleanly, no error', async () => {
    const h = buildHarness({ parentId: undefined });
    await h.executor([mkEvent('/x.ts')], 'system-event');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
    expect(h.chat_.calls.sendRequest).toHaveLength(0);
    // Still emitted status flash + idle.
    expect(h.status.deliveries.length).toBeGreaterThanOrEqual(2);
    expect(h.chat.deliveries).toHaveLength(0);
  });

  it('sendRequest throws: purge still runs, error delivered as clean card', async () => {
    const h = buildHarness({ throwOnSend: new Error('model offline') });
    await h.executor([mkEvent('/x.ts')], 'system-event');

    expect(h.chat_.calls.purgeEphemeralSession).toHaveLength(1);
    expect(h.chat.deliveries).toHaveLength(1);
    expect(h.chat.deliveries[0].content).toContain('Heartbeat turn error');
    expect(h.chat.deliveries[0].content).toContain('model offline');
    const md = h.chat.deliveries[0].metadata as Record<string, unknown>;
    expect(md.error).toBe(true);
    expect(md.heartbeatResult).toBe(true);
  });

  it('origin stamp: every delivery carries ORIGIN_HEARTBEAT', async () => {
    const h = buildHarness();
    await h.executor([mkEvent('/x.ts')], 'system-event');
    for (const d of h.router.deliveryHistory) {
      expect(getDeliveryOrigin(d)).toBe(ORIGIN_HEARTBEAT);
    }
  });

  it('loop-safety: heartbeat-origin deliveries are distinguishable from user/agent', async () => {
    const h = buildHarness();
    await h.executor([mkEvent('/x.ts')], 'system-event');
    await h.executor([], 'wake');

    const hb = h.router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT);
    expect(hb.length).toBeGreaterThan(0);
    // Nothing else in history.
    expect(hb.length).toBe(h.router.deliveryHistory.length);
  });

  it('reasons allowlist blocks all paths (including real turn reasons)', async () => {
    const h = buildHarness({ reasons: ['interval'] });
    await h.executor([mkEvent('/x.ts')], 'system-event');
    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
    expect(h.status.deliveries).toHaveLength(0);
  });
});
