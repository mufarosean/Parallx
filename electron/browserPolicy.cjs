// browserPolicy.cjs — the pure rules of the private browser.
//
// Everything here is a function of its arguments: no Electron, no disk, no
// clock. The bridge (browserBridge.cjs) applies these to live sessions; the
// unit tests (tests/unit/browserPolicy.test.ts) pin them down. Brave is the
// reference for what a rule should do.
'use strict';

const { getDomain, getHostname } = require('tldts');

/** Search engines the address bar can use. `%s` is the encoded query. */
const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', home: 'https://duckduckgo.com/' },
  brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=%s', home: 'https://search.brave.com/' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', home: 'https://www.startpage.com/' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=%s', home: 'https://www.google.com/' },
};
const DEFAULT_ENGINE = 'duckduckgo';

/** Registrable domain ("example.co.uk" for "a.b.example.co.uk"), or the host
 *  itself for names without a public suffix (localhost, intranet), or null. */
function siteKey(url) {
  try {
    const host = getHostname(String(url || ''));
    if (!host) return null;
    return (getDomain(host) || host).toLowerCase();
  } catch {
    return null;
  }
}

/** A request is third-party when its registrable domain differs from the
 *  document's. With no document URL (a top-level navigation) it is first-party. */
function isThirdParty(requestUrl, documentUrl) {
  const req = siteKey(requestUrl);
  const doc = siteKey(documentUrl);
  if (!req || !doc) return false;
  return req !== doc;
}

/** Hosts that never get an HTTPS upgrade: loopback, link-local, private, IP literals, single-label names. */
function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0') return true;
  if (h.includes(':')) return true; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // any IPv4 literal
  if (!h.includes('.')) return true; // intranet name
  return false;
}

/** The https:// form of an http:// URL that should be upgraded, or null. */
function httpsUpgradeTarget(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.protocol !== 'http:') return null;
  if (isLocalHost(u.hostname)) return null;
  u.protocol = 'https:';
  if (u.port === '80') u.port = '';
  return u.toString();
}

/** A plain Chrome user agent for the platform: no Electron, no app name, no
 *  minor version (Chrome's own reduced UA shape). */
function genericUserAgent(chromeVersion, platform) {
  const major = String(chromeVersion || '').split('.')[0] || '120';
  const os = platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : (platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64');
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** What the address bar does with typed text: a URL, or a search. */
function parseOmnibox(text, engineKey) {
  const raw = String(text || '').trim();
  const engine = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES[DEFAULT_ENGINE];
  if (!raw) return { kind: 'url', url: 'about:newtab' };
  if (raw === 'about:newtab' || raw === 'about:blank') return { kind: 'url', url: raw };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(mailto|data|file):/i.test(raw)) {
    try { return { kind: 'url', url: new URL(raw).toString() }; } catch { /* fall through to search */ }
  }
  const noSpaces = !/\s/.test(raw);
  const hostPart = raw.split(/[/?#]/)[0];
  const looksLikeHost = noSpaces && (
    /^localhost(:\d+)?$/i.test(hostPart)
    || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(hostPart)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(hostPart)
  );
  if (looksLikeHost) {
    const scheme = isLocalHost(hostPart.replace(/:\d+$/, '')) ? 'http://' : 'https://';
    try { return { kind: 'url', url: new URL(scheme + raw).toString() }; } catch { /* fall through */ }
  }
  return { kind: 'search', url: engine.url.replace('%s', encodeURIComponent(raw)), query: raw };
}

/** Permission handling by name: 'allow' silently, 'ask' the user, or 'deny' outright. */
const PERMISSION_POLICY = {
  'media': 'ask',
  'geolocation': 'ask',
  'notifications': 'ask',
  'clipboard-read': 'ask',
  'pointerLock': 'ask',
  'clipboard-sanitized-write': 'allow',
  'fullscreen': 'allow',
  'display-capture': 'deny',
  'midi': 'deny',
  'midiSysex': 'deny',
  'openExternal': 'deny',
  'window-management': 'deny',
  'idle-detection': 'deny',
  'keyboardLock': 'deny',
  'storage-access': 'deny',
  'top-level-storage-access': 'deny',
  'speaker-selection': 'deny',
  'hid': 'deny',
  'serial': 'deny',
  'usb': 'deny',
  'background-sync': 'deny',
  'unknown': 'deny',
};
function permissionPolicy(name) {
  return PERMISSION_POLICY[name] || 'deny';
}

/** Per-site settings, the shield's three switches. */
const COOKIE_MODES = ['block-third-party', 'block-all', 'allow'];
function defaultSite() {
  return { shields: true, cookies: 'block-third-party', https: true };
}
function normalizeSite(raw) {
  const d = defaultSite();
  if (!raw || typeof raw !== 'object') return d;
  return {
    shields: typeof raw.shields === 'boolean' ? raw.shields : d.shields,
    cookies: COOKIE_MODES.includes(raw.cookies) ? raw.cookies : d.cookies,
    https: typeof raw.https === 'boolean' ? raw.https : d.https,
  };
}

/** 'allow' the cookie header through or 'strip' it, for one request under one site's settings. */
function cookieDecision(site, requestUrl, documentUrl) {
  const s = normalizeSite(site);
  if (s.cookies === 'allow') return 'allow';
  if (s.cookies === 'block-all') return 'strip';
  return isThirdParty(requestUrl, documentUrl) ? 'strip' : 'allow';
}

/** A safe file name for a download: no path separators, no control characters, bounded length. */
function sanitizeFilename(name) {
  // Last path segment only, then no separators, reserved or control characters.
  let n = String(name || 'download').split(/[\\/]/).pop().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  if (!n) n = 'download';
  if (n.length > 150) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 ? n.slice(dot) : '';
    n = n.slice(0, 150 - ext.length) + ext;
  }
  return n;
}

/** A path in `dir` for `filename` that does not exist yet, adding " (n)" before the extension. */
function downloadTarget(dir, filename, exists, sep) {
  const s = sep || (String(dir).includes('\\') ? '\\' : '/');
  const base = sanitizeFilename(filename);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const root = String(dir).replace(/[\\/]+$/, '');
  let candidate = `${root}${s}${base}`;
  for (let n = 2; exists(candidate) && n < 1000; n++) candidate = `${root}${s}${stem} (${n})${ext}`;
  return candidate;
}

module.exports = {
  SEARCH_ENGINES,
  DEFAULT_ENGINE,
  PERMISSION_POLICY,
  COOKIE_MODES,
  siteKey,
  isThirdParty,
  isLocalHost,
  httpsUpgradeTarget,
  genericUserAgent,
  parseOmnibox,
  permissionPolicy,
  defaultSite,
  normalizeSite,
  cookieDecision,
  sanitizeFilename,
  downloadTarget,
};
