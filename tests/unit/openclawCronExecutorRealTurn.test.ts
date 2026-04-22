/**
 * W4-real (M58-real) — Real-turn CronTurnExecutor tests.
 *
 * Validates:
 *   - `payload.agentTurn` set → ephemeral session + sendRequest + chat
 *     result card + purge. Status flash still fires at start.
 *   - `payload.agentTurn` unset → original thin path unchanged.
 *   - `contextLines` seeded into the user message.
 *   - Real-turn failure → error card delivered, purge runs, executor
 *     rethrows so CronService records success=false.
 *   - No active parent session → falls back to thin path.
 *   - Origin stamp ORIGIN_CRON on every delivery.
 */

import { describe, expect, it } from 'vitest';

import {
  createCronTurnExecutor,
  type ICronChatService,
} from '../../src/openclaw/openclawCronExecutor';
import {
  SurfaceRouterService,
  ORIGIN_CRON,
  getDeliveryOrigin,
} from '../../src/services/surfaceRouterService';
import {
  SURFACE_STATUS,
  SURFACE_NOTIFICATIONS,
  SURFACE_CHAT,
  type ISurfaceDelivery,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
} from '../../src/openclaw/openclawSurfacePlugin';
import type { ICronJob } from '../../src/openclaw/openclawCronService';
import type { IEphemeralSessionHandle, IEphemeralSessionSeed } from '../../src/services/chatService';
import { ChatContentPartKind, type IChatContentPart } from '../../src/services/chatTypes';

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
  async deliver(d: ISurfaceDelivery): Promise<boolean> { this.deliveries.push(d); return true; }
  dispose(): void {}
}

interface IFakeSession {
  readonly id: string;
  readonly messages: { response: { parts: readonly IChatContentPart[] } }[];
}

function buildFakeChat(opts: { respondWith?: string; throwOnSend?: Error } = {}) {
  const sessions = new Map<string, IFakeSession>();
  let c = 0;
  const calls = {
    create: [] as { parentId: string; seed?: IEphemeralSessionSeed }[],
    send: [] as { sessionId: string; message: string }[],
    purge: [] as IEphemeralSessionHandle[],
  };
  const chatService: ICronChatService = {
    createEphemeralSession(parentId, seed) {
      c += 1;
      const sid = `eph-c-${c}`;
      sessions.set(sid, { id: sid, messages: [] });
      calls.create.push({ parentId, seed });
      return { sessionId: sid, parentId, seed: seed ?? {} };
    },
    purgeEphemeralSession(h) { calls.purge.push(h); sessions.delete(h.sessionId); },
    async sendRequest(sid, msg) {
      calls.send.push({ sessionId: sid, message: msg });
      if (opts.throwOnSend) throw opts.throwOnSend;
      const s = sessions.get(sid);
      if (s && opts.respondWith !== undefined) {
        s.messages.push({
          response: {
            parts: [{ kind: ChatContentPartKind.Markdown, content: opts.respondWith } as IChatContentPart],
          },
        });
      }
      return {};
    },
    getSession(sid) { return sessions.get(sid); },
  };
  return { chatService, calls, sessions };
}

function mkJob(overrides?: Partial<ICronJob> & { agentTurn?: string | undefined }): ICronJob {
  return {
    id: 'job-1',
    name: overrides?.name ?? 'daily-summary',
    schedule: { kind: 'interval', intervalMs: 86_400_000 } as unknown as ICronJob['schedule'],
    payload: {
      agentTurn: overrides?.agentTurn === undefined ? 'count markdown files' : overrides.agentTurn,
    } as unknown as ICronJob['payload'],
    wakeMode: 'now',
    contextMessages: 0,
    enabled: true,
    createdAt: 0,
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    ...overrides,
  } as ICronJob;
}

function buildHarness(opts?: {
  parentId?: string | undefined;
  respondWith?: string;
  throwOnSend?: Error;
  withoutRealTurnDeps?: boolean;
}) {
  const router = new SurfaceRouterService();
  const status = new FakeSurfacePlugin(SURFACE_STATUS);
  const notifications = new FakeSurfacePlugin(SURFACE_NOTIFICATIONS);
  const chat = new FakeSurfacePlugin(SURFACE_CHAT);
  router.registerSurface(status);
  router.registerSurface(notifications);
  router.registerSurface(chat);

  const parentId = opts && 'parentId' in opts ? opts.parentId : 'parent-1';
  const chat_ = buildFakeChat({ respondWith: opts?.respondWith ?? 'Found 42 markdown files.', throwOnSend: opts?.throwOnSend });

  const executor = opts?.withoutRealTurnDeps
    ? createCronTurnExecutor(router)
    : createCronTurnExecutor(router, {
        chatService: chat_.chatService,
        getParentSessionId: () => parentId ?? undefined,
      });

  return { router, status, notifications, chat, executor, chat_ };
}

describe('CronTurnExecutor — real-turn retrofit (M58-real W4)', () => {
  it('agentTurn set: ephemeral session + sendRequest + chat result card + purge', async () => {
    const h = buildHarness();
    await h.executor(mkJob({ agentTurn: 'count markdown files' }), []);

    expect(h.chat_.calls.create).toHaveLength(1);
    expect(h.chat_.calls.create[0].parentId).toBe('parent-1');
    expect(h.chat_.calls.send).toHaveLength(1);
    expect(h.chat_.calls.send[0].message).toContain('Task: count markdown files');
    expect(h.chat_.calls.purge).toHaveLength(1);

    expect(h.chat.deliveries).toHaveLength(1);
    expect(h.chat.deliveries[0].content).toBe('Found 42 markdown files.');
    const md = h.chat.deliveries[0].metadata as Record<string, unknown>;
    expect(md.cronResult).toBe(true);
    expect(md.jobId).toBe('job-1');
    expect(md.jobName).toBe('daily-summary');
    expect(getDeliveryOrigin(h.chat.deliveries[0])).toBe(ORIGIN_CRON);

    // Status flash fired at start (no notification — real turn replaces it).
    expect(h.status.deliveries.length).toBeGreaterThanOrEqual(2); // flash + idle
    expect(h.notifications.deliveries).toHaveLength(0);
  });

  it('agentTurn unset: thin path unchanged (status + notification, no real turn)', async () => {
    const h = buildHarness();
    await h.executor(mkJob({ agentTurn: '' }), []);

    expect(h.chat_.calls.create).toHaveLength(0);
    expect(h.chat_.calls.send).toHaveLength(0);
    expect(h.chat.deliveries).toHaveLength(0);
    expect(h.notifications.deliveries).toHaveLength(1);
    expect(h.status.deliveries.length).toBeGreaterThanOrEqual(2);
  });

  it('contextLines seeded into user message', async () => {
    const h = buildHarness();
    await h.executor(
      mkJob({ agentTurn: 'summarize' }),
      ['user: last question', 'assistant: last answer'],
    );

    const msg = h.chat_.calls.send[0].message;
    expect(msg).toContain('Previous chat context:');
    expect(msg).toContain('user: last question');
    expect(msg).toContain('assistant: last answer');
    expect(msg).toContain('Task: summarize');
  });

  it('no active parent session: falls back to thin path', async () => {
    const h = buildHarness({ parentId: undefined });
    await h.executor(mkJob({ agentTurn: 'x' }), []);

    expect(h.chat_.calls.create).toHaveLength(0);
    expect(h.notifications.deliveries).toHaveLength(1);
  });

  it('real-turn failure: error card delivered, purge runs, executor rethrows', async () => {
    const h = buildHarness({ throwOnSend: new Error('LLM down') });
    await expect(h.executor(mkJob({ agentTurn: 'x' }), [])).rejects.toThrow('LLM down');

    expect(h.chat_.calls.purge).toHaveLength(1);
    expect(h.chat.deliveries).toHaveLength(1);
    expect(h.chat.deliveries[0].content).toContain('Cron turn error');
    expect(h.chat.deliveries[0].content).toContain('LLM down');
    const md = h.chat.deliveries[0].metadata as Record<string, unknown>;
    expect(md.error).toBe(true);
    expect(md.cronResult).toBe(true);
  });

  it('origin stamp ORIGIN_CRON on every delivery', async () => {
    const h = buildHarness();
    await h.executor(mkJob({ agentTurn: 'x' }), []);
    for (const d of h.router.deliveryHistory) {
      expect(getDeliveryOrigin(d)).toBe(ORIGIN_CRON);
    }
  });

  it('status flash fires before real turn completes (early visibility)', async () => {
    // Start a slow send; verify that the first status delivery lands BEFORE
    // the chat delivery.
    let resolveSend!: () => void;
    const sendGate = new Promise<void>((r) => { resolveSend = r; });

    const router = new SurfaceRouterService();
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    router.registerSurface(status);
    router.registerSurface(chat);

    const sessions = new Map<string, IFakeSession>();
    const chatService: ICronChatService = {
      createEphemeralSession(parentId, seed) {
        const sid = 'eph-slow';
        sessions.set(sid, { id: sid, messages: [] });
        return { sessionId: sid, parentId, seed: seed ?? {} };
      },
      purgeEphemeralSession() {},
      async sendRequest(sid) {
        await sendGate;
        const s = sessions.get(sid);
        if (s) {
          s.messages.push({
            response: {
              parts: [{ kind: ChatContentPartKind.Markdown, content: 'done' } as IChatContentPart],
            },
          });
        }
        return {};
      },
      getSession(sid) { return sessions.get(sid); },
    };

    const executor = createCronTurnExecutor(router, {
      chatService,
      getParentSessionId: () => 'parent-1',
    });
    const run = executor(mkJob({ agentTurn: 'slow' }), []);

    // Let microtasks flush — status flash should have landed already.
    await Promise.resolve();
    await Promise.resolve();
    expect(status.deliveries.length).toBeGreaterThan(0);
    expect(chat.deliveries).toHaveLength(0);

    resolveSend();
    await run;

    expect(chat.deliveries).toHaveLength(1);
  });

  it('factory called without realTurnDeps: thin fallback for agentTurn jobs', async () => {
    const h = buildHarness({ withoutRealTurnDeps: true });
    await h.executor(mkJob({ agentTurn: 'x' }), []);

    expect(h.chat.deliveries).toHaveLength(0);
    expect(h.notifications.deliveries).toHaveLength(1);
  });
});
