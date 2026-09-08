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
//   - downloads only into the workspace Downloads folder.
// Per-site settings and permission decisions live in JSON under
// userData/browser/. The pure rules are in browserPolicy.cjs.
'use strict';

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { session, app, shell, webContents, WebContentsView } = require('electron');
const policy = require('./browserPolicy.cjs');
const { parse: parseTld } = require('tldts');

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
  const prefs = { annoyances: true, ...readJson(prefsPath, {}) };
  const enginePathFor = () => path.join(dir, prefs.annoyances ? ENGINE_FILES.full : ENGINE_FILES.ads);
  try { fs.unlinkSync(path.join(dir, prefs.annoyances ? ENGINE_FILES.ads : ENGINE_FILES.full)); } catch { /* none */ }

  // ── State ──
  const sites = readJson(sitesPath, {});           // siteKey -> { shields, cookies, https }
  const permissions = readJson(permissionsPath, {}); // `${siteKey}|${permission}` -> 'allow' | 'deny'
  const httpOnce = new Set();                      // http URLs the user chose to load once
  const blocked = new Map();                       // webContentsId -> { count, hosts: Map }
  const pendingPermissions = new Map();            // requestId -> { callback, timer }
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
  let inAppLinks = false;                          // the extension claimed links clicked anywhere in the app

  const send = (channel, payload) => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  const siteFor = (url) => policy.normalizeSite(sites[policy.siteKey(url) || '']);
  const documentUrlOf = (details) => {
    try { const wc = details.webContents; if (wc && !wc.isDestroyed()) return wc.getURL(); } catch { /* ignore */ }
    return details.referrer || '';
  };
  const isOurs = (ses) => [...sessions.values()].includes(ses);

  // ── Sessions ──
  for (const [kind, partition] of Object.entries(PARTITIONS)) {
    const ses = session.fromPartition(partition);
    sessions.set(kind, ses);
    configureSession(ses, kind);
  }

  function configureSession(ses, kind) {
    ses.setUserAgent(policy.genericUserAgent(process.versions.chrome, process.platform), 'en-US,en;q=0.9');
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const pol = policy.permissionPolicy(permission);
      if (pol === 'allow') return callback(true);
      if (pol === 'deny' || kind === 'agent') return callback(false);
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
      const pol = policy.permissionPolicy(permission);
      if (pol === 'allow') return true;
      if (pol === 'deny' || kind === 'agent') return false;
      return (kind === 'private' ? sessionPermissions : permissions)[`${policy.siteKey(requestingOrigin) || 'unknown'}|${permission}`] === 'allow';
    });
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (_event, item, wc) => handleDownload(item, wc, kind));
    installWebRequest(ses);
  }

  // Registered after the engine enables its own hooks: Electron keeps one
  // listener per event per session, so ours wrap the engine's.
  function installWebRequest(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
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
      for (const ses of sessions.values()) installWebRequest(ses);
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
    try { const g = webContents.fromId(Number(id)); isPrivate = !!g && !g.isDestroyed() && g.session === sessions.get('private'); } catch { isPrivate = false; }
    if (!isPrivate) {
      const page = req.sourceHostname || req.sourceDomain || '';
      blockedLog.push({ t: Date.now(), page, host, popup: !!req.popup });
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
      for (const ses of sessions.values()) {
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
  async function refreshScriptlets(rec, url) {
    if (!rec || rec.wc.isDestroyed()) return;
    const source = scriptletsFor(url);
    if (source === rec.scriptSource) return;
    rec.scriptSource = source;
    try {
      if (!rec.wc.debugger.isAttached()) { rec.wc.debugger.attach('1.3'); await rec.wc.debugger.sendCommand('Page.enable'); }
      if (rec.scriptId) { await rec.wc.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: rec.scriptId }); rec.scriptId = null; }
      if (source) { const r = await rec.wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source }); rec.scriptId = r && r.identifier; }
    } catch (err) { console.warn('[browser] scriptlet injection:', err && err.message); }
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
    // Popups (policy.popupDecision): one new window per user gesture in this
    // page, within seconds of it, never to a destination the lists name. A
    // blocked one counts in the shield like any other blocked request.
    const gesture = { at: 0, used: 0 };
    guest.on('input-event', (_e, input) => {
      const t = input && input.type;
      if (t === 'mouseDown' || t === 'mouseUp' || t === 'keyDown' || t === 'rawKeyDown' || t === 'char') { gesture.at = Date.now(); gesture.used = 0; }
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
      if (decision === 'allow') { gesture.used++; send('browser:open-url', { url, disposition, openerId: guest.id }); }
      else if (decision === 'block') countBlocked({ tabId: guest.id, url, hostname: hostnameOf(url), sourceHostname: hostnameOf(openerUrl), popup: true });
      return { action: 'deny' };
    });
    guest.on('did-navigate', () => { blocked.set(guest.id, { count: 0, hosts: new Map() }); send('browser:blocked', blockedSummary(guest.id)); });
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
    const target = policy.downloadTarget(downloadDir(), item.getFilename(), (p) => fs.existsSync(p), path.sep);
    item.setSavePath(target);
    const info = { id, kind, url: item.getURL(), filename: path.basename(target), path: target, total: item.getTotalBytes(), received: 0, state: 'progressing', webContentsId: wc ? wc.id : null, startedAt: Date.now() };
    downloads.set(id, info);
    send('browser:download', { ...info });
    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes();
      info.total = item.getTotalBytes();
      info.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
      send('browser:download', { ...info });
    });
    item.once('done', (_e, state) => {
      info.received = item.getReceivedBytes();
      info.state = state === 'completed' ? 'completed' : (state === 'cancelled' ? 'cancelled' : 'failed');
      info.finishedAt = Date.now();
      send('browser:download', { ...info });
    });
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
  const describeView = (rec) => ({ tabId: rec.tabId, webContentsId: rec.wc.id, kind: rec.kind, ...navState(rec.wc) });
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
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITIONS[partitionKind],
        sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        webviewTag: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false,
      },
    });
    const background = opts && policy.isViewColor(opts.background) ? String(opts.background) : null;
    if (background) view.setBackgroundColor(background);
    const wc = view.webContents;
    const rec = { tabId, kind: partitionKind, view, wc, bounds: null, visible: false, attached: false, fullscreen: false, background };
    views.set(tabId, rec);
    attachGuestHooks(wc);
    // Scriptlets are chosen per destination as soon as a navigation starts,
    // so they are registered before the new document exists.
    rec.scriptId = null; rec.scriptSource = undefined;
    const onNav = (e, url, isInPlace, isMainFrame) => {
      const u = (e && e.url) || url;
      const main = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const same = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (main && !same) void refreshScriptlets(rec, u);
    };
    wc.on('did-start-navigation', onNav);
    wc.on('did-redirect-navigation', onNav);
    try { wc.debugger.attach('1.3'); wc.debugger.sendCommand('Page.enable').catch(() => {}); } catch (err) { console.warn('[browser] debugger attach:', err && err.message); }
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
    wc.on('enter-html-full-screen', () => { rec.fullscreen = true; applyBounds(rec); emitView(rec, 'fullscreen', { on: true }); });
    wc.on('leave-html-full-screen', () => { rec.fullscreen = false; applyBounds(rec); emitView(rec, 'fullscreen', { on: false }); });
    wc.on('context-menu', (_e, p) => emitView(rec, 'context-menu', { params: { x: p.x, y: p.y, linkURL: p.linkURL, srcURL: p.srcURL, mediaType: p.mediaType, selectionText: p.selectionText, isEditable: p.isEditable, pageURL: p.pageURL } }));
    // The page has keyboard focus when the user is in it; the browser's own
    // chords still have to reach the workbench dispatcher.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const chord = chordOf(input);
      if (FORWARDED_KEYS.has(chord)) { e.preventDefault(); emitView(rec, 'shortcut', { chord }); }
    });
    wc.on('focus', () => emitView(rec, 'focus'));
    wc.on('destroyed', () => { if (views.get(tabId) === rec) views.delete(tabId); });
    return describeView(rec);
  }
  function viewDestroy(tabId) {
    const rec = views.get(tabId);
    if (!rec) return;
    views.delete(tabId);
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
  };
  ipcMain.handle('browser:view', async (_e, method, tabId, ...args) => {
    const fn = VIEW_METHODS[method];
    if (!fn) return { __error: `Unknown view method: ${method}` };
    try { return await fn(tabId, ...args); } catch (err) { return { __error: err && err.message ? err.message : String(err) }; }
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
    try { await ses.clearData(); } catch { /* older runtime */ }
    await ses.clearStorageData();
    await ses.clearCache();
    try { await ses.clearCodeCaches({}); } catch { /* ignore */ }
    try { await ses.clearSharedDictionaryCache(); } catch { /* ignore */ }
    await ses.clearAuthCache();
    await ses.clearHostResolverCache();
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
      if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
      await guest.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
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
