// browser-turnstile-probe.cjs: which part of the browser's page configuration
// makes a Cloudflare challenge loop? The same URL is loaded under a ladder of
// configurations, each one adding one thing the real bridge does
// (electron/browserBridge.cjs), in its own in-memory partition:
//
//   plain      Electron as it comes: its own user agent, no header edits,
//              no devtools link, no filter engine.
//   chrome-ua  The user agent the Browser sent until 2026-09-16: plain
//              Chrome, no Electron or app token. Kept in the ladder as the
//              control: a Chrome UA with no client hints reads as a spoof
//              and Turnstile fails with 600010 (stablyai/orca PR 18749).
//   headers    plain + the webRequest edits: Sec-GPC on every request,
//              Cookie and Set-Cookie stripped from third-party requests.
//   debugger   + the devtools link every page view holds (Page.enable, as
//              browserDebugger.cjs attaches it for scriptlets and page theme).
//   bridge     + the Ghostery engine from the app's own list cache, if
//              present. This is the page as the Browser serves it now.
//
// For each rung the probe reports whether the challenge passed on its own,
// passed after one click on the widget, kept reloading (the loop), or timed
// out, plus what the page saw of itself (user agent brands, window.chrome,
// navigator.webdriver, visibility). The first rung that fails names the cause.
//
// The window is never shown: it is created with opacity 0, off the taskbar,
// never focused, and destroyed after each rung. --visible shows it instead,
// for a challenge that wants a real click.
//
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/probes/browser-turnstile-probe.cjs [url] [--visible] [--only=plain,chrome-ua,...]
// The default URL is Cloudflare's own sign-in page, which carries a Turnstile
// widget for everyone. Exit 0 always: this is a diagnostic, its output is the result.
'use strict';
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const policy = require('../../electron/browserPolicy.cjs');

// Nothing of the probe lands in the app's data: its own userData under the OS temp folder, in-memory partitions.
app.setPath('userData', path.join(require('os').tmpdir(), 'parallx-turnstile-probe'));
// Closing a rung's window must not end the run.
app.on('window-all-closed', () => { /* the ladder decides when to quit */ });
// Console output to a pipe is asynchronous and app.exit drops what has not
// flushed, so the report is also written synchronously, here.
const REPORT = path.join(app.getPath('userData'), 'report.txt');
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

let ElectronBlocker = null;
try { ({ ElectronBlocker } = require('@ghostery/adblocker-electron')); } catch { ElectronBlocker = null; }

const DEFAULT_URL = 'https://dash.cloudflare.com/login';
const URL_ARG = process.argv.find((a) => /^https?:\/\//i.test(a)) || DEFAULT_URL;
const VISIBLE = process.argv.includes('--visible');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const WAIT_MS = 30_000;
const CLICK_AFTER_MS = 4_000;
const ENGINE = ['engine-full.bin', 'engine.bin']
  .map((f) => path.join(process.cwd(), 'data', 'chromium-cache', 'browser', f))
  .find((p) => fs.existsSync(p));

// The rewrite the Browser used to apply, verbatim, so the control rung sends exactly what failed.
function chromeOnlyUserAgent(chromeVersion, platform) {
  const major = String(chromeVersion || '').split('.')[0] || '120';
  const os = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : (platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64');
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

const RUNGS = [
  { name: 'plain', ua: false, headers: false, debugger: false, engine: false },
  { name: 'chrome-ua', ua: true, headers: false, debugger: false, engine: false },
  { name: 'headers', ua: false, headers: true, debugger: false, engine: false },
  { name: 'debugger', ua: false, headers: true, debugger: true, engine: false },
  { name: 'bridge', ua: false, headers: true, debugger: true, engine: true },
].filter((r) => !ONLY.length || ONLY.includes(r.name));

const CHALLENGE_TITLE = /just a moment|attention required|verify you are human|checking your browser|security check/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The webRequest edits, as installWebRequest makes them for a user tab.
function installHeaders(ses) {
  const site = policy.defaultSite();
  const docUrlOf = (details) => {
    if (details.resourceType === 'mainFrame') return details.url;
    try { const wc = details.webContents; if (wc && !wc.isDestroyed()) return wc.getURL(); } catch { /* ignore */ }
    return details.referrer || '';
  };
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['Sec-GPC'] = '1';
    if (policy.cookieDecision(site, details.url, docUrlOf(details)) === 'strip') {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k];
    }
    callback({ requestHeaders: headers });
  });
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...(details.responseHeaders || {}) };
    if (policy.cookieDecision(site, details.url, docUrlOf(details)) === 'strip') {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k];
    }
    callback({ responseHeaders: headers });
  });
}

const PAGE_FACTS = `(function(){
  try {
    var b = navigator.userAgentData ? navigator.userAgentData.brands.map(function(x){return x.brand+' '+x.version}).join(', ') : 'none';
    var token = document.querySelector('input[name="cf-turnstile-response"]');
    var frame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    var rect = null;
    var host = document.querySelector('#turnstile-wrapper, .cf-turnstile, [id^="cf-chl-widget"], .main-content .challenge-widget, #challenge-stage');
    var el = frame || host;
    if (el) { var r = el.getBoundingClientRect(); rect = { x: r.left, y: r.top, w: r.width, h: r.height }; }
    return {
      title: document.title, url: location.href, visibility: document.visibilityState,
      brands: b, chrome: typeof window.chrome, webdriver: navigator.webdriver === true,
      token: !!(token && token.value), challengeVisible: !!el, rect: rect,
      bodyText: (document.body && document.body.innerText || '').slice(0, 200).replace(/\\s+/g, ' '),
    };
  } catch (e) { return { error: String(e) }; }
})()`;

async function runRung(rung) {
  const ses = session.fromPartition(`probe-turnstile-${rung.name}`);
  // The bridge fixes Accept-Language on every rung; only the control rewrites the UA itself.
  ses.setUserAgent(rung.ua ? chromeOnlyUserAgent(process.versions.chrome, process.platform) : app.userAgentFallback, 'en-US,en;q=0.9');
  if (rung.headers) installHeaders(ses);
  let blocker = null;
  if (rung.engine && ENGINE && ElectronBlocker) {
    blocker = ElectronBlocker.deserialize(fs.readFileSync(ENGINE));
    blocker.enableBlockingInSession(ses);
  }
  const win = new BrowserWindow({
    width: 1100, height: 800, show: false, frame: false, skipTaskbar: true, focusable: VISIBLE, opacity: VISIBLE ? 1 : 0,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const wc = win.webContents;
  let navigations = 0;
  const titles = [];
  wc.on('did-navigate', (_e, url) => { navigations++; titles.push(url); });
  if (VISIBLE) win.show(); else win.showInactive();
  const started = Date.now();
  wc.loadURL(URL_ARG).catch(() => { /* reported below */ });
  let debuggerNote = '';
  if (rung.debugger) {
    // After loadURL, never before: a command sent to a window whose renderer
    // has not started waits for one, and the renderer starts with the load.
    // Time-boxed like the real controller (browserDebugger.cjs, 10 s).
    try {
      wc.debugger.attach('1.3');
      await Promise.race([
        wc.debugger.sendCommand('Page.enable'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Page.enable did not answer within 10 s')), 10_000)),
      ]);
      debuggerNote = 'attached, Page enabled';
    } catch (err) { debuggerNote = `attach failed: ${err && err.message}`; say(`  [${rung.name}] ${debuggerNote}`); }
  }

  let outcome = 'timeout';
  let via = '';
  let clicked = false;
  let facts = null;
  while (Date.now() - started < WAIT_MS) {
    await sleep(1000);
    if (wc.isDestroyed()) { outcome = 'gone'; break; }
    let cookies = [];
    try { cookies = await ses.cookies.get({}); } catch { cookies = []; }
    const clearance = cookies.some((c) => c.name === 'cf_clearance');
    try { facts = await wc.executeJavaScript(PAGE_FACTS, true); } catch { facts = null; }
    const title = facts && facts.title ? facts.title : '';
    const challenged = CHALLENGE_TITLE.test(title) || (facts && facts.challengeVisible);
    if (clearance || (facts && facts.token) || (navigations >= 1 && !challenged && facts && !facts.error && Date.now() - started > 6000)) {
      outcome = clicked ? 'passed-after-click' : 'passed';
      via = clearance ? 'cf_clearance issued' : (facts && facts.token ? 'widget token present' : 'page settled with no challenge shown');
      break;
    }
    if (navigations >= 4) { outcome = 'loop'; break; }
    if (!clicked && challenged && facts && facts.rect && facts.rect.w > 0 && Date.now() - started > CLICK_AFTER_MS) {
      // One click where the checkbox sits: near the left edge of the widget, vertically centred.
      const x = Math.round(facts.rect.x + Math.min(30, facts.rect.w / 2));
      const y = Math.round(facts.rect.y + facts.rect.h / 2);
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      clicked = true;
      console.log(`  [${rung.name}] clicked the widget at ${x},${y}`);
    }
  }
  let cookieNames = [];
  try { cookieNames = (await ses.cookies.get({})).map((c) => c.name); } catch { cookieNames = []; }
  const result = {
    rung: rung.name, outcome, via, debuggerNote, navigations, clicked, seconds: Math.round((Date.now() - started) / 1000),
    title: facts && facts.title, finalUrl: facts && facts.url, visibility: facts && facts.visibility,
    brands: facts && facts.brands, chrome: facts && facts.chrome, webdriver: facts && facts.webdriver,
    cookies: cookieNames.slice(0, 12), text: facts && facts.bodyText,
    engine: rung.engine ? (blocker ? 'on' : 'no cache or engine') : 'off',
  };
  try { if (rung.debugger && wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* ignore */ }
  try { win.destroy(); } catch { /* ignore */ }
  try { await ses.clearStorageData(); } catch { /* ignore */ }
  return result;
}

app.whenReady().then(async () => {
  say(`probe: ${URL_ARG}`);
  say(`chrome ${process.versions.chrome}, electron ${process.versions.electron}, engine cache ${ENGINE ? 'found' : 'missing'}, window ${VISIBLE ? 'visible' : 'hidden'}`);
  say(`stock user agent: ${app.userAgentFallback}`);
  say(`report: ${REPORT}`);
  const results = [];
  for (const rung of RUNGS) {
    say(`\n== ${rung.name} ==`);
    let r;
    try { r = await runRung(rung); } catch (err) { r = { rung: rung.name, outcome: `error: ${err && err.message ? err.message : err}`, seconds: 0, navigations: 0, cookies: [], engine: 'n/a' }; }
    results.push(r);
    say(`  outcome: ${r.outcome} (${r.seconds}s, ${r.navigations} navigations${r.clicked ? ', one click' : ''}${r.via ? ', ' + r.via : ''}${r.debuggerNote ? ', devtools ' + r.debuggerNote : ''})`);
    say(`  title: ${r.title}`);
    say(`  url: ${r.finalUrl}`);
    say(`  page sees: brands=[${r.brands}] window.chrome=${r.chrome} webdriver=${r.webdriver} visibility=${r.visibility}`);
    say(`  cookies: ${(r.cookies || []).join(', ') || 'none'}; engine ${r.engine}`);
    if (r.text) say(`  text: ${r.text}`);
    try { fs.writeFileSync(REPORT, lines.join('\n') + '\n'); } catch { /* the console still has it */ }
  }
  say('\n== summary ==');
  for (const r of results) say(`  ${r.rung.padEnd(9)} ${r.outcome}`);
  const control = results.find((r) => r.rung === 'chrome-ua');
  const ladder = results.filter((r) => r.rung !== 'chrome-ua');
  if (control) say(`  control (the old Chrome-only UA): ${control.outcome}${/^passed/.test(control.outcome) ? ' (the rewrite is not what this page objects to)' : ' (the rewrite alone fails this page)'}`);
  const firstFail = ladder.find((r) => !/^passed/.test(r.outcome));
  const lastPass = [...ladder].reverse().find((r) => /^passed/.test(r.outcome));
  if (firstFail && lastPass && ladder.indexOf(firstFail) > ladder.indexOf(lastPass)) {
    say(`  first failing rung: ${firstFail.rung} (the thing it adds over ${lastPass.rung} is the suspect)`);
  } else if (firstFail && !lastPass) {
    say('  every rung failed, plain Electron included: the cause is not in the bridge configuration (hidden window, IP reputation, or the site wants a real click)');
  } else if (!firstFail) {
    say('  every rung passed: the Browser as it is now clears this page');
  }
  try { fs.writeFileSync(REPORT, lines.join('\n') + '\n'); } catch { /* the console still has it */ }
  setTimeout(() => app.quit(), 300);
});
