// electron/webFetchBridge.cjs — Web egress chokepoint for the web-research
// extension (M65 Iter 1, Security Layer 1).
//
// SECURITY CRITICAL — DO NOT WEAKEN ANY CONTROL.
// Every outbound HTTP from the extension goes through this single file.
//
// Conditions enforced (per Security Analyst pre-audit C1–C15):
//   C1 — DNS pre-flight: dns.lookup(host,{all:true}) before connect; reject
//        if ANY resolved address is private/loopback/link-local/CGNAT.
//   C2 — Redirects re-run C1 end-to-end. Manual redirect handling only.
//        Max 3 hops. Re-resolve + re-blocklist + re-HTTPS on every hop.
//   C3 — HTTPS hard reject via url.protocol === 'https:'.
//   C4 — Domain blocklist on lowercased+punycoded host of FINAL url.
//        Subdomain match: host === entry || host.endsWith('.'+entry).
//   C5 — Provenance handled in the extension, not here.
//   C6 — Body cap = bytes-read counter on stream, NOT Content-Length. 10MB.
//   C7 — 15s wall-clock budget = single AbortController covering everything.
//   C8 — Sanitization in extension (Readability + DOMParser post-strip).
//   C9 — <untrusted_web_content> wrapping in extension.
//   C10 — Fixed UA 'Parallx-Research/1.0'. No cookies/auth/referer. No jar.
//   C11 — Per-turn / per-day budget in tool handler before calling bridge.
//   C12 — webSearch allowlisted to api.search.brave.com only.
//   C13 — Test coverage; see tests/unit/webFetchBridge.test.ts.
//   C14 — No fetch()/http/https require in ext/web-research/; grep test.
//   C15 — main.cjs edit is two lines only.
//
// Anti-patterns refused:
//   - http://-then-warn-and-proceed
//   - dns.lookup once then connect (race-condition rebind)
//   - https.request with auto-follow redirects
//   - Trusting Content-Length for body cap
//   - Caching DNS across hops

'use strict';

const dns = require('dns');
const https = require('https');
const net = require('net');
const os = require('os');
const { URL } = require('url');

// ─── Constants ───────────────────────────────────────────────────────────────

const FIXED_USER_AGENT = 'Parallx-Research/1.0';
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 10 * 1024 * 1024;       // 10 MB (C6)
const TOTAL_TIMEOUT_MS = 15_000;                // 15 s wall clock (C7)
const PER_TURN_FETCH_BACKSTOP = 5;              // Backstop ceiling per turn
const BRAVE_SEARCH_HOST = 'api.search.brave.com'; // C12 allowlist

// Domain blocklist (C4). Lowercase. Subdomain match: host === e || host.endsWith('.'+e).
const DOMAIN_BLOCKLIST = Object.freeze([
  'webhook.site',
  'requestbin.com',
  'requestbin.net',
  'pipedream.net',
  'pastebin.com',                   // path /raw/* defense-in-depth below
  'metadata.google.internal',
  'metadata.azure.com',
  '169.254.169.254',
]);

// Private/reserved IPv4 CIDRs (C1). Stored as [base, prefix] for cheap match.
const PRIVATE_V4_CIDRS = Object.freeze([
  ['0.0.0.0',       8],   // "this host on this network"
  ['10.0.0.0',      8],   // private
  ['100.64.0.0',    10],  // CGNAT
  ['127.0.0.0',     8],   // loopback
  ['169.254.0.0',   16],  // link-local + cloud metadata
  ['172.16.0.0',    12],  // private
  ['192.0.0.0',     24],  // IETF protocol
  ['192.0.2.0',     24],  // TEST-NET-1
  ['192.168.0.0',   16],  // private
  ['198.18.0.0',    15],  // benchmark
  ['198.51.100.0',  24],  // TEST-NET-2
  ['203.0.113.0',   24],  // TEST-NET-3
  ['224.0.0.0',     4],   // multicast
  ['240.0.0.0',     4],   // reserved
  ['255.255.255.255', 32], // broadcast
]);

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

function _ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const x = Number(p);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = (n * 256) + x;
  }
  return n;
}

function _isIpv4InCidr(ip, base, prefix) {
  const ipInt = _ipv4ToInt(ip);
  const baseInt = _ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (prefix === 0) return true;
  if (prefix === 32) return ipInt === baseInt;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

/**
 * Return true if the given IP (v4 or v6 literal string) is private/loopback/
 * link-local/CGNAT/multicast/reserved — i.e. must NOT be reachable from a
 * web research fetch.
 */
function isPrivateIp(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return true;

  const family = net.isIP(ip);
  if (family === 0) return true; // unparseable — refuse

  if (family === 4) {
    for (const [base, prefix] of PRIVATE_V4_CIDRS) {
      if (_isIpv4InCidr(ip, base, prefix)) return true;
    }
    return false;
  }

  // IPv6 — normalize lowercase, strip zone id.
  const v6 = ip.toLowerCase().split('%')[0];

  if (v6 === '::' || v6 === '::1') return true;            // unspec + loopback
  if (v6.startsWith('fe80:') || v6.startsWith('fe80::')) return true; // link-local
  if (v6.startsWith('febf:')) return true;                  // link-local upper
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local fc00::/7
  if (v6.startsWith('ff')) return true;                     // multicast ff00::/8

  // IPv4-mapped ::ffff:a.b.c.d
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]);

  // IPv4-compatible ::a.b.c.d (deprecated but possible)
  const compat = /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v6);
  if (compat) return isPrivateIp(compat[1]);

  return false;
}

/**
 * Return true if the host (already lowercased+punycoded by URL parser)
 * matches the C4 domain blocklist, including subdomains and the path
 * defense-in-depth for pastebin.com/raw/*.
 */
function isBlocklistedHost(host, pathname) {
  if (typeof host !== 'string') return true;
  const h = host.toLowerCase();
  for (const entry of DOMAIN_BLOCKLIST) {
    if (h === entry) return true;
    if (h.endsWith('.' + entry)) return true;
  }
  // Defense-in-depth: even if someone proxies pastebin via a different host,
  // path /raw/ is the exfil pattern.
  if (typeof pathname === 'string' && /^\/raw(\/|$)/i.test(pathname) && /pastebin/i.test(h)) {
    return true;
  }
  return false;
}

/**
 * Canonicalize a URL for provenance comparison (C5 lives in extension, but
 * the same canonicalization is exported here so the bridge and the extension
 * agree on shape). Lowercase scheme + host, drop fragment, strip trailing
 * '/' on bare host (no path), keep search.
 */
function canonicalUrl(input) {
  let u;
  try { u = new URL(input); } catch { return null; }
  const scheme = u.protocol.toLowerCase();
  const host = u.hostname.toLowerCase();
  let path = u.pathname || '';
  if (path === '/') path = '';
  const search = u.search || '';
  return `${scheme}//${host}${path}${search}`;
}

// ─── DNS preflight ───────────────────────────────────────────────────────────

/**
 * Resolve every address for host and return the list, or throw if ANY
 * resolved address is private. (C1 — reject if ANY is private. No race.)
 */
function _resolveAndGuard(host) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return reject(_err('DNS_LOOKUP_FAILED', `DNS lookup failed for ${host}: ${err.code || err.message}`));
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return reject(_err('DNS_EMPTY', `DNS returned no addresses for ${host}`));
      }
      for (const a of addresses) {
        if (isPrivateIp(a.address)) {
          return reject(_err('PRIVATE_IP', `Refusing to connect to ${host}: resolves to private/reserved address ${a.address}`));
        }
      }
      resolve(addresses);
    });
  });
}

/**
 * Build a `lookup`-compatible callback that returns ONLY addresses we have
 * already vetted in `_resolveAndGuard`. Closes the TOCTOU window between
 * the preflight `dns.lookup` and Node's own `dns.lookup` at connect time
 * (F3 — M65 Iter 2). The callback never invokes DNS itself; it is a pure
 * data-return function over the closure-captured prevalidated set.
 *
 * Signature matches Node's `dns.lookup(hostname, options, cb)`:
 *   options.family  — 0 | 4 | 6
 *   options.all     — boolean
 *   cb(err, address, family)         when !options.all
 *   cb(err, addresses)               when  options.all
 */
function _makePinnedLookup(prevalidated) {
  // Snapshot once — never mutate.
  const snapshot = prevalidated.map((a) => ({ address: a.address, family: a.family }));
  return function pinnedLookup(_host, options, callback) {
    // Node accepts (host, family, cb) and (host, options, cb).
    let opts;
    let cb;
    if (typeof options === 'function') { cb = options; opts = {}; }
    else { opts = options || {}; cb = callback; }
    const wantFamily = typeof opts === 'number' ? opts : (opts.family || 0);
    const wantAll = !!opts.all;

    let candidates = snapshot;
    if (wantFamily === 4 || wantFamily === 6) {
      candidates = snapshot.filter((a) => a.family === wantFamily);
    }
    if (candidates.length === 0) {
      // Should be unreachable since we vetted at least one address. If the
      // socket happens to demand an unavailable family, refuse defensively
      // rather than fall through to a fresh DNS lookup.
      return cb(_err('PRIVATE_IP', `No prevalidated address available for requested family ${wantFamily}`));
    }
    if (wantAll) {
      return cb(null, candidates.map((a) => ({ address: a.address, family: a.family })));
    }
    return cb(null, candidates[0].address, candidates[0].family);
  };
}

function _err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ─── Per-turn fetch counter (backstop) ───────────────────────────────────────

const _turnFetchCounts = new Map();

function _incrementTurnFetch(turnId) {
  if (typeof turnId !== 'string' || turnId.length === 0) return null;
  const cur = (_turnFetchCounts.get(turnId) || 0) + 1;
  _turnFetchCounts.set(turnId, cur);
  // Bounded growth — keep at most the most recent 64 turn ids.
  if (_turnFetchCounts.size > 64) {
    const firstKey = _turnFetchCounts.keys().next().value;
    if (firstKey !== undefined) _turnFetchCounts.delete(firstKey);
  }
  return cur;
}

function _resetTurnFetchCount(turnId) {
  _turnFetchCounts.delete(turnId);
}

// ─── HTTPS request (single hop) ──────────────────────────────────────────────

/**
 * Preflight: HTTPS check + blocklist + DNS preflight. Runs BEFORE every
 * hop (initial request and every redirect destination). Defense-in-depth:
 * _doSingleHopRequest runs the same checks again; the orchestrator-level
 * preflight ensures tests that inject a mock transport still go through
 * every gate.
 */
async function _preflight(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); } catch {
    throw _err('INVALID_URL', `Invalid URL: ${urlStr}`);
  }
  if (parsed.protocol !== 'https:') {                          // C3
    throw _err('NOT_HTTPS', `Refusing non-HTTPS URL: ${parsed.protocol}//`);
  }
  if (isBlocklistedHost(parsed.hostname, parsed.pathname)) {   // C4
    throw _err('BLOCKLISTED', `Host on egress blocklist: ${parsed.hostname}`);
  }
  await _resolveAndGuard(parsed.hostname);                      // C1
  return parsed;
}

function _doSingleHopRequest({ urlStr, signal, headers, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch {
      return reject(_err('INVALID_URL', `Invalid URL: ${urlStr}`));
    }
    if (parsed.protocol !== 'https:') {                          // C3
      return reject(_err('NOT_HTTPS', `Refusing non-HTTPS URL: ${parsed.protocol}//`));
    }
    if (isBlocklistedHost(parsed.hostname, parsed.pathname)) {   // C4
      return reject(_err('BLOCKLISTED', `Host on egress blocklist: ${parsed.hostname}`));
    }

    // C1 / C2 — DNS preflight (re-run on every hop)
    _resolveAndGuard(parsed.hostname).then((prevalidated) => {
      const requestOpts = {
        method,
        host: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + (parsed.search || ''),
        // F3 (M65 Iter 2) — pin the connect-time DNS lookup to the same
        // address set we just validated. Closes the TOCTOU between
        // _resolveAndGuard and Node's internal dns.lookup at socket.connect.
        lookup: _makePinnedLookup(prevalidated),
        // C10 — fixed UA, no cookies, no auth, no referer
        headers: Object.assign({
          'User-Agent': FIXED_USER_AGENT,
          'Accept': headers && headers.Accept ? headers.Accept : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'close',
        }, headers || {}),
      };

      // Strip any forbidden headers caller tried to pass (defense-in-depth).
      delete requestOpts.headers.Cookie;
      delete requestOpts.headers.cookie;
      delete requestOpts.headers.Authorization;
      delete requestOpts.headers.authorization;
      delete requestOpts.headers.Referer;
      delete requestOpts.headers.referer;

      const req = https.request(requestOpts, (res) => {
        // C2 — manual redirect handling. Caller re-runs DNS+blocklist+HTTPS.
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume(); // drain
          let nextUrl;
          try { nextUrl = new URL(res.headers.location, urlStr).toString(); }
          catch { return reject(_err('REDIRECT_BAD_LOCATION', `Bad redirect Location: ${res.headers.location}`)); }
          return resolve({ redirected: true, nextUrl, status });
        }

        const chunks = [];
        let bytesRead = 0;            // C6 — bytes-read counter on stream
        let aborted = false;

        res.on('data', (chunk) => {
          if (aborted) return;
          bytesRead += chunk.length;
          if (bytesRead > MAX_BODY_BYTES) {
            aborted = true;
            try { req.destroy(_err('BODY_TOO_LARGE', `Body exceeded ${MAX_BODY_BYTES} bytes`)); } catch {}
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (aborted) return; // 'error' will fire
          const body = Buffer.concat(chunks, bytesRead).toString('utf-8');
          resolve({
            redirected: false,
            status,
            contentType: String(res.headers['content-type'] || ''),
            body,
            finalUrl: urlStr,
          });
        });

        res.on('error', (err) => reject(_err('STREAM_ERROR', `Response stream error: ${err.message}`)));
      });

      req.on('error', (err) => {
        if (err && err.code === 'BODY_TOO_LARGE') return reject(err);
        reject(_err('REQUEST_ERROR', `Request error: ${err.message || err}`));
      });

      // Wire the combined abort signal (C7 wall-clock).
      if (signal) {
        if (signal.aborted) {
          req.destroy(_err('TIMEOUT', `Request aborted (wall-clock budget ${TOTAL_TIMEOUT_MS}ms)`));
        } else {
          signal.addEventListener('abort', () => {
            req.destroy(_err('TIMEOUT', `Request aborted (wall-clock budget ${TOTAL_TIMEOUT_MS}ms)`));
          });
        }
      }

      req.end();
    }).catch(reject);
  });
}

/**
 * Perform a webFetch through all gates. Returns
 *   { status, finalUrl, contentType, body }
 * or throws a typed Error (code among:
 *   NOT_HTTPS, BLOCKLISTED, PRIVATE_IP, DNS_LOOKUP_FAILED, DNS_EMPTY,
 *   REDIRECT_LIMIT, REDIRECT_BAD_LOCATION, BODY_TOO_LARGE, TIMEOUT,
 *   REQUEST_ERROR, STREAM_ERROR, INVALID_URL, TURN_BACKSTOP).
 *
 * Caller (extension) is responsible for per-turn / per-day budgets (C11)
 * and provenance (C5). The bridge enforces a final backstop on per-turn
 * fetch count if turnId is provided.
 */
async function doWebFetch({ url, turnId, accept, _injectedRequest, _injectedPreflight } = {}) {
  if (typeof url !== 'string' || url.length === 0) {
    throw _err('INVALID_URL', 'webFetch requires a string URL');
  }

  if (turnId) {
    const n = _incrementTurnFetch(turnId);
    if (n !== null && n > PER_TURN_FETCH_BACKSTOP) {
      throw _err('TURN_BACKSTOP', `Per-turn fetch backstop (${PER_TURN_FETCH_BACKSTOP}) exceeded`);
    }
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  // Allow tests to inject a mocked single-hop transport.
  const hop = typeof _injectedRequest === 'function' ? _injectedRequest : _doSingleHopRequest;
  const preflight = typeof _injectedPreflight === 'function' ? _injectedPreflight : _preflight;

  try {
    let currentUrl = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      // eslint-disable-next-line no-await-in-loop
      await preflight(currentUrl);
      const headers = accept ? { Accept: accept } : undefined;
      // eslint-disable-next-line no-await-in-loop
      const r = await hop({ urlStr: currentUrl, signal: controller.signal, headers });
      if (r.redirected) {
        if (i === MAX_REDIRECTS) {
          throw _err('REDIRECT_LIMIT', `Too many redirects (>${MAX_REDIRECTS})`);
        }
        currentUrl = r.nextUrl;
        continue;
      }
      return {
        status: r.status,
        finalUrl: r.finalUrl,
        contentType: r.contentType,
        body: r.body,
      };
    }
    throw _err('REDIRECT_LIMIT', `Too many redirects (>${MAX_REDIRECTS})`);
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Perform a Brave Search API call (C12: host-allowlisted). Returns
 * { results: [{title,url,snippet}] } parsed from the Brave response, or
 * throws.
 */
async function doWebSearch({ query, apiKey, turnId, _injectedFetch } = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw _err('INVALID_QUERY', 'webSearch requires a non-empty query');
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw _err('NO_API_KEY', 'Brave Search API key not configured');
  }

  // C12 — hardcoded host, not configurable.
  const url = `https://${BRAVE_SEARCH_HOST}/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;

  // We don't go through doWebFetch for two reasons:
  //   1. Need to send X-Subscription-Token header (whitelisted, not in C10 ban list).
  //   2. Need JSON body, small cap.
  // We DO re-use _doSingleHopRequest so DNS+blocklist+HTTPS+timeout apply identically.

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    const hop = typeof _injectedFetch === 'function' ? _injectedFetch : _doSingleHopRequest;
    // Verify host literally is the allowed one (defense in depth in case the
    // line above ever gets templated wrong).
    const parsed = new URL(url);
    if (parsed.hostname !== BRAVE_SEARCH_HOST) {
      throw _err('SEARCH_HOST_LOCKED', `webSearch host locked to ${BRAVE_SEARCH_HOST}`);
    }
    await _preflight(url);
    if (turnId) {
      // search calls don't burn fetch backstop but we still want bounded growth
    }
    const r = await hop({
      urlStr: url,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });
    if (r.redirected) {
      throw _err('SEARCH_REDIRECTED', 'Brave Search returned a redirect (refused)');
    }
    if (r.status < 200 || r.status >= 300) {
      throw _err('SEARCH_HTTP_' + r.status, `Brave Search HTTP ${r.status}`);
    }
    let parsedBody;
    try { parsedBody = JSON.parse(r.body); }
    catch { throw _err('SEARCH_BAD_JSON', 'Brave Search returned non-JSON'); }
    const webResults = (parsedBody && parsedBody.web && Array.isArray(parsedBody.web.results))
      ? parsedBody.web.results
      : [];
    const results = webResults.map((x) => ({
      title: String(x.title || ''),
      url: String(x.url || ''),
      snippet: String(x.description || x.snippet || ''),
    })).filter((x) => x.url.startsWith('https://'));
    return { results };
  } finally {
    clearTimeout(deadline);
  }
}

// ─── IPC registration ────────────────────────────────────────────────────────

function setupWebFetchBridge(ipcMain, _appRoot, readSecret) {
  // Bound for safety. _appRoot is reserved for future use (e.g. workspace
  // history sink). readSecret is the main-process-only Brave API key reader
  // (see electron/main.cjs:_readSecretString). The renderer NEVER sends the
  // API key over IPC — it lives only in main + safeStorage at rest.
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('[WebFetchBridge] setupWebFetchBridge: ipcMain.handle is required');
  }
  if (typeof readSecret !== 'function') {
    throw new Error('[WebFetchBridge] setupWebFetchBridge: readSecret(key) function is required');
  }

  ipcMain.handle('webFetch:request', async (_event, opts) => {
    try {
      const safe = opts && typeof opts === 'object' ? opts : {};
      const result = await doWebFetch({
        url: safe.url,
        turnId: safe.turnId,
        accept: safe.accept,
      });
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err && err.code) || 'UNKNOWN',
          message: err && err.message ? err.message : String(err),
        },
      };
    }
  });

  ipcMain.handle('webSearch:request', async (_event, opts) => {
    try {
      const safe = opts && typeof opts === 'object' ? opts : {};
      // SECURITY: API key is read from safeStorage HERE (main process). The
      // renderer cannot pass it in — any `safe.apiKey` is intentionally
      // ignored. Soft-error NO_API_KEY when the secret is missing so the
      // extension can surface a clean message.
      const apiKey = await readSecret('webResearch.braveApiKey');
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        return {
          ok: false,
          error: {
            code: 'NO_API_KEY',
            message: 'Brave Search API key not configured (AI Settings → Web Research)',
          },
        };
      }
      const result = await doWebSearch({
        query: safe.query,
        apiKey,
        turnId: safe.turnId,
      });
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: (err && err.code) || 'UNKNOWN',
          message: err && err.message ? err.message : String(err),
        },
      };
    }
  });

  ipcMain.handle('webFetch:resetTurn', async (_event, turnId) => {
    _resetTurnFetchCount(typeof turnId === 'string' ? turnId : '');
    return { ok: true };
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  setupWebFetchBridge,
  // Exported for tests only:
  _internals: {
    isPrivateIp,
    isBlocklistedHost,
    canonicalUrl,
    doWebFetch,
    doWebSearch,
    DOMAIN_BLOCKLIST,
    PRIVATE_V4_CIDRS,
    FIXED_USER_AGENT,
    MAX_BODY_BYTES,
    TOTAL_TIMEOUT_MS,
    MAX_REDIRECTS,
    PER_TURN_FETCH_BACKSTOP,
    BRAVE_SEARCH_HOST,
    _resetTurnFetchCount,
    _doSingleHopRequest,
    _preflight,
    _makePinnedLookup,
  },
};
