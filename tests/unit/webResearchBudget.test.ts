// tests/unit/webResearchBudget.test.ts — per-turn + per-day budget caps (M65 C11).

import { describe, it, expect, beforeEach } from 'vitest';

let ext: any;
let stored: Record<string, string>;
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
  stored = {};
  ext.__test__._setGlobalStorage({
    get: async (k: string) => stored[k] ?? null,
    set: async (k: string, v: string) => { stored[k] = v; },
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

describe('per-turn search cap (3)', () => {
  it('soft-errors on the 4th search in the same turn', async () => {
    for (let i = 0; i < ext.__test__.PER_TURN_SEARCH_CAP; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await ext.__test__.webSearchTool({ query: `q${i}` }, 'turn-a');
      expect(r.isError).toBe(false);
    }
    const r4 = await ext.__test__.webSearchTool({ query: 'q4' }, 'turn-a');
    expect(r4.isError).toBe(true);
    expect(r4.errorCode).toBe('TURN_SEARCH_CAP');
  });
});

describe('per-turn fetch cap (5)', () => {
  it('soft-errors on the 6th fetch in the same turn', async () => {
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
    stored[ext.__test__.KEY_DAILY_BUDGET] = '100';
    stored[ext.__test__.KEY_DAILY_COUNTER] = JSON.stringify({ date: today, count: 100 });

    const r = await ext.__test__.webSearchTool({ query: 'q' }, 'turn-fresh');
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('DAILY_BUDGET');
  });

  it('rolls over at local midnight (different date key resets count)', async () => {
    stored[ext.__test__.KEY_DAILY_BUDGET] = '100';
    stored[ext.__test__.KEY_DAILY_COUNTER] = JSON.stringify({ date: '1999-01-01', count: 100 });
    const r = await ext.__test__.webSearchTool({ query: 'q' }, 'turn-fresh');
    expect(r.isError).toBe(false);
  });
});

describe('soft-error shape', () => {
  it('budget errors return {isError:true,errorCode,content} — they do NOT throw', async () => {
    stored[ext.__test__.KEY_DAILY_BUDGET] = '1';
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
