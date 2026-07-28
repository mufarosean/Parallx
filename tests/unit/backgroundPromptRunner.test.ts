// backgroundPromptRunner.test.ts — M86 C4 headless prompt turns.
//
// The runner is the chat-side rail dashboard AI widgets refresh through:
// ephemeral session in, one agentic turn, purge always, autonomy-log entry
// for every run, ok/error result out.

import { describe, it, expect, vi } from 'vitest';
import { createBackgroundPromptRunner } from '../../src/built-in/chat/utilities/backgroundPromptRunner.js';
import type { IChatContentPart } from '../../src/services/chatTypes.js';

function makeDeps(overrides: {
  parentId?: string | undefined;
  sendRequest?: () => Promise<unknown>;
  finalParts?: readonly Record<string, unknown>[];
} = {}) {
  const purge = vi.fn();
  const create = vi.fn(() => ({ sessionId: 'eph-1' }));
  const send = vi.fn(overrides.sendRequest ?? (async () => undefined));
  const logEntries: { origin: string; requestText: string; content: string; metadata?: Readonly<Record<string, unknown>> }[] = [];
  const deps = {
    chatService: {
      createEphemeralSession: create as never,
      purgeEphemeralSession: purge as never,
      sendRequest: send as never,
      getSession: () => ({
        messages: [{ response: { parts: (overrides.finalParts ?? []) as unknown as readonly IChatContentPart[] } }],
      }),
    },
    getParentSessionId: () => ('parentId' in overrides ? overrides.parentId : 'parent-1'),
    autonomyLog: { append: (e: (typeof logEntries)[number]) => { logEntries.push(e); return e; } },
  };
  return { deps, purge, create, send, logEntries };
}

describe('backgroundPromptRunner', () => {
  it('rejects empty text without touching the chat service', async () => {
    const { deps, create } = makeDeps();
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: '   ' });
    expect(res.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('fails with guidance when there is no parent session', async () => {
    const { deps, create } = makeDeps({ parentId: undefined });
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'do the thing' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/chat panel/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('runs a turn, extracts final text, logs, and purges', async () => {
    const { deps, purge, send, logEntries } = makeDeps({
      finalParts: [{ content: 'Delivered.' }],
    });
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'summarize', origin: 'dashboard', originLabel: '[dashboard · Test]' });
    expect(res).toEqual({ ok: true, resultText: 'Delivered.' });
    expect(send).toHaveBeenCalledWith('eph-1', 'summarize');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].origin).toBe('dashboard');
    expect(logEntries[0].requestText).toBe('[dashboard · Test]');
    expect(logEntries[0].content).toBe('Delivered.');
  });

  it('reports tool-delivered runs (no final text) as ok', async () => {
    const { deps, logEntries } = makeDeps({ finalParts: [] });
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'fill the widget' });
    expect(res).toEqual({ ok: true, resultText: '' });
    expect(logEntries[0].content).toMatch(/delivered via tools/);
  });

  it('turn errors return ok:false, still purge, and log the failure', async () => {
    const { deps, purge, logEntries } = makeDeps({
      sendRequest: async () => { throw new Error('model unavailable'); },
    });
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'do it' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('model unavailable');
    expect(purge).toHaveBeenCalledTimes(1);
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].metadata?.error).toBe(true);
  });

  it('defaults origin to dashboard and derives a label from the prompt', async () => {
    const { deps, logEntries } = makeDeps({ finalParts: [{ content: 'x' }] });
    const run = createBackgroundPromptRunner(deps);
    await run({ text: 'a very specific task' });
    expect(logEntries[0].origin).toBe('dashboard');
    expect(logEntries[0].requestText).toContain('a very specific task');
  });
});

// ─── Autonomous permission routing (2026-07-20 widget-refresh fix) ───────────

describe('background session permission marking', () => {
  it('marks the ephemeral session BEFORE the turn and unmarks after (success)', async () => {
    const { deps } = makeDeps();
    const calls: string[] = [];
    const permissionService = {
      markHeartbeatSession: vi.fn((sid: string) => calls.push(`mark:${sid}`)),
      unmarkHeartbeatSession: vi.fn((sid: string) => calls.push(`unmark:${sid}`)),
    };
    const run = createBackgroundPromptRunner({
      ...deps,
      permissionService,
      getAutonomyLevel: () => 'allow-safe',
    });
    const res = await run({ text: 'refresh the news widget' });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(['mark:eph-1', 'unmark:eph-1']);
    expect(permissionService.markHeartbeatSession).toHaveBeenCalledWith('eph-1', 'allow-safe');
  });

  it('unmarks even when the turn THROWS (no session leaks into managed state)', async () => {
    const { deps } = makeDeps({ sendRequest: async () => { throw new Error('model gone'); } });
    const permissionService = {
      markHeartbeatSession: vi.fn(),
      unmarkHeartbeatSession: vi.fn(),
    };
    const run = createBackgroundPromptRunner({ ...deps, permissionService, getAutonomyLevel: () => undefined });
    const res = await run({ text: 'x' });
    expect(res.ok).toBe(false);
    expect(permissionService.unmarkHeartbeatSession).toHaveBeenCalledWith('eph-1');
  });

  it('runs fine without a permission service (optional dep)', async () => {
    const { deps } = makeDeps();
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'x' });
    expect(res.ok).toBe(true);
  });
});

// ─── Truthfulness (2026-07-28 widget-refresh diagnosis fixes) ────────────────
//
// sendRequest NEVER rejects on turn failure — errors come back as
// result.errorDetails on a resolved promise. Ignoring the result was the
// black hole that reported every broken refresh as ok:true.

describe('background turn truthfulness', () => {
  function makeTruthDeps(overrides?: { sendRequest?: (...a: unknown[]) => Promise<unknown> }) {
    const base = makeDeps();
    const cancelled: string[] = [];
    const notes: { actor?: string; verb: string; object: string; detail?: string }[] = [];
    const deps = {
      ...base.deps,
      chatService: {
        ...base.deps.chatService,
        sendRequest: (overrides?.sendRequest ?? base.deps.chatService.sendRequest) as never,
        cancelRequest: (sid: string) => { cancelled.push(sid); },
      },
      getActiveModelId: () => 'qwen3:30b',
      activity: { note: (n: (typeof notes)[number]) => { notes.push(n); } },
    };
    return { ...base, deps, cancelled, notes };
  }

  it('errorDetails on a RESOLVED turn → ok:false with error-flagged, model+session-stamped log', async () => {
    const { deps, logEntries, notes, purge } = makeTruthDeps({
      sendRequest: async () => ({ errorDetails: { message: 'model "ghost:7b" not found (404)' } }),
    });
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'refresh the widget' });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('not found');
      expect(res.model).toBe('qwen3:30b');
    }
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0].metadata).toMatchObject({ error: true, sessionId: 'eph-1', model: 'qwen3:30b' });
    // The failure narrated to the activity journal, attributed to the AI.
    expect(notes).toHaveLength(1);
    expect(notes[0].actor).toBe('ai');
    expect(notes[0].verb).toContain('failed');
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('success stamps sessionId + model on the log entry (no error flag)', async () => {
    const { deps, logEntries, notes } = makeTruthDeps();
    const run = createBackgroundPromptRunner(deps);
    const res = await run({ text: 'refresh' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.model).toBe('qwen3:30b');
    expect(logEntries[0].metadata).toMatchObject({ sessionId: 'eph-1', model: 'qwen3:30b' });
    expect(logEntries[0].metadata?.error).toBeUndefined();
    expect(notes).toHaveLength(0);
  });

  it('a hung turn times out, cancels the request, and reports a REAL failure', async () => {
    vi.useFakeTimers();
    try {
      const { deps, cancelled, purge, logEntries } = makeTruthDeps({
        sendRequest: () => new Promise(() => { /* hangs forever */ }),
      });
      const run = createBackgroundPromptRunner(deps);
      const pending = run({ text: 'refresh', timeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(10_100); // trip the runner timeout
      await vi.advanceTimersByTimeAsync(5_100);  // and the post-cancel grace
      const res = await pending;

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/timed out/);
      expect(cancelled).toEqual(['eph-1']);
      expect(purge).toHaveBeenCalledTimes(1);
      expect(logEntries[0].metadata).toMatchObject({ error: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
