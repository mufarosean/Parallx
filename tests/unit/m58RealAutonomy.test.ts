/**
 * M58-real — Integration scenarios for heartbeat + cron real turns.
 *
 * Proves the autonomy vision end-to-end without spinning up the full
 * workbench:
 *
 *   1. File-save (system-event) → heartbeat real turn → heartbeatResult
 *      card delivered to parent chat via ORIGIN_HEARTBEAT.
 *   2. Cron with `agentTurn` → real turn → cronResult card via
 *      ORIGIN_CRON.
 *   3. Both scenarios leave `chatService.getSessions()` showing ONLY the
 *      original parent session (no ephemeral leaks).
 *   4. Depth safety: a heartbeat real turn's own delivery does not
 *      re-enter the heartbeat event queue (event sources and router
 *      history are structurally disjoint).
 *
 * We use the real `ChatService` class to exercise the ephemeral-session
 * substrate (createEphemeralSession / purgeEphemeralSession / getSessions
 * filter) end-to-end. The LLM turn itself is mocked at the
 * `sendRequest` boundary to return a canned response.
 */

import { describe, expect, it } from 'vitest';

import { ChatService } from '../../src/services/chatService';
import {
  SurfaceRouterService,
  ORIGIN_HEARTBEAT,
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
import { createHeartbeatTurnExecutor } from '../../src/openclaw/openclawHeartbeatExecutor';
import { createCronTurnExecutor } from '../../src/openclaw/openclawCronExecutor';
import { HeartbeatRunner, type IHeartbeatConfig } from '../../src/openclaw/openclawHeartbeatRunner';
import { CronService, type ICronJob } from '../../src/openclaw/openclawCronService';
import type { IChatAgentService } from '../../src/services/chatAgent';
import type { IChatModeService } from '../../src/services/chatMode';
import type { ILanguageModelsService } from '../../src/services/languageModels';
import { ChatMode } from '../../src/services/chatTypes';
import { ChatContentPartKind, type IChatContentPart } from '../../src/services/chatTypes';

// ---------------------------------------------------------------------------
// Shared fakes
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
  async deliver(d: ISurfaceDelivery): Promise<boolean> { this.deliveries.push(d); return true; }
  dispose(): void {}
}

function buildFakeAgentService(): IChatAgentService {
  return {
    getAgent: () => undefined,
    getAgents: () => [],
    getDefaultAgent: () => undefined,
    registerAgent: () => ({ dispose: () => {} }),
  } as unknown as IChatAgentService;
}

function buildFakeModeService(): IChatModeService {
  return {
    getMode: () => ChatMode.Ask,
    setMode: () => {},
    onDidChangeMode: () => ({ dispose: () => {} }),
  } as unknown as IChatModeService;
}

function buildFakeLanguageModels(): ILanguageModelsService {
  return {
    getActiveModel: () => 'test-model',
    setActiveModel: () => {},
    getAvailableModels: () => [],
    onDidChangeActiveModel: () => ({ dispose: () => {} }),
  } as unknown as ILanguageModelsService;
}

/**
 * Build a ChatService subclass that intercepts `sendRequest` so we don't
 * need the real participant pipeline. The intercept appends a mock
 * assistant response to the target session's messages so
 * `getSession(sessionId).messages[last].response.parts` is the canned
 * text that heartbeat/cron executors extract.
 */
function buildChatServiceWithMockedTurns(respondWith: string): ChatService {
  const svc = new ChatService(
    buildFakeAgentService(),
    buildFakeModeService(),
    buildFakeLanguageModels(),
  );

  (svc as unknown as {
    sendRequest: (sid: string, msg: string) => Promise<unknown>;
  }).sendRequest = async (sessionId: string, message: string): Promise<unknown> => {
    const session = svc.getSession(sessionId);
    if (!session) throw new Error(`no session ${sessionId}`);
    // Mimic the pair shape: push a request + response into messages[].
    const part: IChatContentPart = { kind: ChatContentPartKind.Markdown, content: respondWith };
    (session.messages as unknown as { request: unknown; response: unknown }[]).push({
      request: { requestId: 'r-1', text: message },
      response: { parts: [part] },
    });
    return { participant: 'test', requestId: 'r-1' };
  };

  return svc;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('M58-real integration scenarios', () => {
  it('file-save triggers heartbeat real turn and delivers heartbeatResult card', async () => {
    const chatService = buildChatServiceWithMockedTurns('Looked at /foo.ts — no action needed.');
    const parent = chatService.createSession();

    const router = new SurfaceRouterService();
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    router.registerSurface(status);
    router.registerSurface(chat);

    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['interval', 'system-event', 'cron', 'wake', 'hook'] }),
      {
        chatService: {
          createEphemeralSession: (pid, seed) => chatService.createEphemeralSession(pid, seed),
          purgeEphemeralSession: (h) => chatService.purgeEphemeralSession(h),
          sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
          getSession: (sid) => chatService.getSession(sid),
        },
        getParentSessionId: () => parent.id,
      },
    );

    const cfg = (): IHeartbeatConfig => ({ enabled: true, intervalMs: 60_000 });
    const runner = new HeartbeatRunner(executor, cfg);
    runner.start();

    runner.pushEvent({
      type: 'file-change',
      payload: { path: '/foo.ts', changeType: 'changed' },
      timestamp: Date.now(),
    });

    // Let the immediate system-event tick run.
    await new Promise((r) => setTimeout(r, 10));

    const chatDeliveries = chat.deliveries.filter((d) => getDeliveryOrigin(d) === ORIGIN_HEARTBEAT);
    expect(chatDeliveries).toHaveLength(1);
    expect(chatDeliveries[0].content).toBe('Looked at /foo.ts — no action needed.');
    const md = chatDeliveries[0].metadata as Record<string, unknown>;
    expect(md.heartbeatResult).toBe(true);
    expect(md.reason).toBe('system-event');
    expect(md.eventKind).toBe('file-change');
    expect(md.parentSessionId).toBe(parent.id);

    // No session pollution.
    expect(chatService.getSessions().map((s) => s.id)).toEqual([parent.id]);

    runner.dispose();
    chatService.dispose();
  });

  it('cron with agentTurn runs real turn and delivers cronResult card', async () => {
    const chatService = buildChatServiceWithMockedTurns('Found 42 markdown files.');
    const parent = chatService.createSession();

    const router = new SurfaceRouterService();
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    const notifications = new FakeSurfacePlugin(SURFACE_NOTIFICATIONS);
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    router.registerSurface(status);
    router.registerSurface(notifications);
    router.registerSurface(chat);

    const cronExecutor = createCronTurnExecutor(router, {
      chatService: {
        createEphemeralSession: (pid, seed) => chatService.createEphemeralSession(pid, seed),
        purgeEphemeralSession: (h) => chatService.purgeEphemeralSession(h),
        sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
        getSession: (sid) => chatService.getSession(sid),
      },
      getParentSessionId: () => parent.id,
    });

    const cronService = new CronService(
      cronExecutor,
      async () => [],
      undefined,
    );

    const job: ICronJob = {
      id: 'j1',
      name: 'md-count',
      schedule: { kind: 'interval', intervalMs: 60_000 } as unknown as ICronJob['schedule'],
      payload: { agentTurn: 'count markdown files' } as unknown as ICronJob['payload'],
      wakeMode: 'now',
      contextMessages: 0,
      enabled: true,
      createdAt: 0,
      lastRunAt: null,
      nextRunAt: null,
      runCount: 0,
    } as ICronJob;

    await cronExecutor(job, []);

    const chatDeliveries = chat.deliveries.filter((d) => getDeliveryOrigin(d) === ORIGIN_CRON);
    expect(chatDeliveries).toHaveLength(1);
    expect(chatDeliveries[0].content).toBe('Found 42 markdown files.');
    const md = chatDeliveries[0].metadata as Record<string, unknown>;
    expect(md.cronResult).toBe(true);
    expect(md.jobId).toBe('j1');
    expect(md.jobName).toBe('md-count');

    // No session pollution — only the parent.
    expect(chatService.getSessions().map((s) => s.id)).toEqual([parent.id]);

    cronService.dispose();
    chatService.dispose();
  });

  it('no session pollution across both scenarios', async () => {
    const chatService = buildChatServiceWithMockedTurns('done');
    const parent = chatService.createSession();

    const router = new SurfaceRouterService();
    router.registerSurface(new FakeSurfacePlugin(SURFACE_STATUS));
    router.registerSurface(new FakeSurfacePlugin(SURFACE_NOTIFICATIONS));
    router.registerSurface(new FakeSurfacePlugin(SURFACE_CHAT));

    const hbExecutor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['interval', 'system-event', 'cron', 'wake', 'hook'] }),
      {
        chatService: {
          createEphemeralSession: (pid, seed) => chatService.createEphemeralSession(pid, seed),
          purgeEphemeralSession: (h) => chatService.purgeEphemeralSession(h),
          sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
          getSession: (sid) => chatService.getSession(sid),
        },
        getParentSessionId: () => parent.id,
      },
    );
    const cronExecutor = createCronTurnExecutor(router, {
      chatService: {
        createEphemeralSession: (pid, seed) => chatService.createEphemeralSession(pid, seed),
        purgeEphemeralSession: (h) => chatService.purgeEphemeralSession(h),
        sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
        getSession: (sid) => chatService.getSession(sid),
      },
      getParentSessionId: () => parent.id,
    });

    await hbExecutor([{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }], 'system-event');
    await hbExecutor([], 'wake');
    await cronExecutor(
      {
        id: 'j',
        name: 'x',
        schedule: { kind: 'interval', intervalMs: 60_000 } as unknown as ICronJob['schedule'],
        payload: { agentTurn: 'y' } as unknown as ICronJob['payload'],
        wakeMode: 'now',
        contextMessages: 0,
        enabled: true,
        createdAt: 0,
        lastRunAt: null,
        nextRunAt: null,
        runCount: 0,
      } as ICronJob,
      [],
    );

    expect(chatService.getSessions().map((s) => s.id)).toEqual([parent.id]);
    chatService.dispose();
  });

  it('depth safety: heartbeat-origin chat deliveries do not re-enter heartbeat event queue', async () => {
    const chatService = buildChatServiceWithMockedTurns('ok');
    const parent = chatService.createSession();

    const router = new SurfaceRouterService();
    router.registerSurface(new FakeSurfacePlugin(SURFACE_STATUS));
    router.registerSurface(new FakeSurfacePlugin(SURFACE_CHAT));

    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['interval', 'system-event', 'cron', 'wake', 'hook'] }),
      {
        chatService: {
          createEphemeralSession: (pid, seed) => chatService.createEphemeralSession(pid, seed),
          purgeEphemeralSession: (h) => chatService.purgeEphemeralSession(h),
          sendRequest: (sid, msg, opts) => chatService.sendRequest(sid, msg, opts),
          getSession: (sid) => chatService.getSession(sid),
        },
        getParentSessionId: () => parent.id,
      },
    );

    const runner = new HeartbeatRunner(executor, () => ({ enabled: true, intervalMs: 60_000 }));
    runner.start();

    // Push one event, let real turn run, then assert no new events queued.
    runner.pushEvent({ type: 'file-change', payload: { path: '/z.ts' }, timestamp: Date.now() });
    await new Promise((r) => setTimeout(r, 10));

    // Multiple wake turns also don't populate the event queue.
    runner.wake('wake');
    await new Promise((r) => setTimeout(r, 10));

    expect(runner.pendingEventCount).toBe(0);

    runner.dispose();
    chatService.dispose();
  });
});
