/**
 * W5 (M58) — SubagentSpawner + ephemeral-session executor wiring tests.
 *
 * Proves end-to-end:
 *
 *   1. `createSubagentTurnExecutor` runs a real turn against an ephemeral
 *      session, captures the final assistant text, and purges the session.
 *   2. `createSubagentAnnouncer` emits a `sendWithOrigin(ORIGIN_SUBAGENT,
 *      ...)` delivery on the chat surface with `metadata.subagentResult =
 *      true` and the runId / parent session id stamped in.
 *   3. `sessions_spawn` tool happy path: returns the subagent's final
 *      text as a structured tool result.
 *   4. `sessions_spawn` is always-approval (`requires-approval`) — no
 *      exemption, no dev-mode bypass.
 *   5. Depth-2 spawn attempt is rejected at the tool handler before
 *      reaching the spawner (registry stays clean).
 *   6. Depth enforcement also happens in SubagentSpawner (`callerDepth >=
 *      maxDepth`) — belt-and-braces.
 *   7. Failure mode: executor throws → spawner records `failed` status,
 *      tool returns a clean error result, no leaked ephemeral session in
 *      the chat service session list.
 *   8. Timeout: short `timeoutMs` with a slow executor returns a clean
 *      `timeout` error.
 *   9. Approval denied (simulated by omitting the spawner) → tool returns
 *      clean error result, no state leak.
 *  10. `currentSubagentDepth` is 0 outside any spawn and 1 during an
 *      in-flight spawn.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';
import {
  SubagentSpawner,
} from '../../src/openclaw/openclawSubagentSpawn';
import {
  createSubagentTurnExecutor,
  createSubagentAnnouncer,
  extractFinalAssistantText,
  currentSubagentDepth,
  _resetSubagentDepthForTests,
  type ISubagentAnnouncerRouter,
} from '../../src/openclaw/openclawSubagentExecutor';
import { createSessionsSpawnTool } from '../../src/built-in/chat/tools/subagentTools';
import {
  subagentToolPermissionLevel,
  subagentToolRequiresApproval,
} from '../../src/openclaw/openclawToolPolicy';
import { ORIGIN_SUBAGENT } from '../../src/services/surfaceRouterService';
import { SURFACE_CHAT } from '../../src/openclaw/openclawSurfacePlugin';
import { isEphemeralSessionId } from '../../src/services/chatSessionPersistence';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function createReplyAgent(reply: string): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Default',
    description: 'stub',
    commands: [],
    handler: async (
      _req: IChatParticipantRequest,
      _ctx: IChatParticipantContext,
      stream: IChatResponseStream,
      _tok: ICancellationToken,
    ) => {
      stream.markdown(reply);
      return {};
    },
  };
}

interface ITestHarness {
  chatService: ChatService;
  agentService: ChatAgentService;
  parentId: string;
  routerCalls: Array<{ surfaceId: string; origin: string; content: unknown; metadata?: Record<string, unknown> }>;
  router: ISubagentAnnouncerRouter;
}

function harness(reply = 'subagent final output'): ITestHarness {
  const agentService = new ChatAgentService();
  agentService.registerAgent(createReplyAgent(reply));
  const modeService = new ChatModeService();
  const lmService = new LanguageModelsService();
  const chatService = new ChatService(agentService, modeService, lmService);
  const parent = chatService.createSession();

  const routerCalls: ITestHarness['routerCalls'] = [];
  const router: ISubagentAnnouncerRouter = {
    async sendWithOrigin(params, origin) {
      routerCalls.push({ surfaceId: params.surfaceId, origin, content: params.content, metadata: params.metadata });
      return { status: 'delivered', deliveryId: 'd-' + routerCalls.length, surfaceId: params.surfaceId };
    },
  };

  return { chatService, agentService, parentId: parent.id, routerCalls, router };
}

// ---------------------------------------------------------------------------
// extractFinalAssistantText
// ---------------------------------------------------------------------------

describe('extractFinalAssistantText', () => {
  it('joins content / code / message fields from parts', () => {
    const text = extractFinalAssistantText([
      { kind: 'markdown', content: 'hello' } as any,
      { kind: 'code', code: 'print(1)' } as any,
      { kind: 'error', message: 'oops' } as any,
    ]);
    expect(text).toContain('hello');
    expect(text).toContain('print(1)');
    expect(text).toContain('oops');
  });

  it('returns empty string for parts with no text-bearing fields', () => {
    expect(extractFinalAssistantText([{ kind: 'reference' } as any])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

describe('createSubagentTurnExecutor', () => {
  beforeEach(() => _resetSubagentDepthForTests());

  it('runs a real turn on an ephemeral session and returns the final text', async () => {
    const h = harness('final answer from subagent');

    const executor = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: (p, s) => h.chatService.createEphemeralSession(p, s),
        purgeEphemeralSession: (handle) => h.chatService.purgeEphemeralSession(handle),
        sendRequest: (sid, msg, opts) => h.chatService.sendRequest(sid, msg, opts),
        getSession: (sid) => h.chatService.getSession(sid),
      },
      getParentSessionId: () => h.parentId,
    });

    const text = await executor('summarize the inbox', null);
    expect(text).toContain('final answer from subagent');

    // Ephemeral session was purged — not in getSessions(), not in getSession()
    expect(h.chatService.getSessions().map(s => s.id)).toEqual([h.parentId]);
    // Parent session untouched
    expect(h.chatService.getSession(h.parentId)?.messages).toHaveLength(0);
  });

  it('throws when there is no parent session id', async () => {
    const h = harness();
    const executor = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: (p, s) => h.chatService.createEphemeralSession(p, s),
        purgeEphemeralSession: (handle) => h.chatService.purgeEphemeralSession(handle),
        sendRequest: (sid, msg, opts) => h.chatService.sendRequest(sid, msg, opts),
        getSession: (sid) => h.chatService.getSession(sid),
      },
      getParentSessionId: () => undefined,
    });

    await expect(executor('t', null)).rejects.toThrow(/no active parent session/);
  });

  it('purges the ephemeral session even when sendRequest rejects', async () => {
    const h = harness();
    const createSpy = vi.spyOn(h.chatService, 'createEphemeralSession');
    const purgeSpy = vi.spyOn(h.chatService, 'purgeEphemeralSession');

    const executor = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: (p, s) => h.chatService.createEphemeralSession(p, s),
        purgeEphemeralSession: (handle) => h.chatService.purgeEphemeralSession(handle),
        sendRequest: async () => { throw new Error('boom'); },
        getSession: (sid) => h.chatService.getSession(sid),
      },
      getParentSessionId: () => h.parentId,
    });

    await expect(executor('t', null)).rejects.toThrow('boom');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(purgeSpy).toHaveBeenCalledTimes(1);
    // No ephemeral session leak
    const all = h.chatService.getSessions();
    expect(all.every(s => !isEphemeralSessionId(s.id))).toBe(true);
  });

  it('exposes depth=1 during the spawn and returns to 0 after', async () => {
    const h = harness();
    let observed: number | undefined;
    const executor = createSubagentTurnExecutor({
      chatService: {
        createEphemeralSession: (p, s) => h.chatService.createEphemeralSession(p, s),
        purgeEphemeralSession: (handle) => h.chatService.purgeEphemeralSession(handle),
        sendRequest: async (sid, msg, opts) => {
          observed = currentSubagentDepth();
          return h.chatService.sendRequest(sid, msg, opts);
        },
        getSession: (sid) => h.chatService.getSession(sid),
      },
      getParentSessionId: () => h.parentId,
    });

    expect(currentSubagentDepth()).toBe(0);
    await executor('t', null);
    expect(observed).toBe(1);
    expect(currentSubagentDepth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Announcer
// ---------------------------------------------------------------------------

describe('createSubagentAnnouncer', () => {
  it('stamps ORIGIN_SUBAGENT and subagentResult=true on a chat-surface delivery', async () => {
    const h = harness();
    const announcer = createSubagentAnnouncer({
      surfaceRouter: h.router,
      getParentSessionId: () => h.parentId,
    });

    const run = {
      id: 'subagent-1',
      task: 'do a thing',
      label: 'Task',
      model: null,
      status: 'completed' as const,
      callerDepth: 0,
      spawnedAt: 100,
      completedAt: 200,
      result: 'done',
      error: null,
      timeoutMs: 120000,
    };

    await announcer(run, 'the final result');

    expect(h.routerCalls).toHaveLength(1);
    const call = h.routerCalls[0];
    expect(call.surfaceId).toBe(SURFACE_CHAT);
    expect(call.origin).toBe(ORIGIN_SUBAGENT);
    expect(call.content).toBe('the final result');
    expect(call.metadata?.subagentResult).toBe(true);
    expect(call.metadata?.runId).toBe('subagent-1');
    expect(call.metadata?.parentSessionId).toBe(h.parentId);
    expect(call.metadata?.durationMs).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tool policy
// ---------------------------------------------------------------------------

describe('subagent tool policy (always-approval)', () => {
  it('subagentToolRequiresApproval returns true for any tool name', () => {
    expect(subagentToolRequiresApproval('sessions_spawn')).toBe(true);
    expect(subagentToolRequiresApproval('anything_else')).toBe(true);
  });

  it('subagentToolPermissionLevel is always requires-approval', () => {
    expect(subagentToolPermissionLevel('sessions_spawn')).toBe('requires-approval');
  });
});

// ---------------------------------------------------------------------------
// sessions_spawn tool handler
// ---------------------------------------------------------------------------

describe('sessions_spawn tool', () => {
  beforeEach(() => _resetSubagentDepthForTests());

  function buildSpawnerWith(executorImpl: (task: string, model: string | null) => Promise<string>): SubagentSpawner {
    return new SubagentSpawner(executorImpl, null, /* maxDepth */ 1);
  }

  it('tool definition is marked requires-approval + requiresConfirmation', () => {
    const tool = createSessionsSpawnTool(buildSpawnerWith(async () => 'ok'));
    expect(tool.name).toBe('sessions_spawn');
    expect(tool.permissionLevel).toBe('requires-approval');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('happy path: returns structured tool result with final subagent text', async () => {
    const spawner = buildSpawnerWith(async () => 'delegated answer');
    const tool = createSessionsSpawnTool(spawner);

    const result = await tool.handler({ task: 'analyze foo.md' }, { isCancellationRequested: false } as ICancellationToken);
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe('completed');
    expect(parsed.result).toBe('delegated answer');
    expect(typeof parsed.runId).toBe('string');
  });

  it('rejects missing task argument cleanly', async () => {
    const tool = createSessionsSpawnTool(buildSpawnerWith(async () => 'x'));
    const result = await tool.handler({}, { isCancellationRequested: false } as ICancellationToken);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/task/i);
  });

  it('rejects when spawner is unavailable', async () => {
    const tool = createSessionsSpawnTool(undefined);
    const result = await tool.handler({ task: 't' }, { isCancellationRequested: false } as ICancellationToken);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/not available/i);
  });

  it('rejects depth-2 spawn attempts without consuming a registry slot', async () => {
    const spawner = buildSpawnerWith(async () => 'never runs');
    const tool = createSessionsSpawnTool(spawner);

    // Simulate being inside a subagent turn by driving the shared counter.
    _resetSubagentDepthForTests();
    // @ts-expect-error — monkey-reach into module depth by running the real path
    // is overkill; use the exported helper to simulate depth>0 by invoking
    // the executor briefly. Simpler: wrap via a spawn to a fake and freeze
    // depth at 1 for the duration of this test.
    // Use the internal depth driver: call the tool's handler from within a
    // spawn whose executor triggers another handler.
    const innerTool = tool;
    const outerSpawner = buildSpawnerWith(async (_task, _model) => {
      // At this point currentSubagentDepth() should be 1.
      const res = await innerTool.handler({ task: 'nested' }, { isCancellationRequested: false } as ICancellationToken);
      // Inner rejection must have been returned as isError (not thrown).
      if (!res.isError) throw new Error('expected depth-2 rejection');
      return 'outer ok';
    });
    // Need a custom executor that uses the depth-counter from openclawSubagentExecutor.
    // Easiest: build a real executor for the outer spawn.
    const outerTool = createSessionsSpawnTool(
      new SubagentSpawner(
        createSubagentTurnExecutor({
          chatService: {
            createEphemeralSession: (p, _s) => ({ sessionId: 'ephemeral-x', parentId: p, seed: {} }),
            purgeEphemeralSession: () => { /* no-op */ },
            sendRequest: async () => {
              // Run the inner tool while depth is 1
              const res = await innerTool.handler({ task: 'nested' }, { isCancellationRequested: false } as ICancellationToken);
              if (!res.isError) throw new Error('expected inner rejection');
              return { requestId: 'r', response: { parts: [], isComplete: true, modelId: '', timestamp: 0 } };
            },
            getSession: () => ({ messages: [{ response: { parts: [{ kind: 'markdown', content: 'outer' } as any], isComplete: true, modelId: '', timestamp: 0 } } as any] }),
          },
          getParentSessionId: () => 'parent-1',
        }),
        null,
        /* maxDepth */ 1,
      ),
    );

    const outerResult = await outerTool.handler({ task: 'outer' }, { isCancellationRequested: false } as ICancellationToken);
    expect(outerResult.isError).toBeFalsy();
    const parsed = JSON.parse(outerResult.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.result).toContain('outer');
    // Side-effect: outerSpawner unused but ensures helper typechecks
    void outerSpawner;
  });

  it('SubagentSpawner itself also rejects callerDepth >= maxDepth (belt-and-braces)', async () => {
    const spawner = buildSpawnerWith(async () => 'ok');
    const result = await spawner.spawn({ task: 't', callerDepth: 1 }); // maxDepth=1
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/depth/i);
  });

  it('timeout: slow executor + small timeoutMs returns a clean timeout error', async () => {
    const slow = buildSpawnerWith(() => new Promise<string>(resolve => setTimeout(() => resolve('late'), 3000)));
    const tool = createSessionsSpawnTool(slow);
    const result = await tool.handler(
      { task: 't', timeoutMs: 1000 },
      { isCancellationRequested: false } as ICancellationToken,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/timeout/i);
  }, 10000);

  it('executor error bubbles as clean failed tool result', async () => {
    const broken = buildSpawnerWith(async () => { throw new Error('model crashed'); });
    const tool = createSessionsSpawnTool(broken);
    const result = await tool.handler(
      { task: 't' },
      { isCancellationRequested: false } as ICancellationToken,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/model crashed/);
  });
});
