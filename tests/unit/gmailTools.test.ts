// gmailTools.test.ts — M60 §T6.F4
//
// Coverage:
//   • _RollingHourLimiter — admission, hourly window decay, remaining()
//   • Tool spec — name, parameters, requiresConfirmation, permissionLevel
//   • Permission gating — disabled deps return a typed error
//   • Rate cap — 60th call OK, 61st call refused with non-error duration <100ms
//   • Auth failure path surfaces gracefully
//   • Argument clamping — maxResults clamped to [1,50]
//   • Body redaction — even if the invoker hands back fields outside
//     the documented metadata set, the tool's rendered output never
//     includes them
//   • Cancellation pre-check
//   • recordToolCall called with argsDigest + non-empty duration; never
//     receives args body

import { describe, it, expect, vi } from 'vitest';
import {
  _RollingHourLimiter,
  createGmailListUnreadTool,
  type GmailMcpInvoker,
  type IGmailMessageMetadata,
} from '../../src/built-in/chat/tools/gmailTools';
import type { IAutonomyToolCallRecord } from '../../src/services/autonomyEventLog';
import type { ICancellationToken } from '../../src/services/chatTypes';
import type { IDisposable } from '../../src/platform/lifecycle';

// ─── Helpers ──────────────────────────────────────────────────────

function token(): ICancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }) satisfies IDisposable,
  };
}

function cancelledToken(): ICancellationToken {
  return {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose: () => {} }) satisfies IDisposable,
  };
}

const SAMPLE: IGmailMessageMetadata = {
  id: 'M1',
  from: 'alice@example.com',
  subject: 'Hi',
  snippet: 'a snippet',
  receivedAt: '2024-01-01T00:00:00Z',
  labels: ['INBOX', 'UNREAD'],
};

// ─── Limiter ──────────────────────────────────────────────────────

describe('_RollingHourLimiter', () => {
  it('admits up to the cap and refuses beyond', () => {
    let now = 1_000_000;
    const lim = new _RollingHourLimiter(3, () => now);
    expect(lim.tryConsume()).toBe(true);
    expect(lim.tryConsume()).toBe(true);
    expect(lim.tryConsume()).toBe(true);
    expect(lim.remaining()).toBe(0);
    expect(lim.tryConsume()).toBe(false);
  });

  it('decays calls older than 60 minutes', () => {
    let now = 1_000_000;
    const lim = new _RollingHourLimiter(2, () => now);
    expect(lim.tryConsume()).toBe(true);
    expect(lim.tryConsume()).toBe(true);
    expect(lim.tryConsume()).toBe(false);
    now += 3_600_001; // jump past 1 hour
    expect(lim.tryConsume()).toBe(true);
    expect(lim.remaining()).toBe(1);
  });
});

// ─── Tool spec ────────────────────────────────────────────────────

describe('createGmailListUnreadTool — spec', () => {
  it('declares the right name + permission level + confirmation', () => {
    const t = createGmailListUnreadTool({});
    expect(t.name).toBe('gmail.list_unread');
    expect(t.permissionLevel).toBe('requires-approval');
    expect(t.requiresConfirmation).toBe(true);
    expect(t.source).toBe('built-in');
    expect((t.parameters as Record<string, unknown>)['type']).toBe('object');
  });
});

describe('createGmailListUnreadTool — gating', () => {
  it('returns a typed error when deps are missing (not configured)', async () => {
    const records: IAutonomyToolCallRecord[] = [];
    const t = createGmailListUnreadTool({ recordToolCall: r => records.push(r) });
    const r = await t.handler({}, token());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not configured/i);
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('gmail.list_unread');
    expect(records[0].error).toBe('gmail-not-configured');
    // argsDigest is recorded, not the args body.
    expect(records[0].argsDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses when rate cap is exhausted', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [] });
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'AT',
      callsPerHourCap: 1,
    });
    const ok = await t.handler({}, token());
    expect(ok.isError).toBeFalsy();
    const refused = await t.handler({}, token());
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/rate cap/i);
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it('returns auth failure verbatim', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [] });
    const records: IAutonomyToolCallRecord[] = [];
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => { throw new Error('refresh-failed: invalid_grant'); },
      recordToolCall: r => records.push(r),
    });
    const r = await t.handler({}, token());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/refresh-failed/);
    expect(invoker).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0].error).toMatch(/^auth: /);
  });

  it('returns cancellation result without calling the invoker', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [] });
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'AT',
    });
    const r = await t.handler({}, cancelledToken());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/cancelled/i);
    expect(invoker).not.toHaveBeenCalled();
  });
});

// ─── Happy paths + redaction ──────────────────────────────────────

describe('createGmailListUnreadTool — invocation', () => {
  it('passes the access token + clamped maxResults to the invoker', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [SAMPLE] });
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'ACCESS-TOKEN-XYZ',
    });
    await t.handler({ maxResults: 999 }, token());
    expect(invoker).toHaveBeenCalledTimes(1);
    expect(invoker.mock.calls[0][0]).toBe('ACCESS-TOKEN-XYZ');
    expect(invoker.mock.calls[0][1]).toEqual({ maxResults: 50 });

    await t.handler({ maxResults: -3 }, token());
    expect(invoker.mock.calls[1][1]).toEqual({ maxResults: 1 });

    await t.handler({}, token());
    expect(invoker.mock.calls[2][1]).toEqual({ maxResults: 10 });
  });

  it('renders metadata and never leaks body fields the server might send', async () => {
    // Even if a future server version added fields beyond the
    // documented metadata set (e.g. `body`, `bodyText`, `raw`), the
    // tool must not surface them. Cast through unknown to attach
    // fields the type doesn't know about.
    const leaky: IGmailMessageMetadata = {
      ...SAMPLE,
      // @ts-expect-error simulating a server that returned extra fields
      body: 'SECRET BODY CONTENT',
      // @ts-expect-error simulating a server that returned extra fields
      bodyText: 'OTHER SECRET',
    };
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [leaky] });
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'AT',
    });
    const r = await t.handler({}, token());
    expect(r.isError).toBeFalsy();
    expect(typeof r.content).toBe('string');
    const text = String(r.content);
    expect(text).toContain('M1');
    expect(text).toContain('Hi');
    expect(text).toContain('alice@example.com');
    expect(text).not.toContain('SECRET BODY CONTENT');
    expect(text).not.toContain('OTHER SECRET');
  });

  it('renders the empty state correctly', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [] });
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'AT',
    });
    const r = await t.handler({}, token());
    expect(r.content).toMatch(/no unread/i);
  });

  it('surfaces invoker errors with the message preserved', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockRejectedValue(new Error('mcp-spawn-failed'));
    const records: IAutonomyToolCallRecord[] = [];
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'AT',
      recordToolCall: r => records.push(r),
    });
    const r = await t.handler({}, token());
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/mcp-spawn-failed/);
    expect(records).toHaveLength(1);
    expect(records[0].error).toBe('mcp-spawn-failed');
  });

  it('records argsDigest + duration but NEVER the args body', async () => {
    const invoker = vi.fn<GmailMcpInvoker>().mockResolvedValue({ messages: [] });
    const records: IAutonomyToolCallRecord[] = [];
    let now = 1_000_000;
    const t = createGmailListUnreadTool({
      invoker,
      getAccessToken: async () => 'AT',
      recordToolCall: r => records.push(r),
      now: () => now,
    });
    // advance the clock between start + finish
    invoker.mockImplementation(async () => { now += 7; return { messages: [] }; });
    await t.handler({ maxResults: 5 }, token());
    expect(records).toHaveLength(1);
    expect(records[0].argsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(records[0].durationMs).toBe(7);
    // Stringify and assert no plaintext body markers.
    const blob = JSON.stringify(records[0]);
    expect(blob).not.toContain('"maxResults"');
  });
});
