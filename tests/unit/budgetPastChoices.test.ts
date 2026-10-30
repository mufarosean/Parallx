// budgetPastChoices.test.ts — the sync's categorizer sees your past calls.
// Two or more of your own picks for a payee, with nothing hand-set
// disagreeing, file the next one directly; anything less goes to the model
// as a few "past choices" lines. The AI's own earlier answers are not
// evidence and never reach the index.
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — JS module with no types
import * as past from '../../ext/budget/past-choices.js';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

type Row = { merchant: string; category_id: string; category_name: string; source: string };
type Index = { byKey: Map<string, unknown[]>; offKeys: Set<string> };
const P = past as {
  buildPastChoiceIndex(rows: Row[], off?: string[]): Index;
  pastChoicesFor(index: Index, merchant: string | null): { direct: { categoryId: string; picks: number } | null; lines: string[] };
  pastChoicesPrompt(lines: string[]): string;
  loadPastChoices(db: { all(sql: string, p?: unknown[]): Promise<unknown[]> }): Promise<Index>;
  PAST_CHOICE_MODEL: string;
};

const row = (merchant: string, cat: string, source = 'manual'): Row =>
  ({ merchant, category_id: 'c-' + cat.toLowerCase(), category_name: cat, source });

describe('past choices for a payee', () => {
  it('files directly when two of your picks agree, across store numbers', () => {
    const idx = P.buildPastChoiceIndex([row('SQ *BLUE BOTTLE 0042 DENVER CO', 'Dining'), row('SQ *BLUE BOTTLE 0107 DENVER CO', 'Dining')]);
    const r = P.pastChoicesFor(idx, 'SQ *BLUE BOTTLE 0311 DENVER CO');
    expect(r.direct).toMatchObject({ categoryId: 'c-dining', picks: 2 });
    expect(r.lines).toEqual([]);
  });

  it('asks the model, with your picks as lines, when they disagree', () => {
    const idx = P.buildPastChoiceIndex([row('TARGET 1234', 'Household'), row('TARGET 1234', 'Groceries'), row('TARGET 5678', 'Groceries')]);
    const r = P.pastChoicesFor(idx, 'TARGET 9999');
    expect(r.direct).toBeNull();
    expect(r.lines).toEqual(['TARGET 1234 → Household (chosen)', 'TARGET 1234 → Groceries (chosen)', 'TARGET 5678 → Groceries (chosen)']);
  });

  it('one pick is a hint, not a decision', () => {
    const r = P.pastChoicesFor(P.buildPastChoiceIndex([row('Shell Oil 5521', 'Gas')]), 'SHELL OIL 7788');
    expect(r.direct).toBeNull();
    expect(r.lines).toEqual(['Shell Oil 5521 → Gas (chosen)']);
  });

  it('a row you only kept counts for less: shown after picks, never decides alone, and blocks on disagreement', () => {
    const kept = P.buildPastChoiceIndex([row('NETFLIX.COM', 'Subscriptions', 'ai'), row('NETFLIX.COM', 'Subscriptions', 'rule')]);
    const k = P.pastChoicesFor(kept, 'NETFLIX.COM');
    expect(k.direct).toBeNull();
    expect(k.lines).toEqual(['NETFLIX.COM → Subscriptions (kept, 2 times)']);
    const mixed = P.buildPastChoiceIndex([row('NETFLIX.COM', 'Entertainment', 'ai'), row('NETFLIX.COM', 'Subscriptions'), row('NETFLIX.COM', 'Subscriptions')]);
    const m = P.pastChoicesFor(mixed, 'NETFLIX.COM');
    expect(m.direct).toBeNull();
    expect(m.lines).toEqual(['NETFLIX.COM → Subscriptions (chosen, 2 times)', 'NETFLIX.COM → Entertainment (kept)']);
  });

  it('caps the prompt at five lines and a rule you turned off stops direct filing', () => {
    // Seven store numbers, one payee once normalised, seven categories.
    const idx = P.buildPastChoiceIndex(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => row('COSTCO WHSE #' + i, c)));
    expect(P.pastChoicesFor(idx, 'COSTCO WHSE #1').lines).toHaveLength(5);
    const off = P.buildPastChoiceIndex([row('LYFT RIDE', 'Transport'), row('LYFT RIDE', 'Transport')], ['lyft ride']);
    const r = P.pastChoicesFor(off, 'LYFT RIDE');
    expect(r.direct).toBeNull();
    expect(r.lines).toEqual(['LYFT RIDE → Transport (chosen, 2 times)']);
  });

  it('knows nothing of a payee you never filed, or of no payee', () => {
    const idx = P.buildPastChoiceIndex([row('LYFT RIDE', 'Transport')]);
    expect(P.pastChoicesFor(idx, 'UBER TRIP')).toEqual({ direct: null, lines: [] });
    expect(P.pastChoicesFor(idx, null)).toEqual({ direct: null, lines: [] });
    expect(P.pastChoicesPrompt([])).toBe('');
    expect(P.pastChoicesPrompt(['x → Y (chosen)'])).toBe("The user's past choices for this merchant, newest first:\n  • x → Y (chosen)\n");
  });

  it('reads hand-touched rows only, and a failing query leaves the model on its own', async () => {
    const asked: string[] = [];
    const idx = await P.loadPastChoices({ async all(sql: string) { asked.push(sql); return /categorization_rules/.test(sql) ? [] : [row('LYFT', 'Transport')]; } });
    expect(asked[0]).toMatch(/categorization_source = 'manual' OR t\.user_overridden = 1/);
    expect(idx.byKey.get('lyft')).toHaveLength(1);
    const none = await P.loadPastChoices({ async all() { throw new Error('locked'); } });
    expect(none.byKey.size).toBe(0);
  });
});

// The sync itself: a payee you filed twice by hand skips the model; one you
// filed once is categorized by the model with that pick in its prompt.
const { triggerSyncFromUI, __setDbBridge } = __testables as {
  triggerSyncFromUI(api: unknown): Promise<{ ok: boolean; counts?: Record<string, number> }>;
  __setDbBridge(bridge: unknown): void;
};
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function syncWith(merchant: string, history: Row[]) {
  const inserts: unknown[][] = [];
  const prompts: string[] = [];
  __setDbBridge({
    async run(sql: string, params: unknown[] = []) { if (/^INSERT INTO transactions \(id, gmail_message_id, merchant/.test(flat(sql))) inserts.push(params); return {}; },
    async get() { return { row: undefined }; },
    async all(sql: string) {
      const s = flat(sql);
      if (/FROM categories WHERE archived=0 AND kind='expense'/.test(s)) return { rows: [{ id: 'c-dining', name: 'Dining' }, { id: 'c-groceries', name: 'Groceries' }] };
      if (/categorization_source = 'manual' OR t\.user_overridden = 1/.test(s)) return { rows: history };
      return { rows: [] };
    },
  });
  const reply = (sys: string) => sys.startsWith('You classify') ? { event_type: 'purchase', account_kind_hint: 'credit_card' }
    : sys.startsWith('You extract financial') ? { items: [{ merchant, amount: 6.5, confidence: 'high', transaction_date: '2026-10-02' }] }
    : { category: 'Groceries' };
  const api = {
    workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
    mcp: {
      listTools: async () => [{ name: 'mcp__gmail__list_emails' }],
      invokeTool: async () => ({ content: JSON.stringify({ messages: [{ id: 'm1', subject: 'Your card was charged', receivedAt: '2026-10-02T10:00:00.000Z', body: 'You spent $6.50' }] }) }),
    },
    lm: {
      getActiveModel: () => 'qwen3:14b',
      sendChatRequest: (_m: string, msgs: { role: string; content: string }[]) => {
        if (msgs[0].content.startsWith('You pick')) prompts.push(msgs[1].content);
        return (async function* () { yield { content: JSON.stringify(reply(msgs[0].content)), done: true }; })();
      },
    },
    window: {
      showWarningMessage: async (_m: string, ...actions: { title: string }[]) => actions[0],
      showInformationMessage: async () => undefined,
      showErrorMessage: async (m: string) => { throw new Error(`unexpected error: ${m}`); },
    },
  };
  return { api, inserts, prompts };
}

describe('budget sync uses your past choices', () => {
  beforeEach(() => __setDbBridge(null));

  it('files a payee you chose twice without asking the model', async () => {
    const { api, inserts, prompts } = syncWith('SQ *BLUE BOTTLE 0311', [row('SQ *BLUE BOTTLE 0042', 'Dining'), row('SQ *BLUE BOTTLE 0107', 'Dining')]);
    await triggerSyncFromUI(api);
    expect(prompts).toEqual([]);
    expect(inserts).toHaveLength(1);
    // category_id, categorizer_model and categorization_source, in insert order.
    expect([inserts[0][6], inserts[0][11], inserts[0][13]]).toEqual(['c-dining', P.PAST_CHOICE_MODEL, 'rule']);
  });

  it('shows the model a single past pick and keeps its answer', async () => {
    const { api, inserts, prompts } = syncWith('SQ *BLUE BOTTLE 0311', [row('SQ *BLUE BOTTLE 0042', 'Dining')]);
    await triggerSyncFromUI(api);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Amount:   6.5 USD\nThe user's past choices for this merchant, newest first:\n  • SQ *BLUE BOTTLE 0042 → Dining (chosen)\nCategories: Dining, Groceries");
    expect([inserts[0][6], inserts[0][11], inserts[0][13]]).toEqual(['c-groceries', 'qwen3:14b', 'ai']);
  });
});
