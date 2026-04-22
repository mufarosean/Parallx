// autonomyLogTool.test.ts — built-in `autonomy_log` chat tool.
//
// The tool is a read-only bridge from the agent to the AutonomyLogService.
//
// Invariants:
//   1. Missing log → isError + ok:false
//   2. Returns summarized entries + returned count + unreadCount
//   3. limit is clamped to [1, 200]
//   4. origin filter is forwarded
//   5. onlyUnread filter is forwarded
//   6. markRead:true marks returned entries and reduces unreadCount

import { describe, expect, it } from 'vitest';
import { createAutonomyLogTool } from '../../src/built-in/chat/tools/autonomyLogTool';
import { AutonomyLogService } from '../../src/services/autonomyLogService';
import type { ICancellationToken } from '../../src/services/chatTypes';

const noCancel: ICancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() { /* noop */ } }),
};

function parseResult(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

describe('autonomy_log tool', () => {
  it('returns error when log service is absent', async () => {
    const tool = createAutonomyLogTool(undefined);
    const result = await tool.handler({}, noCancel);
    expect(result.isError).toBe(true);
    const parsed = parseResult(result.content);
    expect(parsed.ok).toBe(false);
  });

  it('returns entries with summary shape', async () => {
    const log = new AutonomyLogService();
    log.append({
      origin: 'heartbeat',
      content: 'saved TODO.md',
      requestText: '[heartbeat · file-saved]',
      metadata: { reason: 'file-saved', path: '/x/TODO.md', noisy: 'should-be-stripped' },
    });

    const tool = createAutonomyLogTool(log);
    const result = await tool.handler({}, noCancel);
    const parsed = parseResult(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.returned).toBe(1);
    expect(parsed.unreadCount).toBe(1);
    const entries = parsed.entries as Array<Record<string, unknown>>;
    expect(entries[0].origin).toBe('heartbeat');
    expect(entries[0].read).toBe(false);
    const meta = entries[0].meta as Record<string, unknown>;
    expect(meta.reason).toBe('file-saved');
    expect(meta.path).toBe('/x/TODO.md');
    expect(meta.noisy).toBeUndefined();
  });

  it('clamps limit to [1, 200]', async () => {
    const log = new AutonomyLogService();
    for (let i = 0; i < 5; i++) log.append({ origin: 'cron', content: `e${i}` });
    const tool = createAutonomyLogTool(log);

    const hi = parseResult((await tool.handler({ limit: 9999 }, noCancel)).content);
    expect(hi.returned).toBe(5);

    const lo = parseResult((await tool.handler({ limit: -4 }, noCancel)).content);
    expect(lo.returned).toBe(1);
  });

  it('forwards origin filter', async () => {
    const log = new AutonomyLogService();
    log.append({ origin: 'cron', content: 'c' });
    log.append({ origin: 'heartbeat', content: 'h' });
    const tool = createAutonomyLogTool(log);
    const parsed = parseResult((await tool.handler({ origin: 'cron' }, noCancel)).content);
    expect(parsed.returned).toBe(1);
    const entries = parsed.entries as Array<Record<string, unknown>>;
    expect(entries[0].origin).toBe('cron');
  });

  it('forwards onlyUnread filter', async () => {
    const log = new AutonomyLogService();
    const a = log.append({ origin: 'cron', content: 'a' });
    log.append({ origin: 'cron', content: 'b' });
    log.markRead([a.id]);

    const tool = createAutonomyLogTool(log);
    const parsed = parseResult((await tool.handler({ onlyUnread: true }, noCancel)).content);
    expect(parsed.returned).toBe(1);
    const entries = parsed.entries as Array<Record<string, unknown>>;
    expect(entries[0].content).toBe('b');
  });

  it('markRead marks returned entries and reduces unreadCount', async () => {
    const log = new AutonomyLogService();
    log.append({ origin: 'cron', content: 'a' });
    log.append({ origin: 'cron', content: 'b' });
    const tool = createAutonomyLogTool(log);

    const parsed = parseResult((await tool.handler({ markRead: true }, noCancel)).content);
    expect(parsed.markedRead).toBe(2);
    expect(parsed.unreadCount).toBe(0);
    expect(log.getUnreadCount()).toBe(0);
  });
});
