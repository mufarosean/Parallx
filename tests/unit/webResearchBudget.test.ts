// tests/unit/webResearchBudget.test.ts — per-turn + per-day budget caps (M65 C11).

import { describe, it, expect, beforeEach } from 'vitest';

let ext: any;
let stored: Record<string, string>;
let config: Record<string, unknown>;
let DOMParserCtor: any;

async function loadDOMParser() {
  if (DOMParserCtor) return DOMParserCtor;
  try {
    const mod: any = await import('jsdom');
    DOMParserCtor = class { parseFromString(s: string) { return new mod.JSDOM(s).window.document; } };
  } catch {
    const mod: any = await import('happy-dom');
    DOMParserCtor = class { parseFromString(s: string) { const w = new mod.Window(); w.document.write(s); return w.document; } };
  }
  return DOMParserCtor;
}

beforeEach(async () => {
  ext = await import('../../ext/web-research/main.js');
  ext.__test__._setDOMParser(await loadDOMParser());
  ext.__test__.resetTurn('turn-a');
  ext.__test__.resetTurn('turn-b');
  ext.__test__.resetTurn('default-turn');
  stored = {};
  config = {};
  ext.__test__._setGlobalStorage({
    get: async (k: string) => stored[k] ?? null,
    set: async (k: string, v: string) => { stored[k] = v; },
    delete: async (k: string) => { delete stored[k]; },
  });
  // Its limits are its own settings (manifest configuration).
  ext.__test__._setApi({
    workspace: {
      getConfiguration: () => ({
        get: (name: string, fallback: unknown) => (name in config ? config[name] : fallback),
        update: async (name: string, value: unknown) => { config[name] = value; },
      }),
    },
  });
  ext.__test__._setBridge({
    webSearch: {
      request: async () => ({
        ok: true,
        result: {
          results: [{ title: 'A', url: 'https://result.example/x', snippet: '' }],
        },
      }),
    },
    webFetch: {
      request: async ({ url }: { url: string }) => ({
        ok: true,
        result: { status: 200, finalUrl: url, contentType: 'text/html', body: '<html><body>hi</body></html>' },
      }),
    },
  });
});

describe('per-turn search cap (default 20, configurable)', () => {
  it('soft-errors once the default per-turn search cap is reached', async () => {
    for (let i = 0; i < ext.__test__.PER_TURN_SEARCH_CAP; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ext.__test__.webSearchTool({ query: `q${i}` }, 'turn-a');
      expect(r.isError).toBe(false);
    }
    const r4 = await ext.__test__.webSearchTool({ query: 'q4' }, 'turn-a');
    expect(r4.isError).toBe(true);
    expect(r4.errorCode).toBe('TURN_SEARCH_CAP');
  });

  it('starts a fresh cap when the next response turn uses a new turn id', async () => {
    for (let i = 0; i < ext.__test__.PER_TURN_SEARCH_CAP; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ext.__test__.webSearchTool({ query: `q${i}` }, 'turn-a');
      expect(r.isError).toBe(false);
    }

    const capped = await ext.__test__.webSearchTool({ query: 'same turn' }, 'turn-a');
    expect(capped.isError).toBe(true);
    expect(capped.errorCode).toBe('TURN_SEARCH_CAP');

    const freshTurn = await ext.__test__.webSearchTool({ query: 'next response' }, 'turn-b');
    expect(freshTurn.isError).toBe(false);
  });

  it('honours a per-turn search cap set in Settings', async () => {
    config.perTurnSearchCap = 2;
    for (let i = 0; i < 2; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ext.__test__.webSearchTool({ query: `q${i}` }, 'turn-a');
      expect(r.isError).toBe(false);
    }
    const capped = await ext.__test__.webSearchTool({ query: 'q3' }, 'turn-a');
    expect(capped.isError).toBe(true);
    expect(capped.errorCode).toBe('TURN_SEARCH_CAP');
  });
});

describe('settings saved by the old core settings page', () => {
  it('are carried over into the extension\'s own settings once', async () => {
    stored['webResearch.dailyBudget'] = '40';
    stored['webResearch.perTurnFetchCap'] = '3';
    stored['webResearch.ambientEnabled'] = 'true';
    await ext.__test__.migrateSettings();
    expect(config).toEqual({ dailyBudget: 40, perTurnFetchCap: 3 });
    expect(stored).toEqual({});
  });
});

describe('per-turn fetch cap (default 20, configurable)', () => {
  it('soft-errors once the default per-turn fetch cap is reached', async () => {
    // Seed provenance with one URL we will fetch repeatedly.
    ext.__test__.seedTurnFromUserMessage('turn-a', 'check https://result.example/x');
    for (let i = 0; i < ext.__test__.PER_TURN_FETCH_CAP; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ext.__test__.webFetchTool({ url: 'https://result.example/x' }, 'turn-a');
      expect(r.isError).toBe(false);
    }
    const r6 = await ext.__test__.webFetchTool({ url: 'https://result.example/x' }, 'turn-a');
    expect(r6.isError).toBe(true);
    expect(r6.errorCode).toBe('TURN_FETCH_CAP');
  });
});

describe('per-day budget (default 100)', () => {
  it('soft-errors once daily counter == budget', async () => {
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    // Pre-fill counter at the budget.
    config.dailyBudget = 100;
    stored[ext.__test__.KEY_DAILY_COUNTER] = JSON.stringify({ date: today, count: 100 });

    const r = await ext.__test__.webSearchTool({ query: 'q' }, 'turn-fresh');
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('DAILY_BUDGET');
  });

  it('rolls over at local midnight (different date key resets count)', async () => {
    config.dailyBudget = 100;
    stored[ext.__test__.KEY_DAILY_COUNTER] = JSON.stringify({ date: '1999-01-01', count: 100 });
    const r = await ext.__test__.webSearchTool({ query: 'q' }, 'turn-fresh');
    expect(r.isError).toBe(false);
  });
});

describe('soft-error shape', () => {
  it('budget errors return {isError:true,errorCode,content} — they do NOT throw', async () => {
    config.dailyBudget = 1;
    stored[ext.__test__.KEY_DAILY_COUNTER] = JSON.stringify({
      date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
      count: 1,
    });
    const r = await ext.__test__.webSearchTool({ query: 'q' }, 'tx');
    expect(r).toHaveProperty('isError', true);
    expect(typeof r.errorCode).toBe('string');
    expect(typeof r.content).toBe('string');
  });
});

describe('missing Brave API key', () => {
  it('soft-errors NO_API_KEY when the bridge reports the key is absent', async () => {
    // The renderer-side extension no longer reads the API key — the
    // main-process bridge reads it from safeStorage. Simulate the bridge
    // returning the NO_API_KEY soft error.
    ext.__test__._setBridge({
      webSearch: {
        request: async () => ({
          ok: false,
          error: { code: 'NO_API_KEY', message: 'Brave Search API key not configured' },
        }),
      },
      webFetch: { request: async () => ({ ok: false, error: { code: 'NO_BRIDGE', message: '' } }) },
    });
    const r = await ext.__test__.webSearchTool({ query: 'q' }, 'turn-no-key');
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('NO_API_KEY');
  });
});
