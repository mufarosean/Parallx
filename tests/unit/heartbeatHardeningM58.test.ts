/**
 * M58 heartbeat hardening — tests for:
 *   - Fix 3: HeartbeatFileFilter (include/exclude globs)
 *   - Fix 4: Runner burst coalescing (coalesceWindowMs)
 *   - Fix 2: Executor NOOP drop + output dedup
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  shouldHeartbeatAcceptPath,
  globToRegex,
} from '../../src/openclaw/openclawHeartbeatFileFilter';
import {
  HeartbeatRunner,
  type IHeartbeatConfig,
  type HeartbeatTurnExecutor,
} from '../../src/openclaw/openclawHeartbeatRunner';
import {
  createHeartbeatTurnExecutor,
  type IHeartbeatChatService,
} from '../../src/openclaw/openclawHeartbeatExecutor';
import {
  SurfaceRouterService,
  ORIGIN_HEARTBEAT,
} from '../../src/services/surfaceRouterService';
import {
  SURFACE_STATUS,
  SURFACE_CHAT,
  type ISurfaceDelivery,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
} from '../../src/openclaw/openclawSurfacePlugin';
import { ChatContentPartKind, type IChatContentPart } from '../../src/services/chatTypes';
import type {
  IEphemeralSessionHandle,
  IEphemeralSessionSeed,
} from '../../src/services/chatService';

// ───────────────────────── Fix 3: file filter ─────────────────────────

describe('shouldHeartbeatAcceptPath (Fix 3)', () => {
  const DEFAULT_INCLUDE = ['.ts', '.md'];
  const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**'];

  it('accepts path with included extension', () => {
    expect(shouldHeartbeatAcceptPath('/home/x/src/main.ts', DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(true);
    expect(shouldHeartbeatAcceptPath('/home/x/README.md', DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(true);
  });

  it('rejects path with non-included extension', () => {
    expect(shouldHeartbeatAcceptPath('/home/x/build.log', DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(false);
    expect(shouldHeartbeatAcceptPath('/home/x/image.png', DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(false);
  });

  it('empty include list = accept any extension (minus excludes)', () => {
    expect(shouldHeartbeatAcceptPath('/home/x/image.png', [], DEFAULT_EXCLUDE)).toBe(true);
    expect(shouldHeartbeatAcceptPath('/home/x/node_modules/foo/image.png', [], DEFAULT_EXCLUDE)).toBe(false);
  });

  it('exclude always wins over include', () => {
    expect(shouldHeartbeatAcceptPath('/proj/node_modules/foo.ts', DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(false);
    expect(shouldHeartbeatAcceptPath('/proj/.git/HEAD.md', DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(false);
  });

  it('handles file:// URIs with Windows drive letters', () => {
    const path = 'file:///C:/Users/mchit/project/src/main.ts';
    expect(shouldHeartbeatAcceptPath(path, DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(true);
  });

  it('handles Windows backslash paths', () => {
    const path = 'C:\\Users\\mchit\\project\\node_modules\\x.ts';
    expect(shouldHeartbeatAcceptPath(path, DEFAULT_INCLUDE, DEFAULT_EXCLUDE)).toBe(false);
  });

  it('extensions are case-insensitive', () => {
    expect(shouldHeartbeatAcceptPath('/x/main.TS', ['.ts'], [])).toBe(true);
    expect(shouldHeartbeatAcceptPath('/x/main.ts', ['.TS'], [])).toBe(true);
  });

  it('globs match with **, *, ?', () => {
    expect(globToRegex('**/node_modules/**').test('a/b/node_modules/c/d')).toBe(true);
    expect(globToRegex('*.log').test('foo.log')).toBe(true);
    expect(globToRegex('*.log').test('a/foo.log')).toBe(false);
    expect(globToRegex('**/*.log').test('a/foo.log')).toBe(true);
  });

  it('user can add .parallx/** to exclude list to suppress app-internal writes', () => {
    const excludes = [...DEFAULT_EXCLUDE, '**/.parallx/**'];
    expect(shouldHeartbeatAcceptPath('/proj/.parallx/AGENTS.md', DEFAULT_INCLUDE, excludes)).toBe(false);
    expect(shouldHeartbeatAcceptPath('/proj/.parallx/memory/2026.md', DEFAULT_INCLUDE, excludes)).toBe(false);
    expect(shouldHeartbeatAcceptPath('/proj/src/main.ts', DEFAULT_INCLUDE, excludes)).toBe(true);
  });
});

// ───────────────────────── Fix 4: coalesce ─────────────────────────

describe('HeartbeatRunner burst coalescing (Fix 4)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function makeRunner(coalesceWindowMs: number): {
    runner: HeartbeatRunner;
    executor: ReturnType<typeof vi.fn>;
  } {
    const executor = vi.fn<Parameters<HeartbeatTurnExecutor>, ReturnType<HeartbeatTurnExecutor>>().mockResolvedValue(undefined);
    const cfg: IHeartbeatConfig = {
      enabled: true,
      intervalMs: 60 * 60 * 1000, // very long — only coalesce timer matters
      coalesceWindowMs,
    };
    const runner = new HeartbeatRunner(executor as unknown as HeartbeatTurnExecutor, () => cfg);
    return { runner, executor };
  }

  it('coalesceWindowMs=0 preserves legacy immediate tick', async () => {
    const { runner, executor } = makeRunner(0);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    await Promise.resolve();
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('coalesceWindowMs>0 delays the tick until quiet window elapses', async () => {
    const { runner, executor } = makeRunner(2000);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    // No immediate fire.
    await Promise.resolve();
    expect(executor).not.toHaveBeenCalled();

    // Advance less than the window — still no fire.
    await vi.advanceTimersByTimeAsync(1500);
    expect(executor).not.toHaveBeenCalled();

    // Cross the window — one fire.
    await vi.advanceTimersByTimeAsync(600);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('multiple pushEvents within window collapse to a single tick with all events', async () => {
    const { runner, executor } = makeRunner(2000);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    runner.pushEvent({ type: 'file-change', payload: { path: '/b.ts' }, timestamp: 2 });
    runner.pushEvent({ type: 'file-change', payload: { path: '/c.ts' }, timestamp: 3 });

    await vi.advanceTimersByTimeAsync(2100);
    expect(executor).toHaveBeenCalledTimes(1);
    const [events, reason] = executor.mock.calls[0] as [readonly { payload: { path: string } }[], string];
    expect(reason).toBe('system-event');
    expect(events.map(e => e.payload.path)).toEqual(['/a.ts', '/b.ts', '/c.ts']);
  });

  it('later pushEvent resets the coalesce timer (debounce, not throttle)', async () => {
    const { runner, executor } = makeRunner(2000);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    await vi.advanceTimersByTimeAsync(1800);
    runner.pushEvent({ type: 'file-change', payload: { path: '/b.ts' }, timestamp: 2 });
    await vi.advanceTimersByTimeAsync(1800);
    expect(executor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── Fix 2: executor output hardening ─────────────────

class FakeSurfacePlugin implements ISurfacePlugin {
  readonly deliveries: ISurfaceDelivery[] = [];
  readonly capabilities: ISurfaceCapabilities = {
    supportsText: true,
    supportsStructured: false,
    supportsBinary: false,
    supportsActions: false,
  };
  constructor(readonly id: string) {}
  isAvailable(): boolean { return true; }
  async deliver(d: ISurfaceDelivery): Promise<boolean> { this.deliveries.push(d); return true; }
  dispose(): void {}
}

function buildChatStub(responseText: string): { chatService: IHeartbeatChatService; setResponse(text: string): void } {
  let current = responseText;
  const sessions = new Map<string, { messages: { response: { parts: IChatContentPart[] } }[] }>();
  let counter = 0;
  const chatService: IHeartbeatChatService = {
    createEphemeralSession(parentId, seed?: IEphemeralSessionSeed): IEphemeralSessionHandle {
      counter += 1;
      const sid = `eph-${counter}`;
      sessions.set(sid, { messages: [] });
      return { sessionId: sid, parentId, seed: seed ?? {} };
    },
    purgeEphemeralSession(handle) { sessions.delete(handle.sessionId); },
    async sendRequest(sid) {
      const s = sessions.get(sid);
      if (s) {
        s.messages.push({
          response: { parts: [{ kind: ChatContentPartKind.Markdown, content: current } as IChatContentPart] },
        });
      }
      return {};
    },
    getSession(sid) { return sessions.get(sid); },
  };
  return { chatService, setResponse(t) { current = t; } };
}

describe('HeartbeatTurnExecutor output hardening (Fix 2)', () => {
  it('drops NOOP responses without delivering to chat surface', async () => {
    const router = new SurfaceRouterService();
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    router.registerSurface(chat);
    router.registerSurface(status);

    const stub = buildChatStub('NOOP');
    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['system-event'] }),
      { chatService: stub.chatService, getParentSessionId: () => 'p1', debounceMs: 0 },
    );

    await executor(
      [{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }],
      'system-event',
    );

    expect(chat.deliveries).toHaveLength(0);
  });

  it('drops duplicate outputs within dedup window', async () => {
    const router = new SurfaceRouterService();
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    router.registerSurface(chat);
    router.registerSurface(status);

    const stub = buildChatStub('The file changed; no action needed.');
    const nowRef = { value: 1_000_000 };
    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['system-event'] }),
      {
        chatService: stub.chatService,
        getParentSessionId: () => 'p1',
        debounceMs: 0,
        outputDedupWindowMs: 60_000,
        now: () => nowRef.value,
      },
    );

    // First call delivers.
    await executor(
      [{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }],
      'system-event',
    );
    expect(chat.deliveries).toHaveLength(1);

    // Same text, still within window → drop.
    nowRef.value += 30_000;
    await executor(
      [{ type: 'file-change', payload: { path: '/b.ts' }, timestamp: 2 }],
      'system-event',
    );
    expect(chat.deliveries).toHaveLength(1);

    // After window → delivered again.
    nowRef.value += 60_000;
    await executor(
      [{ type: 'file-change', payload: { path: '/c.ts' }, timestamp: 3 }],
      'system-event',
    );
    expect(chat.deliveries).toHaveLength(2);
  });

  it('outputDedupWindowMs=0 disables dedup', async () => {
    const router = new SurfaceRouterService();
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    router.registerSurface(chat);
    router.registerSurface(status);

    const stub = buildChatStub('Same text.');
    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['system-event'] }),
      {
        chatService: stub.chatService,
        getParentSessionId: () => 'p1',
        debounceMs: 0,
        outputDedupWindowMs: 0,
      },
    );

    await executor([{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }], 'system-event');
    await executor([{ type: 'file-change', payload: { path: '/b.ts' }, timestamp: 2 }], 'system-event');
    expect(chat.deliveries).toHaveLength(2);
  });

  it('whitespace/case variations of NOOP all drop', async () => {
    const router = new SurfaceRouterService();
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    router.registerSurface(chat);
    router.registerSurface(status);

    const stub = buildChatStub('  noop  ');
    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['system-event'] }),
      { chatService: stub.chatService, getParentSessionId: () => 'p1', debounceMs: 0 },
    );
    await executor([{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }], 'system-event');
    expect(chat.deliveries).toHaveLength(0);

    stub.setResponse('Noop');
    await executor([{ type: 'file-change', payload: { path: '/b.ts' }, timestamp: 2 }], 'system-event');
    expect(chat.deliveries).toHaveLength(0);
  });
});

// ───────────────────────── Chat-turn back-pressure ─────────────────────────

describe('HeartbeatRunner shouldDeferTick (chat-turn back-pressure)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('skips system-event tick when shouldDeferTick returns true and re-queues events', async () => {
    let busy = true;
    const executor = vi.fn<Parameters<HeartbeatTurnExecutor>, ReturnType<HeartbeatTurnExecutor>>().mockResolvedValue(undefined);
    const cfg: IHeartbeatConfig = {
      enabled: true,
      intervalMs: 60 * 60 * 1000,
      shouldDeferTick: () => busy,
    };
    const runner = new HeartbeatRunner(executor as unknown as HeartbeatTurnExecutor, () => cfg);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    await Promise.resolve();
    expect(executor).not.toHaveBeenCalled();
    // Event was kept in the queue (not silently dropped) — visible via wake.
    busy = false;
    runner.wake('wake');
    await Promise.resolve();
    expect(executor).toHaveBeenCalledTimes(1);
    const [events] = executor.mock.calls[0] as [readonly { payload: { path: string } }[], string];
    expect(events.map(e => e.payload.path)).toEqual(['/a.ts']);
  });

  it('runs normally when shouldDeferTick returns false', async () => {
    const executor = vi.fn<Parameters<HeartbeatTurnExecutor>, ReturnType<HeartbeatTurnExecutor>>().mockResolvedValue(undefined);
    const cfg: IHeartbeatConfig = {
      enabled: true,
      intervalMs: 60 * 60 * 1000,
      shouldDeferTick: () => false,
    };
    const runner = new HeartbeatRunner(executor as unknown as HeartbeatTurnExecutor, () => cfg);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    await Promise.resolve();
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('absent shouldDeferTick = no back-pressure (legacy behavior)', async () => {
    const executor = vi.fn<Parameters<HeartbeatTurnExecutor>, ReturnType<HeartbeatTurnExecutor>>().mockResolvedValue(undefined);
    const cfg: IHeartbeatConfig = {
      enabled: true,
      intervalMs: 60 * 60 * 1000,
    };
    const runner = new HeartbeatRunner(executor as unknown as HeartbeatTurnExecutor, () => cfg);
    runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 });
    await Promise.resolve();
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────── NOTE handling ─────────────────────────

describe('HeartbeatTurnExecutor NOTE response routing', () => {
  it('routes NOTE: lines to status surface as heartbeatNote (not chat)', async () => {
    const router = new SurfaceRouterService();
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    router.registerSurface(chat);
    router.registerSurface(status);

    const stub = buildChatStub('NOTE: a config file changed');
    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['system-event'] }),
      { chatService: stub.chatService, getParentSessionId: () => 'p1', debounceMs: 0 },
    );

    await executor(
      [{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }],
      'system-event',
    );

    expect(chat.deliveries).toHaveLength(0);
    const noteDeliveries = status.deliveries.filter(d => d.metadata?.heartbeatNote === true);
    expect(noteDeliveries).toHaveLength(1);
    expect(noteDeliveries[0].content).toContain('a config file changed');
  });

  it('treats non-NOTE prose as a normal ACT delivery', async () => {
    const router = new SurfaceRouterService();
    const chat = new FakeSurfacePlugin(SURFACE_CHAT);
    const status = new FakeSurfacePlugin(SURFACE_STATUS);
    router.registerSurface(chat);
    router.registerSurface(status);

    const stub = buildChatStub('I checked the file and it looks fine.');
    const executor = createHeartbeatTurnExecutor(
      router,
      () => ({ reasons: ['system-event'] }),
      { chatService: stub.chatService, getParentSessionId: () => 'p1', debounceMs: 0 },
    );

    await executor(
      [{ type: 'file-change', payload: { path: '/a.ts' }, timestamp: 1 }],
      'system-event',
    );

    expect(chat.deliveries).toHaveLength(1);
  });
});
