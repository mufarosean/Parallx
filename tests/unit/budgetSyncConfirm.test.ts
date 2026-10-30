// budgetSyncConfirm.test.ts — Sync Now asks first. Once Gmail's emails are
// fetched, the sync says how many are new and which model will read them;
// Cancel leaves everything as it was (no email read, the last-run time put
// back). With nothing new it does not ask.
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { triggerSyncFromUI, __setDbBridge } = __testables as {
  triggerSyncFromUI(api: unknown): Promise<{ ok: boolean; cancelled?: boolean; counts?: Record<string, number> }>;
  __setDbBridge(bridge: unknown): void;
};

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function setup(imported: string[]) {
  const runs: { sql: string; params: unknown[] }[] = [];
  const asked: string[] = [];
  let lmCalls = 0;
  __setDbBridge({
    async run(sql: string, params: unknown[] = []) { runs.push({ sql: flat(sql), params }); return {}; },
    async get(sql: string, params: unknown[] = []) {
      if (/FROM email_imports WHERE gmail_message_id/.test(flat(sql))) return { row: imported.includes(String(params[0])) ? { x: 1 } : undefined };
      if (/FROM sync_state WHERE key/.test(flat(sql)) && params[0] === 'last_run_at') return { row: { value: JSON.stringify('2026-10-01T08:00:00.000Z') } };
      return { row: undefined };
    },
    async all() { return { rows: [] }; },
  });
  const emails = ['m1', 'm2', 'm3'].map((id, i) => ({ id, subject: 'Purchase', receivedAt: `2026-10-0${i + 2}T10:00:00.000Z`, body: 'You spent $5' }));
  const api = {
    workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
    mcp: {
      listTools: async () => [{ name: 'mcp__gmail__list_emails' }],
      invokeTool: async () => ({ content: JSON.stringify({ messages: emails }) }),
    },
    lm: {
      getActiveModel: () => 'qwen3:14b',
      sendChatRequest: () => { lmCalls++; throw new Error('not in this test'); },
      streamChatRequest: () => { lmCalls++; throw new Error('not in this test'); },
    },
    window: {
      showWarningMessage: async (message: string, ...actions: { title: string }[]) => { asked.push(message, ...actions.map((a) => a.title)); return { title: 'Cancel' }; },
      showInformationMessage: async () => undefined,
      showErrorMessage: async (m: string) => { throw new Error(`unexpected error: ${m}`); },
    },
  };
  return { api, runs, asked, lmCalls: () => lmCalls };
}

describe('budget sync asks before reading emails', () => {
  beforeEach(() => __setDbBridge(null));

  it('says how many new emails and which model, and Cancel reads none', async () => {
    const { api, runs, asked, lmCalls } = setup(['m1']);
    const r = await triggerSyncFromUI(api);
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(asked[0]).toContain('2 new emails');
    expect(asked[0]).toContain('qwen3:14b');
    expect(asked.slice(1)).toEqual(['Sync 2 Emails', 'Cancel']);
    expect(lmCalls()).toBe(0);
    const writes = runs.filter((w) => w.sql.includes('INTO sync_state'));
    expect(writes.map((w) => w.params[0])).toEqual(['last_run_at', 'last_run_at']); // stamped, then put back
    expect(writes.at(-1)!.params[1]).toBe(JSON.stringify('2026-10-01T08:00:00.000Z'));
    expect(runs.some((w) => w.sql.includes('INTO email_imports'))).toBe(false);
  });

  it('does not ask when every email is already filed', async () => {
    const { api, asked } = setup(['m1', 'm2', 'm3']);
    const r = await triggerSyncFromUI(api);
    expect(asked).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.counts?.skipped).toBe(3);
  });
});
