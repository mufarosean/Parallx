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
const { session, app, shell, webContents } = require('electron');
const policy = require('./browserPolicy.cjs');

let ElectronBlocker = null;
try { ({ ElectronBlocker } = require('@ghostery/adblocker-electron')); } catch { ElectronBlocker = null; }

// The private partition has no `persist:` prefix: it lives in memory only and
// the extension clears it when the last private tab closes.
const PARTITIONS = { user: 'persist:parallx-browser', agent: 'persist:parallx-browser-agent', private: 'parallx-browser-private' };
const LIST_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_RETRY_MS = 10 * 60 * 1000;
const PERMISSION_TIMEOUT_MS = 60 * 1000;

function setupBrowserBridge(ipcMain, opts) {
  const getMainWindow = opts.getMainWindow;
  const getWorkspaceRoot = opts.getWorkspaceRoot || (() => null);
  const dir = path.join(opts.userData || app.getPath('userData'), 'browser');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best effort */ }
  const sitesPath = path.join(dir, 'sites.json');
  const permissionsPath = path.join(dir, 'permissions.json');
  const enginePath = path.join(dir, 'engine.bin');

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
    try {
      let stale = force;
      try {
        const st = fs.statSync(enginePath);
        if (Date.now() - st.mtimeMs > LIST_REFRESH_MS) stale = true;
      } catch { stale = false; }
      if (stale) { try { fs.unlinkSync(enginePath); } catch { /* none */ } }
      const next = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: enginePath,
        read: (p) => fsp.readFile(p),
        write: (p, data) => fsp.writeFile(p, data),
      });
      if (blocker) { for (const ses of sessions.values()) { try { blocker.disableBlockingInSession(ses); } catch { /* ignore */ } } }
      blocker = next;
      blocker.on('request-blocked', (req) => countBlocked(req));
      blocker.on('request-redirected', (req) => countBlocked(req));
      for (const ses of sessions.values()) {
        blocker.enableBlockingInSession(ses);
        installWebRequest(ses); // ours wrap the engine's (one listener per event)
      }
      let updatedAt = Date.now();
      try { updatedAt = fs.statSync(enginePath).mtimeMs; } catch { /* keep now */ }
      lists = { status: 'ready', count: countFilters(blocker), updatedAt, error: null };
    } catch (err) {
      lists = { status: blocker ? 'ready' : 'unavailable', count: blocker ? lists.count : 0, updatedAt: lists.updatedAt, error: err && err.message ? err.message : String(err) };
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
    const page = req.sourceHostname || req.sourceDomain || '';
    blockedLog.push({ t: Date.now(), page, host });
    if (blockedLog.length > 500) blockedLog.splice(0, blockedLog.length - 500);
    blockedStats.total = (blockedStats.total || 0) + 1;
    blockedStats.byHost[host] = (blockedStats.byHost[host] || 0) + 1;
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
  setInterval(() => { void loadLists(false); }, LIST_REFRESH_MS).unref?.();

  // ── Guests: popups, navigation resets, lifecycle ──
  function attachGuestHooks(guest) {
    if (!guest || guest.isDestroyed() || !isOurs(guest.session)) return;
    guest.setWindowOpenHandler(({ url, disposition }) => {
      send('browser:open-url', { url, disposition, openerId: guest.id });
      return { action: 'deny' };
    });
    guest.on('did-navigate', () => { blocked.set(guest.id, { count: 0, hosts: new Map() }); send('browser:blocked', blockedSummary(guest.id)); });
    guest.on('destroyed', () => { blocked.delete(guest.id); });
  }
  function watchWindow(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents.on('did-attach-webview', (_event, guest) => attachGuestHooks(guest));
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
  ipcMain.handle('browser:clearData', async (_e, kind) => {
    const ses = sessions.get(kind === 'agent' ? 'agent' : 'user');
    if (!ses) return { ok: false };
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    await ses.clearHostResolverCache();
    return { ok: true };
  });
  ipcMain.handle('browser:refreshLists', async () => { await loadLists(true); return lists; });
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
      if (features.length === 0) { try { guest.debugger.detach(); } catch { /* already gone */ } }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  return { PARTITIONS, watchWindow };
}

module.exports = { setupBrowserBridge, PARTITIONS };
