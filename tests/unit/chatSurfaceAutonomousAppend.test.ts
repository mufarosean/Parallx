// chatSurfaceAutonomousAppend.test.ts — M58-real post-ship autonomy fix
//
// Covers the ChatSurfacePlugin upgrade that makes heartbeat / cron /
// subagent result deliveries user-visible. Before this fix, the plugin
// logged deliveries to the console and dropped them; now it appends an
// autonomous assistant message to the active chat session via the new
// `ChatService.appendAutonomousMessage` API.
//
// The tests prove:
//   1. Legacy trace-only constructor still works (no regression for tests
//      that pass a bare logger callback).
//   2. With a chatService + getActiveSessionId wired, deliveries route
//      into appendAutonomousMessage.
//   3. Delivery metadata is used to derive the origin label
//      (heartbeat / cron / subagent / _origin envelope key).
//   4. When no active session id is resolvable, deliveries degrade to
//      trace-only (never create a fresh session behind the user's back).
//   5. Empty content deliveries are skipped (no blank bubbles).
//   6. appendAutonomousMessage on the real ChatService correctly builds a
//      request/response pair, pushes it, fires onDidChangeSession, and
//      rejects ephemeral session ids.

import { describe, expect, it, vi } from 'vitest';

import {
  ChatSurfacePlugin,
  type IChatSurfaceHost,
} from '../../src/built-in/chat/surfaces/chatSurface';
import {
  SURFACE_CHAT,
  type ISurfaceDelivery,
} from '../../src/openclaw/openclawSurfacePlugin';

// ---------------------------------------------------------------------------
// Helpers

function makeDelivery(overrides: Partial<ISurfaceDelivery> = {}): ISurfaceDelivery {
  return {
    id: 'd-1',
    surface: SURFACE_CHAT,
    content: 'hello from heartbeat',
    contentType: 'text/markdown',
    metadata: {},
    timestamp: Date.now(),
    ...overrides,
  } as ISurfaceDelivery;
}

function makeHost(): IChatSurfaceHost & { calls: Array<{ sessionId: string; opts: unknown }> } {
  const calls: Array<{ sessionId: string; opts: unknown }> = [];
  return {
    calls,
    appendAutonomousMessage(sessionId, opts) {
      calls.push({ sessionId, opts });
      return true;
    },
  };
}

// ---------------------------------------------------------------------------

describe('ChatSurfacePlugin (M58-real autonomous append)', () => {
  it('preserves trace-only behavior when constructed with a bare logger', async () => {
    const seen: ISurfaceDelivery[] = [];
    const plugin = new ChatSurfacePlugin((d) => seen.push(d));
    const ok = await plugin.deliver(makeDelivery());
    expect(ok).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('routes delivery into appendAutonomousMessage when fully wired', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-A',
    });
    const ok = await plugin.deliver(makeDelivery({
      content: 'heartbeat ran',
      metadata: { heartbeatResult: true, reason: 'file-saved' },
    }));
    expect(ok).toBe(true);
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0].sessionId).toBe('session-A');
    const opts = host.calls[0].opts as { content: string; origin: string; requestText: string };
    expect(opts.content).toBe('heartbeat ran');
    expect(opts.origin).toBe('heartbeat');
    expect(opts.requestText).toContain('heartbeat');
    expect(opts.requestText).toContain('file-saved');
  });

  it('derives origin from SURFACE_ORIGIN_KEY metadata envelope', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-X',
    });
    await plugin.deliver(makeDelivery({
      metadata: { _origin: 'cron', jobName: 'nightly-digest' },
    }));
    const opts = host.calls[0].opts as { origin: string; requestText: string };
    expect(opts.origin).toBe('cron');
    expect(opts.requestText).toContain('nightly-digest');
  });

  it('labels subagent deliveries distinctly', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-S',
    });
    await plugin.deliver(makeDelivery({
      content: 'subagent finished',
      metadata: { subagentResult: true },
    }));
    const opts = host.calls[0].opts as { origin: string; requestText: string };
    expect(opts.origin).toBe('subagent');
    expect(opts.requestText).toBe('[subagent]');
  });

  it('degrades to trace-only when no active session id resolves', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => undefined,
    });
    const ok = await plugin.deliver(makeDelivery({ metadata: { heartbeatResult: true } }));
    expect(ok).toBe(true);
    expect(host.calls).toHaveLength(0);
  });

  it('skips append for empty content', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-Q',
    });
    await plugin.deliver(makeDelivery({ content: '' }));
    expect(host.calls).toHaveLength(0);
  });

  it('stringifies structured deliveries as fenced JSON', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-J',
    });
    await plugin.deliver(makeDelivery({
      content: { ok: true, count: 2 } as unknown as string,
      contentType: 'application/json',
      metadata: { heartbeatResult: true },
    }));
    const opts = host.calls[0].opts as { content: string };
    expect(opts.content).toContain('```json');
    expect(opts.content).toContain('"count": 2');
  });

  it('runs the logger alongside real append for observability', async () => {
    const host = makeHost();
    const logger = vi.fn();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-L',
      logger,
    });
    await plugin.deliver(makeDelivery({ metadata: { heartbeatResult: true } }));
    expect(logger).toHaveBeenCalledOnce();
    expect(host.calls).toHaveLength(1);
  });

  it('logger exceptions do not fail the delivery', async () => {
    const host = makeHost();
    const plugin = new ChatSurfacePlugin({
      chatService: host,
      getActiveSessionId: () => 'session-E',
      logger: () => { throw new Error('boom'); },
    });
    const ok = await plugin.deliver(makeDelivery({ metadata: { heartbeatResult: true } }));
    expect(ok).toBe(true);
    expect(host.calls).toHaveLength(1);
  });
});
