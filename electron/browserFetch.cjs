// electron/browserFetch.cjs — reading a page with the real browser engine.
//
// The plain fetch (webFetchBridge.cjs) runs on Node's HTTPS client. A bot wall
// (Cloudflare and its kind) fingerprints the TLS handshake and the HTTP
// behaviour, not the User-Agent line, and answers 403 to anything that is not
// a browser; it may also serve a JavaScript challenge that a plain client can
// never pass. This module loads the page in a hidden Chromium window instead,
// with Electron's own user agent (a Chrome UA with no client hints reads as a
// spoof and breaks the challenge, see browserBridge.cjs), waits the challenge
// out, and returns the document's HTML for the same sanitizer the plain fetch
// feeds. It is the fallback the Web Research extension takes when a site
// refuses the plain fetch (its setting "browserFallback").
//
// Every rule of the plain fetch holds here, for the page and for everything
// it loads: HTTPS only, the domain blocklist, no private or local addresses
// (the preflight the bridge hands in, DNS included, on the page and on every
// main-frame navigation; by form on subresources, as the assistant browser
// does), a wall-clock budget, a size cap, no downloads, no popups, no
// permissions. The window is never shown. Its session is in memory only and
// is wiped when the read ends, so nothing a site sets outlives one read.
//
// Pure parts (looksLikeChallenge, the gate) and the flow are unit-tested with
// a fake Electron: tests/unit/browserFetch.test.ts.

'use strict';

const DEFAULTS = Object.freeze({
  totalTimeoutMs: 25_000,      // the whole read, challenge included
  loadTimeoutMs: 15_000,       // the first document
  challengeWaitMs: 9_000,      // one round of a JavaScript challenge
  challengeRounds: 2,
  maxHtmlBytes: 10 * 1024 * 1024,
  width: 1280,
  height: 900,
});

const CHALLENGE_TITLE = /just a moment|attention required|checking your browser|verify you are (a )?human|access denied|security check|please wait|one more step|are you a robot|ddos-guard|bot verification/i;
const CHALLENGE_MARKERS = ['cf-challenge', 'challenge-platform', '_cf_chl_opt', 'cf-turnstile', 'cf_chl_', 'captcha-delivery', 'px-captcha', '_pxhd', 'awswaf', 'ddos-guard', 'hcaptcha', 'g-recaptcha', 'sec-cpt-'];

function _err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** Is this document a bot wall or a human check rather than the page? */
function looksLikeChallenge({ status, title, html }) {
  const t = String(title || '');
  const h = String(html || '');
  if (CHALLENGE_TITLE.test(t)) return true;
  const head = h.slice(0, 200_000).toLowerCase();
  if (CHALLENGE_MARKERS.some((m) => head.includes(m))) return true;
  // A short page under a refusing status is the wall's own text, not the page.
  const s = Number(status) || 0;
  if ((s === 403 || s === 429 || s === 503) && h.length < 20_000) return true;
  return false;
}

/**
 * Build the fetcher. `electron` is the module (BrowserWindow, session, app);
 * `policy` is browserPolicy.cjs (privateAddressRefused); `preflight(url)`
 * is the bridge's gate (HTTPS, blocklist, DNS), which throws when refused.
 */
function createBrowserFetch({ electron, policy, preflight, options = {} }) {
  if (!electron || !electron.BrowserWindow || !electron.session) throw new Error('[browserFetch] electron is required');
  if (typeof preflight !== 'function') throw new Error('[browserFetch] preflight(url) is required');
  const cfg = { ...DEFAULTS, ...options };
  const { BrowserWindow, session, app } = electron;
  let seq = 0;
  // One hidden window at a time: a Chromium renderer per read is heavy, and
  // the callers (one chat turn, one Add Link) never need two at once.
  let chain = Promise.resolve();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The gate on everything the page loads. Main-frame navigations re-run the full preflight. */
  function gate(details, callback) {
    const u = String(details.url || '');
    if (/^(data|blob|about):/i.test(u)) return callback({});
    if (!/^https:/i.test(u)) return callback({ cancel: true });
    if (policy && typeof policy.privateAddressRefused === 'function' && policy.privateAddressRefused(u)) return callback({ cancel: true });
    if (details.resourceType === 'mainFrame') {
      Promise.resolve().then(() => preflight(u)).then(() => callback({}), () => callback({ cancel: true }));
      return;
    }
    callback({});
  }

  function configure(ses) {
    try { if (app && app.userAgentFallback) ses.setUserAgent(app.userAgentFallback, 'en-US,en;q=0.9'); } catch { /* fake session */ }
    try { ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); } catch { /* ignore */ }
    try { ses.setPermissionCheckHandler(() => false); } catch { /* ignore */ }
    try { ses.setDevicePermissionHandler(() => false); } catch { /* ignore */ }
    try { ses.on('will-download', (_e, item) => { try { item.cancel(); } catch { /* gone */ } }); } catch { /* ignore */ }
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, gate);
  }

  /** Resolves when the main frame finished loading or failed; rejects on failure. */
  function waitForLoad(wc, ms) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); wc.removeListener('did-finish-load', onLoad); wc.removeListener('did-fail-load', onFail); fn(v); };
      const onLoad = () => finish(resolve, true);
      const onFail = (_e, code, desc, _url, isMainFrame) => {
        if (isMainFrame === false) return;
        if (code === -3) return; // ERR_ABORTED: the navigation was replaced by another (a redirect, a challenge reload)
        finish(reject, _err('BROWSER_LOAD_FAILED', `The page did not load (${desc || code}).`));
      };
      const timer = setTimeout(() => finish(reject, _err('TIMEOUT', `The page did not load within ${ms}ms.`)), ms);
      wc.on('did-finish-load', onLoad);
      wc.on('did-fail-load', onFail);
    });
  }

  async function readDocument(wc) {
    const r = await wc.executeJavaScript('({ html: document.documentElement ? document.documentElement.outerHTML : "", title: document.title || "", url: location.href })', true);
    return { html: String((r && r.html) || ''), title: String((r && r.title) || ''), url: String((r && r.url) || '') };
  }

  async function fetchOnce(url) {
    await preflight(url);
    const partition = `webfetch-${Date.now().toString(36)}-${++seq}`; // no "persist:": in memory only
    const ses = session.fromPartition(partition);
    configure(ses);
    const win = new BrowserWindow({
      show: false, width: cfg.width, height: cfg.height,
      webPreferences: {
        partition, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        webviewTag: false, images: false, spellcheck: false, backgroundThrottling: false,
      },
    });
    const wc = win.webContents;
    let status = 0;
    try { wc.setWindowOpenHandler(() => ({ action: 'deny' })); } catch { /* fake */ }
    try { wc.setAudioMuted(true); } catch { /* fake */ }
    wc.on('will-attach-webview', (e) => { try { e.preventDefault(); } catch { /* ignore */ } });
    wc.on('did-navigate', (_e, _url, code) => { status = Number(code) || status; });
    const started = Date.now();
    const left = () => cfg.totalTimeoutMs - (Date.now() - started);
    try {
      const loading = waitForLoad(wc, Math.min(cfg.loadTimeoutMs, cfg.totalTimeoutMs));
      wc.loadURL(url).catch(() => { /* did-fail-load says why */ });
      await loading;
      let doc = await readDocument(wc);
      // A challenge reloads into the page on its own once it is satisfied;
      // give it a round or two, within the budget.
      for (let round = 0; round < cfg.challengeRounds && looksLikeChallenge({ status, title: doc.title, html: doc.html }); round++) {
        const wait = Math.min(cfg.challengeWaitMs, left());
        if (wait <= 0) break;
        await waitForLoad(wc, wait).catch(() => { /* no reload came: read what is there */ });
        doc = await readDocument(wc);
      }
      if (looksLikeChallenge({ status, title: doc.title, html: doc.html })) {
        throw _err('BROWSER_CHALLENGE', 'The site asked for a human check that the browser engine could not pass on its own.');
      }
      let html = doc.html;
      if (Buffer.byteLength(html, 'utf8') > cfg.maxHtmlBytes) html = html.slice(0, cfg.maxHtmlBytes);
      return { status: status || 200, finalUrl: doc.url || url, contentType: 'text/html', body: html, title: doc.title, via: 'browser' };
    } finally {
      try { if (!win.isDestroyed()) win.destroy(); } catch { /* gone */ }
      // Nothing the site set outlives the read.
      Promise.resolve().then(() => ses.clearStorageData && ses.clearStorageData()).catch(() => {});
      Promise.resolve().then(() => ses.clearCache && ses.clearCache()).catch(() => {});
    }
  }

  /** Read `url` with the browser engine: { status, finalUrl, contentType, body, title, via }. */
  function fetchPage({ url }) {
    if (typeof url !== 'string' || !url) return Promise.reject(_err('INVALID_URL', 'browser fetch requires a string URL'));
    const run = chain.then(() => {
      let timer;
      const budget = new Promise((_r, reject) => { timer = setTimeout(() => reject(_err('TIMEOUT', `The read exceeded ${cfg.totalTimeoutMs}ms.`)), cfg.totalTimeoutMs); });
      return Promise.race([fetchOnce(url), budget]).finally(() => clearTimeout(timer));
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  return { fetchPage, _gate: gate, _sleep: sleep, _config: cfg };
}

module.exports = { createBrowserFetch, looksLikeChallenge, DEFAULTS, CHALLENGE_MARKERS };
