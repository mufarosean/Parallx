// chatSurfaceAutonomyLog.test.ts — M58-real post-ship UX reshape.
//
// Verifies the rewired ChatSurfacePlugin that now writes autonomous
// deliveries into the AutonomyLogService instead of the chat transcript.
//
// Invariants:
//   1. Bare-logger constructor preserved (trace-only path)
//   2. With autonomyLog + resolver wired, deliveries are appended to the log
//   3. Origin derived from _origin envelope metadata (SURFACE_ORIGIN_KEY)
//   4. Origin fallback flags (heartbeatResult/cronResult/subagentResult)
//   5. Request label is built from origin + contextual metadata
//   6. Empty content is skipped (no log noise)
//   7. Structured (non-string) content is stringified as fenced JSON
//   8. Logger errors never fail delivery
//   9. Active session id is forwarded onto the log entry

import { describe, expect, it, vi } from 'vitest';
import { ChatSurfacePlugin } from '../../src/built-in/chat/surfaces/chatSurface';
import { AutonomyLogService } from '../../src/services/autonomyLogService';
import {
  SURFACE_CHAT,
  type ISurfaceDelivery,
} from '../../src/openclaw/openclawSurfacePlugin';

function makeDelivery(overrides: Partial<ISurfaceDelivery> = {}): ISurfaceDelivery {
  return {
    id: 'd-1',
    surface: SURFACE_CHAT,
    content: 'hello',
    contentType: 'text/markdown',
    metadata: {},
    timestamp: Date.now(),
    ...overrides,
  } as ISurfaceDelivery;
}

describe('ChatSurfacePlugin → AutonomyLog', () => {
  it('bare-logger constructor preserves trace-only behavior', async () => {
    const seen: ISurfaceDelivery[] = [];
    const plugin = new ChatSurfacePlugin((d) => seen.push(d));
    const ok = await plugin.deliver(makeDelivery());
    expect(ok).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('appends delivery to autonomy log with derived origin + label', async () => {
    const log = new AutonomyLogService();
    const plugin = new ChatSurfacePlugin({
      autonomyLog: log,
      getActiveSessionId: () => 'session-A',
    });

    await plugin.deliver(makeDelivery({
      content: 'heartbeat ran',
      metadata: { heartbeatResult: true, reason: 'file-saved' },
    }));

    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].origin).toBe('heartbeat');
    expect(entries[0].requestText).toContain('heartbeat');
    expect(entries[0].requestText).toContain('file-saved');
    expect(entries[0].content).toBe('heartbeat ran');
    expect(entries[0].sessionId).toBe('session-A');
  });

  it('derives origin from _origin metadata (SURFACE_ORIGIN_KEY)', async () => {
    const log = new AutonomyLogService();
    const plugin = new ChatSurfacePlugin({
      autonomyLog: log,
      getActiveSessionId: () => undefined,
    });
    await plugin.deliver(makeDelivery({
      metadata: { _origin: 'cron', jobName: 'nightly-digest' },
    }));
    const entries = log.getEntries();
    expect(entries[0].origin).toBe('cron');
    expect(entries[0].requestText).toContain('nightly-digest');
  });

  it('subagent delivery labels distinctly', async () => {
    const log = new AutonomyLogService();
    const plugin = new ChatSurfacePlugin({
      autonomyLog: log,
    });
    await plugin.deliver(makeDelivery({
      content: 'subagent finished',
      metadata: { subagentResult: true },
    }));
    const entries = log.getEntries();
    expect(entries[0].origin).toBe('subagent');
    expect(entries[0].requestText).toBe('[subagent]');
  });

  it('skips empty content', async () => {
    const log = new AutonomyLogService();
    const plugin = new ChatSurfacePlugin({
      autonomyLog: log,
    });
    await plugin.deliver(makeDelivery({ content: '' }));
    expect(log.size).toBe(0);
  });

  it('stringifies non-string content as fenced JSON', async () => {
    const log = new AutonomyLogService();
    const plugin = new ChatSurfacePlugin({ autonomyLog: log });
    await plugin.deliver(makeDelivery({
      content: { ok: true, count: 2 } as unknown as string,
      contentType: 'application/json',
      metadata: { heartbeatResult: true },
    }));
    const e = log.getEntries()[0];
    expect(e.content).toContain('```json');
    expect(e.content).toContain('"count": 2');
  });

  it('logger exceptions do not break delivery', async () => {
    const log = new AutonomyLogService();
    const plugin = new ChatSurfacePlugin({
      autonomyLog: log,
      logger: () => { throw new Error('boom'); },
    });
    const ok = await plugin.deliver(makeDelivery({ metadata: { heartbeatResult: true } }));
    expect(ok).toBe(true);
    expect(log.size).toBe(1);
  });

  it('runs logger alongside log append', async () => {
    const log = new AutonomyLogService();
    const logger = vi.fn();
    const plugin = new ChatSurfacePlugin({
      autonomyLog: log,
      logger,
    });
    await plugin.deliver(makeDelivery({ metadata: { cronResult: true } }));
    expect(logger).toHaveBeenCalledOnce();
    expect(log.size).toBe(1);
  });
});
