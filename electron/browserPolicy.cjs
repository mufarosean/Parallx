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

/** What the assistant's profile never gets, even where the user's tabs are
 *  allowed silently: a page going fullscreen over the app, or writing the
 *  user's clipboard, on a click the model made. */
const AGENT_DENIED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
/** The assistant's profile asks nobody: a permission is granted only when it
 *  is silent for everyone and not one of AGENT_DENIED_PERMISSIONS. */
function agentPermission(name) {
  return permissionPolicy(name) === 'allow' && !AGENT_DENIED_PERMISSIONS.has(name);
}

// ── Private addresses ──
// The assistant's pages never reach this machine or the local network. These
// rules know a private destination by its form alone: the loopback, private,
// link-local and other reserved ranges webFetch refuses (webFetchBridge.cjs),
// and the names reserved for local use. A public-looking name that resolves
// to a private address is the broker's check at browserOpen: a request
// filter cannot wait on DNS.
const PRIVATE_V4_RANGES = [
  ['0.0.0.0', 8],        // "this host on this network"
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, cloud metadata
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, broadcast
];
/** Names reserved for local use, alone or as a suffix: never a public site. */
const PRIVATE_NAME_SUFFIXES = ['localhost', 'local', 'home.arpa', 'internal'];

function ipv4Number(text) {
  const parts = String(text).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}
function isPrivateV4(n) {
  return PRIVATE_V4_RANGES.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix);
    return Math.floor(n / size) === Math.floor(ipv4Number(base) / size);
  });
}
/** The eight 16-bit words of an IPv6 literal (an IPv4 tail allowed), or null. */
function ipv6Words(text) {
  let s = String(text).split('%')[0];
  const tail = /(^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const n = ipv4Number(tail[2]);
    if (n === null) return null;
    s = `${s.slice(0, s.length - tail[2].length)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const split = (h) => (h ? h.split(':') : []);
  const head = split(halves[0]);
  const rest = halves.length === 2 ? split(halves[1]) : [];
  const gap = 8 - head.length - rest.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null;
  const all = [...head, ...new Array(halves.length === 2 ? gap : 0).fill('0'), ...rest];
  if (!all.every((w) => /^[0-9a-f]{1,4}$/i.test(w))) return null;
  return all.map((w) => parseInt(w, 16));
}
function isPrivateV6(w) {
  const zeros = (from, to) => w.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return true;                     // :: unspecified
  if (zeros(0, 7) && w[7] === 1) return true;       // ::1 loopback
  if ((w[0] & 0xff80) === 0xfe80) return true;      // fe80::/10 link-local, fec0::/10 site-local
  if ((w[0] & 0xfe00) === 0xfc00) return true;      // fc00::/7 unique local
  if ((w[0] & 0xff00) === 0xff00) return true;      // ff00::/8 multicast
  // An IPv4 address carried in IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d).
  const carried = (zeros(0, 5) && (w[5] === 0xffff || w[5] === 0)) || (w[0] === 0x64 && w[1] === 0xff9b && zeros(2, 6));
  return carried ? isPrivateV4(w[6] * 65536 + w[7]) : false;
}
/** A hostname the way Chromium writes it: lower case, IPv4 in dotted
 *  decimal (so 2130706433 and 0x7f.1 are 127.0.0.1), IPv6 without brackets,
 *  no trailing dot. */
function canonicalHost(hostname) {
  let h = String(hostname || '').trim().toLowerCase();
  if (!h) return '';
  if (h.includes(':') && !h.startsWith('[')) h = `[${h}]`;
  try { h = new URL(`http://${h}/`).hostname; } catch { /* leave it as written */ }
  return h.replace(/^\[|\]$/g, '').replace(/\.$/, '');
}
/** Is this hostname private by its form alone: a loopback, private,
 *  link-local or reserved IP literal, or a name reserved for local use
 *  (localhost, *.localhost, *.local, *.home.arpa, *.internal)? */
function isPrivateHostLiteral(hostname) {
  const h = canonicalHost(hostname);
  if (!h) return false;
  if (PRIVATE_NAME_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))) return true;
  if (h.includes(':')) { const w = ipv6Words(h); return !!w && isPrivateV6(w); }
  const n = ipv4Number(h);
  return n !== null && isPrivateV4(n);
}
/** The hostnames in a comma-separated list, canonical, as a Set
 *  (PARALLX_BROWSER_AGENT_ALLOW_LOCAL: "127.0.0.1,localhost"). */
function parseHostList(value) {
  const out = new Set();
  for (const part of String(value || '').split(',')) { const h = canonicalHost(part); if (h) out.add(h); }
  return out;
}
/** Does the assistant's profile refuse this URL? Yes when its host is a
 *  private literal (isPrivateHostLiteral) not named in `allowed`, a Set from
 *  parseHostList. A URL with no host (data:, about:) is not an address. */
function privateAddressRefused(url, allowed) {
  let host = '';
  try { host = new URL(String(url)).hostname; } catch { return false; }
  const h = canonicalHost(host);
  if (!h || !isPrivateHostLiteral(h)) return false;
  return !(allowed && typeof allowed.has === 'function' && allowed.has(h));
}

/** Per-site settings, the shield's switches. `redirects` true lets the site
 *  send the tab to another site on its own (navigationDecision). */
const COOKIE_MODES = ['block-third-party', 'block-all', 'allow'];
function defaultSite() {
  return { shields: true, cookies: 'block-third-party', https: true, redirects: false };
}
function normalizeSite(raw) {
  const d = defaultSite();
  if (!raw || typeof raw !== 'object') return d;
  return {
    shields: typeof raw.shields === 'boolean' ? raw.shields : d.shields,
    cookies: COOKIE_MODES.includes(raw.cookies) ? raw.cookies : d.cookies,
    https: typeof raw.https === 'boolean' ? raw.https : d.https,
    redirects: typeof raw.redirects === 'boolean' ? raw.redirects : d.redirects,
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

// ── User activation ──
// Chromium's popup blocker and its navigation throttles are not part of
// Electron, so the notion they rest on is rebuilt here: transient user
// activation. The page has it for a few seconds after the user pressed a
// mouse button or a key in it, and window.open consumes it. Everything that
// follows (popups, tab-unders, redirects) asks one question: did the user
// just act in this page, and has that act already been spent?
const ACTIVATION_MS = 5000;
const POPUP_GESTURE_MS = ACTIVATION_MS;
const NON_ACTIVATING_KEYS = new Set(['Escape', 'Esc', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock']);
/**
 * Does this input event (webContents 'input-event') grant activation? The
 * HTML rules: mousedown (not the context-menu button) and keydown (not
 * Escape, not a lone modifier). mouseup and the char event that follows a
 * keydown are the same act, not a second one: counting them doubled what a
 * click could open.
 */
function activationInput(input) {
  if (!input || typeof input !== 'object') return false;
  const t = input.type;
  if (t === 'mouseDown') return input.button !== 'right';
  if (t === 'keyDown' || t === 'rawKeyDown') return !NON_ACTIVATING_KEYS.has(String(input.key || ''));
  return false;
}

// ── Popups ──
// A page may open one new window per activation, only while the activation
// lasts, and never to a destination the filter lists would not let the page
// embed (the popunder ad networks). 'drop' is for schemes a popup may never
// carry (javascript:, data:, blob:, about:blank that the opener could only
// fill by scripting it).
function popupDecision({ url, gestureAgeMs, popupsSinceGesture, listed }) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return 'drop';
  if (listed) return 'block';
  if (!Number.isFinite(gestureAgeMs) || gestureAgeMs < 0 || gestureAgeMs > POPUP_GESTURE_MS) return 'block';
  if ((popupsSinceGesture || 0) >= 1) return 'block';
  return 'allow';
}

// ── Redirects ──
// A top-level navigation the page itself starts (a link, a script setting
// location, a meta refresh; never the address bar, Back, or a server
// redirect, which are not the page's doing) that leaves the site is judged
// by what the user did:
//   - the user just acted here and nothing has spent it: a click on a link.
//     Allowed.
//   - the user just acted here but the page already opened a window on it:
//     the tab-under, the popunder's other half (the link opens in the new
//     window and this tab slides to an ad). Blocked outright.
//   - no activation, and the document is only moments old: a redirect page
//     doing its job (sign-in, a link shortener, a consent hop). Allowed.
//   - no activation on a document the user has been sitting on: nobody
//     asked for this. Held for the user to say Continue.
// Staying on the same site is never questioned, nor is a site the user has
// marked (site.redirects), nor a page that is not web content to begin with.
const REDIRECT_GRACE_MS = 3000;
const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
function navigationDecision({ fromUrl, toUrl, activationAgeMs, popupsSinceActivation, documentAgeMs, site }) {
  if (!isWebUrl(toUrl) || !isWebUrl(fromUrl)) return 'allow';
  if (!isThirdParty(toUrl, fromUrl)) return 'allow';
  if (site && site.redirects === true) return 'allow';
  const active = Number.isFinite(activationAgeMs) && activationAgeMs >= 0 && activationAgeMs <= ACTIVATION_MS;
  if (active) return (popupsSinceActivation || 0) >= 1 ? 'tab-under' : 'allow';
  if (!Number.isFinite(documentAgeMs) || documentAgeMs < REDIRECT_GRACE_MS) return 'allow';
  return 'hold';
}

/**
 * A colour the page view may be painted with between documents: a hex
 * colour or an rgb()/rgba() triple, nothing that could carry CSS or script.
 */
function isViewColor(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) || /^#[0-9a-f]{3,4}$/i.test(v) || /^rgba?\(\s*[\d.]+%?(\s*,\s*[\d.]+%?){2}(\s*,\s*[\d.]+%?)?\s*\)$/i.test(v);
}

/**
 * Does a link clicked in the app open in a browser tab here? Only when the
 * extension has claimed links, the caller did not ask for the system browser
 * outright, and the URL is a plain http(s) address. mailto and the rest
 * always go to the system.
 */
function inAppLinkDecision(url, enabled, system) {
  if (!enabled || system) return false;
  if (typeof url !== 'string') return false;
  const u = url.trim();
  return /^https?:\/\/[^\s/?#]+/i.test(u) && !/\s/.test(u);
}

module.exports = {
  SEARCH_ENGINES,
  DEFAULT_ENGINE,
  POPUP_GESTURE_MS,
  popupDecision,
  activationInput,
  navigationDecision,
  ACTIVATION_MS,
  REDIRECT_GRACE_MS,
  isViewColor,
  inAppLinkDecision,
  PERMISSION_POLICY,
  COOKIE_MODES,
  siteKey,
  isThirdParty,
  isLocalHost,
  httpsUpgradeTarget,
  genericUserAgent,
  parseOmnibox,
  permissionPolicy,
  AGENT_DENIED_PERMISSIONS,
  agentPermission,
  isPrivateHostLiteral,
  parseHostList,
  privateAddressRefused,
  defaultSite,
  normalizeSite,
  cookieDecision,
  sanitizeFilename,
  downloadTarget,
};
