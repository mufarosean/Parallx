// browserBridge.cjs — the private browser's privileged half.
//
// Two persistent sessions, one for the user and one for the agent, each
// configured the same way and sealed off from the app's own session:
//   - ads and trackers blocked by the Ghostery adblocker engine on the
//     EasyList/EasyPrivacy family of lists (network filters here, cosmetic
//     filters and scriptlets through the engine's own frame preload),
//   - third-party cookies stripped both ways,
//   - http:// top-level navigations upgraded to https:// before a connection,
//   - a plain Chrome user agent and Sec-GPC: 1,
//   - permissions denied by default, the human ones asked through the
//     renderer and remembered per site,
//   - popups denied and handed to the renderer as "open this URL",
//   - downloads only into the workspace Downloads folder (the assistant's
//     only into its run's folder, never the workspace),
//   - the assistant's pages kept off loopback, LAN and link-local addresses,
//   - HTTP sign-ins and "leave this page?" answered by the user, never
//     silently.
// Per-site settings and permission decisions live in JSON under
// userData/browser/. The pure rules are in browserPolicy.cjs.
'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { session, app, shell, webContents, WebContentsView, dialog } = require('electron');
const policy = require('./browserPolicy.cjs');
const { parse: parseTld } = require('tldts');
const { createDebuggerController } = require('./browserDebugger.cjs');
const { createAutomationBroker } = require('./browserAutomationBroker.cjs');

let ElectronBlocker = null;
let AdblockRequest = null;
try { ({ ElectronBlocker, Request: AdblockRequest } = require('@ghostery/adblocker-electron')); } catch { ElectronBlocker = null; AdblockRequest = null; }
// The engine's frame preload handles cosmetic CSS and DOM-driven rules; we
// register it ourselves (once per session) instead of enableBlockingInSession,
// which registers one IPC handler per session and throws on the second.
let ADBLOCK_PRELOAD = null;
try { ADBLOCK_PRELOAD = require.resolve('@ghostery/adblocker-electron-preload'); } catch { ADBLOCK_PRELOAD = null; }

// The private partition has no `persist:` prefix: it lives in memory only and
// the extension clears it when the last private tab closes.
const PARTITIONS = { user: 'persist:parallx-browser', agent: 'persist:parallx-browser-agent', private: 'parallx-browser-private' };
// Twelve hours, not a week: uBlock's quick-fixes list moves daily against
// YouTube's anti-adblock changes, and stale rules are how ads get through.
const LIST_REFRESH_MS = 12 * 60 * 60 * 1000;
const LIST_CHECK_MS = 60 * 60 * 1000;
const LIST_RETRY_MS = 10 * 60 * 1000;
const PERMISSION_TIMEOUT_MS = 60 * 1000;
// An HTTP sign-in nobody answers is cancelled, so the page stops waiting.
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
// The Electron world the bridge runs its own page script in (0 is the page,
// 999 Electron's preload world): nothing a page script patches reaches it.
const BRIDGE_WORLD_ID = 1017;

function setupBrowserBridge(ipcMain, opts) {
  const getMainWindow = opts.getMainWindow;
  const getWorkspaceRoot = opts.getWorkspaceRoot || (() => null);
  const dir = path.join(opts.userData || app.getPath('userData'), 'browser');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  const sitesPath = path.join(dir, 'sites.json');
  const permissionsPath = path.join(dir, 'permissions.json');
  const prefsPath = path.join(dir, 'prefs.json');
  // Two list sets, one engine cache each: ads and trackers, or that plus the
  // annoyance lists (cookie banners, newsletter and social overlays). The
  // set in use is remembered here so the engine is right from the first load.
  const ENGINE_FILES = { ads: 'engine.bin', full: 'engine-full.bin' };
  const prefs = { annoyances: true, holdRedirects: true, ...readJson(prefsPath, {}) };
  const enginePathFor = () => path.join(dir, prefs.annoyances ? ENGINE_FILES.full : ENGINE_FILES.ads);
  try { fs.unlinkSync(path.join(dir, prefs.annoyances ? ENGINE_FILES.ads : ENGINE_FILES.full)); } catch { /* none */ }

  // ── State ──
  const sites = readJson(sitesPath, {});           // siteKey -> { shields, cookies, https }
  const permissions = readJson(permissionsPath, {}); // `${siteKey}|${permission}` -> 'allow' | 'deny'
  const httpOnce = new Set();                      // http URLs the user chose to load once
  const blocked = new Map();                       // webContentsId -> { count, hosts: Map }
  const pendingPermissions = new Map();            // requestId -> { callback, timer }
  const pendingAuth = new Map();                   // requestId -> { rec, tabId, key, callbacks, timer }: HTTP sign-ins
  // Hostnames the assistant's pages may reach although they are private
  // (loopback, LAN, link-local). Empty unless set; the probes list their
  // loopback fixtures here, e.g. "127.0.0.1,localhost".
  const agentAllowLocal = policy.parseHostList(process.env.PARALLX_BROWSER_AGENT_ALLOW_LOCAL);
  const downloads = new Map();                     // id -> info
  const sessions = new Map();                      // kind -> Session
  const sessionPermissions = {};                   // private tabs: remembered for this run only
  const blockedLog = [];                           // last 500 blocked requests: { t, page, host }
  const blockedStatsPath = path.join(dir, 'blocked-stats.json');
  const blockedStats = readJson(blockedStatsPath, { total: 0, since: Date.now(), byHost: {} });
  let statsTimer = null;
  let blocker = null;
  let lists = { status: ElectronBlocker ? 'loading' : 'unavailable', count: 0, updatedAt: null, error: null };
  let permissionSeq = 0;
  let downloadSeq = 0;
  let authSeq = 0;
  let inAppLinks = false;                          // the extension claimed links clicked anywhere in the app
  let broker = null;                               // the assistant's automation (browserAutomationBroker.cjs), created below
  const recByWc = new Map();                       // webContentsId -> page view record
  // A broker hook called only when the broker has it, and never allowed to
  // break the view event that called it (an exception here would surface as
  // an uncaught error in the main process). Undefined when absent or thrown.
  const brokerHook = (name, ...args) => {
    if (!broker || typeof broker[name] !== 'function') return undefined;
    try { return broker[name](...args); } catch (err) { console.warn(`[browser] ${name}:`, err && err.message); return undefined; }
  };
  // The privileged view API answers the app window only.
  const isMainSender = (event) => { const w = getMainWindow(); return !!(w && !w.isDestroyed() && event && event.sender === w.webContents); };

  const send = (channel, payload) => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  const siteFor = (url) => policy.normalizeSite(sites[policy.siteKey(url) || '']);
  const documentUrlOf = (details) => {
    try { const wc = details.webContents; if (wc && !wc.isDestroyed()) return wc.getURL(); } catch { /* ignore */ }
    return details.referrer || '';
  };
  const isOurs = (ses) => [...sessions.values()].includes(ses) || [...agentPrivateSessions.values()].includes(ses);

  // ── Sessions ──
  for (const [kind, partition] of Object.entries(PARTITIONS)) {
    const ses = session.fromPartition(partition);
    sessions.set(kind, ses);
    configureSession(ses, kind);
  }
  // Private assistant sessions (browserOpen private: true): one partition per
  // chat's private session, in memory only (no "persist:"), with every rule of
  // the assistant's profile. Made on first use; wiped when its last tab closes.
  const AGENT_PRIVATE_PREFIX = 'parallx-browser-agent-private-';
  const agentPrivateSessions = new Map(); // partition -> session
  function agentPrivateSession(partition) {
    let ses = agentPrivateSessions.get(partition);
    if (ses) return ses;
    ses = session.fromPartition(partition);
    agentPrivateSessions.set(partition, ses);
    configureSession(ses, 'agent');
    if (cosmeticsWired && ADBLOCK_PRELOAD) { try { ses.registerPreloadScript({ type: 'frame', filePath: ADBLOCK_PRELOAD }); } catch (err) { console.warn('[browser] cosmetic preload:', err && err.message); } }
    return ses;
  }
  /** Everything a session keeps: storage, caches, sign-ins. */
  async function clearSession(ses) {
    try { await ses.clearData(); } catch { /* older runtime */ }
    await ses.clearStorageData();
    await ses.clearCache();
    try { await ses.clearCodeCaches({}); } catch { /* ignore */ }
    try { await ses.clearSharedDictionaryCache(); } catch { /* ignore */ }
    await ses.clearAuthCache();
    await ses.clearHostResolverCache();
  }

  function configureSession(ses, kind) {
    ses.setUserAgent(policy.genericUserAgent(process.versions.chrome, process.platform), 'en-US,en;q=0.9');
    // The assistant's profile is decided first: it asks nobody, and even what
    // the user's tabs get silently (fullscreen over the app, clipboard
    // writes) is refused there, since the model's clicks count as gestures.
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (kind === 'agent') return callback(policy.agentPermission(permission));
      const pol = policy.permissionPolicy(permission);
      if (pol === 'allow') return callback(true);
      if (pol === 'deny') return callback(false);
      const origin = (details && details.requestingUrl) || (wc && !wc.isDestroyed() ? wc.getURL() : '');
      const key = `${policy.siteKey(origin) || 'unknown'}|${permission}`;
      const store = kind === 'private' ? sessionPermissions : permissions;
      if (store[key] === 'allow') return callback(true);
      if (store[key] === 'deny') return callback(false);
      const requestId = `perm-${++permissionSeq}`;
      const timer = setTimeout(() => { pendingPermissions.delete(requestId); try { callback(false); } catch { /* ignore */ } }, PERMISSION_TIMEOUT_MS);
      pendingPermissions.set(requestId, { callback, timer, key, kind });
      send('browser:permission-request', { requestId, origin, permission, webContentsId: wc ? wc.id : null });
    });
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (kind === 'agent') return policy.agentPermission(permission);
      const pol = policy.permissionPolicy(permission);
      if (pol === 'allow') return true;
      if (pol === 'deny') return false;
      return (kind === 'private' ? sessionPermissions : permissions)[`${policy.siteKey(requestingOrigin) || 'unknown'}|${permission}`] === 'allow';
    });
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (_event, item, wc) => handleDownload(item, wc, kind));
    installWebRequest(ses, kind);
  }

  // Registered after the engine enables its own hooks: Electron keeps one
  // listener per event per session, so ours wrap the engine's.
  function installWebRequest(ses, kind) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      // A sealed workspace: the assistant's pages reach nothing. The user's own browsing is unaffected.
      if (kind === 'agent' && broker && broker.isAgentSealed()) return callback({ cancel: true });
      // The assistant's pages never reach this machine or the local network,
      // whatever a link, redirect, frame or subresource asks for. browserOpen
      // refuses these up front (and resolves names); this filter cannot wait
      // on DNS, so it knows private addresses by their form alone.
      if (kind === 'agent' && policy.privateAddressRefused(details.url, agentAllowLocal)) return callback({ cancel: true });
      if (details.resourceType === 'mainFrame') {
        const site = siteFor(details.url);
        if (site.https) {
          if (httpOnce.has(details.url)) {
            httpOnce.delete(details.url);
          } else {
            const target = policy.httpsUpgradeTarget(details.url);
            if (target) return callback({ redirectURL: target });
          }
        }
        blocked.set(details.webContentsId, { count: 0, hosts: new Map() });
      }
      const docUrl = details.resourceType === 'mainFrame' ? details.url : documentUrlOf(details);
      if (blocker && lists.status === 'ready' && siteFor(docUrl).shields) return blocker.onBeforeRequest(details, callback);
      callback({});
    });
    ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers['Sec-GPC'] = '1';
      const docUrl = details.resourceType === 'mainFrame' ? details.url : documentUrlOf(details);
      if (policy.cookieDecision(siteFor(docUrl), details.url, docUrl) === 'strip') {
        for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k];
      }
      callback({ requestHeaders: headers });
    });
    ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const headers = { ...(details.responseHeaders || {}) };
      const docUrl = details.resourceType === 'mainFrame' ? details.url : documentUrlOf(details);
      if (policy.cookieDecision(siteFor(docUrl), details.url, docUrl) === 'strip') {
        for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k];
      }
      if (blocker && lists.status === 'ready' && siteFor(docUrl).shields) {
        return blocker.onHeadersReceived({ ...details, responseHeaders: headers }, callback);
      }
      callback({ responseHeaders: headers });
    });
  }

  // ── Filter lists ──
  async function loadLists(force) {
    if (!ElectronBlocker) { lists = { status: 'unavailable', count: 0, updatedAt: null, error: 'engine not installed' }; send('browser:lists', lists); return; }
    lists = { ...lists, status: 'loading', error: null };
    send('browser:lists', lists);
    const enginePath = enginePathFor();
    try {
      let stale = force;
      try {
        const st = fs.statSync(enginePath);
        if (Date.now() - st.mtimeMs > LIST_REFRESH_MS) stale = true;
      } catch { stale = false; }
      if (stale) { try { fs.unlinkSync(enginePath); } catch { /* none */ } }
      const next = await ElectronBlocker[prefs.annoyances ? 'fromPrebuiltFull' : 'fromPrebuiltAdsAndTracking'](fetch, {
        path: enginePath,
        read: (p) => fsp.readFile(p),
        write: (p, data) => fsp.writeFile(p, data),
      });
      blocker = next;
      blocker.on('request-blocked', (req) => countBlocked(req));
      blocker.on('request-redirected', (req) => countBlocked(req));
      ensureCosmetics();
      for (const [kind, ses] of sessions) installWebRequest(ses, kind);
      for (const ses of agentPrivateSessions.values()) installWebRequest(ses, 'agent');
      for (const rec of views.values()) { try { refreshScriptlets(rec, rec.wc.getURL()); } catch { /* view gone */ } }
      let updatedAt = Date.now();
      try { updatedAt = fs.statSync(enginePath).mtimeMs; } catch { /* keep now */ }
      lists = { status: 'ready', count: countFilters(blocker), updatedAt, error: null, annoyances: prefs.annoyances };
    } catch (err) {
      lists = { status: blocker ? 'ready' : 'unavailable', count: blocker ? lists.count : 0, updatedAt: lists.updatedAt, error: err && err.message ? err.message : String(err), annoyances: prefs.annoyances };
      setTimeout(() => { void loadLists(false); }, LIST_RETRY_MS).unref?.();
    }
    send('browser:lists', lists);
  }
  function countFilters(engine) {
    try { const s = engine.getFilters ? engine.getFilters() : null; if (s) return (s.networkFilters || []).length + (s.cosmeticFilters || []).length; } catch { /* ignore */ }
    return 0;
  }
  function countBlocked(req) {
    const id = req && req.tabId;
    if (id == null) return;
    const entry = blocked.get(id) || { count: 0, hosts: new Map() };
    entry.count++;
    const host = req.hostname || policy.siteKey(req.url) || '?';
    entry.hosts.set(host, (entry.hosts.get(host) || 0) + 1);
    blocked.set(id, entry);
    // The log the user can read: what tried to track, from which page, when.
    // Private tabs leave nothing readable behind: they raise the lifetime total
    // and nothing else. (The per-tab count in the shield is in memory only.)
    let isPrivate = false;
    // The user's private tabs and the assistant's private sessions alike.
    try { const g = webContents.fromId(Number(id)); isPrivate = !!g && !g.isDestroyed() && (g.session === sessions.get('private') || [...agentPrivateSessions.values()].includes(g.session)); } catch { isPrivate = false; }
    if (!isPrivate) {
      const page = req.sourceHostname || req.sourceDomain || '';
      blockedLog.push({ t: Date.now(), page, host, popup: !!req.popup, redirect: !!req.redirect });
      if (blockedLog.length > 500) blockedLog.splice(0, blockedLog.length - 500);
      blockedStats.byHost[host] = (blockedStats.byHost[host] || 0) + 1;
    }
    blockedStats.total = (blockedStats.total || 0) + 1;
    if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = null; writeJson(blockedStatsPath, blockedStats); }, 5000);
    if (!entry._timer) {
      entry._timer = setTimeout(() => { entry._timer = null; send('browser:blocked', blockedSummary(id)); }, 150);
    }
  }
  function blockedSummary(id) {
    const e = blocked.get(id);
    if (!e) return { webContentsId: id, count: 0, hosts: [] };
    return { webContentsId: id, count: e.count, hosts: [...e.hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([host, n]) => ({ host, n })) };
  }
  void loadLists(false);
  setInterval(() => { void loadLists(false); }, LIST_CHECK_MS).unref?.();

  // ── Cosmetic filters and scriptlets ──
  // Cosmetic CSS: the engine's frame preload asks for rules at document start
  // and again as the DOM grows; we answer with styles only (user-origin CSS).
  // Scriptlets, which defeat YouTube-style ads by hooking the player before it
  // reads the page's ad data, are injected at DOCUMENT START in the main world
  // through the devtools protocol, before any page script and immune to the
  // page's CSP, the way uBlock's content scripts run. The engine's own path
  // would run them asynchronously, after the page had started.
  let cosmeticsWired = false;
  function ensureCosmetics() {
    if (cosmeticsWired) return;
    cosmeticsWired = true;
    if (ADBLOCK_PRELOAD) {
      for (const ses of [...sessions.values(), ...agentPrivateSessions.values()]) {
        try { ses.registerPreloadScript({ type: 'frame', filePath: ADBLOCK_PRELOAD }); } catch (err) { console.warn('[browser] cosmetic preload:', err && err.message); }
      }
    }
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', async () => true);
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => {
      if (!blocker || lists.status !== 'ready' || !siteFor(url).shields) return;
      const parsed = parseTld(String(url || ''));
      const first = msg === undefined;
      let result;
      try {
        result = blocker.getCosmeticsFilters({
          url, hostname: parsed.hostname || '', domain: parsed.domain || '',
          classes: msg && msg.classes, hrefs: msg && msg.hrefs, ids: msg && msg.ids,
          getBaseRules: first, getInjectionRules: false, getExtendedRules: false, getRulesFromHostname: first, getRulesFromDOM: !first,
          callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg && msg.lifecycle },
        });
      } catch { return; }
      if (!result || result.active === false) return;
      if (result.styles && result.styles.length) { try { event.sender.insertCSS(result.styles, { cssOrigin: 'user' }); } catch { /* frame gone */ } }
    });
  }
  function scriptletsFor(url) {
    if (!blocker || lists.status !== 'ready' || !/^https?:/i.test(url || '') || !siteFor(url).shields) return '';
    try {
      const parsed = parseTld(url);
      const r = blocker.getCosmeticsFilters({
        url, hostname: parsed.hostname || '', domain: parsed.domain || '',
        getBaseRules: false, getInjectionRules: true, getExtendedRules: false, getRulesFromDOM: false, getRulesFromHostname: true,
        callerContext: { lifecycle: 'start' },
      });
      if (!r || r.active === false || !r.scripts || !r.scripts.length) return '';
      return r.scripts.join('\n;\n');
    } catch { return ''; }
  }
  // Through the view's shared debugger controller, which puts the scriptlet
  // back if the link drops (DevTools) and is reattached.
  async function refreshScriptlets(rec, url) {
    if (!rec || rec.wc.isDestroyed() || !rec.dc) return;
    try { await rec.dc.setScriptlet(scriptletsFor(url)); } catch (err) { console.warn('[browser] scriptlet injection:', err && err.message); }
  }

  const PAGE_COLOR_EXPR = '(function(){try{var d=document.documentElement,b=document.body;var t=function(c){return !c||c==="transparent"||c==="rgba(0, 0, 0, 0)"};var c=b?getComputedStyle(b).backgroundColor:"";if(t(c))c=getComputedStyle(d).backgroundColor;return t(c)?"rgb(255, 255, 255)":String(c)}catch(e){return ""}})()';

  const hostnameOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  /** Would the lists stop the opener from embedding this URL? Then it may not open it as a window either. */
  function popupListed(url, openerUrl) {
    if (!blocker || !AdblockRequest || lists.status !== 'ready' || !siteFor(openerUrl).shields) return false;
    try {
      const r = blocker.match(AdblockRequest.fromRawDetails({ url, sourceUrl: openerUrl || '', type: 'sub_frame' }));
      return !!(r && r.match && !r.exception);
    } catch { return false; }
  }

  // ── Guests: popups, navigation resets, lifecycle ──
  function attachGuestHooks(guest) {
    if (!guest || guest.isDestroyed() || !isOurs(guest.session)) return;
    // A page's sound is the page's business: never start a browser tab muted.
    try { if (guest.isAudioMuted()) guest.setAudioMuted(false); } catch { /* ignore */ }
    // Transient user activation (policy.activationInput): a press grants it,
    // the windows opened on it spend it. Popups (policy.popupDecision) get
    // one window per activation, never to a destination the lists name; a
    // blocked one counts in the shield like any other blocked request.
    const gesture = { at: 0, used: 0, committedAt: Date.now() };
    guest.on('input-event', (_e, input) => {
      if (policy.activationInput(input)) { gesture.at = Date.now(); gesture.used = 0; }
      // On an assistant page, input that is not the assistant's own is the user taking over.
      if (broker) broker.onInput(recByWc.get(guest.id), input);
    });
    guest.setWindowOpenHandler(({ url, disposition }) => {
      let openerUrl = '';
      try { openerUrl = guest.getURL(); } catch { openerUrl = ''; }
      const decision = policy.popupDecision({
        url,
        gestureAgeMs: gesture.at ? Date.now() - gesture.at : Infinity,
        popupsSinceGesture: gesture.used,
        listed: popupListed(url, openerUrl),
      });
      if (decision === 'allow') {
        gesture.used++;
        // An assistant page's popup stays in the assistant profile, owned by the same chat.
        const opener = recByWc.get(guest.id);
        if (broker && opener && opener.kind === 'agent' && broker.onPopup(opener, url)) return { action: 'deny' };
        send('browser:open-url', { url, disposition, openerId: guest.id });
      }
      else if (decision === 'block') countBlocked({ tabId: guest.id, url, hostname: hostnameOf(url), sourceHostname: hostnameOf(openerUrl), popup: true });
      return { action: 'deny' };
    });
    // Redirects (policy.navigationDecision): a navigation this page starts
    // that leaves the site is a click, a tab-under, a fresh page's own
    // redirect, or nobody's idea. The last is held and the pane asks; the
    // tab-under is blocked outright. The assistant's pages are exempt: the
    // broker consents to each of their navigations itself.
    guest.on('will-navigate', (e, urlArg) => {
      const rec = recByWc.get(guest.id);
      if (rec && rec.kind === 'agent') return;
      if (e && typeof e.isMainFrame === 'boolean' && !e.isMainFrame) return;
      const toUrl = String((e && e.url) || urlArg || '');
      let fromUrl = '';
      try { fromUrl = guest.getURL(); } catch { fromUrl = ''; }
      const decision = policy.navigationDecision({
        fromUrl, toUrl,
        activationAgeMs: gesture.at ? Date.now() - gesture.at : Infinity,
        popupsSinceActivation: gesture.used,
        documentAgeMs: Date.now() - gesture.committedAt,
        site: siteFor(fromUrl),
      });
      if (decision === 'allow') return;
      if (decision === 'hold' && !prefs.holdRedirects) return;
      e.preventDefault();
      countBlocked({ tabId: guest.id, url: toUrl, hostname: hostnameOf(toUrl), sourceHostname: hostnameOf(fromUrl), redirect: true });
      if (decision === 'hold' && rec) emitView(rec, 'redirect-held', { from: fromUrl, url: toUrl });
    });
    guest.on('did-navigate', () => { gesture.committedAt = Date.now(); blocked.set(guest.id, { count: 0, hosts: new Map() }); send('browser:blocked', blockedSummary(guest.id)); });
    guest.on('destroyed', () => { blocked.delete(guest.id); });
  }
  function watchWindow(win) {
    if (!win || win.isDestroyed()) return;
    // Runs alongside the app's own hardening listener (no Node, isolated,
    // sandboxed, no preload). For the browser's partitions only, playback
    // does not wait for a gesture: a video the user opened plays with sound
    // instead of Chromium starting it muted.
    win.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
      if (params && Object.values(PARTITIONS).includes(params.partition)) webPreferences.autoplayPolicy = 'no-user-gesture-required';
    });
    win.webContents.on('did-attach-webview', (_event, guest) => attachGuestHooks(guest));
    // The app renderer reloading or crashing orphans the assistant's leases:
    // revoke them in this process before anything asynchronous can use them.
    // Sign-in prompts lived in that renderer: cancelled, so no page waits on one nobody can see.
    win.webContents.on('did-start-navigation', (e) => { if (e && e.isMainFrame && !e.isSameDocument) { cancelAuthFor(null); if (broker) broker.onRendererReset(); } });
    win.webContents.on('render-process-gone', () => { cancelAuthFor(null); if (broker) broker.onRendererReset(); });
    win.on('closed', () => { for (const rec of [...views.values()]) { try { rec.wc.close(); } catch { /* ignore */ } } views.clear(); });
  }
  watchWindow(getMainWindow());

  // ── Downloads ──
  function downloadDir() {
    const root = getWorkspaceRoot();
    const base = root ? path.join(root, 'Downloads') : app.getPath('downloads');
    try { fs.mkdirSync(base, { recursive: true }); } catch { /* best effort */ }
    return base;
  }
  function handleDownload(item, wc, kind) {
    const id = `dl-${++downloadSeq}`;
    // Anything the assistant's profile downloads belongs to the assistant: it
    // lands in the run's own folder under userData/browser/artifacts (the
    // chat's last run, or an unowned folder there, once no run is live),
    // never in whatever workspace happens to be open. With no such folder it
    // is refused, not saved as the user's.
    const owned = kind === 'agent' ? brokerHook('downloadPathFor', wc, item.getFilename()) : null;
    if (kind === 'agent' && !(owned && owned.path)) { try { item.cancel(); } catch { /* already over */ } return; }
    const entry = owned && owned.entry ? owned.entry : null;
    const target = owned ? owned.path : policy.downloadTarget(downloadDir(), item.getFilename(), (p) => fs.existsSync(p), path.sep);
    item.setSavePath(target);
    // While it runs, the broker can stop it (sealing, a workspace change, a
    // renderer reset). A function, not the item, so the entry stays plain data.
    if (entry) entry.cancel = () => { try { const s = item.getState(); if (s === 'progressing' || s === 'interrupted') item.cancel(); } catch { /* already over */ } };
    const info = { id, kind, assistant: !!owned, url: item.getURL(), filename: path.basename(target), path: target, total: item.getTotalBytes(), received: 0, state: 'progressing', webContentsId: wc ? wc.id : null, startedAt: Date.now() };
    downloads.set(id, info);
    send('browser:download', { ...info });
    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes();
      info.total = item.getTotalBytes();
      info.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
      if (entry) entry.state = info.state;
      send('browser:download', { ...info });
    });
    item.once('done', (_e, state) => {
      info.received = item.getReceivedBytes();
      info.state = state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'failed');
      info.finishedAt = Date.now();
      if (entry) {
        entry.state = info.state;
        delete entry.cancel;
      }
      // An assistant download that did not finish leaves nothing half-written
      // in the run's folder (Chromium removes most partial files itself).
      if (owned && state !== 'completed') for (const p of [target, `${target}.crdownload`]) { try { fs.unlinkSync(p); } catch { /* none */ } }
      send('browser:download', { ...info });
    });
  }

  // ── HTTP sign-ins ──
  // Basic, digest and proxy authentication. Electron cancels these unless
  // someone answers, so the pane asks the user with a sign-in bar. The
  // assistant never sees or supplies credentials: on its tabs the broker
  // hands the step to the user (AUTH_NEEDS_USER). Requests waiting on the
  // same challenge in the same tab share one prompt and one answer, the way
  // Chrome signs every request waiting on a realm in with one sign-in.
  const authKey = (info) => `${info.isProxy ? 'proxy' : 'server'}|${info.scheme || ''}|${info.host || ''}:${info.port || 0}|${info.realm || ''}`;
  /** Answer one pending sign-in: credentials, or none to cancel it. */
  function settleAuth(id, username, password) {
    const e = pendingAuth.get(id);
    if (!e) return false;
    pendingAuth.delete(id);
    clearTimeout(e.timer);
    for (const cb of e.callbacks) {
      try { if (username == null) cb(); else cb(String(username), String(password == null ? '' : password)); } catch { /* request gone */ }
    }
    return true;
  }
  /** Cancel the pending sign-ins of one view, or of every view when rec is null. */
  function cancelAuthFor(rec) {
    for (const [id, e] of [...pendingAuth]) if (!rec || e.rec === rec) settleAuth(id);
  }
  function onLogin(rec, event, details, authInfo, callback) {
    event.preventDefault();
    const info = authInfo || {};
    const key = authKey(info);
    let id = null;
    for (const [k, e] of pendingAuth) if (e.rec === rec && e.key === key) { e.callbacks.push(callback); id = k; break; }
    if (!id) {
      const fresh = `auth-${++authSeq}`;
      const timer = setTimeout(() => settleAuth(fresh), AUTH_TIMEOUT_MS);
      timer.unref?.();
      pendingAuth.set(fresh, { rec, tabId: rec.tabId, key, callbacks: [callback], timer });
      id = fresh;
    }
    // Sent again for a request that joins a pending prompt, so a pane that
    // dropped its bar shows it again; the id says it is the same one.
    emitView(rec, 'auth-request', { id, host: info.host || '', port: info.port || 0, realm: info.realm || '', scheme: info.scheme || '', isProxy: !!info.isProxy, url: (details && details.url) || '' });
    brokerHook('onAuthRequired', rec, { host: info.host || '', realm: info.realm || '', scheme: info.scheme || '', isProxy: !!info.isProxy });
  }

  // ── Page views ──
  // A tab's page is a WebContentsView owned here and positioned over the
  // pane's content area from the rectangle the renderer reports. It outlives
  // the pane: moving a tab to another group, splitting, or evicting the pane
  // only moves or hides the rectangle, and the page never reloads. The
  // renderer destroys a view only once the editor is really closed.
  const views = new Map(); // tabId -> { tabId, kind, view, wc, bounds, visible, attached, fullscreen }
  const FORWARDED_KEYS = new Set(['Ctrl+L', 'Ctrl+F', 'Ctrl+T', 'Ctrl+R', 'F5', 'Ctrl+D', 'Ctrl+H', 'Ctrl+Shift+N', 'Ctrl+Shift+O', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0']);
  const chordOf = (input) => {
    const mods = [];
    if (input.control) mods.push('Ctrl');
    if (input.shift) mods.push('Shift');
    if (input.alt) mods.push('Alt');
    let k = String(input.key || '');
    if (k.length === 1) k = k.toUpperCase();
    if (k === '+') k = '=';
    return [...mods, k].join('+');
  };
  const navState = (wc) => {
    const h = wc.navigationHistory;
    return {
      url: wc.getURL(), title: wc.getTitle(),
      canGoBack: h ? h.canGoBack() : wc.canGoBack(),
      canGoForward: h ? h.canGoForward() : wc.canGoForward(),
    };
  };
  const describeView = (rec) => ({ tabId: rec.tabId, webContentsId: rec.wc.id, kind: rec.kind, private: !!rec.private, owned: !!rec.owned, crashed: rec.crashed || null, ...navState(rec.wc) });
  const emitView = (rec, type, payload) => send('browser:view:event', { tabId: rec.tabId, type, ...(payload || {}) });
  function applyBounds(rec) {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || rec.wc.isDestroyed()) return;
    let bounds = null;
    if (rec.fullscreen) { const [w, h] = win.getContentSize(); bounds = { x: 0, y: 0, width: w, height: h }; }
    else if (rec.visible && rec.bounds && rec.bounds.width > 0 && rec.bounds.height > 0) bounds = rec.bounds;
    if (bounds) {
      if (!rec.attached) { win.contentView.addChildView(rec.view); rec.attached = true; }
      rec.view.setBounds(bounds);
    } else if (rec.attached) {
      try { win.contentView.removeChildView(rec.view); } catch { /* already gone */ }
      rec.attached = false;
    }
  }
  // Between two documents the compositor shows the view's own background
  // until the new page first paints. Chromium's default is white, which in a
  // dark app reads as a flash on every navigation. The pane sets the app
  // surface at creation and the current page's colour once known, so the gap
  // matches what was on screen.
  function viewCreate(tabId, kind, opts) {
    const existing = views.get(tabId);
    if (existing && !existing.wc.isDestroyed()) return describeView(existing);
    const partitionKind = PARTITIONS[kind] ? kind : 'user';
    // A private assistant session: the assistant's rules, the chat's own in-memory partition.
    const privatePartition = partitionKind === 'agent' && opts && typeof opts.privatePartition === 'string' && opts.privatePartition.startsWith(AGENT_PRIVATE_PREFIX) ? opts.privatePartition : null;
    if (privatePartition) agentPrivateSession(privatePartition);
    const view = new WebContentsView({
      webPreferences: {
        partition: privatePartition || PARTITIONS[partitionKind],
        sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        webviewTag: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
      },
    });
    const background = opts && policy.isViewColor(opts.background) ? String(opts.background) : null;
    if (background) view.setBackgroundColor(background);
    const wc = view.webContents;
    const rec = { tabId, kind: partitionKind, private: !!privatePartition, view, wc, bounds: null, visible: false, attached: false, fullscreen: false, background };
    // One debugger controller per view: scriptlets, page theme and the
    // assistant's automation all go through it (browserDebugger.cjs).
    rec.dc = createDebuggerController(wc);
    views.set(tabId, rec);
    recByWc.set(wc.id, rec);
    attachGuestHooks(wc);
    // Scriptlets are chosen per destination as soon as a navigation starts,
    // so they are registered before the new document exists.
    const onNav = (e, url, isInPlace, isMainFrame) => {
      const u = (e && e.url) || url;
      const main = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const same = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (main && !same) void refreshScriptlets(rec, u);
    };
    wc.on('did-start-navigation', onNav);
    wc.on('did-redirect-navigation', onNav);
    // A new document: a crashed page is live again (a reload starts a new
    // renderer), and a sign-in the old one was waiting on is moot.
    wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
      const main = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const same = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (!main || same) return;
      rec.crashed = null;
      cancelAuthFor(rec);
    });
    rec.dc.ensure().catch((err) => console.warn('[browser] debugger attach:', err && err.message));
    wc.on('did-start-loading', () => emitView(rec, 'did-start-loading'));
    wc.on('did-stop-loading', () => emitView(rec, 'did-stop-loading', navState(wc)));
    // The pane paints the few pixels it leaves beside each resize sash in the
    // page's own colour, so that strip reads as page, not as a gap. A read of
    // the document's background; the result is validated as a colour.
    wc.on('did-finish-load', () => {
      wc.executeJavaScript(PAGE_COLOR_EXPR, false)
        .then((c) => { if (typeof c === 'string' && /^rgba?\([\d.,\s%]+\)$/.test(c) && !rec.wc.isDestroyed()) emitView(rec, 'page-color', { color: c }); })
        .catch(() => { /* page gone or refused */ });
    });
    wc.on('did-navigate', (_e, url) => emitView(rec, 'did-navigate', { ...navState(wc), url }));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) emitView(rec, 'did-navigate-in-page', { ...navState(wc), url }); });
    wc.on('page-title-updated', (_e, title) => emitView(rec, 'page-title-updated', { title }));
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => emitView(rec, 'did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame }));
    wc.on('update-target-url', (_e, url) => emitView(rec, 'update-target-url', { url }));
    wc.on('found-in-page', (_e, result) => emitView(rec, 'found-in-page', { result }));
    // The assistant's pages never cover the app: the permission is refused
    // (policy.agentPermission) and this is the second lock. The view keeps
    // its pane rectangle and the page is told, from a world its scripts
    // cannot patch, to leave fullscreen.
    wc.on('enter-html-full-screen', () => {
      if (rec.kind === 'agent') {
        wc.executeJavaScriptInIsolatedWorld(BRIDGE_WORLD_ID, [{ code: 'document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : null' }], false).catch(() => { /* page gone */ });
        return;
      }
      rec.fullscreen = true; applyBounds(rec); emitView(rec, 'fullscreen', { on: true });
    });
    wc.on('leave-html-full-screen', () => {
      if (rec.kind === 'agent' && !rec.fullscreen) return;
      rec.fullscreen = false; applyBounds(rec); emitView(rec, 'fullscreen', { on: false });
    });
    wc.on('context-menu', (_e, p) => emitView(rec, 'context-menu', { params: { x: p.x, y: p.y, linkURL: p.linkURL, srcURL: p.srcURL, mediaType: p.mediaType, selectionText: p.selectionText, isEditable: p.isEditable, pageURL: p.pageURL } }));
    // The page has keyboard focus when the user is in it; the browser's own
    // chords still have to reach the workbench dispatcher.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const chord = chordOf(input);
      // The assistant's key presses go to the page, never to the app's shortcuts.
      if (FORWARDED_KEYS.has(chord) && !(broker && broker.isAutomationInput(rec, input))) { e.preventDefault(); emitView(rec, 'shortcut', { chord }); }
    });
    wc.on('focus', () => emitView(rec, 'focus'));
    // A page asking to confirm before it is left (unsaved changes). Electron
    // answers synchronously and, unanswered, keeps the page with no word to
    // anyone. During an assistant action on this tab the veto stands and the
    // broker tells the model (LEAVE_BLOCKED); otherwise the user is leaving,
    // so the user is asked.
    wc.on('will-prevent-unload', (event) => {
      if (brokerHook('onLeaveBlocked', rec)) return;
      const win = getMainWindow();
      const box = { type: 'question', buttons: ['Leave', 'Stay'], defaultId: 0, cancelId: 1, noLink: true, title: 'Leave This Site?', message: 'Changes you made may not be saved.' };
      const choice = win && !win.isDestroyed() ? dialog.showMessageBoxSync(win, box) : dialog.showMessageBoxSync(box);
      if (choice === 0) event.preventDefault();
    });
    // A crashed page keeps its tab: the pane shows the failure with Reload,
    // the broker ends any assistant action on it (PAGE_CRASHED), and a
    // fullscreen page gives the window back. A clean exit is teardown, not a
    // crash (Chrome shows no sad tab for it either).
    wc.on('render-process-gone', (_e, details) => {
      const reason = (details && details.reason) || 'crashed';
      if (reason === 'clean-exit' || wc.isDestroyed()) return;
      rec.crashed = reason;
      if (rec.fullscreen) { rec.fullscreen = false; applyBounds(rec); emitView(rec, 'fullscreen', { on: false }); }
      cancelAuthFor(rec);
      brokerHook('onViewCrashed', rec, { ...(details || {}), reason });
      emitView(rec, 'crashed', { reason });
    });
    wc.on('login', (event, details, authInfo, callback) => onLogin(rec, event, details, authInfo, callback));
    wc.on('destroyed', () => {
      cancelAuthFor(rec);
      recByWc.delete(rec.wc.id);
      if (views.get(tabId) === rec) { views.delete(tabId); if (broker) broker.onViewGone(tabId); }
      try { rec.dc.dispose(); } catch { /* gone */ }
    });
    return describeView(rec);
  }
  function viewDestroy(tabId) {
    const rec = views.get(tabId);
    if (!rec) return;
    views.delete(tabId);
    if (broker) broker.onViewGone(tabId);
    try { rec.visible = false; rec.fullscreen = false; applyBounds(rec); } catch { /* ignore */ }
    try { if (!rec.wc.isDestroyed()) rec.wc.close(); } catch { /* ignore */ }
  }
  function liveView(tabId) {
    const rec = views.get(tabId);
    if (!rec || rec.wc.isDestroyed()) throw new Error('This tab has no page view.');
    return rec;
  }
  const VIEW_METHODS = {
    create: (tabId, kind, opts) => viewCreate(tabId, kind, opts),
    background: (tabId, color) => {
      const rec = liveView(tabId);
      if (!policy.isViewColor(color)) return false;
      rec.background = String(color);
      rec.view.setBackgroundColor(rec.background);
      return true;
    },
    adopt: (tabId) => { const rec = views.get(tabId); return rec && !rec.wc.isDestroyed() ? describeView(rec) : null; },
    list: () => [...views.values()].filter((r) => !r.wc.isDestroyed()).map(describeView),
    state: (tabId) => describeView(liveView(tabId)),
    bounds: (tabId, b) => {
      const rec = views.get(tabId);
      if (!rec || rec.wc.isDestroyed()) return false;
      rec.bounds = b && b.width > 0 && b.height > 0 ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) } : null;
      rec.visible = !!(b && b.visible);
      applyBounds(rec);
      return true;
    },
    navigate: async (tabId, url) => { await liveView(tabId).wc.loadURL(String(url)); return true; },
    back: (tabId) => { const wc = liveView(tabId).wc; const h = wc.navigationHistory; if (h ? h.canGoBack() : wc.canGoBack()) { if (h) h.goBack(); else wc.goBack(); } return true; },
    forward: (tabId) => { const wc = liveView(tabId).wc; const h = wc.navigationHistory; if (h ? h.canGoForward() : wc.canGoForward()) { if (h) h.goForward(); else wc.goForward(); } return true; },
    reload: (tabId) => { liveView(tabId).wc.reload(); return true; },
    stop: (tabId) => { liveView(tabId).wc.stop(); return true; },
    find: (tabId, text, opts) => liveView(tabId).wc.findInPage(String(text), opts || {}),
    stopFind: (tabId, action) => { liveView(tabId).wc.stopFindInPage(action || 'clearSelection'); return true; },
    zoom: (tabId, factor) => { liveView(tabId).wc.setZoomFactor(Number(factor) || 1); return true; },
    exec: (tabId, code) => liveView(tabId).wc.executeJavaScript(String(code), true),
    print: (tabId) => { liveView(tabId).wc.print(); return true; },
    edit: (tabId, cmd) => { const wc = liveView(tabId).wc; if (['copy', 'cut', 'paste', 'selectAll'].includes(cmd)) wc[cmd](); return true; },
    snapshot: async (tabId) => { const rec = liveView(tabId); if (!rec.attached) return null; const img = await rec.wc.capturePage(); return img.isEmpty() ? null : img.toDataURL(); },
    destroy: (tabId) => { viewDestroy(tabId); return true; },
    // The pane's sign-in bar: answers only a request that belongs to this tab's page.
    authReply: (tabId, id, username, password) => {
      const e = pendingAuth.get(id);
      if (!e || e.tabId !== tabId || views.get(tabId) !== e.rec) return false;
      return settleAuth(id, username == null ? '' : username, password);
    },
    authCancel: (tabId, id) => {
      const e = pendingAuth.get(id);
      if (!e || e.tabId !== tabId || views.get(tabId) !== e.rec) return false;
      return settleAuth(id);
    },
  };
  ipcMain.handle('browser:view', async (e, method, tabId, ...args) => {
    if (!isMainSender(e)) return { __error: 'The page view API answers the app window only.' };
    const fn = VIEW_METHODS[method];
    if (!fn) return { __error: `Unknown view method: ${method}` };
    try { return await fn(tabId, ...args); } catch (err) { return { __error: err && err.message ? err.message : String(err) }; }
  });

  // ── The assistant's automation ──
  // The broker drives these same views; it gets a narrow accessor, not a
  // second view registry.
  broker = createAutomationBroker({
    ipcMain,
    getMainWindow,
    userData: opts.userData || app.getPath('userData'),
    // Kept captures and downloads are erased, never binned: Eraser when the delete policy names it.
    eraseSecurely: typeof opts.eraseSecurely === 'function' ? opts.eraseSecurely : undefined,
    // A test launch sharing a running app's folder leaves that app's captures alone.
    eraseLeftoversAtStart: opts.eraseLeftoversAtStart !== false,
    // browserAct save_download: a copy of a finished assistant download in the
    // user's Downloads, listed like their own. Only files under the artifacts folder.
    saveDownload: async (src, name) => {
      try {
        const artifactsDir = path.resolve(opts.userData || app.getPath('userData'), 'browser', 'artifacts');
        const from = path.resolve(String(src || ''));
        if (!from.startsWith(artifactsDir + path.sep)) return { error: 'not an assistant download' };
        const target = policy.downloadTarget(downloadDir(), String(name || path.basename(from)), (p) => fs.existsSync(p), path.sep);
        await fsp.copyFile(from, target, fs.constants.COPYFILE_EXCL);
        const size = fs.statSync(target).size;
        const now = Date.now();
        const info = { id: `saved-${++downloadSeq}`, kind: 'user', assistant: false, savedByAssistant: true, url: '', filename: path.basename(target), path: target, total: size, received: size, state: 'completed', webContentsId: null, startedAt: now, finishedAt: now };
        downloads.set(info.id, info);
        send('browser:download', { ...info });
        return { path: target };
      } catch (err) { return { error: err && err.message ? err.message : String(err) }; }
    },
    views: {
      get: (tabId) => { const r = views.get(tabId); return r && !r.wc.isDestroyed() ? r : null; },
      create: (tabId, kind, opts) => { viewCreate(tabId, kind, opts || {}); return views.get(tabId); },
      // A private session ended: its partition keeps nothing.
      clearPrivate: (partition) => { const ses = agentPrivateSessions.get(partition); return ses ? clearSession(ses) : Promise.resolve(); },
      destroy: (tabId) => viewDestroy(tabId),
      byWebContentsId: (id) => recByWc.get(id) || null,
    },
  });

  // ── Persistence ──
  function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
  function writeJson(p, value) { try { fs.writeFileSync(p, JSON.stringify(value, null, 2)); } catch (err) { console.warn('[browser] could not save', p, err && err.message); } }

  // ── IPC ──
  ipcMain.handle('browser:getState', () => ({ partitions: PARTITIONS, lists, downloadDir: downloadDir(), engineInstalled: !!ElectronBlocker }));
  ipcMain.handle('browser:getSite', (_e, url) => ({ key: policy.siteKey(url), settings: siteFor(url) }));
  ipcMain.handle('browser:setSite', (_e, url, patch) => {
    const key = policy.siteKey(url);
    if (!key) return { ok: false };
    sites[key] = policy.normalizeSite({ ...siteFor(url), ...(patch || {}) });
    writeJson(sitesPath, sites);
    return { ok: true, key, settings: sites[key] };
  });
  ipcMain.handle('browser:listSites', () => Object.entries(sites).map(([key, settings]) => ({ key, settings })));
  ipcMain.handle('browser:resetSite', async (_e, url) => {
    const key = policy.siteKey(url);
    if (key) { delete sites[key]; writeJson(sitesPath, sites); }
    for (const k of Object.keys(permissions)) if (k.startsWith(`${key}|`)) delete permissions[k];
    writeJson(permissionsPath, permissions);
    return { ok: true };
  });
  ipcMain.handle('browser:clearSiteData', async (_e, url) => {
    const ses = sessions.get('user');
    let origin = null;
    try { origin = new URL(url).origin; } catch { origin = null; }
    if (!ses || !origin) return { ok: false };
    await ses.clearStorageData({ origin });
    return { ok: true };
  });
  ipcMain.handle('browser:listPermissions', () => Object.entries(permissions).map(([key, decision]) => { const i = key.indexOf('|'); return { site: key.slice(0, i), permission: key.slice(i + 1), decision }; }));
  ipcMain.handle('browser:revokePermission', (_e, site, permission) => { delete permissions[`${site}|${permission}`]; writeJson(permissionsPath, permissions); return { ok: true }; });
  ipcMain.handle('browser:permissionReply', (_e, requestId, allow, remember) => {
    const pending = pendingPermissions.get(requestId);
    if (!pending) return { ok: false };
    pendingPermissions.delete(requestId);
    clearTimeout(pending.timer);
    if (remember) {
      if (pending.kind === 'private') sessionPermissions[pending.key] = allow ? 'allow' : 'deny';
      else { permissions[pending.key] = allow ? 'allow' : 'deny'; writeJson(permissionsPath, permissions); }
    }
    try { pending.callback(!!allow); } catch { /* ignore */ }
    return { ok: true };
  });
  ipcMain.handle('browser:allowHttpOnce', (_e, url) => { if (typeof url === 'string' && /^http:\/\//i.test(url)) httpOnce.add(url); return { ok: true }; });
  // Chromium removes its own files (cookies, HTTP cache, site storage, code
  // caches, shared dictionaries, the bounce-tracking and interest-group
  // databases). clearData is the thorough call; the rest cover what it does
  // not reach. These are ordinary deletes inside the partition folder; the
  // extension database's rows are zeroed separately (ext/browser/main.js).
  ipcMain.handle('browser:clearData', async (_e, kind) => {
    const ses = sessions.get(Object.prototype.hasOwnProperty.call(PARTITIONS, kind) ? kind : 'user');
    if (!ses) return { ok: false };
    await clearSession(ses);
    // Clearing the assistant's data takes any private session's with it.
    if (kind === 'agent') for (const s of agentPrivateSessions.values()) await clearSession(s).catch(() => {});
    return { ok: true };
  });
  ipcMain.handle('browser:refreshLists', async () => { await loadLists(true); return lists; });
  ipcMain.handle('browser:setAnnoyances', async (_e, on) => {
    const next = on !== false;
    if (next === prefs.annoyances) return lists;
    prefs.annoyances = next;
    writeJson(prefsPath, prefs);
    try { fs.unlinkSync(path.join(dir, next ? ENGINE_FILES.ads : ENGINE_FILES.full)); } catch { /* none */ }
    await loadLists(false);
    return lists;
  });
  // A settled page's own cross-site redirect waits for the user (default) or goes through. Tab-unders are blocked either way.
  ipcMain.handle('browser:setHoldRedirects', (_e, on) => {
    prefs.holdRedirects = on !== false;
    writeJson(prefsPath, prefs);
    return prefs.holdRedirects;
  });
  ipcMain.handle('browser:blockedFor', (_e, webContentsId) => blockedSummary(webContentsId));
  ipcMain.handle('browser:listDownloads', () => [...downloads.values()].map((d) => ({ ...d })));
  ipcMain.handle('browser:openDownload', async (_e, p) => { const d = [...downloads.values()].find((x) => x.path === p); if (!d) return { ok: false }; const err = await shell.openPath(p); return { ok: !err, error: err || null }; });
  ipcMain.handle('browser:showDownload', (_e, p) => { const d = [...downloads.values()].find((x) => x.path === p); if (!d) return { ok: false }; shell.showItemInFolder(p); return { ok: true }; });

  ipcMain.handle('browser:blockedLog', () => ({
    recent: blockedLog.slice(-200).reverse(),
    total: blockedStats.total || 0,
    since: blockedStats.since || null,
    top: Object.entries(blockedStats.byHost || {}).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([host, n]) => ({ host, n })),
  }));
  ipcMain.handle('browser:clearBlockedLog', () => {
    blockedLog.length = 0;
    blockedStats.total = 0; blockedStats.since = Date.now(); blockedStats.byHost = {};
    writeJson(blockedStatsPath, blockedStats);
    return { ok: true };
  });
  // Page theme: prefers-color-scheme emulated per tab through the devtools
  // protocol, so sites that offer a dark theme use it. It does not invert
  // sites that have none; the setting says so.
  ipcMain.handle('browser:setPageTheme', async (_e, webContentsId, theme) => {
    const guest = webContents.fromId(Number(webContentsId));
    if (!guest || guest.isDestroyed() || !isOurs(guest.session)) return { ok: false };
    const features = theme === 'dark' || theme === 'light' ? [{ name: 'prefers-color-scheme', value: theme }] : [];
    try {
      const rec = recByWc.get(guest.id);
      if (rec) await rec.dc.setEmulatedMedia(features);
      else {
        if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
        await guest.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // Links clicked anywhere in the app: while the browser extension is
  // enabled and its setting says so, an http(s) URL becomes a tab here
  // instead of a system-browser launch. main.cjs asks before every
  // shell.openExternal and every window.open the renderer attempts; the
  // extension clears the claim when it deactivates, so a disabled extension
  // means the plain path again.
  ipcMain.handle('browser:setInAppLinks', (_e, on) => { inAppLinks = !!on; return inAppLinks; });
  const openInApp = (url, system) => {
    if (!policy.inAppLinkDecision(url, inAppLinks, !!system)) return false;
    send('browser:open-url', { url: String(url).trim(), disposition: 'app-link', openerId: null });
    return true;
  };
  return { PARTITIONS, watchWindow, openInApp };
}

module.exports = { setupBrowserBridge, PARTITIONS };
