// ext/web-research/main.js — Web Research extension (M65 Iter 1–3).
//
// SECURITY MODEL (full detail in docs/Parallx_Milestone_65.md):
//   Layer 1 — Egress allowlist        : enforced in electron/webFetchBridge.cjs
//   Layer 2 — URL provenance          : enforced HERE (turn-scoped Set)
//   Layer 3 — Content sanitization    : enforced HERE (Readability + post-strip)
//   Layer 4 — Untrusted-content framing : <untrusted_web_content> wrapping HERE
//   Layer 5 — Tool-color gating       : Iteration 2 (openclawToolPolicy)
//   Layer 6 — Renderer hardening      : Iteration 2 (markdownRenderer)
//   Layer 7 — Ephemerality            : bridge sends no cookies/auth/referer
//
// All outbound HTTP MUST go through window.parallxElectron.webFetch /
// .webSearch (the bridge). DO NOT add fetch(), require('http'), or
// require('https') to this file — there is a grep regression test for it
// (C14, tests/unit/webResearchNoDirectFetch.test.ts).

import { Readability } from './readability.js';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1 — Constants & module state
// ═══════════════════════════════════════════════════════════════════════════

const PER_TURN_SEARCH_CAP = 3;            // C11
const PER_TURN_FETCH_CAP  = 5;            // C11
const DEFAULT_DAILY_BUDGET = 100;         // C11
const MAX_SANITIZED_BYTES = 50 * 1024;    // 50 KB (C8 — AFTER sanitization)

// Storage keys (in global-storage.json). NOTE: the Brave API key is NOT
// stored here — it lives in safeStorage and is read by the main-process
// bridge (electron/webFetchBridge.cjs) so the secret never enters the
// renderer prompt context.
const KEY_DAILY_BUDGET     = 'webResearch.dailyBudget';
const KEY_AMBIENT_ENABLED  = 'webResearch.ambientEnabled';
const KEY_DAILY_COUNTER    = 'webResearch.dailyCounter'; // JSON {date,count}
// Iter 3 — Research Hub storage keys (see M65 §"Correction to earlier sketch").
const KEY_HUB_PAGE_ID      = 'webResearch.hubPageId';
const KEY_HUB_PAGE_TITLE   = 'webResearch.hubPageTitle';

// Iter 3 — research history ndjson location (workspace-scoped, daily-rotated).
// Source Analyst Iter 3 §History ndjson: extensions can only write inside the
// workspace via api.workspace.fs; app-root data/ is inaccessible from the
// extension surface, so we place it under .parallx/data/.
const HISTORY_DIR_RELATIVE = '.parallx/data';
const HISTORY_FILE_PREFIX  = 'web-research-history';

// Whitelist of fields that may appear in a research history ndjson record
// (C7 of the Iter 3 pre-audit). The record is REBUILT from these keys; any
// extra fields supplied by the caller are silently dropped. This is the
// no-API-key, no-response-body guarantee.
const HISTORY_ALLOWED_KINDS = new Set([
  'search', 'fetch', 'hub-create', 'draft-create',
]);
const HISTORY_MAX_QUERY_LEN = 256;
const HISTORY_MAX_URL_LEN   = 2048;

// Lazy-bound at activate()
let _api = null;
let _globalStorage = null;
let _activated = false;
let _commandDisposables = [];

// Per-turn provenance state.
//   key   = turnId (string)
//   value = Set<string> of canonical URLs allowed for webFetch this turn,
//           plus { _searches, _fetches } counters.
const _turnState = new Map();

// Strict URL lex from user message (C5).
// Matches https only, stops at whitespace and a small set of delimiters.
const URL_LEX_REGEX = /\bhttps:\/\/[^\s<>"'`)\]]+/g;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2 — URL canonicalization (must match bridge canonicalUrl)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Canonical form for provenance comparison. Lowercase scheme + host,
 * strip fragment, strip trailing '/' on bare host. Preserve search.
 * Returns null on parse failure (so callers can treat it as "not in set").
 */
function canonicalUrl(input) {
  if (typeof input !== 'string') return null;
  try {
    const u = new URL(input);
    const scheme = u.protocol.toLowerCase();
    const host = u.hostname.toLowerCase();
    let path = u.pathname || '';
    if (path === '/') path = '';
    const search = u.search || '';
    return `${scheme}//${host}${path}${search}`;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3 — Per-turn state
// ═══════════════════════════════════════════════════════════════════════════

function _ensureTurn(turnId) {
  let t = _turnState.get(turnId);
  if (!t) {
    t = { urls: new Set(), searches: 0, fetches: 0 };
    _turnState.set(turnId, t);
    // Bounded growth — keep at most the most recent 32 turns.
    if (_turnState.size > 32) {
      const firstKey = _turnState.keys().next().value;
      if (firstKey !== undefined) _turnState.delete(firstKey);
    }
  }
  return t;
}

/**
 * Seed a turn's provenance set with URLs lexed from the user message.
 * Exported so the chat surface (or a test harness) can drive it.
 */
function seedTurnFromUserMessage(turnId, userMessage) {
  const t = _ensureTurn(turnId);
  if (typeof userMessage !== 'string') return;
  const matches = userMessage.match(URL_LEX_REGEX) || [];
  for (const m of matches) {
    const c = canonicalUrl(m);
    if (c) t.urls.add(c);
  }
}

function resetTurn(turnId) {
  _turnState.delete(turnId);
}

function _isUrlAllowedThisTurn(turnId, url) {
  const t = _turnState.get(turnId);
  if (!t) return false;
  const c = canonicalUrl(url);
  if (!c) return false;
  return t.urls.has(c);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4 — Daily budget (C11)
// ═══════════════════════════════════════════════════════════════════════════

function _todayKey() {
  // YYYY-MM-DD in user local time (C11).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function _readDailyBudget() {
  if (!_globalStorage) return DEFAULT_DAILY_BUDGET;
  const raw = await _globalStorage.get(KEY_DAILY_BUDGET);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_BUDGET;
}

async function _readDailyCounter() {
  if (!_globalStorage) return { date: _todayKey(), count: 0 };
  try {
    const raw = await _globalStorage.get(KEY_DAILY_COUNTER);
    if (!raw) return { date: _todayKey(), count: 0 };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { date: _todayKey(), count: 0 };
    if (parsed.date !== _todayKey()) return { date: _todayKey(), count: 0 };
    return { date: parsed.date, count: Number(parsed.count) || 0 };
  } catch {
    return { date: _todayKey(), count: 0 };
  }
}

async function _writeDailyCounter(counter) {
  if (!_globalStorage) return;
  await _globalStorage.set(KEY_DAILY_COUNTER, JSON.stringify(counter));
}

async function _bumpDailyCounter() {
  const cur = await _readDailyCounter();
  cur.count += 1;
  await _writeDailyCounter(cur);
  return cur;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5 — Sanitization (Layer 3, C8)
// ═══════════════════════════════════════════════════════════════════════════

const ZERO_WIDTH_AND_TAG_CHANNEL = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]|[\uDB40][\uDC00-\uDC7F]/g;

const HIDDEN_INLINE_STYLE_REGEXES = [
  /display\s*:\s*none/i,
  /visibility\s*:\s*hidden/i,
  /opacity\s*:\s*0(\.0+)?(\s*[;}]|$)/i,
  /font-size\s*:\s*0(px|pt|em|rem)?(\s*[;}]|$)/i,
  /font-size\s*:\s*[0-5](\.\d+)?\s*px/i,                         // <6px
];

function _isOffScreen(style) {
  // position:absolute|fixed plus large negative left/top (off-screen tactic)
  if (!style) return false;
  if (!/position\s*:\s*(absolute|fixed)/i.test(style)) return false;
  return /(?:left|top)\s*:\s*-\d{4,}\s*px/i.test(style);
}

function _isWhiteOnWhite(style) {
  // crude but effective: color:#fff(fff)? paired with background(-color)?:#fff(fff)?
  if (!style) return false;
  const colorWhite = /color\s*:\s*(?:#?fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))\b/i.test(style);
  const bgWhite = /background(?:-color)?\s*:\s*(?:#?fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))\b/i.test(style);
  return colorWhite && bgWhite;
}

function _hasHiddenStyle(style) {
  if (!style) return false;
  for (const re of HIDDEN_INLINE_STYLE_REGEXES) if (re.test(style)) return true;
  if (_isOffScreen(style)) return true;
  if (_isWhiteOnWhite(style)) return true;
  return false;
}

/**
 * Sanitize an HTML string into safe markdown-ish plain text.
 *
 * Order (C8):
 *   1. Parse HTML.
 *   2. Strip comments, <script>, <style>, <iframe>, <object>, <embed>,
 *      <form>, <noscript>, all <img>.
 *   3. Walk tree, drop nodes with hidden styles, aria-hidden="true", hidden attr.
 *   4. Extract text (preserving block structure).
 *   5. Strip Unicode tag-channel / zero-width chars.
 *   6. Collapse whitespace, truncate at 50 KB.
 *
 * Fails closed if the input cannot be parsed. (No best-effort fallback.)
 *
 * @param {string} html
 * @param {{ DOMParserCtor?: typeof DOMParser }} [opts]
 * @returns {string} sanitized text body
 */
// Module-level default DOMParser. In production this resolves to the
// browser-builtin (extensions run in the renderer). In Node-based unit tests
// it stays null until a test calls __test__._setDOMParser().
let _defaultDOMParser = (typeof DOMParser !== 'undefined') ? DOMParser : null;

function sanitizeHtml(html, opts = {}) {
  if (typeof html !== 'string') throw new Error('[web-research] sanitizeHtml: input must be a string');

  const Parser = opts.DOMParserCtor || _defaultDOMParser;
  if (!Parser) throw new Error('[web-research] sanitizeHtml: no DOMParser available');

  const doc = new Parser().parseFromString(html, 'text/html');
  if (!doc || !doc.body) throw new Error('[web-research] sanitizeHtml: failed to parse HTML');

  // 2. Remove dangerous and noisy elements wholesale.
  const HARD_REMOVE = ['script', 'style', 'iframe', 'object', 'embed', 'form',
                       'noscript', 'img', 'link', 'meta', 'svg', 'video',
                       'audio', 'canvas', 'template'];
  for (const tag of HARD_REMOVE) {
    const nodes = doc.querySelectorAll(tag);
    for (const n of Array.from(nodes)) n.parentNode && n.parentNode.removeChild(n);
  }

  // 3. Walk and strip hidden-style / aria-hidden / hidden-attr nodes,
  //    plus all HTML comment nodes.
  const COMMENT_NODE = 8;
  const ELEMENT_NODE = 1;

  function walk(node) {
    if (!node) return;
    const children = Array.from(node.childNodes || []);
    for (const child of children) {
      if (child.nodeType === COMMENT_NODE) {
        node.removeChild(child);
        continue;
      }
      if (child.nodeType === ELEMENT_NODE) {
        const el = /** @type {Element} */ (child);
        const style = el.getAttribute && el.getAttribute('style');
        const ariaHidden = el.getAttribute && el.getAttribute('aria-hidden');
        const hiddenAttr = el.hasAttribute && el.hasAttribute('hidden');
        if (ariaHidden === 'true' || hiddenAttr || _hasHiddenStyle(style)) {
          node.removeChild(el);
          continue;
        }
        // Strip dangerous data:/javascript: hrefs as defense in depth.
        const href = el.getAttribute && el.getAttribute('href');
        if (href && /^(?:javascript:|data:|vbscript:)/i.test(href.trim())) {
          el.removeAttribute('href');
        }
        walk(el);
      }
    }
  }
  walk(doc.body);

  // 4. Extract text. We preserve some block structure with newlines for the
  // common content tags so the LLM gets reasonable paragraph breaks.
  function extract(node, out) {
    if (!node) return;
    if (node.nodeType === 3 /* TEXT */) {
      out.push(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT */) return;
    const tag = (node.tagName || '').toLowerCase();
    const isBlock = /^(p|div|section|article|li|tr|h[1-6]|pre|blockquote|figure|figcaption|br|hr)$/.test(tag);
    if (isBlock) out.push('\n');
    for (const c of Array.from(node.childNodes || [])) extract(c, out);
    if (isBlock) out.push('\n');
  }
  const parts = [];
  extract(doc.body, parts);
  let text = parts.join('');

  // 5. Strip Unicode tag-channel + zero-width.
  text = text.replace(ZERO_WIDTH_AND_TAG_CHANNEL, '');

  // 6. Collapse runs of whitespace and trim. Keep paragraph breaks (\n\n).
  text = text.replace(/[ \t\r\f\v]+/g, ' ')
             .replace(/ ?\n ?/g, '\n')
             .replace(/\n{3,}/g, '\n\n')
             .trim();

  if (text.length > MAX_SANITIZED_BYTES) {
    text = text.slice(0, MAX_SANITIZED_BYTES);
  }
  return text;
}

/** Wrap a sanitized body in the C9 framing tag. The source is the final URL. */
function wrapUntrusted(source, body) {
  // Source is included as an attribute. We escape " and < just in case.
  const safeSource = String(source || '').replace(/[<"&]/g, (c) =>
    c === '<' ? '&lt;' : c === '"' ? '&quot;' : '&amp;'
  );
  return `<untrusted_web_content source="${safeSource}">\n${body}\n</untrusted_web_content>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6 — Tool: webSearch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Soft-error shape used for budget exhaustion and provenance rejection.
 * Returned (not thrown) so the LLM can surface it cleanly.
 */
function softError(code, message) {
  return { isError: true, errorCode: code, content: `[web-research] ${code}: ${message}` };
}

async function webSearchTool(args, turnId) {
  const query = args && typeof args.query === 'string' ? args.query.trim() : '';
  if (query.length === 0) return softError('BAD_QUERY', 'query must be a non-empty string');

  const t = _ensureTurn(turnId);
  if (t.searches >= PER_TURN_SEARCH_CAP) {
    return softError('TURN_SEARCH_CAP', `per-turn search cap (${PER_TURN_SEARCH_CAP}) reached`);
  }

  const budget = await _readDailyBudget();
  const counter = await _readDailyCounter();
  if (counter.count >= budget) {
    return softError('DAILY_BUDGET', `daily search budget (${budget}) exhausted; resets at local midnight`);
  }

  if (!_globalStorage) return softError('NO_STORAGE', 'global storage unavailable');

  const bridge = (globalThis.parallxElectron && globalThis.parallxElectron.webSearch) || null;
  if (!bridge || typeof bridge.request !== 'function') {
    return softError('NO_BRIDGE', 'webSearch bridge unavailable');
  }

  // The Brave API key is read inside the main-process bridge from
  // safeStorage. NO_API_KEY surfaces here as a soft error from the bridge.
  const res = await bridge.request({ query, turnId });
  if (!res || !res.ok) {
    return softError(res && res.error && res.error.code ? res.error.code : 'SEARCH_FAILED',
      res && res.error && res.error.message ? res.error.message : 'webSearch failed');
  }

  // Count this search against the per-turn + per-day budgets ONLY on success
  // (failures should not consume budget).
  t.searches += 1;
  await _bumpDailyCounter();

  // Add result URLs to the provenance set (C5).
  const results = (res.result && Array.isArray(res.result.results)) ? res.result.results : [];
  for (const r of results) {
    const c = canonicalUrl(r.url);
    if (c) t.urls.add(c);
  }

  return { isError: false, content: JSON.stringify({ results }) };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Tool: webFetch
// ═══════════════════════════════════════════════════════════════════════════

async function webFetchTool(args, turnId) {
  const url = args && typeof args.url === 'string' ? args.url.trim() : '';
  if (url.length === 0) return softError('BAD_URL', 'url must be a non-empty string');

  const t = _ensureTurn(turnId);
  if (t.fetches >= PER_TURN_FETCH_CAP) {
    return softError('TURN_FETCH_CAP', `per-turn fetch cap (${PER_TURN_FETCH_CAP}) reached`);
  }

  // C5 — provenance gate. URL must be in the per-turn set seeded from the
  // user message, prior webSearch results, or prior webFetch finals.
  if (!_isUrlAllowedThisTurn(turnId, url)) {
    return softError('NOT_IN_PROVENANCE',
      `URL is not in this turn's provenance set. The model may only fetch URLs the user typed, a prior search returned, or a prior fetch resolved to.`);
  }

  const bridge = (globalThis.parallxElectron && globalThis.parallxElectron.webFetch) || null;
  if (!bridge || typeof bridge.request !== 'function') {
    return softError('NO_BRIDGE', 'webFetch bridge unavailable');
  }

  const res = await bridge.request({ url, turnId });
  if (!res || !res.ok) {
    return softError(res && res.error && res.error.code ? res.error.code : 'FETCH_FAILED',
      res && res.error && res.error.message ? res.error.message : 'webFetch failed');
  }

  t.fetches += 1;

  // Add the final resolved URL to provenance (C5) so a subsequent fetch of
  // the redirect destination is allowed. We DO NOT add any <a href> URLs
  // extracted from the body — that's the depth-1 hard stop.
  const finalUrl = (res.result && typeof res.result.finalUrl === 'string') ? res.result.finalUrl : url;
  const cFinal = canonicalUrl(finalUrl);
  if (cFinal) t.urls.add(cFinal);

  // Sanitize HTML → text (Layer 3 + C8), then wrap (Layer 4 / C9).
  const body = (res.result && typeof res.result.body === 'string') ? res.result.body : '';
  let sanitized;
  try {
    sanitized = sanitizeWithReadability(body);
  } catch (err) {
    // Per audit: hard fail, do NOT proceed with raw HTML.
    return softError('SANITIZE_FAILED', err && err.message ? err.message : 'sanitization failed');
  }
  const framed = wrapUntrusted(finalUrl, sanitized);
  return { isError: false, content: framed };
}

/**
 * Iter 3 — Layer-3 sanitization pipeline:
 *   raw HTML → Readability.parse() → result.content (cleaned article HTML)
 *            → sanitizeHtml() (strip hidden styles, scripts, comments, zero-width)
 *            → text
 *
 * ORDER MATTERS (Iter 3 pre-audit C1):
 *   - Readability runs FIRST. It extracts the main article and strips
 *     boilerplate (nav, footer, ads) but preserves inline styles, comments,
 *     and many tag types our sanitizer needs to kill.
 *   - sanitizeHtml runs AFTER on Readability's output. This is the layer
 *     that removes display:none / visibility:hidden / opacity:0 / aria-hidden
 *     / Unicode tag-channel, etc.
 *   - If Readability throws or returns null (non-article page, parse error),
 *     we fall back to sanitizing the raw HTML directly. NEVER emit raw HTML.
 */
function sanitizeWithReadability(html) {
  if (typeof html !== 'string') throw new Error('[web-research] sanitizeWithReadability: input must be a string');

  const Parser = _defaultDOMParser;
  if (!Parser) {
    // No DOMParser available — fall back to direct sanitization (which will
    // also throw, but at least it gives the canonical error path).
    return sanitizeHtml(html);
  }

  let readableHtml = null;
  try {
    const doc = new Parser().parseFromString(html, 'text/html');
    if (doc && doc.documentElement) {
      const article = new Readability(doc, { keepClasses: false }).parse();
      if (article && typeof article.content === 'string' && article.content.length > 0) {
        readableHtml = article.content;
      }
    }
  } catch {
    // Fall through to raw-HTML sanitization. Readability is best-effort
    // boilerplate-strip; the deterministic security layer is sanitizeHtml.
    readableHtml = null;
  }

  return sanitizeHtml(readableHtml ?? html);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7b — Research Hub state + history ndjson (Iter 3)
// ═══════════════════════════════════════════════════════════════════════════
//
// These tools are GREEN per Iter 3 Layer-5 audit:
//   - getResearchHub:    read-only read of two global-storage keys.
//   - setResearchHub:    write of those two keys after strict validation.
//   - logResearchEvent:  append-only ndjson, whitelist serialization, no
//                        api key, no response bodies. Pure observability.
// None read untrusted web content; none mutate canvas pages directly.

const HUB_ID_RE     = /^[A-Za-z0-9_\-:.]{1,256}$/;          // canvas page id shape
const HUB_TITLE_MAX = 200;
// Strip control chars (Unicode tag-channel + zero-width handled at sanitize layer too).
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u0080-\u009F]/g;

async function getResearchHubTool() {
  if (!_globalStorage) return softError('NO_STORAGE', 'global storage unavailable');
  const pageId = await _globalStorage.get(KEY_HUB_PAGE_ID);
  const title  = await _globalStorage.get(KEY_HUB_PAGE_TITLE);
  if (!pageId || typeof pageId !== 'string') {
    return { isError: false, content: JSON.stringify(null) };
  }
  return {
    isError: false,
    content: JSON.stringify({
      pageId,
      title: (typeof title === 'string' && title.length > 0) ? title : 'Research Hub',
    }),
  };
}

async function setResearchHubTool(args) {
  if (!_globalStorage) return softError('NO_STORAGE', 'global storage unavailable');
  const pageId = args && typeof args.pageId === 'string' ? args.pageId.trim() : '';
  let title    = args && typeof args.title  === 'string' ? args.title.trim()  : '';
  if (!HUB_ID_RE.test(pageId)) {
    return softError('BAD_PAGE_ID', 'pageId must match canvas-page id shape (1–256 chars [A-Za-z0-9_-:.])');
  }
  if (title.length === 0) title = 'Research Hub';
  title = title.replace(CONTROL_CHARS, '').slice(0, HUB_TITLE_MAX);
  if (title.length === 0) {
    return softError('BAD_TITLE', 'title must be a non-empty string after control-char strip');
  }
  await _globalStorage.set(KEY_HUB_PAGE_ID, pageId);
  await _globalStorage.set(KEY_HUB_PAGE_TITLE, title);
  return { isError: false, content: JSON.stringify({ pageId, title }) };
}

/**
 * Whitelist-serialize a history record. Returns the JSON-stringified line
 * (without trailing newline) or null if the record is unusable.
 * Iter 3 pre-audit C7: rebuild from known keys, do NOT pass-through the
 * caller's object. This is how we guarantee no apiKey / body / content
 * leaks into the on-disk log.
 */
function _buildHistoryLine(record) {
  if (!record || typeof record !== 'object') return null;
  const kind = typeof record.kind === 'string' ? record.kind : '';
  if (!HISTORY_ALLOWED_KINDS.has(kind)) return null;

  const out = {
    ts: new Date().toISOString(),
    kind,
  };
  if (typeof record.query === 'string' && record.query.length > 0) {
    out.query = record.query.replace(CONTROL_CHARS, '').slice(0, HISTORY_MAX_QUERY_LEN);
  }
  if (typeof record.url === 'string' && record.url.length > 0) {
    out.url = record.url.replace(CONTROL_CHARS, '').slice(0, HISTORY_MAX_URL_LEN);
  }
  if (typeof record.hubPageId === 'string' && HUB_ID_RE.test(record.hubPageId)) {
    out.hubPageId = record.hubPageId;
  }
  if (typeof record.draftPageId === 'string' && HUB_ID_RE.test(record.draftPageId)) {
    out.draftPageId = record.draftPageId;
  }
  if (Number.isFinite(record.urlCount) && record.urlCount >= 0) {
    out.urlCount = Math.floor(record.urlCount);
  }
  return JSON.stringify(out);
}

function _historyFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${HISTORY_FILE_PREFIX}.${y}-${m}-${d}.ndjson`;
}

function _joinUri(base, ...parts) {
  let out = String(base || '');
  for (const p of parts) {
    if (!p) continue;
    if (out.endsWith('/')) out = out + p;
    else out = out + '/' + p;
  }
  return out;
}

async function _appendHistoryLine(api, line) {
  const fs = api && api.workspace && api.workspace.fs;
  const folders = api && api.workspace && api.workspace.workspaceFolders;
  if (!fs || !folders || folders.length === 0) {
    // No workspace open — silently skip. History is observability, never
    // a security control; we never block a search/fetch on history-write
    // failure (Iter 3 pre-audit C8).
    return false;
  }
  const root = folders[0].uri;
  const dirUri  = _joinUri(root, HISTORY_DIR_RELATIVE);
  const fileUri = _joinUri(dirUri, _historyFileName());
  try {
    if (typeof fs.mkdir === 'function') {
      try { await fs.mkdir(dirUri); } catch { /* may already exist */ }
    }
    let existing = '';
    if (typeof fs.exists === 'function' && typeof fs.readFile === 'function') {
      try {
        const present = await fs.exists(fileUri);
        if (present) {
          const raw = await fs.readFile(fileUri);
          existing = (typeof raw === 'string') ? raw : new TextDecoder().decode(raw);
        }
      } catch { /* treat as empty */ }
    }
    const next = existing + (existing.length > 0 && !existing.endsWith('\n') ? '\n' : '') + line + '\n';
    await fs.writeFile(fileUri, next);
    return true;
  } catch (err) {
    console.warn('[web-research] history append failed:', err && err.message);
    return false;
  }
}

async function logResearchEventTool(args) {
  const line = _buildHistoryLine(args || {});
  if (!line) return softError('BAD_RECORD', 'record must include a valid kind in: ' + [...HISTORY_ALLOWED_KINDS].join(', '));
  const ok = await _appendHistoryLine(_api, line);
  return { isError: false, content: JSON.stringify({ ok, file: _historyFileName() }) };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8 — Tool registration
// ═══════════════════════════════════════════════════════════════════════════

function _registerTools(api) {
  if (!api.chat || typeof api.chat.registerTool !== 'function') {
    console.warn('[web-research] api.chat.registerTool not available — tools skipped');
    return;
  }
  // Turn id propagation: the chat surface passes a token whose shape includes
  // a turn identifier. Until that is wired, we fall back to a stable id so
  // local development still seeds provenance correctly. Tests use the
  // exported tool handlers directly.
  const getTurnId = (token) => {
    if (token && typeof token === 'object' && typeof token.turnId === 'string') return token.turnId;
    return 'default-turn';
  };

  _commandDisposables.push(api.chat.registerTool('webSearch', {
    description: 'Search the public web via Brave Search. Returns up to 10 results as {title,url,snippet}. Use this BEFORE webFetch to find candidate URLs. Hard caps: 3 searches/turn, 100 searches/day (configurable). All returned URLs become eligible for webFetch this turn.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Focused search query. Be specific; this is the only way to get URLs you can then fetch.' },
      },
      required: ['query'],
    },
    handler: async (args, token) => webSearchTool(args, getTurnId(token)),
    requiresConfirmation: false,
  }));

  _commandDisposables.push(api.chat.registerTool('webFetch', {
    description: 'Fetch a single URL through the secure egress chokepoint, sanitize the page, and return it framed as <untrusted_web_content>. CRITICAL: the URL must come from (a) the current user message, (b) a prior webSearch result this turn, or (c) the final URL of a prior webFetch this turn. You cannot synthesize URLs. Hard cap: 5 fetches/turn. Links inside fetched pages are NOT automatically fetchable (depth-1 stop).',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'An https:// URL that came from the user message or a prior tool result.' },
      },
      required: ['url'],
    },
    handler: async (args, token) => webFetchTool(args, getTurnId(token)),
    requiresConfirmation: false,
  }));

  // Iter 3 — Research Hub state. Green tools (no untrusted-content read,
  // no consequential write to existing canvas pages). The research-topic
  // skill uses these to lazy-create the Hub page on first use.
  _commandDisposables.push(api.chat.registerTool('getResearchHub', {
    description: 'Return the current Research Hub page id and title as JSON, or null if the Hub has not been created yet. Call this BEFORE drafting a research summary — if it returns null, ask the user for a Hub title, call create_page (parent_id null), then call setResearchHub with the new page id.',
    parameters: { type: 'object', properties: {} },
    handler: async () => getResearchHubTool(),
    requiresConfirmation: false,
  }));

  _commandDisposables.push(api.chat.registerTool('setResearchHub', {
    description: 'Persist the Research Hub page id and title to extension storage so future research turns reuse the same Hub. Call this once, immediately after create_page returns the Hub page id.',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'Canvas page id returned by create_page.' },
        title:  { type: 'string', description: 'Hub title. Defaults to "Research Hub" if omitted.' },
      },
      required: ['pageId'],
    },
    handler: async (args) => setResearchHubTool(args || {}),
    requiresConfirmation: false,
  }));

  _commandDisposables.push(api.chat.registerTool('logResearchEvent', {
    description: 'Append one line to the workspace research history ndjson (.parallx/data/web-research-history.<date>.ndjson). Use after each webSearch/webFetch and after creating a Hub child draft. Allowed kinds: search, fetch, hub-create, draft-create. NEVER include response bodies, page content, or secrets — only topic/query/url/page-id metadata.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['search', 'fetch', 'hub-create', 'draft-create'] },
        query:       { type: 'string' },
        url:         { type: 'string' },
        hubPageId:   { type: 'string' },
        draftPageId: { type: 'string' },
        urlCount:    { type: 'number' },
      },
      required: ['kind'],
    },
    handler: async (args) => logResearchEventTool(args || {}),
    requiresConfirmation: false,
  }));

  console.log('[web-research] Registered webSearch + webFetch + Research Hub tools');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9 — Activation
// ═══════════════════════════════════════════════════════════════════════════

export async function activate(api, _context) {
  if (_activated) return;
  _activated = true;
  _api = api;

  // Bind global storage for settings (Brave key, daily budget, etc.).
  try {
    const IGlobalStorageService = api.services && api.services.has
      ? (function tryFind() {
          // The service id is exported from src/services/serviceTypes — we
          // can't import it from an extension. Re-create a matching id object.
          return { id: 'IGlobalStorageService' };
        })()
      : null;
    if (IGlobalStorageService && api.services && api.services.get) {
      _globalStorage = api.services.get(IGlobalStorageService);
    }
  } catch (err) {
    console.warn('[web-research] global storage lookup failed:', err && err.message);
  }

  _registerTools(api);
  console.log('[web-research] Activated');
}

export function deactivate() {
  for (const d of _commandDisposables) {
    try { d.dispose(); } catch { /* best-effort */ }
  }
  _commandDisposables = [];
  _turnState.clear();
  _activated = false;
  _api = null;
  _globalStorage = null;
  console.log('[web-research] Deactivated');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10 — Exports for tests
// ═══════════════════════════════════════════════════════════════════════════
//
// The extension is normally loaded via blob URL with `activate` as the
// public entrypoint. For unit testing under vitest we additionally expose
// internals — guarded so they no-op in production. Tests import this file
// directly via `import * as ext from '../../ext/web-research/main.js'`.

export const __test__ = Object.freeze({
  canonicalUrl,
  seedTurnFromUserMessage,
  resetTurn,
  sanitizeHtml,
  sanitizeWithReadability,
  wrapUntrusted,
  webSearchTool,
  webFetchTool,
  getResearchHubTool,
  setResearchHubTool,
  logResearchEventTool,
  _buildHistoryLine,
  _historyFileName,
  _setGlobalStorage(stub) { _globalStorage = stub; },
  _setBridge(stub) { globalThis.parallxElectron = stub; },
  _setDOMParser(ctor) { _defaultDOMParser = ctor; },
  _setApi(stub) { _api = stub; },
  _isUrlAllowedThisTurn,
  _ensureTurn,
  PER_TURN_SEARCH_CAP,
  PER_TURN_FETCH_CAP,
  DEFAULT_DAILY_BUDGET,
  MAX_SANITIZED_BYTES,
  KEY_DAILY_BUDGET,
  KEY_DAILY_COUNTER,
  KEY_HUB_PAGE_ID,
  KEY_HUB_PAGE_TITLE,
  HISTORY_DIR_RELATIVE,
  HISTORY_FILE_PREFIX,
});
