// electron/duckDuckGoSearch.cjs — Web search with no API key, for the
// web-research extension.
//
// With a Brave Search key set (Settings › Web Research) searches go to Brave;
// without one, electron/webFetchBridge.cjs sends them here. This file reads
// DuckDuckGo's plain HTML results page (html.duckduckgo.com/html/, the one
// that works without JavaScript) and turns it into the same
// { results: [{ title, url, snippet }] } the Brave path returns.
//
// It opens no socket of its own. The bridge hands in its single-hop transport
// and its preflight, so the request passes the same gates as every other web
// request: HTTPS only, the domain blocklist, the DNS check pinned at connect,
// the wall-clock budget, the body cap, no cookies and no referer. The sealed
// workspace refusal sits in the bridge's IPC handler, before either search.
//
// DuckDuckGo throttles fast or scripted searches: queries here run one at a
// time, a fixed gap apart, and a challenge page (its "anomaly" check) comes
// back as a clear error (DDG_CHALLENGE, DDG_RATE_LIMITED); the extension adds
// the hint that a Brave key, set in its settings, is the reliable route. The
// tool's name stays out of this file: electron/ is core.

'use strict';

const DDG_HTML_HOST = 'html.duckduckgo.com';
const DDG_HTML_URL = `https://${DDG_HTML_HOST}/html/`;
// Slower than the extension's own one-a-second pacing: DuckDuckGo answers a
// burst with its challenge page, and that page then sticks for a while.
const DDG_MIN_GAP_MS = 1500;
const MAX_RESULTS = 10;

function _err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ─── HTML helpers (pure) ─────────────────────────────────────────────────────

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©', reg: '®',
});

/** Character references (named, decimal, hex) to the characters they stand for. */
function decodeEntities(text) {
  return String(text || '').replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ref) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const n = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    const v = NAMED_ENTITIES[ref.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/**
 * The visible text of a fragment: inline tags (<b> around the matched words)
 * dropped in place, block tags turned into a space, references decoded,
 * spaces collapsed.
 */
function textOf(fragment) {
  const plain = String(fragment || '')
    .replace(/<\/?(?:br|p|div|li|td|tr|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(plain).replace(/\s+/g, ' ').trim();
}

/** One attribute's raw value from a tag's attribute string, or null. */
function attrOf(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs || '');
  if (!m) return null;
  return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
}

function classesOf(attrs) {
  const v = attrOf(attrs, 'class');
  return v ? v.split(/\s+/).filter(Boolean) : [];
}

/**
 * The real address behind a result link. DuckDuckGo's links go through its
 * own redirect, `//duckduckgo.com/l/?uddg=<the address, encoded>&rut=…`;
 * that is unwrapped. An ad's link (`duckduckgo.com/y.js?…`) and any other
 * DuckDuckGo-internal link give null, as does anything not http(s).
 */
function decodeDuckDuckGoHref(href) {
  if (typeof href !== 'string' || href.trim().length === 0) return null;
  let u;
  try { u = new URL(decodeEntities(href.trim()), 'https://duckduckgo.com/'); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const internal = host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com');
  if (internal) {
    if (u.pathname !== '/l/' && u.pathname !== '/l') return null;
    const target = u.searchParams.get('uddg');
    if (!target) return null;
    let t;
    try { t = new URL(target); } catch { return null; }
    if (t.protocol !== 'https:' && t.protocol !== 'http:') return null;
    const th = t.hostname.toLowerCase();
    if (th === 'duckduckgo.com' || th.endsWith('.duckduckgo.com')) return null;
    return t.toString();
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return u.toString();
}

/** Is this result block an ad? DuckDuckGo marks them three ways; any one is enough. */
function _isAd(classes, block) {
  if (classes.some((c) => c === 'result--ad' || c.startsWith('result--ad'))) return true;
  if (/class\s*=\s*["'][^"']*\bbadge--ad\b/i.test(block)) return true;
  return /href\s*=\s*["'][^"']*duckduckgo\.com\/y\.js/i.test(block);
}

/**
 * The first element in `block` carrying `cls`, as { attrs, inner }, or null.
 * Opening tags are scanned one by one (a whole-element match on an outer
 * <div> would swallow the element inside it); the inner part runs to the
 * first closing tag of the same name, which is enough for a title or snippet.
 */
function _elementWithClass(block, cls, tags) {
  const openRe = new RegExp(`<(${tags})\\b([^>]*)>`, 'gi');
  let m;
  while ((m = openRe.exec(block))) {
    if (!classesOf(m[2]).includes(cls)) continue;
    const rest = block.slice(m.index + m[0].length);
    const close = new RegExp(`</${m[1]}\\s*>`, 'i').exec(rest);
    return { attrs: m[2], inner: close ? rest.slice(0, close.index) : rest };
  }
  return null;
}

/**
 * DuckDuckGo's HTML results page → [{ title, url, snippet }], ads left out,
 * https results only (webFetch reads nothing else), each address once, at
 * most `max` of them.
 *
 * Each result is a block whose class list holds `result`; inside it the title
 * link has class `result__a` and the snippet `result__snippet`. If the page
 * ever comes without those blocks, each title link starts a result instead.
 */
function parseDuckDuckGoHtml(html, { max = MAX_RESULTS } = {}) {
  const page = String(html || '');
  const starts = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(page))) {
    const classes = classesOf(m[2]);
    if (classes.includes('result')) starts.push({ at: m.index, classes });
  }
  if (starts.length === 0) {
    const aRe = /<a\b([^>]*)>/gi;
    while ((m = aRe.exec(page))) {
      if (classesOf(m[1]).includes('result__a')) starts.push({ at: m.index, classes: [] });
    }
  }

  const results = [];
  const seen = new Set();
  for (let i = 0; i < starts.length && results.length < max; i++) {
    const block = page.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : page.length);
    if (_isAd(starts[i].classes, block)) continue;
    const title = _elementWithClass(block, 'result__a', 'a');
    if (!title) continue;
    const url = decodeDuckDuckGoHref(attrOf(title.attrs, 'href'));
    if (!url || !url.startsWith('https://') || seen.has(url)) continue;
    const snippet = _elementWithClass(block, 'result__snippet', 'a|div|td|span');
    seen.add(url);
    results.push({ title: textOf(title.inner), url, snippet: snippet ? textOf(snippet.inner) : '' });
  }
  return results;
}

/**
 * DuckDuckGo's "are you a person" page: HTTP 202, or the anomaly modal and
 * its challenge form. Matched on markup with its quotes, which a query
 * echoed back into the page (escaped) cannot produce.
 */
function isChallengePage(status, body) {
  if (status === 202) return true;
  const page = String(body || '');
  return /class\s*=\s*"[^"]*\banomaly-modal/i.test(page)
    || /id\s*=\s*"challenge-form"/i.test(page)
    || /action\s*=\s*"[^"]*anomaly\.js/i.test(page);
}

/**
 * A results page that found nothing says so with its no-results marker.
 * Anything else with no results is a page we cannot read: every results
 * page has id="links", so that alone would read a changed layout as "no
 * results" and hide the problem.
 */
function _isEmptyResultsPage(body) {
  return /class\s*=\s*"[^"]*\b(no-results|result--no-result)\b/i.test(String(body || ''));
}

// ─── Pacing ──────────────────────────────────────────────────────────────────

/**
 * Run calls one at a time, starting each at least `gapMs` after the last one
 * finished. `now` and `sleep` are injectable so tests need no real clock.
 */
function createPacer({ gapMs = DDG_MIN_GAP_MS, now = Date.now, sleep } = {}) {
  const wait = typeof sleep === 'function'
    ? sleep
    : (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  let last = -Infinity;
  let chain = Promise.resolve();
  return function pace(call) {
    const run = chain.then(async () => {
      const due = last + gapMs - now();
      if (due > 0) await wait(due);
      try { return await call(); } finally { last = now(); }
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}

let _pace = createPacer();

// ─── The search ──────────────────────────────────────────────────────────────

/**
 * One search through DuckDuckGo's HTML page. `hop` and `preflight` are the
 * bridge's own (_doSingleHopRequest, _preflight). Returns { results } or
 * throws a typed Error: INVALID_QUERY, DDG_REDIRECTED, DDG_CHALLENGE,
 * DDG_RATE_LIMITED, DDG_HTTP_<status>, DDG_UNREADABLE, or whatever the gates
 * throw (TIMEOUT, BODY_TOO_LARGE, PRIVATE_IP...).
 */
async function doDuckDuckGoSearch({ query, hop, preflight, userAgent, timeoutMs = 15_000, max = MAX_RESULTS } = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw _err('INVALID_QUERY', 'webSearch requires a non-empty query');
  }
  if (typeof hop !== 'function' || typeof preflight !== 'function') {
    throw _err('NO_TRANSPORT', 'DuckDuckGo search needs the bridge transport');
  }
  // Fixed host, like Brave's: checked again in case the constant is ever templated wrong.
  if (new URL(DDG_HTML_URL).hostname !== DDG_HTML_HOST) {
    throw _err('SEARCH_HOST_LOCKED', `webSearch host locked to ${DDG_HTML_HOST}`);
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await preflight(DDG_HTML_URL);
    // The page's own form posts the query; a browser does the same.
    const r = await hop({
      urlStr: DDG_HTML_URL,
      method: 'POST',
      body: new URLSearchParams({ q: query.trim() }).toString(),
      signal: controller.signal,
      headers: Object.assign(
        { 'Accept': 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
        userAgent ? { 'User-Agent': userAgent } : {},
      ),
    });
    if (r.redirected) {
      throw _err('DDG_REDIRECTED', 'DuckDuckGo returned a redirect (refused)');
    }
    if (isChallengePage(r.status, r.body)) {
      throw _err('DDG_CHALLENGE', 'DuckDuckGo asked to confirm a person is searching, which it does when searches come too often.');
    }
    if (r.status === 403 || r.status === 429) {
      throw _err('DDG_RATE_LIMITED', `DuckDuckGo is limiting searches right now (HTTP ${r.status}).`);
    }
    if (r.status < 200 || r.status >= 300) {
      throw _err('DDG_HTTP_' + r.status, `DuckDuckGo HTTP ${r.status}`);
    }
    const results = parseDuckDuckGoHtml(r.body, { max });
    if (results.length === 0 && !_isEmptyResultsPage(r.body)) {
      throw _err('DDG_UNREADABLE', 'DuckDuckGo answered with a page that has no results to read.');
    }
    return { results };
  } finally {
    clearTimeout(deadline);
  }
}

/** doDuckDuckGoSearch, paced: one query at a time, DDG_MIN_GAP_MS apart. */
function searchDuckDuckGo(opts) {
  const query = opts && opts.query;
  if (typeof query !== 'string' || query.trim().length === 0) {
    return Promise.reject(_err('INVALID_QUERY', 'webSearch requires a non-empty query'));
  }
  return _pace(() => doDuckDuckGoSearch(opts));
}

module.exports = {
  searchDuckDuckGo,
  DDG_HTML_HOST,
  // Exported for tests only:
  _internals: {
    doDuckDuckGoSearch,
    parseDuckDuckGoHtml,
    decodeDuckDuckGoHref,
    decodeEntities,
    isChallengePage,
    createPacer,
    DDG_HTML_URL,
    DDG_MIN_GAP_MS,
    /** Replace the shared pacer (tests use a zero gap). */
    _setPacer(pacer) { _pace = typeof pacer === 'function' ? pacer : createPacer(); },
  },
};
