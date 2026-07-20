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
