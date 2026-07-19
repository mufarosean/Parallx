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
  type IHeartbeatMind,
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

interface IFakeMindCalls {
  records: { kind: string; summary: string; origin: string }[];
  remembers: { kind: string; content: string; confidence: number; provenance: readonly string[] }[];
  seedCalls: number;
}
function buildFakeMind(seed = ''): { mind: IHeartbeatMind; calls: IFakeMindCalls } {
  const calls: IFakeMindCalls = { records: [], remembers: [], seedCalls: 0 };
  let h = 0;
  const mind: IHeartbeatMind = {
    seedBlock() { calls.seedCalls += 1; return seed; },
    async record(kind, summary, origin) { calls.records.push({ kind, summary, origin }); return { hash: `h${++h}` }; },
    async remember(kind, content, confidence, provenance) { calls.remembers.push({ kind, content, confidence, provenance }); return true; },
  };
  return { mind, calls };
}

function buildHarness(overrides?: {
  parentId?: string | undefined;
  respondWith?: string;
  throwOnSend?: Error;
  reasons?: HeartbeatReason[];
  debounceMs?: number;
  nowRef?: { value: number };
  mind?: IHeartbeatMind;
  getWorkspacePages?: () => Promise<readonly { title: string; updatedAt?: string }[]>;
  getWorkspaceTasks?: () => Promise<readonly { title: string; dueAt?: number | null }[]>;
  deterministicLane?: () => Promise<unknown>;
  getPurposeWatches?: () => Promise<readonly string[]>;
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
      mind: overrides?.mind,
      getWorkspacePages: overrides?.getWorkspacePages,
      getWorkspaceTasks: overrides?.getWorkspaceTasks,
      deterministicLane: overrides?.deterministicLane,
      getPurposeWatches: overrides?.getPurposeWatches,
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

  it('interval reason: runs a real periodic review when the snapshot is noteworthy', async () => {
    // The interval is the app-awareness review: when something is noteworthy
    // (here, pending workspace activity) it runs a real turn with the snapshot.
    // (An *idle* interval is gated — see the idle-gate suite below.)
    const h = buildHarness();
    await h.executor([mkEvent('/x.ts')], 'interval');

    expect(h.chat_.calls.createEphemeralSession).toHaveLength(1);
    expect(h.chat_.calls.createEphemeralSession[0].parentId).toBe('parent-1');
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
    expect(h.chat_.calls.sendRequest[0].message).toContain('[heartbeat interval]');
    expect(h.chat_.calls.sendRequest[0].message).toContain('Recent activity');
    expect(h.chat_.calls.purgeEphemeralSession).toHaveLength(1);
    expect((h.chat.deliveries[0].metadata as Record<string, unknown>).reason).toBe('interval');
    expect(getDeliveryOrigin(h.chat.deliveries[0])).toBe(ORIGIN_HEARTBEAT);
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

  it('VALUE: a review triggered by a canvas page the user created is ABOUT that activity, not diagnostics', async () => {
    // The whole point: the agent must respond to what the user actually did, and
    // NOT regurgitate the 15 diagnostics they can already see. With all checks
    // passing and a real canvas page-creation event, the model's prompt must lead
    // with the page activity and never echo the diagnostics.
    const h = buildHarness({ respondWith: 'NOOP' });
    const pageCreated = { type: 'extension-signal', payload: { source: 'canvas', title: 'created page "Q3 Planning"' }, timestamp: Date.now() } as IHeartbeatSystemEvent;

    await h.executor([pageCreated], 'system-event');

    const msg = h.chat_.calls.sendRequest[0].message;
    expect(msg).toContain('created page "Q3 Planning"'); // the agent SEES the canvas activity
    expect(msg).not.toMatch(/checks passing/);           // no redundant diagnostics echo
    expect(msg).not.toMatch(/all \d+ checks/);           // diagnostics aren't the headline
  });

  it('VALUE: the review is given the user\'s ACTUAL canvas pages (real workspace awareness)', async () => {
    // The agent can only help if it knows the user's real work. The review's
    // prompt must include the actual pages, so it can offer substantive help
    // ("you have Q3 Planning and Q3 Budget — link them?") instead of status.
    const h = buildHarness({
      respondWith: 'NOOP',
      getWorkspacePages: async () => [{ title: 'Q3 Planning' }, { title: 'Q3 Budget' }],
      getWorkspaceTasks: async () => [{ title: 'File the Q3 report', dueAt: Date.now() + 3_600_000 }],
    });
    await h.executor([], 'wake');
    const msg = h.chat_.calls.sendRequest[0].message;
    expect(msg).toContain('Q3 Planning');
    expect(msg).toContain('Q3 Budget');
    expect(msg).toContain('canvas page');
    // ...and the user's open tasks (the second surface)
    expect(msg).toContain('File the Q3 report');
    expect(msg).toContain('open task');
  });

  it('reasons allowlist blocks all paths (including real turn reasons)', async () => {
    const h = buildHarness({ reasons: ['interval'] });
    await h.executor([mkEvent('/x.ts')], 'system-event');
    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
    expect(h.status.deliveries).toHaveLength(0);
  });
});

describe('HeartbeatTurnExecutor — idle gate (Build-1e: idle must be free)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('an idle interval (nothing noteworthy) runs NO model turn', async () => {
    const h = buildHarness(); // no events → idle
    await h.executor([], 'interval');
    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
    expect(h.chat_.calls.sendRequest).toHaveLength(0);
  });

  it('an interval with a noteworthy snapshot runs the model', async () => {
    const h = buildHarness();
    await h.executor([mkEvent('/x.ts')], 'interval');
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
  });

  it('an unchanged noteworthy snapshot is not re-reviewed on the next interval', async () => {
    const h = buildHarness();
    await h.executor([mkEvent('/x.ts')], 'interval'); // first time: reviews
    await h.executor([mkEvent('/x.ts')], 'interval'); // same snapshot key: gated
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
  });

  it('a NEWLY changed snapshot reopens the interval review', async () => {
    const h = buildHarness();
    await h.executor([mkEvent('/a.ts')], 'interval'); // reviews (file-change)
    await h.executor([mkEvent('/b.ts', 'index-complete')], 'interval'); // different type → different key
    expect(h.chat_.calls.sendRequest).toHaveLength(2);
  });

  it('daily reflection runs even when idle (bypasses the gate) and consolidates', async () => {
    let reflected = false;
    const mind: IHeartbeatMind = {
      seedBlock: () => 'What I believe: ...',
      async remember() { return true; },
      async record() { return { hash: 'h' }; },
      reflectionDue: () => true,
      reflect: async () => { reflected = true; },
    };
    const h = buildHarness({ mind, respondWith: 'NOOP' }); // idle: no diagnostics → normally gated
    await h.executor([], 'interval');
    expect(h.chat_.calls.sendRequest).toHaveLength(1); // ran despite idle
    expect(h.chat_.calls.sendRequest[0].message).toContain('[heartbeat reflection]'); // reflection seed
    expect(reflected).toBe(true); // consolidation ran
  });

  it('reflection does NOT fire when not due (normal idle gating applies)', async () => {
    const mind: IHeartbeatMind = {
      seedBlock: () => '',
      async remember() { return true; },
      async record() { return { hash: 'h' }; },
      reflectionDue: () => false,
      reflect: async () => { /* should not be called */ },
    };
    const h = buildHarness({ mind, respondWith: 'NOOP' }); // idle + not due → gated
    await h.executor([], 'interval');
    expect(h.chat_.calls.sendRequest).toHaveLength(0);
  });

  it('wake is never gated — it always runs even when idle', async () => {
    const h = buildHarness(); // idle
    await h.executor([], 'wake');
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
  });

  it('system-event is never gated by the idle rule', async () => {
    const h = buildHarness(); // no diagnostics, but a real event
    await h.executor([mkEvent('/x.ts')], 'system-event');
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
  });
});

describe('HeartbeatTurnExecutor — MIND continuity wiring (Build-1d)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('injects the MIND seed block into the review so the agent reads its own continuity', async () => {
    const { mind, calls } = buildFakeMind('What I currently believe:\n- [belief · 90%] User ships on Fridays');
    const h = buildHarness({ mind, respondWith: 'NOOP' });
    await h.executor([mkEvent('/x.ts')], 'interval');
    expect(calls.seedCalls).toBe(1);
    const msg = h.chat_.calls.sendRequest[0].message;
    expect(msg).toContain('User ships on Fridays');
    expect(msg).toContain('Your continuity');
  });

  it('omits the continuity block when the MIND is empty', async () => {
    const { mind } = buildFakeMind('MIND: (empty — no durable beliefs yet)');
    const h = buildHarness({ mind, respondWith: 'NOOP' });
    await h.executor([mkEvent('/x.ts')], 'interval');
    expect(h.chat_.calls.sendRequest[0].message).not.toContain('Your continuity');
  });

  it('records a NOOP outcome to the audit ledger', async () => {
    const { mind, calls } = buildFakeMind();
    const h = buildHarness({ mind, respondWith: 'NOOP' });
    await h.executor([mkEvent('/x.ts')], 'interval');
    expect(calls.records.map(r => r.kind)).toContain('noop');
    expect(calls.records[0].origin).toBe('heartbeat:interval');
  });

  it('records a NOTE to the ledger but does NOT auto-remember it as a belief', async () => {
    const { mind, calls } = buildFakeMind();
    const h = buildHarness({ mind, respondWith: 'NOTE: the file index looks stale' });
    await h.executor([mkEvent('/x.ts')], 'system-event');
    expect(calls.records.find(r => r.kind === 'note')?.summary).toContain('file index looks stale');
    // The MIND is curated only by the model's deliberate mind_remember — the
    // heartbeat no longer force-logs every NOTE as a belief (the junk source).
    expect(calls.remembers).toHaveLength(0);
  });

  it('nag governor: a NOTE is NOT surfaced when interruption is denied (but is ledgered)', async () => {
    const calls: { kind: string }[] = [];
    const mind: IHeartbeatMind = {
      seedBlock: () => '',
      async remember() { return true; },
      async record(kind) { calls.push({ kind }); return { hash: 'h' }; },
      async allowInterruption() { return false; }, // throttled
    };
    const h = buildHarness({ mind, respondWith: 'NOTE: something minor' });
    await h.executor([mkEvent('/x.ts')], 'interval');
    const noteCards = h.status.deliveries.filter(d => (d.metadata as Record<string, unknown>)?.heartbeatNote);
    expect(noteCards).toHaveLength(0); // not surfaced
    expect(calls.some(c => c.kind === 'deferred')).toBe(true); // but ledgered as deferred
  });

  it('nag governor: a NOTE IS surfaced when interruption is allowed', async () => {
    const mind: IHeartbeatMind = {
      seedBlock: () => '',
      async remember() { return true; },
      async record() { return { hash: 'h' }; },
      async allowInterruption() { return true; },
    };
    const h = buildHarness({ mind, respondWith: 'NOTE: worth a look' });
    await h.executor([mkEvent('/x.ts')], 'interval');
    const noteCards = h.status.deliveries.filter(d => (d.metadata as Record<string, unknown>)?.heartbeatNote);
    expect(noteCards).toHaveLength(1);
  });

  it('records an ACT to the ledger but does NOT auto-remember it as a belief', async () => {
    const { mind, calls } = buildFakeMind();
    const h = buildHarness({ mind, respondWith: 'Investigated and fixed the broken link.' });
    await h.executor([mkEvent('/x.ts')], 'system-event');
    expect(calls.records.find(r => r.kind === 'act')).toBeTruthy();
    expect(calls.remembers).toHaveLength(0);
  });

  it('records an error outcome when the turn throws', async () => {
    const { mind, calls } = buildFakeMind();
    const h = buildHarness({ mind, throwOnSend: new Error('model offline') });
    await h.executor([mkEvent('/x.ts')], 'system-event');
    expect(calls.records.find(r => r.kind === 'error')?.summary).toContain('model offline');
  });

  it('a throwing MIND never breaks the heartbeat (seed + record both guarded)', async () => {
    const brokenMind: IHeartbeatMind = {
      seedBlock() { throw new Error('mind boom'); },
      async remember() { throw new Error('boom'); },
      async record() { throw new Error('boom'); },
    };
    const h = buildHarness({ mind: brokenMind, respondWith: 'Investigated. All clear.' });
    await h.executor([], 'wake');
    // The turn still ran and delivered despite the MIND throwing everywhere.
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
    expect(h.chat.deliveries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// M87 S1 — deterministic lane integration
// ---------------------------------------------------------------------------

describe('HeartbeatTurnExecutor — deterministic lane (M87 S1)', () => {
  it('interval beats run the lane even with NO events and NO parent session (idle gate does not apply)', async () => {
    const lane = vi.fn(async () => ({ delivered: 1, suppressed: 0, failed: 0 }));
    const h = buildHarness({ parentId: undefined, deterministicLane: lane });

    await h.executor([], 'interval');

    expect(lane).toHaveBeenCalledTimes(1);
    // The LLM lane stayed silent: no session, no model turn.
    expect(h.chat_.calls.sendRequest).toHaveLength(0);
    expect(h.chat_.calls.createEphemeralSession).toHaveLength(0);
  });

  it('a throwing lane never breaks the beat', async () => {
    const lane = vi.fn(async () => { throw new Error('lane exploded'); });
    const h = buildHarness({ parentId: undefined, deterministicLane: lane });

    await expect(h.executor([], 'interval')).resolves.toBeUndefined();
    expect(lane).toHaveBeenCalledTimes(1);
  });

  it('system-event beats do NOT run the lane (interval-only in S1)', async () => {
    const lane = vi.fn(async () => ({ delivered: 0, suppressed: 0, failed: 0 }));
    const h = buildHarness({ deterministicLane: lane });

    await h.executor([mkEvent('/notes/page.md')], 'system-event');

    expect(lane).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M87 S2 — standing watches (UC6 prompt inclusion)
// ---------------------------------------------------------------------------

describe('HeartbeatTurnExecutor — standing watches (M87 S2 / UC6)', () => {
  it('a real-turn review includes each watch VERBATIM in the seed message', async () => {
    const h = buildHarness({
      getPurposeWatches: async () => ['Warn me if the Exam 7 page goes a week without edits.'],
    });

    await h.executor([mkEvent('/notes/page.md')], 'system-event');

    expect(h.chat_.calls.sendRequest).toHaveLength(1);
    const seed = h.chat_.calls.sendRequest[0].message;
    expect(seed).toContain('STANDING WATCHES');
    expect(seed).toContain('- Warn me if the Exam 7 page goes a week without edits.');
  });

  it('zero watches add NOTHING to the seed', async () => {
    const h = buildHarness({ getPurposeWatches: async () => [] });

    await h.executor([mkEvent('/notes/page.md')], 'system-event');

    expect(h.chat_.calls.sendRequest).toHaveLength(1);
    expect(h.chat_.calls.sendRequest[0].message).not.toContain('STANDING WATCHES');
  });

  it('a throwing watch loader never breaks the review', async () => {
    const h = buildHarness({
      getPurposeWatches: async () => { throw new Error('fs gone'); },
    });

    await expect(h.executor([mkEvent('/notes/page.md')], 'system-event')).resolves.toBeUndefined();
    expect(h.chat_.calls.sendRequest).toHaveLength(1);
  });
});
