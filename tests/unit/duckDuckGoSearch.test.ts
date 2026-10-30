// tests/unit/duckDuckGoSearch.test.ts — web search with no API key.
//
// Without a Brave key, webSearch reads DuckDuckGo's HTML results page
// (electron/duckDuckGoSearch.cjs) through the bridge's own gates. Covered:
//   * the parser on a fixture shaped like the real page (result blocks,
//     result__a titles, result__snippet text, ads in two forms, entities)
//   * the uddg redirect links decoded to the real address
//   * the challenge ("anomaly") page and rate limits as clear errors
//   * the choice: Brave with a key, DuckDuckGo without, through the same
//     preflight and transport, and the IPC handler that reads the key
//   * the pacing between DuckDuckGo queries
// No network: every request goes to an injected transport.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ddg = require_('../../electron/duckDuckGoSearch.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bridge = require_('../../electron/webFetchBridge.cjs');
const {
  parseDuckDuckGoHtml, decodeDuckDuckGoHref, decodeEntities, isChallengePage,
  doDuckDuckGoSearch, createPacer, DDG_HTML_URL,
} = ddg._internals;
const { runWebSearch, BRAVE_SEARCH_HOST } = bridge._internals;

const enc = encodeURIComponent;
const ddgLink = (target: string, rut = 'a1b2c3') => `//duckduckgo.com/l/?uddg=${enc(target)}&amp;rut=${rut}`;

// Shaped like html.duckduckgo.com/html/ as served: a header with the search
// form (the query echoed back), an ad block on top, organic results, a second
// ad marked only by its badge, and the "next page" form at the bottom.
const FIXTURE = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="content-type" content="text/html; charset=UTF-8">
  <title>rust borrow checker at DuckDuckGo</title>
  <link rel="stylesheet" href="/dist/h.css" type="text/css">
</head>
<body>
  <div id="header" class="header cw">
    <form name="x" class="header__form" action="/html/" method="post">
      <input name="q" autocomplete="off" class="search__input" id="search_form_input_homepage" type="text" value="rust borrow checker" />
      <input name="b" id="search_button_homepage" class="search__button search__button--html" value="" title="Search" alt="Search" type="submit" />
    </form>
  </div>
  <div>
  <div class="serp__results">
  <div id="links" class="results">

    <div class="result results_links results_links_deep result--ad result--ad--small">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=example-ads.com&amp;ad_provider=bingv7aa&amp;ad_type=txad&amp;u3=https%3A%2F%2Fwww.bing.com%2Faclick">Learn Rust Fast - <b>Online Course</b></a>
        </h2>
        <div class="result__extras">
          <div class="result__extras__url">
            <a class="result__url" href="https://duckduckgo.com/y.js?ad_domain=example-ads.com">example-ads.com</a>
            <span class="badge--ad">Ad</span>
          </div>
        </div>
        <a class="result__snippet" href="https://duckduckgo.com/y.js?ad_domain=example-ads.com">Sponsored copy.</a>
      </div>
    </div>

    <div class="result results_links results_links_deep web-result ">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${ddgLink('https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html')}">References and <b>Borrowing</b> - The Rust Programming Language</a>
        </h2>
        <div class="result__extras">
          <div class="result__extras__url">
            <span class="result__icon">
              <a rel="nofollow" href="${ddgLink('https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html')}">
                <img class="result__icon__img" width="16" height="16" alt="" src="//external-content.duckduckgo.com/ip3/doc.rust-lang.org.ico" name="i15" />
              </a>
            </span>
            <a class="result__url" href="${ddgLink('https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html')}">doc.rust-lang.org/book/ch04-02-references-and-borrowing.html</a>
          </div>
        </div>
        <a class="result__snippet" href="${ddgLink('https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html')}">The <b>borrow</b> <b>checker</b> ensures references are always valid &amp; never outlive the data they refer to.</a>
        <div class="clear"></div>
      </div>
    </div>

    <div class="result results_links results_links_deep web-result ">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${ddgLink('https://blog.example.org/posts/borrowck?lang=en&ref=1')}">Understanding the &quot;borrow checker&quot; &#8211; a guide</a>
        </h2>
        <a class="result__snippet" href="${ddgLink('https://blog.example.org/posts/borrowck?lang=en&ref=1')}">Why <b>Rust</b>&#x27;s rules feel strict at first&hellip;</a>
        <div class="clear"></div>
      </div>
    </div>

    <div class="result results_links results_links_deep web-result ">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${ddgLink('http://insecure.example.com/rust')}">An http-only page</a>
        </h2>
        <a class="result__snippet" href="${ddgLink('http://insecure.example.com/rust')}">Not https.</a>
      </div>
    </div>

    <div class="result results_links results_links_deep">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${ddgLink('https://shop.example.net/rust')}">Rust gear</a>
        </h2>
        <div class="result__extras"><span class="badge--ad">Ad</span></div>
        <a class="result__snippet" href="${ddgLink('https://shop.example.net/rust')}">Marked as an ad by its badge only.</a>
      </div>
    </div>

    <div class="result results_links results_links_deep web-result ">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="${ddgLink('https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html', 'zz')}">Duplicate of the first result</a>
        </h2>
        <a class="result__snippet" href="#">Same address again.</a>
      </div>
    </div>

    <div class="result results_links results_links_deep web-result ">
      <div class="links_main links_deep result__body">
        <h2 class="result__title">
          <a rel="nofollow" class="result__a" href="https://stackoverflow.example.com/q/42">A direct link with no redirect</a>
        </h2>
        <div class="result__snippet">Snippet in a div.</div>
      </div>
    </div>

    <div class="nav-link">
      <form action="/html/" method="post">
        <input type="submit" class="btn btn--alt" value="Next" />
        <input type="hidden" name="q" value="rust borrow checker" />
        <input type="hidden" name="s" value="10" />
      </form>
    </div>
  </div>
  </div>
  </div>
</body>
</html>`;

const CHALLENGE_PAGE = `<!DOCTYPE html><html><head><title>DuckDuckGo</title></head><body>
<div class="anomaly-modal__mask"><div class="anomaly-modal__modal" data-testid="anomaly-modal">
<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>
<form id="challenge-form" action="//duckduckgo.com/anomaly.js?sv=html&amp;cc=sre" method="POST">
<input type="hidden" name="q" value="rust" /></form></div></div></body></html>`;

const NO_RESULTS_PAGE = `<html><body><div id="links" class="results">
<div class="no-results">No results.</div></div></body></html>`;

// ─── Parser ──────────────────────────────────────────────────────────────────

describe('parseDuckDuckGoHtml', () => {
  const results = parseDuckDuckGoHtml(FIXTURE);

  it('reads organic results in page order as {title, url, snippet}', () => {
    expect(results).toEqual([
      {
        title: 'References and Borrowing - The Rust Programming Language',
        url: 'https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html',
        snippet: 'The borrow checker ensures references are always valid & never outlive the data they refer to.',
      },
      {
        title: 'Understanding the "borrow checker" – a guide',
        url: 'https://blog.example.org/posts/borrowck?lang=en&ref=1',
        snippet: 'Why Rust\'s rules feel strict at first…',
      },
      {
        title: 'A direct link with no redirect',
        url: 'https://stackoverflow.example.com/q/42',
        snippet: 'Snippet in a div.',
      },
    ]);
  });

  it('skips ads, whether marked by class, by badge, or by the ad link', () => {
    const urls = results.map((r: { url: string }) => r.url).join(' ');
    expect(urls).not.toMatch(/y\.js|bing\.com|example-ads|shop\.example\.net/);
  });

  it('drops http results and repeats of the same address', () => {
    expect(results.some((r: { url: string }) => r.url.startsWith('http://'))).toBe(false);
    expect(results.filter((r: { url: string }) => r.url.includes('doc.rust-lang.org')).length).toBe(1);
  });

  it('stops at max results', () => {
    expect(parseDuckDuckGoHtml(FIXTURE, { max: 1 })).toHaveLength(1);
  });

  it('reads title links even when the page has no result blocks', () => {
    const bare = `<p><a class="result__a" href="${ddgLink('https://a.example/1')}">One</a>
      <a class="result__snippet" href="#">First</a></p>
      <p><a href="${ddgLink('https://b.example/2')}" class='result__a'>Two</a></p>`;
    expect(parseDuckDuckGoHtml(bare)).toEqual([
      { title: 'One', url: 'https://a.example/1', snippet: 'First' },
      { title: 'Two', url: 'https://b.example/2', snippet: '' },
    ]);
  });

  it('gives nothing for empty or non-results pages', () => {
    expect(parseDuckDuckGoHtml('')).toEqual([]);
    expect(parseDuckDuckGoHtml(NO_RESULTS_PAGE)).toEqual([]);
    expect(parseDuckDuckGoHtml(CHALLENGE_PAGE)).toEqual([]);
  });
});

describe('decodeDuckDuckGoHref (uddg redirect links)', () => {
  it('unwraps the protocol-relative redirect, with &amp; in the attribute', () => {
    expect(decodeDuckDuckGoHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2&amp;rut=abc'))
      .toBe('https://example.com/a?b=1&c=2');
  });

  it('unwraps the absolute and path-only forms', () => {
    expect(decodeDuckDuckGoHref('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F')).toBe('https://example.com/');
    expect(decodeDuckDuckGoHref('/l/?kh=-1&uddg=https%3A%2F%2Fexample.com%2Fx')).toBe('https://example.com/x');
  });

  it('keeps non-ASCII and encoded characters of the target', () => {
    expect(decodeDuckDuckGoHref(`//duckduckgo.com/l/?uddg=${enc('https://de.example.org/Straße?q=a b')}`))
      .toBe('https://de.example.org/Stra%C3%9Fe?q=a%20b');
  });

  it('refuses ad links, internal links, other schemes and redirects back to DuckDuckGo', () => {
    expect(decodeDuckDuckGoHref('https://duckduckgo.com/y.js?ad_domain=x&u3=https%3A%2F%2Fbing.com')).toBeNull();
    expect(decodeDuckDuckGoHref('/html/?q=next')).toBeNull();
    expect(decodeDuckDuckGoHref(`//duckduckgo.com/l/?uddg=${enc('javascript:alert(1)')}`)).toBeNull();
    expect(decodeDuckDuckGoHref(`//duckduckgo.com/l/?uddg=${enc('https://duckduckgo.com/?q=loop')}`)).toBeNull();
    expect(decodeDuckDuckGoHref('//duckduckgo.com/l/?rut=only')).toBeNull();
    expect(decodeDuckDuckGoHref('')).toBeNull();
    expect(decodeDuckDuckGoHref('mailto:a@b.example')).toBeNull();
  });

  it('passes a direct link through', () => {
    expect(decodeDuckDuckGoHref('https://example.com/direct')).toBe('https://example.com/direct');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references and leaves unknown ones', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &quot;e&quot; &hellip; &bogus;')).toBe('a & b <c> \'d\' "e" … &bogus;');
  });
});

describe('isChallengePage', () => {
  it('knows the anomaly page and HTTP 202', () => {
    expect(isChallengePage(200, CHALLENGE_PAGE)).toBe(true);
    expect(isChallengePage(202, '')).toBe(true);
  });

  it('does not mistake a results page that echoes such words in the query', () => {
    const echoed = FIXTURE.replace(/value="rust borrow checker"/g, 'value="anomaly-modal challenge-form &quot;anomaly.js&quot;"');
    expect(isChallengePage(200, echoed)).toBe(false);
  });
});

// ─── The search, through an injected transport ───────────────────────────────

type Hop = (req: { urlStr: string; method?: string; body?: string; headers?: Record<string, string> }) => Promise<unknown>;

function page(body: string, status = 200): Hop {
  return async ({ urlStr }) => ({ redirected: false, status, contentType: 'text/html; charset=utf-8', body, finalUrl: urlStr });
}

const okPreflight = async () => undefined;

describe('doDuckDuckGoSearch', () => {
  it('posts the query to the fixed HTML endpoint through the given preflight and transport', async () => {
    const seen: { preflight: string[]; requests: Parameters<Hop>[0][] } = { preflight: [], requests: [] };
    const r = await doDuckDuckGoSearch({
      query: '  rust borrow checker  ',
      preflight: async (u: string) => { seen.preflight.push(u); },
      hop: async (req: Parameters<Hop>[0]) => { seen.requests.push(req); return page(FIXTURE)(req); },
      userAgent: 'UA',
    });
    expect(r.results).toHaveLength(3);
    expect(seen.preflight).toEqual([DDG_HTML_URL]);
    expect(DDG_HTML_URL).toBe('https://html.duckduckgo.com/html/');
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]).toMatchObject({ urlStr: DDG_HTML_URL, method: 'POST', body: 'q=rust+borrow+checker' });
    expect(seen.requests[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'UA' });
  });

  it('a gate refusal in the preflight stops the request', async () => {
    let called = false;
    const refuse = async () => { const e: any = new Error('priv'); e.code = 'PRIVATE_IP'; throw e; };
    await expect(doDuckDuckGoSearch({ query: 'q', preflight: refuse, hop: async () => { called = true; } }))
      .rejects.toMatchObject({ code: 'PRIVATE_IP' });
    expect(called).toBe(false);
  });

  it('the challenge page is a clear error, not an empty result list', async () => {
    const err = await doDuckDuckGoSearch({ query: 'q', preflight: okPreflight, hop: page(CHALLENGE_PAGE, 202) }).catch((e: any) => e);
    expect(err.code).toBe('DDG_CHALLENGE');
    expect(err.message).toMatch(/DuckDuckGo asked to confirm a person is searching/);
  });

  it('403 and 429 are a rate limit (and no quick retry)', async () => {
    for (const status of [403, 429]) {
      // eslint-disable-next-line no-await-in-loop
      const err = await doDuckDuckGoSearch({ query: 'q', preflight: okPreflight, hop: page('', status) }).catch((e: any) => e);
      expect(err.code).toBe('DDG_RATE_LIMITED');
      // The extension retries a code containing 429 at once; DuckDuckGo must not be.
      expect(err.code).not.toMatch(/429/);
      expect(err.message).toMatch(new RegExp(`HTTP ${status}`));
    }
  });

  it('a redirect is refused, other HTTP errors carry the status', async () => {
    await expect(doDuckDuckGoSearch({ query: 'q', preflight: okPreflight, hop: async () => ({ redirected: true, nextUrl: 'https://duckduckgo.com/', status: 302 }) }))
      .rejects.toMatchObject({ code: 'DDG_REDIRECTED' });
    await expect(doDuckDuckGoSearch({ query: 'q', preflight: okPreflight, hop: page('', 500) }))
      .rejects.toMatchObject({ code: 'DDG_HTTP_500' });
  });

  it('a results page with no results is an empty list; an unknown page is an error', async () => {
    await expect(doDuckDuckGoSearch({ query: 'q', preflight: okPreflight, hop: page(NO_RESULTS_PAGE) })).resolves.toEqual({ results: [] });
    await expect(doDuckDuckGoSearch({ query: 'q', preflight: okPreflight, hop: page('<html><body>Something else</body></html>') }))
      .rejects.toMatchObject({ code: 'DDG_UNREADABLE' });
  });

  it('an empty query is refused before any request', async () => {
    await expect(doDuckDuckGoSearch({ query: '   ', preflight: okPreflight, hop: page(FIXTURE) })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(ddg.searchDuckDuckGo({ query: '', preflight: okPreflight, hop: page(FIXTURE) })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});

describe('createPacer', () => {
  it('runs calls one at a time, the gap apart, on an injected clock', async () => {
    let clock = 10_000;
    const waits: number[] = [];
    const pace = createPacer({ gapMs: 1500, now: () => clock, sleep: async (ms: number) => { waits.push(ms); clock += ms; } });
    const order: string[] = [];
    const call = (name: string, cost: number) => async () => { order.push(`start ${name}`); clock += cost; order.push(`end ${name}`); return name; };
    const results = await Promise.all([pace(call('a', 200)), pace(call('b', 100)), pace(call('c', 0))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(waits).toEqual([1500, 1500]);
    clock += 5_000;
    await pace(call('d', 0));
    expect(waits).toEqual([1500, 1500]);
  });

  it('a failed call still holds the gap and does not block the next', async () => {
    let clock = 0;
    const waits: number[] = [];
    const pace = createPacer({ gapMs: 1000, now: () => clock, sleep: async (ms: number) => { waits.push(ms); clock += ms; } });
    await expect(pace(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(pace(async () => 'next')).resolves.toBe('next');
    expect(waits).toEqual([1000]);
  });

  it('the shared pacer keeps at least about a second between DuckDuckGo queries', () => {
    expect(ddg._internals.DDG_MIN_GAP_MS).toBeGreaterThanOrEqual(1000);
  });
});

// ─── Brave or DuckDuckGo ─────────────────────────────────────────────────────

const BRAVE_JSON = JSON.stringify({ web: { results: [{ title: 'Brave hit', url: 'https://brave-hit.example/', description: 'from Brave' }] } });

function recordingTransport() {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const hop = async (req: { urlStr: string; headers?: Record<string, string> }) => {
    urls.push(req.urlStr);
    headers.push(req.headers || {});
    const body = new URL(req.urlStr).hostname === BRAVE_SEARCH_HOST ? BRAVE_JSON : FIXTURE;
    return { redirected: false, status: 200, contentType: 'text/html', body, finalUrl: req.urlStr };
  };
  return { urls, headers, hop };
}

describe('runWebSearch: the key decides the engine', () => {
  beforeEach(() => ddg._internals._setPacer(createPacer({ gapMs: 0 })));

  it('with a key: Brave, with the key in its header, and DuckDuckGo is not asked', async () => {
    const t = recordingTransport();
    const preflighted: string[] = [];
    const r = await runWebSearch({
      query: 'rust', apiKey: 'BSA-key', _injectedFetch: t.hop,
      _injectedPreflight: async (u: string) => { preflighted.push(u); },
    });
    expect(r.provider).toBe('brave');
    expect(r.results).toEqual([{ title: 'Brave hit', url: 'https://brave-hit.example/', snippet: 'from Brave' }]);
    expect(t.urls).toHaveLength(1);
    expect(new URL(t.urls[0]).hostname).toBe(BRAVE_SEARCH_HOST);
    expect(t.headers[0]['X-Subscription-Token']).toBe('BSA-key');
    expect(preflighted.map((u) => new URL(u).hostname)).toEqual([BRAVE_SEARCH_HOST]);
  });

  it('without a key (none, empty): DuckDuckGo, through the same preflight and transport', async () => {
    for (const apiKey of [null, undefined, '']) {
      const t = recordingTransport();
      const preflighted: string[] = [];
      // eslint-disable-next-line no-await-in-loop
      const r = await runWebSearch({
        query: 'rust', apiKey, _injectedFetch: t.hop,
        _injectedPreflight: async (u: string) => { preflighted.push(u); },
      });
      expect(r.provider).toBe('duckduckgo');
      expect(r.results.map((x: { url: string }) => x.url)).toEqual([
        'https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html',
        'https://blog.example.org/posts/borrowck?lang=en&ref=1',
        'https://stackoverflow.example.com/q/42',
      ]);
      expect(t.urls).toEqual([DDG_HTML_URL]);
      expect(preflighted).toEqual([DDG_HTML_URL]);
      expect(t.headers[0]['X-Subscription-Token']).toBeUndefined();
    }
  });
});

describe('webSearch:request handler', () => {
  beforeEach(() => ddg._internals._setPacer(createPacer({ gapMs: 0 })));

  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  function setup(key: string | null, sealed = false) {
    const handlers = new Map<string, Handler>();
    const t = recordingTransport();
    bridge.setupWebFetchBridge(
      { handle: (ch: string, fn: Handler) => { handlers.set(ch, fn); } },
      '',
      async () => key,
      { isSealed: () => sealed, searchTransport: t.hop, searchPreflight: okPreflight },
    );
    return { t, call: (opts: unknown) => handlers.get('webSearch:request')!({}, opts) as Promise<any> };
  }

  it('no key set: searches work, through DuckDuckGo', async () => {
    const { t, call } = setup(null);
    const r = await call({ query: 'rust', turnId: 't1' });
    expect(r.ok).toBe(true);
    expect(r.result.provider).toBe('duckduckgo');
    expect(r.result.results).toHaveLength(3);
    expect(t.urls).toEqual([DDG_HTML_URL]);
  });

  it('a key set: Brave; a key passed from the renderer is ignored', async () => {
    const { t, call } = setup('stored-key');
    const r = await call({ query: 'rust', apiKey: 'renderer-key' });
    expect(r.result.provider).toBe('brave');
    expect(t.headers[0]['X-Subscription-Token']).toBe('stored-key');
  });

  it('a renderer cannot slip in its own transport', async () => {
    const { t, call } = setup(null);
    const r = await call({ query: 'rust', searchTransport: 'x', _injectedFetch: 'y' });
    expect(r.ok).toBe(true);
    expect(t.urls).toEqual([DDG_HTML_URL]);
  });

  it('a sealed workspace refuses either engine before any request', async () => {
    for (const key of [null, 'stored-key']) {
      const { t, call } = setup(key, true);
      // eslint-disable-next-line no-await-in-loop
      expect(await call({ query: 'rust' })).toMatchObject({ ok: false, error: { code: 'SEALED' } });
      expect(t.urls).toEqual([]);
    }
  });

  it('a DuckDuckGo challenge comes back as an error the extension can show', async () => {
    const handlers = new Map<string, Handler>();
    bridge.setupWebFetchBridge(
      { handle: (ch: string, fn: Handler) => { handlers.set(ch, fn); } }, '', async () => null,
      { isSealed: () => false, searchTransport: page(CHALLENGE_PAGE, 202), searchPreflight: okPreflight },
    );
    const r: any = await handlers.get('webSearch:request')!({}, { query: 'rust' });
    expect(r).toMatchObject({ ok: false, error: { code: 'DDG_CHALLENGE' } });
  });
});

// ─── The extension's side: the hint, the caps ────────────────────────────────

describe('webSearch tool with DuckDuckGo behind the bridge', () => {
  let ext: any;
  let stored: Record<string, string>;
  beforeEach(async () => {
    // @ts-expect-error — JS module with no types
    ext = await import('../../ext/web-research/main.js');
    ext.__test__.resetTurn('ddg-turn');
    stored = {};
    ext.__test__._setGlobalStorage({
      get: async (k: string) => stored[k] ?? null,
      set: async (k: string, v: string) => { stored[k] = v; },
      delete: async (k: string) => { delete stored[k]; },
    });
    ext.__test__._setApi({ workspace: { getConfiguration: () => ({ get: (_n: string, f: unknown) => f, update: async () => {} }) } });
  });

  function bridgeWith(transport: Hop) {
    const handlers = new Map<string, Handler>();
    bridge.setupWebFetchBridge(
      { handle: (ch: string, fn: Handler) => { handlers.set(ch, fn); } }, '', async () => null,
      { isSealed: () => false, searchTransport: transport, searchPreflight: okPreflight },
    );
    ext.__test__._setBridge({ 'webSearch:request': (o: unknown) => handlers.get('webSearch:request')!({}, o) });
  }
  type Handler = (event: unknown, ...args: unknown[]) => unknown;

  it('a challenge tells the user to add a Brave key in Settings › Web Research, and costs no budget', async () => {
    ddg._internals._setPacer(createPacer({ gapMs: 0 }));
    bridgeWith(page(CHALLENGE_PAGE, 202));
    const r = await ext.__test__.webSearchTool({ query: 'rust' }, 'ddg-turn');
    expect(r).toMatchObject({ isError: true, errorCode: 'DDG_CHALLENGE' });
    expect(r.content).toMatch(/Add a Brave Search API key in Settings › Web Research for reliable search\./);
    expect(stored[ext.__test__.KEY_DAILY_COUNTER]).toBeUndefined();
  });

  it('results count against the per-day budget, as with Brave', async () => {
    ddg._internals._setPacer(createPacer({ gapMs: 0 }));
    bridgeWith(page(FIXTURE));
    const r = await ext.__test__.webSearchTool({ query: 'rust' }, 'ddg-turn');
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content).results).toHaveLength(3);
    expect(JSON.parse(stored[ext.__test__.KEY_DAILY_COUNTER]).count).toBe(1);
    expect(r.content).not.toMatch(/Brave Search API key/);
  });
});
