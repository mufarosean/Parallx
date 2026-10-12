// ext/browser/main.js — the private browser (docs/BROWSER.md).
//
// Every page is a workbench editor tab hosting one hardened <webview> on the
// browser's own session partition. The privileged half (blocking, cookies,
// HTTPS, permissions, downloads, popups) lives in electron/browserBridge.cjs
// and is reached through window.parallxElectron.browser; nothing in this file
// can weaken it. This file owns the UI: address bar, shield panel, bookmarks,
// history, downloads, the New Tab page, reader mode, find, zoom.
//
// Reader mode uses Mozilla's Readability, vendored as ./readability.js (the
// same file ext/web-research carries; each extension ships its own copy).
//
// ── SECTIONS ──
//   1. Constants and module state
//   2. Database (bookmarks, history, downloads, tabs)
//   3. Address parsing (mirrors electron/browserPolicy.cjs for the renderer)
//   4. DOM helpers and styles
//   5. Page pane: toolbar, webview, shield, find, permissions, errors
//   6. New Tab page
//   7. Reader mode
//   8. Sidebar
//   9. Commands and bridge events
//  10. Activation
//  11. Agent browsing (tools on the agent partition)

import { Readability } from './readability.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONSTANTS AND MODULE STATE
// ═══════════════════════════════════════════════════════════════════════════════

const EDITOR_TYPE = 'browser.page';
const NEWTAB = 'about:newtab';
/** In-memory session for Private tabs (no persist: prefix); cleared when the last one closes. */
const PRIVATE_PARTITION = 'parallx-browser-private';
const INTERNAL_PAGES = new Set(['about:newtab', 'about:bookmarks', 'about:history', 'about:shields']);
const SEARCH_ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { label: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=%s' },
};
const PERMISSION_LABELS = {
  media: 'use your camera or microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'read your clipboard',
  pointerLock: 'lock the mouse pointer',
};
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

let _api = null;
let _dbBridge = null;
let _styleInjected = false;
let _unsubscribeBridge = null;
let _tabSeq = 0;
let _activePane = null;
let _lists = { status: 'loading', count: 0, updatedAt: null, error: null };
const _panes = new Map();          // instanceId -> pane
const _panesByWc = new Map();      // webContentsId -> pane
const _livePanes = new Set();      // every mounted pane, a second copy of one tab included
const _pendingUrls = new Map();    // instanceId -> url to load when the pane mounts
const _sidebarListeners = new Set();
/** Sidebar sections the user has opened; everything starts collapsed. */
const _sideOpen = new Set();

const bridge = () => (typeof window !== 'undefined' && window.parallxElectron && window.parallxElectron.browser) || null;
const cfg = (key, fallback) => {
  try { return _api.workspace.getConfiguration('browser').get(key, fallback); } catch { return fallback; }
};
const notifySidebar = () => { for (const fn of _sidebarListeners) { try { fn(); } catch { /* ignore */ } } };

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

const db = {
  async run(sql, params = []) { const r = await _dbBridge.run(sql, params); if (r.error) throw new Error(r.error.message); return r; },
  async get(sql, params = []) { const r = await _dbBridge.get(sql, params); if (r.error) throw new Error(r.error.message); return r.row ?? null; },
  async all(sql, params = []) { const r = await _dbBridge.all(sql, params); if (r.error) throw new Error(r.error.message); return r.rows ?? []; },
};

// Deleting means gone. History, bookmarks and the download list are rows in
// the extension database, a file that stays open while Parallx runs, so no
// file eraser can touch it; the database does the overwriting itself.
// secure_delete zeroes a row's bytes the moment it is deleted, the checkpoint
// folds the write-ahead log back into the file and truncates the log to
// nothing, and VACUUM after a bulk clear rebuilds the file from live rows
// only. Downloaded files are real files: they go through the core secure
// delete, Eraser first when it is installed, a permanent delete otherwise.
async function hardenDb() {
  try { await db.all('PRAGMA secure_delete = ON'); } catch (err) { console.warn('[browser] secure_delete:', err && err.message); }
}
async function scrubDb(vacuum) {
  try { await db.all('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
  if (vacuum) { try { await db.run('VACUUM'); await db.all('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ } }
}
/** Delete rows, then scrub the file so nothing of them remains in it. */
async function forget(sql, params, vacuum) { const r = await db.run(sql, params); await scrubDb(vacuum); return r; }

const Bookmarks = {
  list: (q) => q
    ? db.all(`SELECT * FROM br_bookmarks WHERE url LIKE ? OR title LIKE ? ORDER BY created_at DESC LIMIT 200`, [`%${q}%`, `%${q}%`])
    : db.all(`SELECT * FROM br_bookmarks ORDER BY created_at DESC LIMIT 200`),
  has: async (url) => !!(await db.get(`SELECT id FROM br_bookmarks WHERE url = ?`, [url])),
  add: (url, title) => db.run(`INSERT OR IGNORE INTO br_bookmarks (url, title) VALUES (?, ?)`, [url, title || '']),
  remove: (url) => forget(`DELETE FROM br_bookmarks WHERE url = ?`, [url], false),
};
const History = {
  record: (url, title) => db.run(
    `INSERT INTO br_history (url, title, visits, last_visit_at) VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(url) DO UPDATE SET visits = visits + 1, last_visit_at = datetime('now'), title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE br_history.title END`,
    [url, title || ''],
  ),
  setTitle: (url, title) => db.run(`UPDATE br_history SET title = ? WHERE url = ? AND ? <> ''`, [title, url, title]),
  recent: (limit) => db.all(`SELECT * FROM br_history ORDER BY last_visit_at DESC LIMIT ?`, [limit]),
  search: (q, limit) => db.all(`SELECT * FROM br_history WHERE url LIKE ? OR title LIKE ? ORDER BY last_visit_at DESC LIMIT ?`, [`%${q}%`, `%${q}%`, limit]),
  clear: () => forget(`DELETE FROM br_history`, [], true),
  removeUrl: (url) => forget(`DELETE FROM br_history WHERE url = ?`, [url], false),
};
const Downloads = {
  upsert: (d) => db.run(
    `INSERT INTO br_downloads (id, url, filename, path, total, received, state, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET total = excluded.total, received = excluded.received, state = excluded.state, finished_at = excluded.finished_at`,
    [d.id, d.url, d.filename, d.path, d.total ?? null, d.received ?? 0, d.state, new Date(d.startedAt || Date.now()).toISOString(), d.finishedAt ? new Date(d.finishedAt).toISOString() : null],
  ),
  list: () => db.all(`SELECT * FROM br_downloads ORDER BY started_at DESC LIMIT 100`),
  clear: () => forget(`DELETE FROM br_downloads WHERE state <> 'progressing'`, [], true),
  remove: (id) => forget(`DELETE FROM br_downloads WHERE id = ?`, [id], false),
};
const Tabs = {
  remember: (instanceId, url, title) => db.run(
    `INSERT INTO br_tabs (instance_id, url, title, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(instance_id) DO UPDATE SET url = excluded.url, title = excluded.title, updated_at = datetime('now')`,
    [instanceId, url, title || ''],
  ),
  recall: (instanceId) => db.get(`SELECT url FROM br_tabs WHERE instance_id = ?`, [instanceId]),
  prune: () => db.run(`DELETE FROM br_tabs WHERE updated_at < datetime('now', '-30 days')`),
};
/** Address bar suggestions: bookmarks first, then history by recency. */
async function suggest(q, limit = 8) {
  const like = `%${q}%`;
  const rows = await db.all(
    `SELECT url, title, 1 AS kind, 0 AS visits FROM br_bookmarks WHERE url LIKE ? OR title LIKE ?
     UNION ALL
     SELECT url, title, 0 AS kind, visits FROM br_history WHERE url LIKE ? OR title LIKE ?
     ORDER BY kind DESC, visits DESC LIMIT ?`,
    [like, like, like, like, limit * 2],
  );
  const seen = new Set();
  const out = [];
  for (const r of rows) { if (seen.has(r.url)) continue; seen.add(r.url); out.push(r); if (out.length >= limit) break; }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: ADDRESS PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0') return true;
  if (h.includes(':')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (!h.includes('.')) return true;
  return false;
}
function parseOmnibox(text, engineKey) {
  const raw = String(text || '').trim();
  const engine = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.duckduckgo;
  if (!raw) return { kind: 'url', url: NEWTAB };
  if (INTERNAL_PAGES.has(raw) || raw === 'about:blank') return { kind: 'url', url: raw };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try { return { kind: 'url', url: new URL(raw).toString() }; } catch { /* search */ }
  }
  const hostPart = raw.split(/[/?#]/)[0];
  const looksLikeHost = !/\s/.test(raw) && (
    /^localhost(:\d+)?$/i.test(hostPart)
    || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(hostPart)
    || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(hostPart)
  );
  if (looksLikeHost) {
    const scheme = isLocalHost(hostPart.replace(/:\d+$/, '')) ? 'http://' : 'https://';
    try { return { kind: 'url', url: new URL(scheme + raw).toString() }; } catch { /* search */ }
  }
  return { kind: 'search', url: engine.url.replace('%s', encodeURIComponent(raw)), query: raw };
}
function displayUrl(url) {
  if (!url || url === NEWTAB || url === 'about:blank') return '';
  return url;
}
function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
function isWebUrl(url) { return /^https?:\/\//i.test(url || ''); }

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: DOM HELPERS AND STYLES
// ═══════════════════════════════════════════════════════════════════════════════

function el(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (v != null) e.setAttribute(k, v);
    }
  }
  return e;
}
function icon(name, size) { try { return _api.icons.createIconHtml(name, size || 14); } catch { return ''; } }
function iconBtn(name, title, onClick, className) {
  const b = el('button', `br-btn${className ? ` ${className}` : ''}`, { type: 'button', title, 'aria-label': title });
  b.innerHTML = icon(name, 14);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function fmtDay(iso) {
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function fmtTime(iso) {
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A small anchored menu. Items: { label, handler, danger?, separator? }. onClose runs once when it goes away. */
// THE context menu (api.ui.showContextMenu): the workbench's, not a clone.
// Items are { label, handler, danger, disabled } or { separator: true }; the
// anchor is the element the menu belongs to or a point.
let _openMenu = null;
function showMenu(anchor, items, onClose) {
  dismissMenu();
  const entries = items.map((it) => it.separator ? { separator: true } : {
    label: it.label,
    danger: !!it.danger,
    disabled: !!it.disabled,
    onSelect: () => { try { it.handler(); } catch (err) { console.warn('[browser] menu action failed', err); } },
  });
  const menu = _api.ui.showContextMenu(anchor, entries, {
    onClose: () => {
      if (_openMenu === menu) _openMenu = null;
      if (typeof onClose === 'function') { try { onClose(); } catch { /* ignore */ } }
    },
  });
  _openMenu = menu;
}
function dismissMenu() {
  const m = _openMenu;
  _openMenu = null;
  if (m) m.dispose();
}

const CSS = `
.br-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--vscode-editor-background, var(--px-bg)); color: var(--vscode-foreground, var(--px-text)); outline: none; position: relative; overflow: hidden; box-sizing: border-box; }
.br-private-chip { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 1px 7px; border-radius: var(--px-radius-sm, 4px); font-size: 10px; font-weight: 600; letter-spacing: 0.2px; background: var(--vscode-badge-background, var(--px-accent)); color: var(--vscode-badge-foreground, #fff); }
.br-bookmarks-bar { display: flex; align-items: center; gap: 2px; padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-sideBar-background, var(--px-bg)); overflow: hidden; flex: 0 0 auto; }
.br-notice { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-sideBar-background, var(--px-bg)); font-size: 12px; flex: 0 0 auto; }
.br-notice-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.br-notice button { border: 1px solid var(--vscode-panel-border, var(--px-border)); background: transparent; color: inherit; border-radius: var(--parallx-radius-md, 6px); padding: 2px 10px; font-size: 12px; cursor: pointer; flex: 0 0 auto; white-space: nowrap; }
.br-notice button:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-notice button.primary { background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
.br-bm-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 180px; padding: 2px 8px; border: none; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 0 auto; }
.br-bm-chip:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-bm-hint { font-size: 11px; padding: 2px 4px; }
.br-link { border: none; background: transparent; color: var(--vscode-textLink-foreground, var(--px-accent)); font: inherit; font-size: inherit; cursor: pointer; padding: 0; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.br-link:hover { text-decoration: underline; }
.br-page { padding: 28px 36px 48px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; font-size: 12px; }
.br-page-head h2 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
.br-page-tools { display: flex; gap: 8px; align-items: center; }
.br-page-tools input { flex: 1; max-width: 420px; border: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-input-background, var(--px-bg-inset)); color: inherit; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 4px; outline: none; }
.br-page-tools input:focus { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.br-page-day { margin: 14px 0 4px; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.br-page-headline strong { font-size: 28px; font-weight: 600; margin-right: 6px; }
.br-page-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 24px; align-items: start; }
.br-table { width: 100%; border-collapse: collapse; }
.br-table th { text-align: left; font-weight: 600; opacity: 0.7; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); font-size: 11px; }
.br-table td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.br-table .num { text-align: right; font-variant-numeric: tabular-nums; width: 1%; white-space: nowrap; }
.br-table td .br-btn { width: 22px; height: 22px; }
.br-toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-sideBar-background, var(--px-bg)); flex: 0 0 auto; }
.br-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: var(--parallx-radius-md, 6px); background: transparent; color: inherit; cursor: pointer; padding: 0; position: relative; }
.br-btn:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-btn:disabled { opacity: 0.35; cursor: default; }
.br-btn:disabled:hover { background: transparent; }
.br-btn.is-active { color: var(--vscode-textLink-foreground, var(--px-accent)); }
.br-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--px-accent)); outline-offset: -1px; }
.br-badge { position: absolute; top: -2px; right: -2px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; font-size: 9px; line-height: 14px; font-weight: 600; background: var(--vscode-badge-background, var(--px-accent)); color: var(--vscode-badge-foreground, #fff); text-align: center; pointer-events: none; }
.br-address-wrap { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; height: 28px; padding: 0 8px; border-radius: var(--px-radius-md, 6px); background: var(--vscode-input-background, var(--px-bg-inset)); border: 1px solid transparent; position: relative; }
.br-address-wrap:focus-within { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.br-lock { display: inline-flex; opacity: 0.7; flex: 0 0 auto; }
.br-lock.is-insecure { color: var(--vscode-errorForeground, var(--px-danger)); opacity: 1; }
.br-address { flex: 1; min-width: 0; height: 100%; border: none; background: transparent; color: inherit; font: inherit; font-size: 13px; outline: none; }
.br-suggest { position: absolute; left: 0; right: 0; top: 30px; z-index: 5; background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-panel-border, var(--px-border)); border-radius: var(--parallx-radius-md, 6px); box-shadow: 0 8px 24px rgba(0,0,0,0.25); overflow: hidden; }
.br-suggest-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.br-suggest-item:hover, .br-suggest-item.is-selected { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-suggest-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-suggest-url { opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.br-progress { height: 2px; background: transparent; flex: 0 0 auto; }
.br-progress > div { height: 100%; width: 0; background: var(--vscode-progressBar-background, var(--px-accent)); transition: width var(--px-dur-base, 180ms) var(--px-ease, ease), opacity var(--px-dur-fast, 120ms); }
.br-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); flex: 0 0 auto; }
.br-bar .br-spacer { flex: 1; }
.br-bar button, .br-panel button.br-action, .br-error button, .br-sidebar button.br-action, .br-newtab button.br-action, .br-page button.br-action { border: 1px solid var(--vscode-panel-border, var(--px-border)); background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; height: var(--px-control-h-sm); padding: 0 10px; border-radius: var(--px-radius-sm); font-size: var(--px-text-sm); line-height: 1; }
.br-bar button:hover, .br-panel button.br-action:hover, .br-error button:hover, .br-sidebar button.br-action:hover, .br-newtab button.br-action:hover, .br-page button.br-action:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-bar button.primary, .br-error button.primary { background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, #fff); border-color: transparent; }
.br-bar input[type="text"], .br-bar input[type="password"] { flex: 1; min-width: 0; border: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-input-background, var(--px-bg-inset)); color: inherit; font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 4px; outline: none; }
.br-bar input[type="text"]:focus, .br-bar input[type="password"]:focus { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.br-auth-bar { flex-wrap: wrap; }
.br-auth-bar .br-auth-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.br-auth-bar input[type="text"], .br-auth-bar input[type="password"] { flex: 0 1 160px; }
.br-bar label { display: inline-flex; align-items: center; gap: 4px; opacity: 0.85; }
.br-content { flex: 1; min-height: 0; position: relative; display: flex; }
.br-content > * { flex: 1; min-width: 0; min-height: 0; }
/* The hidden attribute must win over every display rule below, or the New Tab
   page, the web page and the error panel all show at once. */
.br-pane [hidden] { display: none !important; }
.br-content { background-size: 100% 100%; background-repeat: no-repeat; background-position: 0 0; }
.br-status { position: absolute; left: 0; bottom: 0; max-width: 70%; padding: 2px 8px; font-size: 11px; background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-panel-border, var(--px-border)); border-left: none; border-bottom: none; border-radius: 0 4px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; z-index: 3; }
.br-panel { position: absolute; top: 40px; right: 8px; width: 320px; z-index: 6; background: var(--vscode-editorWidget-background, var(--px-bg-elevated)); border: 1px solid var(--vscode-panel-border, var(--px-border)); border-radius: var(--parallx-radius-md, 6px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); padding: 12px; font-size: 12px; }
.br-panel h3 { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
.br-panel .br-muted { opacity: 0.7; }
.br-panel-count { display: flex; align-items: baseline; gap: 8px; margin: 10px 0 6px; }
.br-panel-count strong { font-size: 24px; font-weight: 600; line-height: 1; }
.br-panel-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-top: 1px solid var(--vscode-panel-border, var(--px-border)); }
.br-panel-row .ui-dropdown, .br-panel-row .br-dropdown-slot { min-width: 150px; }
.br-hosts { max-height: 120px; overflow-y: auto; margin: 4px 0 8px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: 0.85; }
.br-hosts div { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.br-panel-foot { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.br-switch { position: relative; width: 34px; height: 18px; border-radius: 9px; border: none; background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)); cursor: pointer; padding: 0; flex: 0 0 auto; }
.br-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--vscode-editor-background, #fff); transition: left var(--px-dur-fast, 120ms) var(--px-ease, ease); }
.br-switch.is-on { background: var(--vscode-button-background, var(--px-accent)); }
.br-switch.is-on::after { left: 18px; }
.br-error { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px; text-align: center; }
.br-error h2 { margin: 0; font-size: 16px; font-weight: 600; }
.br-error p { margin: 0; opacity: 0.75; font-size: 12px; max-width: 520px; word-break: break-all; }
.br-error .br-row { display: flex; gap: 8px; margin-top: 6px; }
.br-newtab { display: flex; flex-direction: column; align-items: center; padding: 48px 24px 24px; overflow-y: auto; gap: 28px; }
.br-newtab-search { width: min(640px, 100%); display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: var(--px-radius-md, 6px); background: var(--vscode-input-background, var(--px-bg-inset)); border: 1px solid var(--vscode-panel-border, var(--px-border)); }
.br-newtab-search:focus-within { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.br-newtab-search input { flex: 1; border: none; background: transparent; color: inherit; font: inherit; font-size: 14px; outline: none; }
.br-newtab-private { width: min(640px, 100%); margin: 0; font-size: 12px; line-height: 1.5; opacity: 0.7; text-align: center; }
.br-newtab-section { width: min(760px, 100%); }
.br-newtab-section h3 { margin: 0 0 8px; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.br-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.br-tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--parallx-radius-md, 6px); border: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-editor-background, var(--px-bg)); cursor: pointer; text-align: left; color: inherit; font: inherit; min-width: 0; }
.br-tile:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-tile-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-tile-host { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-list { display: flex; flex-direction: column; }
.br-item { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; min-width: 0; }
.br-item:hover { background: var(--vscode-list-hoverBackground, var(--px-surface-hover)); }
.br-item .br-item-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.br-item .br-item-meta { opacity: 0.55; font-size: 11px; white-space: nowrap; }
.br-item .br-btn { width: 22px; height: 22px; opacity: 0; }
.br-item:hover .br-btn { opacity: 1; }
.br-empty { padding: 8px; font-size: var(--px-text-sm); color: var(--px-text-muted); }
.br-sidebar { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 12px; }
.br-sidebar-top { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border, var(--px-border)); }
.br-sidebar-top button.br-action.primary { background: var(--vscode-button-background, var(--px-accent)); color: var(--vscode-button-foreground, #fff); border-color: transparent; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.br-sidebar-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.br-section-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 4px; font-size: 11px; font-weight: 600; text-transform: none; letter-spacing: normal; opacity: 0.75; cursor: pointer; user-select: none; }
.br-section-head .br-chevron { margin-left: auto; transition: transform var(--px-dur-fast, 120ms); display: inline-flex; }
.br-section-head.is-collapsed .br-chevron { transform: rotate(-90deg); }
.br-section-body { padding: 0 4px 6px; }
.br-section-body.is-collapsed { display: none; }
.br-section-tools { display: flex; gap: 6px; align-items: center; padding: 2px 4px 6px; }
.br-section-tools input { flex: 1; min-width: 0; border: 1px solid var(--vscode-panel-border, var(--px-border)); background: var(--vscode-input-background, var(--px-bg-inset)); color: inherit; font: inherit; font-size: 12px; padding: 3px 8px; border-radius: 4px; outline: none; }
.br-section-tools input:focus { border-color: var(--vscode-focusBorder, var(--px-accent)); }
.br-day { padding: 6px 8px 2px; font-size: 11px; opacity: 0.6; }
.br-sidebar-foot { padding: 8px; border-top: 1px solid var(--vscode-panel-border, var(--px-border)); display: flex; flex-direction: column; gap: 6px; font-size: 11px; opacity: 0.9; }
.br-sidebar-foot .br-row { display: flex; gap: 6px; align-items: center; }
.br-dlbar { height: 3px; border-radius: 2px; background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.3)); overflow: hidden; }
.br-dlbar > div { height: 100%; background: var(--vscode-progressBar-background, var(--px-accent)); }
.br-reader { border: none; background: var(--vscode-editor-background, var(--px-bg)); }
.br-agent-bar { background: var(--vscode-inputValidation-infoBackground, var(--px-bg-elevated)); }
.br-agent-note { opacity: 0.75; font-style: italic; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.br-agent-state { font-weight: 600; white-space: nowrap; }
.br-agent-actions { display: inline-flex; gap: 6px; flex: 0 0 auto; }
@media (prefers-reduced-motion: reduce) { .br-progress > div, .br-switch::after, .br-section-head .br-chevron { transition: none; } }
`;
function injectStyles() {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.id = 'browser-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: PAGE PANE
// ═══════════════════════════════════════════════════════════════════════════════

function newTabId() { return `tab:${Date.now().toString(36)}-${++_tabSeq}`; }

/** Open a new page tab. `url` may be omitted for the New Tab page. */
async function openTab(url, opts = {}) {
  const instanceId = opts.private ? newTabId().replace(/^tab:/, 'private:') : newTabId();
  const target = url || homepage();
  _pendingUrls.set(instanceId, target);
  const base = INTERNAL_TITLES[target] || hostOf(target) || 'Web Page';
  await _api.editors.openEditor({ typeId: EDITOR_TYPE, title: opts.private ? `Private: ${base}` : base, icon: opts.private ? 'eye-closed' : 'globe', instanceId });
}

// ── Page views ──
// Pages are not in the document. Each tab's page is a WebContentsView owned by
// the main process (electron/browserBridge.cjs) and positioned over this
// pane's content area; the pane reports the rectangle whenever it changes.
// Moving a tab to another group, splitting, or evicting the pane only moves
// or hides the rectangle: the page keeps playing, scrolled where it was.
// Anything the pane draws over the page area (shield panel, menus, address
// suggestions) would sit under the native view, so while one is open the view
// is hidden behind a snapshot of itself.
async function V(method, tabId, ...args) {
  const b = bridge();
  if (!b || typeof b.view !== 'function') throw new Error('The browser bridge is not available.');
  const r = await b.view(method, tabId, ...args);
  if (r && typeof r === 'object' && r.__error) throw new Error(r.__error);
  return r;
}
let _linkStatus = null;
/** Link preview in the status bar, where the page cannot cover it. */
function linkStatus(text) {
  try {
    if (!_linkStatus) _linkStatus = _api.window.createStatusBarItem(1, 50);
    if (text) { _linkStatus.text = text.length > 120 ? `${text.slice(0, 117)}…` : text; _linkStatus.show(); }
    else _linkStatus.hide();
  } catch { /* the status bar is optional */ }
}
const SHORTCUT_COMMANDS = {
  'Ctrl+L': 'browser.focusAddress', 'Ctrl+F': 'browser.find', 'Ctrl+T': 'browser.newTab', 'Ctrl+R': 'browser.reload', 'F5': 'browser.reload',
  'Ctrl+D': 'browser.bookmark', 'Ctrl+H': 'browser.openHistory', 'Ctrl+Shift+N': 'browser.newPrivateTab', 'Ctrl+Shift+O': 'browser.openBookmarks',
  'Alt+ArrowLeft': 'browser.back', 'Alt+ArrowRight': 'browser.forward', 'Ctrl+=': 'browser.zoomIn', 'Ctrl+-': 'browser.zoomOut', 'Ctrl+0': 'browser.zoomReset',
};
function editorStillOpen(instanceId) {
  try { return (_api.editors.openEditors || []).some((e) => typeof e.id === 'string' && e.id.endsWith(instanceId)); } catch { return true; }
}
function privateEditorsOpen() {
  try { return (_api.editors.openEditors || []).some((e) => typeof e.id === 'string' && e.id.includes(':private:')); } catch { return true; }
}

function createPagePane(container, input, opts = {}) {
  injectStyles();
  const instanceId = (input && (input.instanceId || input.id)) || newTabId();
  const editorId = input && input.id;
  const partitionKind = opts.agent ? 'agent' : (opts.private ? 'private' : 'user');
  const isPrivate = !!opts.private;
  const root = el('div', `br-pane${isPrivate ? ' br-pane--private' : ''}`);
  root.tabIndex = -1;
  container.appendChild(root);
  let agentBanner = null;
  if (opts.agent) {
    agentBanner = el('div', 'br-bar br-agent-bar');
    agentBanner.innerHTML = icon('shield', 12);
    const agentPriv = _agentPrivate.has(instanceId);
    if (agentPriv) agentBanner.dataset.private = '1';
    agentBanner.appendChild(el('span', 'br-agent-state', { text: agentPriv ? 'Private Assistant Browser' : 'Assistant Browser' }));
    agentBanner.appendChild(el('span', 'br-agent-note', { text: agentPriv ? AGENT_BANNER_PRIVATE : AGENT_BANNER_IDLE }));
    agentBanner.appendChild(el('span', 'br-spacer'));
    agentBanner.appendChild(el('span', 'br-agent-actions'));
    root.appendChild(agentBanner);
  }

  const pane = {
    instanceId, tabId: instanceId, root, hasView: false, wcId: null, url: NEWTAB, title: 'New Tab', loading: false,
    canGoBack: false, canGoForward: false, bookmarked: false, blocked: { count: 0, hosts: [] }, zoom: 1, readerOn: false,
    disposed: false, isPrivate, isAgent: !!opts.agent, viewVisible: false, overlays: 0, covered: false, pageColor: '', _creating: null, _loadWaiters: [],
    // The page view's own address and title (pane.url and pane.title follow whatever the pane shows), and why its process ended.
    viewUrl: '', viewTitle: '', crashed: null,
    freeze() { void overlayOpen(); }, thaw() { overlayClose(); },
  };
  _panes.set(instanceId, pane);
  _livePanes.add(pane);
  const setActive =() => { _activePane = pane; };
  root.addEventListener('pointerdown', setActive, true);
  root.addEventListener('focusin', setActive);
  setActive();

  // ── Toolbar ──
  const toolbar = el('div', 'br-toolbar');
  const backBtn = iconBtn('arrow-left', 'Back', () => goBack());
  const fwdBtn = iconBtn('arrow-right', 'Forward', () => goForward());
  const reloadBtn = iconBtn('rotate-cw', 'Reload', () => { if (pane.loading) stop(); else reload(); });
  const homeBtn = iconBtn('home', 'Home', () => navigate(homepage()));
  // Everything opened from inside a private tab is private: the plus button,
  // links and images in new tabs, searches, popups the page opens, Ctrl+T.
  const newTabBtn = iconBtn('plus', 'New Tab', () => openTab(undefined, { private: isPrivate }));
  const addressWrap = el('div', 'br-address-wrap');
  const privateChip = el('span', 'br-private-chip', { title: 'Private tab: nothing is kept after the last private tab closes, and nothing goes into history.' });
  privateChip.innerHTML = icon('eye-closed', 11);
  privateChip.appendChild(document.createTextNode('Private'));
  privateChip.hidden = !(isPrivate || (opts.agent && _agentPrivate.has(instanceId)));
  addressWrap.appendChild(privateChip);
  const lock = el('span', 'br-lock');
  const address = el('input', 'br-address', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Search or enter an address', 'aria-label': 'Address' });
  const suggestBox = el('div', 'br-suggest');
  suggestBox.hidden = true;
  addressWrap.append(lock, address, suggestBox);
  const shieldBtn = iconBtn('shield', 'Shields', () => toggleShieldPanel(), 'br-shield');
  const shieldBadge = el('span', 'br-badge');
  shieldBadge.hidden = true;
  shieldBtn.appendChild(shieldBadge);
  const starBtn = iconBtn('star', 'Bookmark This Page', () => toggleBookmark());
  const readerBtn = iconBtn('book-open', 'Reader Mode', () => toggleReader());
  const menuBtn = iconBtn('ellipsis', 'Page Menu', () => showPageMenu(menuBtn));
  toolbar.append(backBtn, fwdBtn, reloadBtn, homeBtn, newTabBtn, addressWrap, shieldBtn, starBtn, readerBtn, menuBtn);
  root.appendChild(toolbar);

  // Bookmarks bar: the starred pages as chips, one click away, toggled from the page menu.
  const bookmarksBar = el('div', 'br-bookmarks-bar');
  root.appendChild(bookmarksBar);
  // A notice above the page, for a redirect the bridge held for the user's word.
  const notice = el('div', 'br-notice');
  notice.hidden = true;
  root.appendChild(notice);
  async function refreshBookmarksBar() {
    if (!showBookmarksBar()) { bookmarksBar.hidden = true; return; }
    let rows = [];
    try { rows = await Bookmarks.list(''); } catch { rows = []; }
    if (pane.disposed) return;
    bookmarksBar.innerHTML = '';
    bookmarksBar.hidden = false;
    // No bookmarks, no bar: the strip appears with the first star. No helper text on the default page.
    if (!rows.length) { bookmarksBar.hidden = true; return; }
    for (const bm of rows.slice(0, 30)) {
      const chip = el('button', 'br-bm-chip', { type: 'button', title: bm.url });
      chip.innerHTML = icon('star', 10);
      chip.appendChild(document.createTextNode(bm.title || hostOf(bm.url) || bm.url));
      chip.addEventListener('click', () => navigate(bm.url));
      chip.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openTab(bm.url, { private: isPrivate }); } });
      bookmarksBar.appendChild(chip);
    }
  }
  _sidebarListeners.add(refreshBookmarksBar);
  refreshBookmarksBar();

  const progress = el('div', 'br-progress');
  const progressFill = el('div');
  progress.appendChild(progressFill);
  root.appendChild(progress);

  const permBar = el('div', 'br-bar');
  permBar.hidden = true;
  root.appendChild(permBar);

  const authBar = el('div', 'br-bar br-auth-bar');
  authBar.hidden = true;
  root.appendChild(authBar);

  const findBar = el('div', 'br-bar');
  findBar.hidden = true;
  const findInput = el('input', null, { type: 'text', placeholder: 'Find in page', 'aria-label': 'Find in page' });
  const findCount = el('span', 'br-muted');
  const findPrev = iconBtn('arrow-left', 'Previous match', () => findNext(false));
  const findNextBtn = iconBtn('arrow-right', 'Next match', () => findNext(true));
  const findClose = iconBtn('x', 'Close', () => closeFind());
  findBar.append(el('span', null, { text: 'Find' }), findInput, findCount, findPrev, findNextBtn, findClose);
  root.appendChild(findBar);

  // The page area. The native view is positioned over it; DOM views (New Tab,
  // about: pages, errors, reader) live inside it and show when the view hides.
  const content = el('div', 'br-content');
  root.appendChild(content);

  let newtabView = null;
  let internalView = null;
  let errorView = null;
  let readerView = null;
  let shieldPanel = null;
  let suggestIndex = -1;
  let suggestions = [];
  let suggestOverlay = false;

  // ── Which surface shows ──
  function showOnly(which) {
    for (const child of [newtabView, internalView, errorView, readerView]) if (child) child.hidden = child !== which;
    pane.viewVisible = which === 'view';
    if (!pane.viewVisible) content.style.backgroundImage = '';
  }
  function showNewTab() {
    if (!newtabView) { newtabView = buildNewTabView(pane, (u) => navigate(u)); content.appendChild(newtabView); }
    else refreshNewTabView(newtabView, pane);
    pane.url = NEWTAB; pane.title = 'New Tab';
    address.value = '';
    updateChrome();
    setTitle('New Tab');
    showOnly(newtabView);
  }
  function showInternal(kind) {
    if (internalView) internalView.remove();
    internalView = buildInternalPage(kind, { navigate, openTab });
    content.appendChild(internalView);
    pane.url = `about:${kind}`;
    pane.title = INTERNAL_TITLES[pane.url] || kind;
    address.value = pane.url;
    updateChrome();
    setTitle(pane.title);
    showOnly(internalView);
  }
  function showError(title, description, failedUrl, allowHttpOnce) {
    if (errorView) errorView.remove();
    errorView = el('div', 'br-error');
    errorView.appendChild(el('h2', null, { text: title }));
    if (description) errorView.appendChild(el('p', null, { text: description }));
    if (failedUrl) errorView.appendChild(el('p', null, { text: failedUrl }));
    const row = el('div', 'br-row');
    const retry = el('button', 'primary', { type: 'button', text: 'Try Again' });
    retry.addEventListener('click', () => navigate(failedUrl || pane.url));
    row.appendChild(retry);
    if (allowHttpOnce) {
      const http = el('button', null, { type: 'button', text: 'Load Over HTTP Once', title: 'This site did not answer over HTTPS. Load the unencrypted page this one time.' });
      http.addEventListener('click', async () => { const b = bridge(); if (b) await b.allowHttpOnce(allowHttpOnce); loadInView(allowHttpOnce); });
      row.appendChild(http);
    }
    const back = el('button', null, { type: 'button', text: 'Back' });
    back.addEventListener('click', () => goBack());
    row.appendChild(back);
    errorView.appendChild(row);
    content.appendChild(errorView);
    showOnly(errorView);
  }
  /**
   * The page tried to send this tab to another site with no act of the
   * user's, and the bridge held it (policy.navigationDecision). The page
   * stays; the bar says where it wanted to go and waits.
   */
  function showRedirectHeld(ev) {
    const to = String(ev.url || '');
    let fromHost = '', toHost = '';
    try { fromHost = new URL(ev.from || pane.url).hostname; } catch { fromHost = ''; }
    try { toHost = new URL(to).hostname; } catch { toHost = to; }
    notice.innerHTML = '';
    const text = el('span', 'br-notice-text', { text: `${fromHost || 'This page'} wants to send you to ${toHost}`, title: to });
    const go = el('button', 'primary', { type: 'button', text: 'Continue', title: to });
    go.addEventListener('click', () => { hideNotice(); loadInView(to); });
    const stay = el('button', null, { type: 'button', text: 'Stay' });
    stay.addEventListener('click', () => hideNotice());
    const always = el('button', null, { type: 'button', text: 'Always Allow Here', title: `Let ${fromHost || 'this site'} send you to other sites on its own. The shield panel has the switch to undo it.` });
    always.addEventListener('click', async () => { const b = bridge(); if (b) await b.setSite(pane.url, { redirects: true }); hideNotice(); loadInView(to); });
    notice.append(text, go, stay, always);
    notice.hidden = false;
  }
  function hideNotice() { if (notice.hidden) return; notice.hidden = true; notice.innerHTML = ''; }
  /** An assistant tab whose page is gone (a restart, or the Browser was off). */
  function showEnded() {
    if (errorView) errorView.remove();
    errorView = el('div', 'br-error');
    errorView.appendChild(el('h2', null, { text: 'This assistant tab has ended' }));
    errorView.appendChild(el('p', null, { text: 'Its page closed when Parallx restarted or the Browser was turned off. The assistant opens a new tab when it browses again.' }));
    const row = el('div', 'br-row');
    const close = el('button', 'primary', { type: 'button', text: 'Close Tab' });
    close.addEventListener('click', () => { if (editorId) _api.editors.closeEditor(editorId).catch(() => {}); });
    row.appendChild(close);
    errorView.appendChild(row);
    content.appendChild(errorView);
    pane.url = 'about:blank';
    address.value = '';
    updateChrome();
    setTitle('Ended');
    showOnly(errorView);
  }
  /** The page's process ended (a crash, out of memory, killed). The view stays; Reload starts a new process. */
  function showCrashed(reason) {
    pane.crashed = reason || 'crashed';
    pane.loading = false;
    progressFill.style.opacity = '0'; progressFill.style.width = '0';
    settleLoad(false);
    if (errorView) errorView.remove();
    errorView = el('div', 'br-error');
    errorView.appendChild(el('h2', null, { text: 'This page crashed' }));
    const why = reason === 'oom' || reason === 'memory-eviction' ? 'It ran out of memory.'
      : (reason === 'killed' ? 'Its process was stopped.' : (reason === 'launch-failed' ? 'Its process could not start.' : 'Its process ended unexpectedly.'));
    errorView.appendChild(el('p', null, { text: `${why} ${pane.isAgent ? 'Reload it, or let the assistant open it again.' : 'Reload it to try again.'}` }));
    if (isWebUrl(pane.viewUrl)) errorView.appendChild(el('p', null, { text: pane.viewUrl }));
    const row = el('div', 'br-row');
    const again = el('button', 'primary', { type: 'button', text: 'Reload' });
    again.addEventListener('click', () => reload());
    row.appendChild(again);
    errorView.appendChild(row);
    content.appendChild(errorView);
    updateChrome();
    // The New Tab page or an about: page the user is on stays; the crash shows when they go back to the page.
    if ([newtabView, internalView].some((v) => v && !v.hidden)) errorView.hidden = true;
    else showOnly(errorView);
  }

  // ── The page view ──
  function ensureView() {
    if (pane.hasView) return Promise.resolve(true);
    if (pane._creating) return pane._creating;
    pane._creating = (async () => {
      try {
        // The gap between documents is painted in the page's colour when known, else the app surface: no white flash.
        const r = await V('create', pane.tabId, partitionKind, { background: pane.pageColor || surfaceColor() });
        if (pane.disposed) return false;
        pane.hasView = true;
        pane.wcId = r.webContentsId;
        _panesByWc.set(pane.wcId, pane);
        applyPageTheme(pane);
        if (pane.zoom !== 1) V('zoom', pane.tabId, pane.zoom).catch(() => {});
        return true;
      } catch (err) {
        showError('The page view could not be created', String(err && err.message || err), null, null);
        return false;
      } finally { pane._creating = null; }
    })();
    return pane._creating;
  }
  // Bounds: read every frame, sent only when they change.
  let lastBounds = '';
  let rafId = 0;
  // The page is a native view above the whole DOM. Each frame the pane reports
  // where the view belongs and whether it may show at all:
  //  - anything the workbench draws over the page area (a dialog, a menu, the
  //    command palette, a tab-drop indicator) would sit BEHIND the view, so a
  //    grid of hit tests inside the page area looks for foreign elements; when
  //    one is there the view yields to a snapshot of itself until the way is
  //    clear;
  //  - the resize sashes straddle each boundary by half their width, and the
  //    half over the page area must stay in the DOM's hands or the sash could
  //    never be grabbed, so the view stops short of it and the pane paints the
  //    strip in the page's own colour.
  function coveredBy(r) {
    const inset = 5;
    if (r.width <= 2 * inset || r.height <= 2 * inset) return false;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = r.left + inset + ((r.width - 2 * inset) * i) / 3;
        const y = r.top + inset + ((r.height - 2 * inset) * j) / 3;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== content && !content.contains(hit)) return true;
      }
    }
    return false;
  }
  function sashInsets(r) {
    const ins = { left: 0, top: 0, right: 0, bottom: 0 };
    for (const s of document.querySelectorAll('.grid-sash')) {
      const q = s.getBoundingClientRect();
      if (!q.width || !q.height) continue;
      if (s.classList.contains('grid-sash-vertical')) {
        if (Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top) <= 0) continue;
        if (q.left <= r.left && q.right > r.left) ins.left = Math.max(ins.left, Math.min(8, Math.ceil(q.right - r.left)));
        if (q.right >= r.right && q.left < r.right) ins.right = Math.max(ins.right, Math.min(8, Math.ceil(r.right - q.left)));
      } else {
        if (Math.min(q.right, r.right) - Math.max(q.left, r.left) <= 0) continue;
        if (q.top <= r.top && q.bottom > r.top) ins.top = Math.max(ins.top, Math.min(8, Math.ceil(q.bottom - r.top)));
        if (q.bottom >= r.bottom && q.top < r.bottom) ins.bottom = Math.max(ins.bottom, Math.min(8, Math.ceil(r.bottom - q.top)));
      }
    }
    return ins;
  }
  let lastRectKey = '';
  let insets = { left: 0, top: 0, right: 0, bottom: 0 };
  function tick() {
    if (pane.disposed) return;
    rafId = requestAnimationFrame(tick);
    if (!pane.hasView) return;
    const r = content.getBoundingClientRect();
    const displayed = root.isConnected && root.offsetParent !== null && r.width > 0 && r.height > 0;
    const rectKey = `${r.left},${r.top},${r.width},${r.height}`;
    if (displayed && rectKey !== lastRectKey) { lastRectKey = rectKey; insets = sashInsets(r); }
    const wantsView = displayed && pane.viewVisible && !document.hidden;
    if (wantsView && pane.overlays === 0 && !pane.covered && coveredBy(r)) { pane.covered = true; void overlayOpen(); }
    else if (pane.covered && pane.overlays > 0 && (!wantsView || !coveredBy(r))) { pane.covered = false; overlayClose(); }
    const visible = wantsView && pane.overlays === 0;
    const b = { x: Math.round(r.left + insets.left), y: Math.round(r.top + insets.top), width: Math.round(r.width - insets.left - insets.right), height: Math.round(r.height - insets.top - insets.bottom), visible };
    const key = `${b.x},${b.y},${b.width},${b.height},${b.visible}`;
    if (key === lastBounds) return;
    lastBounds = key;
    V('bounds', pane.tabId, b).catch(() => {});
  }
  rafId = requestAnimationFrame(tick);
  // Overlays over the page area: freeze the page into a snapshot, hide the view.
  async function overlayOpen() {
    if (pane.hasView && pane.viewVisible && pane.overlays === 0) {
      try { const data = await V('snapshot', pane.tabId); if (data && !pane.disposed) content.style.backgroundImage = `url("${data}")`; } catch { /* no snapshot, the area is plain */ }
    }
    pane.overlays++;
  }
  function overlayClose() {
    pane.overlays = Math.max(0, pane.overlays - 1);
    if (pane.overlays === 0) setTimeout(() => { if (pane.overlays === 0) content.style.backgroundImage = ''; }, 150);
  }
  function waitLoad(timeoutMs) {
    return new Promise((resolve) => {
      const done = (ok) => { pane._loadWaiters = pane._loadWaiters.filter((w) => w !== done); resolve(ok); };
      pane._loadWaiters.push(done);
      setTimeout(() => done(true), timeoutMs);
    });
  }
  function settleLoad(ok) { for (const w of [...pane._loadWaiters]) w(ok); }

  async function loadInView(url) {
    pane.url = url;
    pane.readerOn = false;
    address.value = displayUrl(url);
    updateChrome();
    if (!(await ensureView()) || pane.disposed) return;
    pane.crashed = null;
    showOnly('view');
    try { await V('navigate', pane.tabId, url); }
    catch (err) { /* did-fail-load paints the page; anything else lands here */ if (!/ERR_/.test(String(err && err.message))) showError('This address could not be opened', String(err && err.message || err), url, null); }
  }
  function onNavigated(url, inPage, nav) {
    if (!url || url === 'about:blank') return;
    pane.url = url;
    pane.viewUrl = url;
    pane.crashed = null;
    pane.readerOn = false;
    if (nav) { pane.canGoBack = !!nav.canGoBack; pane.canGoForward = !!nav.canGoForward; }
    if (!pane.viewVisible) showOnly('view');
    if (document.activeElement !== address) address.value = displayUrl(url);
    if (!inPage) pane.blocked = { count: 0, hosts: [] };
    updateChrome();
    if (isWebUrl(url)) {
      if (!isPrivate && !pane.isAgent) {
        History.record(url, pane.title && pane.title !== 'New Tab' ? pane.title : '').then(notifySidebar).catch(() => {});
        Tabs.remember(instanceId, url, pane.title).catch(() => {});
      }
      Bookmarks.has(url).then((b) => { pane.bookmarked = b; updateChrome(); }).catch(() => {});
    }
    setTitle(pane.title && pane.title !== 'New Tab' ? pane.title : (hostOf(url) || 'Web Page'));
    if (shieldPanel) refreshShieldPanel();
  }
  // Every way the user moves a page ends in navigate, goBack, goForward or
  // reload: the toolbar, the address bar and its suggestions, bookmark chips,
  // menus, about: pages, New Tab tiles, the commands and their page shortcuts.
  // In an assistant tab that is taking over. The broker never calls these; it
  // drives the page itself, and its navigations reach the pane as did-navigate.
  function navigate(text) {
    if (pane.isAgent) agentUserDrove(pane);
    dismissSuggest();
    const parsed = parseOmnibox(text, cfg('searchEngine', 'duckduckgo'));
    if (parsed.url === NEWTAB) { showNewTab(); return; }
    if (INTERNAL_PAGES.has(parsed.url)) { showInternal(parsed.url.slice('about:'.length)); return; }
    loadInView(parsed.url);
  }
  function setTitle(t) {
    if (!editorId) return;
    const label = isPrivate ? `Private: ${t || 'Web Page'}` : (pane.isAgent ? `${_agentPrivate.has(instanceId) ? 'Private Assistant' : 'Assistant'}: ${t || 'Web Page'}` : (t || 'Web Page'));
    try { _api.editors.setEditorTitle(editorId, label); } catch { /* ignore */ }
  }
  function updateChrome() {
    backBtn.disabled = !(pane.hasView && (pane.canGoBack || pane.url !== NEWTAB));
    fwdBtn.disabled = !(pane.hasView && pane.canGoForward);
    reloadBtn.innerHTML = icon(pane.loading ? 'x' : 'rotate-cw', 14);
    reloadBtn.title = pane.loading ? 'Stop' : 'Reload';
    const isHttps = /^https:/i.test(pane.url);
    const isHttp = /^http:/i.test(pane.url);
    lock.innerHTML = isHttps ? icon('lock', 12) : (isHttp ? icon('lock-open', 12) : '');
    lock.classList.toggle('is-insecure', isHttp);
    lock.title = isHttps ? 'Connection is encrypted' : (isHttp ? 'Connection is not encrypted' : '');
    starBtn.classList.toggle('is-active', pane.bookmarked);
    starBtn.title = pane.bookmarked ? 'Remove Bookmark' : 'Bookmark This Page';
    readerBtn.classList.toggle('is-active', pane.readerOn);
    readerBtn.disabled = !isWebUrl(pane.url);
    shieldBtn.disabled = !isWebUrl(pane.url);
    shieldBadge.hidden = !(pane.blocked.count > 0);
    shieldBadge.textContent = pane.blocked.count > 99 ? '99+' : String(pane.blocked.count);
  }
  function goBack() { if (pane.isAgent) agentUserDrove(pane); if (pane.hasView && pane.canGoBack) { V('back', pane.tabId).catch(() => {}); if (!pane.viewVisible) showOnly('view'); } else if (pane.url !== NEWTAB) showNewTab(); }
  function goForward() { if (pane.isAgent) agentUserDrove(pane); if (pane.hasView && pane.canGoForward) { V('forward', pane.tabId).catch(() => {}); if (!pane.viewVisible) showOnly('view'); } }
  function reload() {
    if (pane.isAgent) agentUserDrove(pane);
    if (pane.url === NEWTAB) { showNewTab(); return; }
    if (INTERNAL_PAGES.has(pane.url)) { showInternal(pane.url.slice('about:'.length)); return; }
    if (pane.hasView) { pane.crashed = null; showOnly('view'); V('reload', pane.tabId).catch(() => {}); } else loadInView(pane.url);
  }
  function stop() { if (pane.hasView) V('stop', pane.tabId).catch(() => {}); }

  // ── Events from the main process ──
  pane.onViewEvent = (ev) => {
    switch (ev.type) {
      case 'page-color':
        pane.pageColor = ev.color || ''; content.style.backgroundColor = pane.pageColor;
        if (pane.pageColor) V('background', pane.tabId, pane.pageColor).catch(() => {});
        break;
      case 'did-start-loading': pane.loading = true; progressFill.style.opacity = '1'; progressFill.style.width = '30%'; updateChrome(); break;
      case 'did-stop-loading':
        pane.loading = false; progressFill.style.width = '100%';
        setTimeout(() => { progressFill.style.opacity = '0'; progressFill.style.width = '0'; }, 200);
        pane.canGoBack = !!ev.canGoBack; pane.canGoForward = !!ev.canGoForward; updateChrome(); settleLoad(true); break;
      case 'did-navigate': hideNotice(); onNavigated(ev.url, false, ev); break;
      case 'did-navigate-in-page': onNavigated(ev.url, true, ev); break;
      case 'page-title-updated':
        pane.viewTitle = ev.title || pane.viewTitle;
        pane.title = ev.title || pane.title; setTitle(pane.title);
        if (isWebUrl(pane.url) && !isPrivate && !pane.isAgent) { History.setTitle(pane.url, pane.title).catch(() => {}); Tabs.remember(instanceId, pane.url, pane.title).catch(() => {}); }
        break;
      case 'did-fail-load': {
        if (!ev.isMainFrame || ev.errorCode === -3) break;
        settleLoad(false);
        const failed = ev.validatedURL || pane.url;
        let httpOnce = null;
        try { const u = new URL(failed); if (u.protocol === 'https:' && !isLocalHost(u.hostname) && /CERT|SSL|CONNECTION_REFUSED|CONNECTION_RESET|NAME_NOT_RESOLVED|TIMED_OUT/.test(ev.errorDescription || '')) { u.protocol = 'http:'; httpOnce = u.toString(); } } catch { httpOnce = null; }
        const isCert = /CERT/.test(ev.errorDescription || '');
        showError(isCert ? 'This connection is not private' : 'This page could not be loaded', `${ev.errorDescription || 'Unknown error'} (${ev.errorCode})`, failed, isCert ? null : httpOnce);
        break;
      }
      case 'crashed': showCrashed(ev.reason); break;
      case 'redirect-held': showRedirectHeld(ev); break;
      case 'auth-request': showAuth(ev); break;
      case 'update-target-url': linkStatus(ev.url || ''); break;
      case 'found-in-page': { const r = ev.result; if (r) findCount.textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : 'No matches'; break; }
      case 'context-menu': showPageContextMenu(ev.params || {}); break;
      case 'shortcut': { _activePane = pane; const cmd = SHORTCUT_COMMANDS[ev.chord]; if (cmd) _api.commands.executeCommand(cmd).catch(() => {}); break; }
      case 'focus': _activePane = pane; break;
      default: break;
    }
  };

  // ── Address bar ──
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const pick = suggestIndex >= 0 ? suggestions[suggestIndex] : null; navigate(pick ? pick.url : address.value); address.blur(); root.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); dismissSuggest(); address.value = displayUrl(pane.url); address.blur(); root.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!suggestions.length) return;
      e.preventDefault();
      suggestIndex = e.key === 'ArrowDown' ? Math.min(suggestions.length - 1, suggestIndex + 1) : Math.max(-1, suggestIndex - 1);
      renderSuggest();
    }
  });
  address.addEventListener('input', () => { void refreshSuggest(address.value.trim()); });
  address.addEventListener('focus', () => { address.select(); });
  address.addEventListener('blur', () => { setTimeout(dismissSuggest, 120); });
  async function refreshSuggest(q) {
    if (!q || q.length < 2) { dismissSuggest(); return; }
    try { suggestions = await suggest(q, 8); } catch { suggestions = []; }
    suggestIndex = -1;
    renderSuggest();
  }
  function renderSuggest() {
    suggestBox.innerHTML = '';
    if (!suggestions.length) { dismissSuggest(); return; }
    suggestions.forEach((s, i) => {
      const row = el('div', `br-suggest-item${i === suggestIndex ? ' is-selected' : ''}`);
      row.innerHTML = icon(s.kind ? 'star' : 'clock', 12);
      row.appendChild(el('span', 'br-suggest-title', { text: s.title || s.url }));
      row.appendChild(el('span', 'br-suggest-url', { text: s.url }));
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); navigate(s.url); });
      suggestBox.appendChild(row);
    });
    suggestBox.hidden = false;
    if (!suggestOverlay) { suggestOverlay = true; void overlayOpen(); }
  }
  function dismissSuggest() { suggestions = []; suggestIndex = -1; suggestBox.hidden = true; suggestBox.innerHTML = ''; if (suggestOverlay) { suggestOverlay = false; overlayClose(); } }

  // ── Bookmark ──
  async function toggleBookmark() {
    if (!isWebUrl(pane.url)) return;
    try {
      if (pane.bookmarked) { await Bookmarks.remove(pane.url); pane.bookmarked = false; }
      else { await Bookmarks.add(pane.url, pane.title); pane.bookmarked = true; }
      updateChrome();
      notifySidebar();
    } catch (err) { _api.window.showErrorMessage('Bookmark failed: ' + (err && err.message || err)); }
  }

  // ── Find ──
  function openFind() { if (!pane.hasView) return; findBar.hidden = false; findInput.focus(); findInput.select(); }
  function closeFind() { findBar.hidden = true; findCount.textContent = ''; if (pane.hasView) V('stopFind', pane.tabId, 'clearSelection').catch(() => {}); root.focus(); }
  function findNext(forward) { const q = findInput.value; if (!q || !pane.hasView) return; V('find', pane.tabId, q, { forward, findNext: true }).catch(() => {}); }
  findInput.addEventListener('input', () => { const q = findInput.value; if (!pane.hasView) return; if (!q) { findCount.textContent = ''; V('stopFind', pane.tabId, 'clearSelection').catch(() => {}); return; } V('find', pane.tabId, q).catch(() => {}); });
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(!e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });

  // ── Zoom ──
  function zoomBy(dir) {
    const i = ZOOM_STEPS.indexOf(pane.zoom);
    const next = dir === 0 ? 1 : ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? ZOOM_STEPS.indexOf(1) : i) + dir))];
    pane.zoom = next;
    if (pane.hasView) V('zoom', pane.tabId, next).catch(() => {});
    linkStatus(`Zoom ${Math.round(next * 100)}%`);
    clearTimeout(pane._zoomTimer); pane._zoomTimer = setTimeout(() => linkStatus(''), 1200);
  }

  // ── Shield panel ──
  function toggleShieldPanel() { if (shieldPanel) { closeShieldPanel(); return; } if (!isWebUrl(pane.url)) return; shieldPanel = el('div', 'br-panel'); root.appendChild(shieldPanel); void overlayOpen(); refreshShieldPanel(); setTimeout(() => { document.addEventListener('pointerdown', onShieldOutside, true); }, 0); }
  function onShieldOutside(e) { if (shieldPanel && !shieldPanel.contains(e.target) && !shieldBtn.contains(e.target) && !e.target.closest('.ui-dropdown, .ui-dropdown-list')) closeShieldPanel(); }
  function closeShieldPanel() { document.removeEventListener('pointerdown', onShieldOutside, true); if (shieldPanel) { shieldPanel.remove(); shieldPanel = null; overlayClose(); } }
  async function refreshShieldPanel() {
    if (!shieldPanel) return;
    const b = bridge();
    const siteInfo = b ? await b.getSite(pane.url) : { key: hostOf(pane.url), settings: { shields: true, cookies: 'block-third-party', https: true } };
    const blockedNow = b && pane.wcId != null ? await b.blockedFor(pane.wcId) : pane.blocked;
    if (!shieldPanel) return;
    pane.blocked = { count: blockedNow.count || 0, hosts: blockedNow.hosts || [] };
    updateChrome();
    const s = siteInfo.settings;
    shieldPanel.innerHTML = '';
    shieldPanel.appendChild(el('h3', null, { text: siteInfo.key || hostOf(pane.url) }));
    shieldPanel.appendChild(el('div', 'br-muted', { text: s.shields ? 'Shields are up for this site.' : 'Shields are down for this site.' }));
    const count = el('div', 'br-panel-count');
    count.appendChild(el('strong', null, { text: String(pane.blocked.count) }));
    count.appendChild(el('span', 'br-muted', { text: pane.blocked.count === 1 ? 'tracker or ad blocked on this page' : 'trackers and ads blocked on this page' }));
    shieldPanel.appendChild(count);
    if (pane.blocked.hosts.length) {
      const hosts = el('div', 'br-hosts');
      for (const h of pane.blocked.hosts.slice(0, 12)) { const row = el('div'); row.appendChild(el('span', null, { text: h.host })); row.appendChild(el('span', null, { text: String(h.n) })); hosts.appendChild(row); }
      shieldPanel.appendChild(hosts);
    }
    const rowSwitch = (label, on, onToggle) => {
      const row = el('div', 'br-panel-row');
      row.appendChild(el('span', null, { text: label }));
      const sw = el('button', `br-switch${on ? ' is-on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label });
      sw.addEventListener('click', () => onToggle(!on));
      row.appendChild(sw);
      return row;
    };
    const apply = async (patch) => { if (!b) return; await b.setSite(pane.url, patch); reload(); refreshShieldPanel(); notifySidebar(); };
    shieldPanel.appendChild(rowSwitch('Block Trackers And Ads', s.shields, (v) => apply({ shields: v })));
    shieldPanel.appendChild(rowSwitch('Upgrade Connections To HTTPS', s.https, (v) => apply({ https: v })));
    shieldPanel.appendChild(rowSwitch('Allow Redirects To Other Sites', s.redirects, (v) => apply({ redirects: v })));
    const cookieRow = el('div', 'br-panel-row');
    cookieRow.appendChild(el('span', null, { text: 'Cookies' }));
    const slot = el('div', 'br-dropdown-slot');
    cookieRow.appendChild(slot);
    shieldPanel.appendChild(cookieRow);
    try {
      const dd = _api.ui.createDropdown(slot, {
        items: [{ value: 'block-third-party', label: 'Block Third-Party' }, { value: 'block-all', label: 'Block All' }, { value: 'allow', label: 'Allow All' }],
        selected: s.cookies, ariaLabel: 'Cookies',
      });
      dd.onDidChange((v) => apply({ cookies: v }));
    } catch { slot.textContent = s.cookies; }
    const foot = el('div', 'br-panel-foot');
    const clearBtn = el('button', 'br-action', { type: 'button', text: 'Clear Site Data', title: 'Remove this site’s cookies and storage.' });
    clearBtn.addEventListener('click', async () => { if (b) { await b.clearSiteData(pane.url); reload(); } });
    const resetBtn = el('button', 'br-action', { type: 'button', text: 'Reset Site', title: 'Forget this site’s shield settings and permission answers.' });
    resetBtn.addEventListener('click', async () => { if (b) { await b.resetSite(pane.url); reload(); refreshShieldPanel(); notifySidebar(); } });
    foot.append(clearBtn, resetBtn);
    shieldPanel.appendChild(foot);
    shieldPanel.appendChild(el('div', 'br-muted', { text: listsLine() }));
  }

  // ── Permission bar ──
  const pendingPrompts = [];
  function showPermission(req) { pendingPrompts.push(req); if (pendingPrompts.length === 1) renderPermission(); }
  function renderPermission() {
    const req = pendingPrompts[0];
    if (!req) { permBar.hidden = true; permBar.innerHTML = ''; return; }
    permBar.innerHTML = icon('lock', 12);
    const what = PERMISSION_LABELS[req.permission] || `use ${req.permission}`;
    permBar.appendChild(el('span', null, { text: `${hostOf(req.origin) || 'This site'} wants to ${what}.` }));
    permBar.appendChild(el('span', 'br-spacer'));
    const remember = el('label');
    const cb = el('input', null, { type: 'checkbox' });
    cb.checked = true;
    remember.append(cb, el('span', null, { text: 'Remember for this site' }));
    const allow = el('button', 'primary', { type: 'button', text: 'Allow' });
    const block = el('button', null, { type: 'button', text: 'Block' });
    const reply = async (ok) => { const b = bridge(); if (b) await b.permissionReply(req.requestId, ok, cb.checked); pendingPrompts.shift(); renderPermission(); notifySidebar(); };
    allow.addEventListener('click', () => reply(true));
    block.addEventListener('click', () => reply(false));
    permBar.append(remember, allow, block);
    permBar.hidden = false;
  }

  // ── Sign-in bar (HTTP authentication) ──
  // A site or proxy asks for a username and password (Basic, Digest, NTLM).
  // The request waits until it is answered here. The credentials go to the
  // main process for that one request only: nothing stores them, and the
  // assistant never sees them (its action ends asking the user instead).
  // The bridge cancels a request after 5 minutes; the bar forgets it then too.
  const pendingAuth = [];
  function showAuth(req) {
    if (!req || !req.id) return;
    req.timer = setTimeout(() => {
      const i = pendingAuth.indexOf(req);
      if (i < 0) return;
      pendingAuth.splice(i, 1);
      if (i === 0) renderAuth();
    }, 5 * 60 * 1000);
    pendingAuth.push(req);
    if (pendingAuth.length === 1) renderAuth();
  }
  function renderAuth() {
    const req = pendingAuth[0];
    if (!req || pane.disposed) { authBar.hidden = true; authBar.innerHTML = ''; return; }
    authBar.innerHTML = icon('lock', 12);
    const port = req.port && req.port !== 80 && req.port !== 443 ? `:${req.port}` : '';
    const who = req.isProxy ? `The proxy ${req.host || ''}${port}` : `${req.host || 'This site'}${port}`;
    let text = `${who} asks you to sign in${req.realm ? ` to “${req.realm}”` : ''}.`;
    if (!req.isProxy && /^http:/i.test(req.url || '')) text += ' The connection is not encrypted.';
    authBar.appendChild(el('span', 'br-auth-text', { text, title: req.url || '' }));
    authBar.appendChild(el('span', 'br-spacer'));
    const user = el('input', null, { type: 'text', placeholder: 'Username', 'aria-label': 'Username', autocomplete: 'off', spellcheck: 'false' });
    const pass = el('input', null, { type: 'password', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'off' });
    const signIn = el('button', 'primary', { type: 'button', text: 'Sign In' });
    const cancel = el('button', null, { type: 'button', text: 'Cancel' });
    const answer = (ok) => {
      if (pendingAuth[0] !== req) return;
      pendingAuth.shift();
      clearTimeout(req.timer);
      const u = user.value;
      const p = pass.value;
      user.value = ''; pass.value = '';
      (ok ? V('authReply', pane.tabId, req.id, u, p) : V('authCancel', pane.tabId, req.id)).catch(() => {});
      renderAuth();
    };
    signIn.addEventListener('click', () => answer(true));
    cancel.addEventListener('click', () => answer(false));
    user.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pass.focus(); } else if (e.key === 'Escape') { e.preventDefault(); answer(false); } });
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); answer(true); } else if (e.key === 'Escape') { e.preventDefault(); answer(false); } });
    authBar.append(user, pass, signIn, cancel);
    authBar.hidden = false;
    // Where the user is already working in this tab, the cursor goes to the form.
    if (root.contains(document.activeElement)) user.focus();
  }
  /** Refuse every sign-in still waiting (the pane is going away): the page gets its 401 answer. */
  function dropAuthPrompts() {
    while (pendingAuth.length) { const r = pendingAuth.shift(); clearTimeout(r.timer); V('authCancel', pane.tabId, r.id).catch(() => {}); }
    renderAuth();
  }

  // ── Reader ──
  async function toggleReader() {
    if (pane.readerOn) { pane.readerOn = false; showOnly('view'); updateChrome(); return; }
    if (!pane.hasView || !isWebUrl(pane.url)) return;
    try {
      const html = await V('exec', pane.tabId, 'document.documentElement.outerHTML');
      const article = readerArticle(html, pane.url);
      if (!article) { _api.window.showInformationMessage('Reader mode could not find an article on this page.'); return; }
      if (readerView) readerView.remove();
      readerView = buildReaderView(article);
      content.appendChild(readerView);
      pane.readerOn = true;
      showOnly(readerView);
      updateChrome();
    } catch (err) { _api.window.showErrorMessage('Reader mode failed: ' + (err && err.message || err)); }
  }

  // ── Menus ──
  // Links from a private assistant session stay private (a private tab of the user's).
  const keepsPrivate = () => isPrivate || (!!pane.isAgent && _agentPrivate.has(instanceId));
  function showPageMenu(anchor) {
    const web = isWebUrl(pane.url);
    void overlayOpen();
    showMenu(anchor, [
      { label: 'New Tab', handler: () => openTab(undefined, { private: keepsPrivate() }) },
      ...(isPrivate ? [{ label: 'New Regular Tab', handler: () => openTab() }] : [{ label: 'New Private Tab', handler: () => openTab(undefined, { private: true }) }]),
      { separator: true },
      { label: 'Set Current Page as Home', handler: () => setHomepage(pane.url), disabled: !(web || INTERNAL_PAGES.has(pane.url)) },
      ...(homepage() !== NEWTAB ? [{ label: 'Use New Tab Page as Home', handler: () => setHomepage(NEWTAB) }] : []),
      { separator: true },
      { label: 'Bookmarks', handler: () => navigate('about:bookmarks') },
      { label: 'History', handler: () => navigate('about:history') },
      { label: 'Blocked Trackers', handler: () => navigate('about:shields') },
      { label: showBookmarksBar() ? 'Hide Bookmarks Bar' : 'Show Bookmarks Bar', handler: () => setBookmarksBar(!showBookmarksBar()) },
      { separator: true },
      { label: 'Find In Page', handler: () => openFind(), disabled: !web },
      { label: 'Zoom In', handler: () => zoomBy(1), disabled: !web },
      { label: 'Zoom Out', handler: () => zoomBy(-1), disabled: !web },
      { label: 'Reset Zoom', handler: () => zoomBy(0), disabled: !web },
      { separator: true },
      { label: 'Send Page to Chat', handler: () => sendToChat(), disabled: !web },
      { label: 'Copy Address', handler: () => navigator.clipboard.writeText(pane.url).catch(() => {}), disabled: !web },
      { label: 'Open In System Browser', handler: () => { const sh = window.parallxElectron && window.parallxElectron.shell; if (sh && sh.openExternal) sh.openExternal(pane.url, { system: true }); }, disabled: !web },
      { label: 'Print', handler: () => { if (pane.hasView) V('print', pane.tabId).catch(() => {}); }, disabled: !web },
      { separator: true },
      { label: 'Clear Browsing Data', danger: true, handler: () => clearBrowsingData() },
    ], overlayClose);
  }
  function showPageContextMenu(p) {
    const items = [];
    if (p.linkURL) {
      items.push({ label: 'Open Link In New Tab', handler: () => openTab(p.linkURL, { private: keepsPrivate() }) });
      items.push({ label: 'Copy Link Address', handler: () => navigator.clipboard.writeText(p.linkURL).catch(() => {}) });
      items.push({ separator: true });
    }
    if (p.srcURL && p.mediaType === 'image') {
      items.push({ label: 'Open Image In New Tab', handler: () => openTab(p.srcURL, { private: keepsPrivate() }) });
      items.push({ label: 'Copy Image Address', handler: () => navigator.clipboard.writeText(p.srcURL).catch(() => {}) });
      items.push({ separator: true });
    }
    if (p.selectionText) {
      items.push({ label: 'Copy', handler: () => V('edit', pane.tabId, 'copy').catch(() => {}) });
      items.push({ label: `Search For "${p.selectionText.slice(0, 40)}${p.selectionText.length > 40 ? '…' : ''}"`, handler: () => openTab(parseOmnibox(p.selectionText, cfg('searchEngine', 'duckduckgo')).url, { private: keepsPrivate() }) });
      items.push({ separator: true });
    }
    if (p.isEditable) {
      items.push({ label: 'Cut', handler: () => V('edit', pane.tabId, 'cut').catch(() => {}) });
      items.push({ label: 'Copy', handler: () => V('edit', pane.tabId, 'copy').catch(() => {}) });
      items.push({ label: 'Paste', handler: () => V('edit', pane.tabId, 'paste').catch(() => {}) });
      items.push({ separator: true });
    }
    items.push({ label: 'Back', handler: () => goBack() });
    items.push({ label: 'Forward', handler: () => goForward() });
    items.push({ label: 'Reload', handler: () => reload() });
    items.push({ separator: true });
    items.push({ label: 'Send Page to Chat', handler: () => sendToChat() });
    const r = content.getBoundingClientRect();
    const anchor = { x: r.left + (p.x || 0), y: r.top + (p.y || 0) };
    void overlayOpen();
    showMenu(anchor, items, overlayClose);
  }
  function sendToChat() {
    if (!isWebUrl(pane.url)) return;
    // The one door from the browser to the AI: the address and title, so the
    // model fetches through the sanitized chokepoint, never the live page.
    _api.commands.executeCommand('chat.addSelectionContext', {
      kind: 'selection', id: `browser:${pane.url}`, name: pane.title || hostOf(pane.url), fullPath: pane.url, isImplicit: false,
      selectedText: `Web page: ${pane.title || ''}\n${pane.url}`, surface: 'browser',
    }).then(() => { try { _api.commands.executeCommand('chat.show'); } catch { /* ignore */ } })
      .catch((err) => _api.window.showErrorMessage('Could not send to chat: ' + (err && err.message || err)));
  }

  // ── Pane API for commands, tools and bridge events ──
  pane.navigate = navigate;
  pane.focusAddress = () => { address.focus(); address.select(); };
  pane.openFind = openFind;
  pane.reload = reload;
  pane.goBack = goBack;
  pane.goForward = goForward;
  pane.toggleBookmark = toggleBookmark;
  pane.zoomBy = zoomBy;
  pane.toggleReader = toggleReader;
  pane.sendToChat = sendToChat;
  pane.waitLoad = waitLoad;
  pane.exec = (code) => V('exec', pane.tabId, code);
  pane.onBlocked = (summary) => { pane.blocked = { count: summary.count || 0, hosts: summary.hosts || [] }; updateChrome(); if (shieldPanel) refreshShieldPanel(); };
  pane.onPermission = showPermission;
  pane.onLists = () => { if (shieldPanel) refreshShieldPanel(); };
  /** Put the page view back on show: the broker needs it on screen for native input (its 'reveal'). */
  pane.showView = () => {
    if (pane.disposed || !pane.hasView || pane.viewVisible) return;
    if (pane.crashed) { if (errorView) showOnly(errorView); return; }
    // The user left the page for the New Tab page or an about: page: the pane shows the page again, under its own address.
    if (pane.viewUrl && pane.url !== pane.viewUrl) {
      pane.url = pane.viewUrl;
      pane.title = pane.viewTitle || hostOf(pane.viewUrl) || 'Web Page';
      if (document.activeElement !== address) address.value = displayUrl(pane.url);
      setTitle(pane.title);
      Bookmarks.has(pane.url).then((b) => { pane.bookmarked = b; updateChrome(); }).catch(() => {});
    }
    pane.readerOn = false;
    showOnly('view');
    updateChrome();
  };
  pane.setRunState = (s) => renderAgentBanner(agentBanner, s);
  if (pane.isAgent) pane.setRunState(_agentRunByTab.get(instanceId) || null);

  // ── First load: adopt a live page if this tab already has one (moved or
  // evicted pane), otherwise open the pending, remembered or home address. ──
  (async () => {
    let adopted = null;
    try { adopted = await V('adopt', pane.tabId); } catch { adopted = null; }
    if (pane.disposed) return;
    if (adopted && adopted.webContentsId) {
      pane.hasView = true;
      pane.wcId = adopted.webContentsId;
      _panesByWc.set(pane.wcId, pane);
      if (adopted.url && adopted.url !== 'about:blank') {
        pane.url = adopted.url;
        pane.title = adopted.title || hostOf(adopted.url) || 'Web Page';
        pane.viewUrl = adopted.url;
        pane.viewTitle = adopted.title || '';
        pane.canGoBack = !!adopted.canGoBack;
        pane.canGoForward = !!adopted.canGoForward;
        address.value = displayUrl(pane.url);
        setTitle(pane.title);
        Bookmarks.has(pane.url).then((b) => { pane.bookmarked = b; updateChrome(); }).catch(() => {});
        updateChrome();
        // A page whose process ended while the tab was moving shows as crashed, if the bridge says so.
        if (adopted.crashed) showCrashed(adopted.crashed); else showOnly('view');
        if (pane.isAgent) applyPageTheme(pane);
        return;
      }
    }
    // An assistant tab shows the page its run owns, never the homepage or a
    // remembered address. Without a live page the tab has ended.
    if (pane.isAgent) {
      if (pane.hasView) {
        V('background', pane.tabId, surfaceColor()).catch(() => {});
        applyPageTheme(pane);
        updateChrome();
        showOnly('view');
      } else showEnded();
      return;
    }
    let initial = _pendingUrls.get(instanceId);
    _pendingUrls.delete(instanceId);
    if (!initial) { try { const row = await Tabs.recall(instanceId); if (row && row.url) initial = row.url; } catch { /* fresh */ } }
    if (!initial) initial = homepage();
    if (pane.disposed) return;
    if (initial === NEWTAB) showNewTab(); else navigate(initial);
  })();

  return {
    dispose() {
      pane.disposed = true;
      cancelAnimationFrame(rafId);
      closeShieldPanel();
      dismissSuggest();
      _sidebarListeners.delete(refreshBookmarksBar);
      linkStatus('');
      dropAuthPrompts();
      _livePanes.delete(pane);
      // Only the entries this pane owns: a second copy of the tab (another
      // group) may have registered over them, and it keeps receiving events.
      if (pane.wcId != null && _panesByWc.get(pane.wcId) === pane) _panesByWc.delete(pane.wcId);
      if (_panes.get(instanceId) === pane) {
        _panes.delete(instanceId);
        for (const p of _livePanes) {
          if (p.instanceId !== instanceId) continue;
          _panes.set(instanceId, p);
          if (p.wcId != null) _panesByWc.set(p.wcId, p);
          break;
        }
      }
      if (_activePane === pane) _activePane = null;
      if (pane.hasView) V('bounds', pane.tabId, { x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => {});
      // Closed, or only moved? Moved tabs come back within a moment and adopt
      // the same page; a closed tab is gone from the editor list.
      setTimeout(() => {
        if (_panes.has(instanceId) || editorStillOpen(instanceId)) return;
        V('destroy', pane.tabId).catch(() => {});
        if (isPrivate && !privateEditorsOpen()) { const b = bridge(); if (b) b.clearData('private').catch(() => {}); }
      }, 800);
      container.innerHTML = '';
    },
    saveViewState() { return { zoom: pane.zoom }; },
    restoreViewState(state) { if (state && typeof state.zoom === 'number') { pane.zoom = state.zoom; if (pane.hasView) V('zoom', pane.tabId, pane.zoom).catch(() => {}); } },
  };
}

// Home: the browser.homepage setting (about:newtab by default), changed from
// the page menu; the override covers the moment before the setting write lands.
let _homepageOverride = null;
function homepage() { return _homepageOverride != null ? _homepageOverride : (cfg('homepage', NEWTAB) || NEWTAB); }
function setHomepage(url) {
  const target = url && (isWebUrl(url) || INTERNAL_PAGES.has(url)) ? url : NEWTAB;
  _homepageOverride = target;
  try {
    const c = _api.workspace.getConfiguration('browser');
    if (c && typeof c.update === 'function') Promise.resolve(c.update('homepage', target)).then(() => { _homepageOverride = null; }).catch(() => {});
  } catch { /* keep the override */ }
  try { _api.window.showInformationMessage(target === NEWTAB ? 'Home is the New Tab page.' : `Home is now ${hostOf(target) || target}.`); } catch { /* ignore */ }
}
let _bookmarksBarOverride = null;
function showBookmarksBar() { return _bookmarksBarOverride != null ? _bookmarksBarOverride : cfg('showBookmarksBar', true) !== false; }
function setBookmarksBar(on) {
  _bookmarksBarOverride = !!on;
  try {
    const c = _api.workspace.getConfiguration('browser');
    if (c && typeof c.update === 'function') { Promise.resolve(c.update('showBookmarksBar', !!on)).then(() => { _bookmarksBarOverride = null; }).catch(() => {}); }
  } catch { /* keep the override */ }
  notifySidebar();
}
/** prefers-color-scheme for this pane's page, from the browser.pageTheme setting. */
function applyPageTheme(pane) {
  const b = bridge();
  if (!b || pane.wcId == null) return;
  const theme = cfg('pageTheme', 'system');
  b.setPageTheme(pane.wcId, theme === 'dark' || theme === 'light' ? theme : 'system').catch(() => {});
}

/**
 * Claim http(s) links clicked anywhere in the app (pages, notes, chat,
 * PDFs) so they open as tabs here, or hand them back to the system browser.
 * The claim follows the setting while the extension is enabled and is
 * withdrawn on deactivate, so a disabled extension means the plain path.
 */
function pushInAppLinks(on) {
  const b = bridge();
  if (!b || !b.setInAppLinks) return;
  const claim = on == null ? cfg('openLinksInApp', true) !== false : !!on;
  Promise.resolve(b.setInAppLinks(claim)).catch(() => {});
}

/** Tell main which list set to run: ads and trackers, or that plus the annoyance lists. */
function pushAnnoyances() {
  const b = bridge();
  if (!b || !b.setAnnoyances) return;
  b.setAnnoyances(cfg('blockAnnoyances', true) !== false)
    .then((l) => { if (l && l.status) { _lists = l; notifySidebar(); for (const p of _panes.values()) p.onLists(); } })
    .catch(() => {});
}
/** Tell main whether a settled page's own cross-site redirect waits for the user. */
function pushHoldRedirects() {
  const b = bridge();
  if (!b || !b.setHoldRedirects) return;
  b.setHoldRedirects(cfg('holdRedirects', true) !== false).catch(() => {});
}

function listsLine() {
  if (_lists.status === 'ready') return `Filter lists updated ${_lists.updatedAt ? new Date(_lists.updatedAt).toLocaleDateString() : 'recently'}${_lists.count ? `, ${_lists.count.toLocaleString()} rules` : ''}.`;
  if (_lists.status === 'loading') return 'Filter lists loading…';
  return `Filter lists not loaded${_lists.error ? ` (${_lists.error})` : ''}. Blocking is off until they load.`;
}

async function clearBrowsingData() {
  const pick = await _api.window.showWarningMessage('Clear browsing data? Cookies, cache, site storage, history and the download list are removed. Bookmarks and downloaded files stay.', { title: 'Clear' }, { title: 'Cancel' });
  if (!pick || pick.title !== 'Clear') return;
  const b = bridge();
  try {
    if (b) await b.clearData('user');
    await db.run(`DELETE FROM br_history`);
    await db.run(`DELETE FROM br_downloads WHERE state <> 'progressing'`);
    await scrubDb(true);
    // Assistant tabs are on their own profile, untouched; reloading one would count as taking over its run.
    for (const p of _panes.values()) { if (p.hasView && !p.isAgent && isWebUrl(p.url)) { try { p.reload(); } catch { /* ignore */ } } }
    notifySidebar();
    _api.window.showInformationMessage('Browsing data cleared.');
  } catch (err) { _api.window.showErrorMessage('Could not clear browsing data: ' + (err && err.message || err)); }
}

/** The Assistant Browser's profile only. The user's own browsing is not touched. */
async function clearAgentData() {
  const pick = await _api.window.showWarningMessage('Clear the Assistant Browser\'s data? Its cookies, sign-ins, cache and site storage are removed, and so are its page captures and the files it downloaded. A run in progress stops. Your own browsing is not touched.', { title: 'Clear' }, { title: 'Cancel' });
  if (!pick || pick.title !== 'Clear') return;
  const b = bridge();
  try {
    if (_automation) await _automation.control('stop').catch(() => false);
    if (b) await b.clearData('agent');
    // Captures and downloads are files kept with the runs, outside the profile: the broker removes this workspace's.
    if (b && typeof b.automation === 'function') {
      const r = await b.automation('clearArtifacts', {});
      const err = r && typeof r === 'object' ? (r.__error || r.error) : null;
      if (err) throw new Error(typeof err === 'string' ? err : (err.message || err.code || 'the captures could not be removed'));
    }
    _api.window.showInformationMessage('Assistant Browser data cleared.');
  } catch (err) { _api.window.showErrorMessage('Could not clear the Assistant Browser\'s data: ' + (err && err.message || err)); }
}

/** Remove a downloaded file for good: Eraser overwrites it when installed, a permanent delete otherwise. Never the Recycle Bin. */
async function deleteDownload(d) {
  const pick = await _api.window.showWarningMessage(`Delete ${d.filename}? The file is erased from disk, not moved to the Recycle Bin.`, { title: 'Delete' }, { title: 'Cancel' });
  if (!pick || pick.title !== 'Delete') return;
  const fsb = typeof window !== 'undefined' && window.parallxElectron ? window.parallxElectron.fs : null;
  let how = 'none';
  if (fsb && d.path) {
    try {
      const r = await fsb.delete(d.path, { useTrash: false, secure: true });
      if (r && r.error && r.error.code !== 'ENOENT') throw new Error(r.error.message || r.error.code);
      how = r && r.secure === 'eraser' ? 'eraser' : 'permanent';
    } catch (err) { _api.window.showErrorMessage('Could not delete the file: ' + (err && err.message || err)); return; }
  }
  await Downloads.remove(d.id);
  notifySidebar();
  _api.window.showInformationMessage(how === 'eraser' ? 'Eraser is overwriting the file; it disappears when Eraser finishes.' : 'File deleted.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: NEW TAB PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function buildNewTabView(pane, onNavigate) {
  const view = el('div', 'br-newtab');
  const search = el('div', 'br-newtab-search');
  search.innerHTML = icon('search', 16);
  const input = el('input', null, { type: 'text', placeholder: 'Search or enter an address', 'aria-label': 'Search or enter an address', spellcheck: 'false' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onNavigate(input.value); } });
  search.appendChild(input);
  view.appendChild(search);
  if (pane.isPrivate) {
    // A private tab shows nothing of yours: no bookmarks, no recent pages.
    view.appendChild(el('p', 'br-newtab-private', { text: 'Private tab. Pages you visit here are not kept in history or suggested later, and their cookies and site data vanish when the last private tab closes.' }));
    view._fill = async () => {};
    return view;
  }
  const bookmarks = el('div', 'br-newtab-section');
  bookmarks.appendChild(el('h3', null, { text: 'Bookmarks' }));
  const bookmarkTiles = el('div', 'br-tiles');
  bookmarks.appendChild(bookmarkTiles);
  view.appendChild(bookmarks);
  const recent = el('div', 'br-newtab-section');
  recent.appendChild(el('h3', null, { text: 'Recently Visited' }));
  const recentList = el('div', 'br-list');
  recent.appendChild(recentList);
  view.appendChild(recent);
  view._fill = async () => {
    try {
      const [bms, hist] = await Promise.all([Bookmarks.list(''), History.recent(12)]);
      bookmarkTiles.innerHTML = '';
      if (!bms.length) bookmarkTiles.appendChild(el('div', 'br-empty', { text: 'No bookmarks yet. Press the star on a page to keep it here.' }));
      for (const bm of bms.slice(0, 18)) {
        const t = el('button', 'br-tile', { type: 'button', title: bm.url });
        t.appendChild(el('span', 'br-tile-title', { text: bm.title || hostOf(bm.url) || bm.url }));
        t.appendChild(el('span', 'br-tile-host', { text: hostOf(bm.url) }));
        t.addEventListener('click', () => onNavigate(bm.url));
        bookmarkTiles.appendChild(t);
      }
      recentList.innerHTML = '';
      if (!hist.length) recentList.appendChild(el('div', 'br-empty', { text: 'Nothing visited yet.' }));
      for (const h of hist) {
        const row = el('div', 'br-item', { title: h.url });
        row.innerHTML = icon('clock', 12);
        row.appendChild(el('span', 'br-item-title', { text: h.title || h.url }));
        row.appendChild(el('span', 'br-item-meta', { text: hostOf(h.url) }));
        row.addEventListener('click', () => onNavigate(h.url));
        recentList.appendChild(row);
      }
    } catch { /* database not ready */ }
  };
  view._fill();
  setTimeout(() => input.focus(), 0);
  return view;
}
function refreshNewTabView(view) { if (view && view._fill) view._fill(); const input = view && view.querySelector('input'); if (input) setTimeout(() => input.focus(), 0); }

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6B: INTERNAL PAGES (about:bookmarks, about:history, about:shields)
// ═══════════════════════════════════════════════════════════════════════════════
// Full-page views rendered in the pane, no webview: the browser's own
// bookmarks, history and the tracker log, the way chrome://history and
// brave://adblock work. They read from the extension's SQLite and from the
// bridge, and refresh when the data changes.

const INTERNAL_TITLES = { 'about:newtab': 'New Tab', 'about:bookmarks': 'Bookmarks', 'about:history': 'History', 'about:shields': 'Blocked Trackers' };

function pageShell(title, subtitle) {
  const view = el('div', 'br-page');
  const head = el('div', 'br-page-head');
  head.appendChild(el('h2', null, { text: title }));
  if (subtitle) head.appendChild(el('div', 'br-muted', { text: subtitle }));
  view.appendChild(head);
  return view;
}
function pageTools(view) { const t = el('div', 'br-page-tools'); view.appendChild(t); return t; }
function table(headers) {
  const t = el('table', 'br-table');
  const tr = el('tr');
  for (const h of headers) tr.appendChild(el('th', h.num ? 'num' : null, { text: h.label }));
  t.appendChild(tr);
  return t;
}
function cell(text, cls) { return el('td', cls || null, { text }); }
function linkCell(text, onClick, title) {
  const td = el('td');
  const a = el('button', 'br-link', { type: 'button', text, title: title || text });
  a.addEventListener('click', onClick);
  td.appendChild(a);
  return td;
}
function fmtWhen(iso) {
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** kind: 'bookmarks' | 'history' | 'shields'. ctx: { navigate, openTab }. */
function buildInternalPage(kind, ctx) {
  if (kind === 'bookmarks') return buildBookmarksPage(ctx);
  if (kind === 'history') return buildHistoryPage(ctx);
  return buildShieldsPage(ctx);
}

function watchData(view, refresh) {
  const fn = () => { if (!view.isConnected) { _sidebarListeners.delete(fn); return; } refresh(); };
  _sidebarListeners.add(fn);
}

function buildBookmarksPage(ctx) {
  const view = pageShell('Bookmarks', 'Everything you starred. Click a title to open it here.');
  const tools = pageTools(view);
  const q = el('input', null, { type: 'text', placeholder: 'Filter bookmarks', 'aria-label': 'Filter bookmarks' });
  tools.appendChild(q);
  const body = el('div');
  view.appendChild(body);
  const refresh = async () => {
    let rows = [];
    try { rows = await Bookmarks.list(q.value.trim()); } catch { rows = []; }
    body.innerHTML = '';
    if (!rows.length) { body.appendChild(el('div', 'br-empty', { text: q.value ? 'No bookmarks match.' : 'No bookmarks yet. Press the star on a page to keep it.' })); return; }
    const t = table([{ label: 'Title' }, { label: 'Site' }, { label: 'Added' }, { label: '' }]);
    for (const bm of rows) {
      const tr = el('tr');
      tr.appendChild(linkCell(bm.title || bm.url, () => ctx.navigate(bm.url), bm.url));
      tr.appendChild(cell(hostOf(bm.url)));
      tr.appendChild(cell(fmtWhen(bm.created_at)));
      const act = el('td', 'num');
      act.appendChild(iconBtn('trash', 'Remove Bookmark', async () => { await Bookmarks.remove(bm.url); for (const p of _panes.values()) if (p.url === bm.url) p.bookmarked = false; notifySidebar(); }));
      tr.appendChild(act);
      t.appendChild(tr);
    }
    body.appendChild(t);
  };
  q.addEventListener('input', refresh);
  watchData(view, refresh);
  refresh();
  return view;
}

function buildHistoryPage(ctx) {
  const view = pageShell('History', 'Pages you visited in normal tabs. Private tabs leave nothing here.');
  const tools = pageTools(view);
  const q = el('input', null, { type: 'text', placeholder: 'Search history', 'aria-label': 'Search history' });
  const clear = el('button', 'br-action', { type: 'button', text: 'Clear History' });
  clear.addEventListener('click', async () => {
    const pick = await _api.window.showWarningMessage('Clear all browsing history?', { title: 'Clear History' }, { title: 'Cancel' });
    if (pick && pick.title === 'Clear History') { await History.clear(); notifySidebar(); }
  });
  tools.append(q, clear);
  const body = el('div');
  view.appendChild(body);
  const refresh = async () => {
    let rows = [];
    try { rows = q.value.trim() ? await History.search(q.value.trim(), 500) : await History.recent(500); } catch { rows = []; }
    body.innerHTML = '';
    if (!rows.length) { body.appendChild(el('div', 'br-empty', { text: q.value ? 'Nothing matches.' : 'No history yet.' })); return; }
    let day = null;
    let t = null;
    for (const h of rows) {
      const d = fmtDay(h.last_visit_at);
      if (d !== day) { day = d; body.appendChild(el('h3', 'br-page-day', { text: d })); t = table([{ label: 'Time' }, { label: 'Page' }, { label: 'Site' }, { label: 'Visits', num: true }, { label: '' }]); body.appendChild(t); }
      const tr = el('tr');
      tr.appendChild(cell(fmtTime(h.last_visit_at)));
      tr.appendChild(linkCell(h.title || h.url, () => ctx.navigate(h.url), h.url));
      tr.appendChild(cell(hostOf(h.url)));
      tr.appendChild(cell(String(h.visits), 'num'));
      const act = el('td', 'num');
      act.appendChild(iconBtn('x', 'Remove From History', async () => { await History.removeUrl(h.url); notifySidebar(); }));
      tr.appendChild(act);
      t.appendChild(tr);
    }
  };
  q.addEventListener('input', refresh);
  watchData(view, refresh);
  refresh();
  return view;
}

function buildShieldsPage() {
  const view = pageShell('Blocked Trackers', 'Every request the shields refused, from which page, and the lifetime totals. Nothing here ever reached the network.');
  const tools = pageTools(view);
  const refreshBtn = el('button', 'br-action', { type: 'button', text: 'Refresh' });
  const clearBtn = el('button', 'br-action', { type: 'button', text: 'Clear Log' });
  // The filter lists live here with the totals they produce, not in the sidebar.
  const listsBtn = el('button', 'br-action', { type: 'button', text: 'Refresh Lists', title: 'Fetch the latest filter lists now.' });
  listsBtn.addEventListener('click', async () => {
    const b = bridge();
    if (!b) return;
    listsBtn.disabled = true;
    try { _lists = await b.refreshLists(); } finally { listsBtn.disabled = false; }
    notifySidebar();
    for (const p of _panes.values()) p.onLists();
    refresh();
  });
  tools.append(refreshBtn, listsBtn, clearBtn);
  const headline = el('div', 'br-page-headline');
  view.appendChild(headline);
  const cols = el('div', 'br-page-cols');
  view.appendChild(cols);
  const left = el('div'); const right = el('div');
  cols.append(left, right);
  const refresh = async () => {
    const b = bridge();
    if (!b) { headline.textContent = 'Browser bridge unavailable.'; return; }
    let r;
    try { r = await b.blockedLog(); } catch { headline.textContent = 'Could not read the log.'; return; }
    headline.innerHTML = '';
    headline.appendChild(el('strong', null, { text: Number(r.total || 0).toLocaleString() }));
    headline.appendChild(el('span', 'br-muted', { text: ` trackers and ads blocked${r.since ? ` since ${new Date(r.since).toLocaleDateString()}` : ''}. ${listsLine()}` }));
    left.innerHTML = '';
    left.appendChild(el('h3', 'br-page-day', { text: 'Most Blocked' }));
    if (!r.top || !r.top.length) left.appendChild(el('div', 'br-empty', { text: 'Nothing blocked yet.' }));
    else {
      const t = table([{ label: 'Tracker' }, { label: 'Blocked', num: true }]);
      for (const row of r.top) { const tr = el('tr'); tr.appendChild(cell(row.host)); tr.appendChild(cell(Number(row.n).toLocaleString(), 'num')); t.appendChild(tr); }
      left.appendChild(t);
    }
    right.innerHTML = '';
    right.appendChild(el('h3', 'br-page-day', { text: 'Recent' }));
    if (!r.recent || !r.recent.length) right.appendChild(el('div', 'br-empty', { text: 'Nothing in this session yet.' }));
    else {
      const t = table([{ label: 'Time' }, { label: 'On Page' }, { label: 'Blocked' }]);
      for (const e of r.recent) { const tr = el('tr'); tr.appendChild(cell(new Date(e.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))); tr.appendChild(cell(e.page || '')); tr.appendChild(cell(e.popup ? e.host + ' (popup)' : (e.redirect ? e.host + ' (redirect)' : e.host))); t.appendChild(tr); }
      right.appendChild(t);
    }
  };
  refreshBtn.addEventListener('click', refresh);
  clearBtn.addEventListener('click', async () => {
    const pick = await _api.window.showWarningMessage('Clear the blocked-tracker log and totals?', { title: 'Clear Log' }, { title: 'Cancel' });
    if (pick && pick.title === 'Clear Log') { const b = bridge(); if (b) await b.clearBlockedLog(); refresh(); notifySidebar(); }
  });
  refresh();
  return view;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: READER MODE
// ═══════════════════════════════════════════════════════════════════════════════

/** Readability over the page's HTML. Returns { title, byline, content, length } or null. */
function readerArticle(html, url) {
  if (typeof Readability !== 'function') return null;
  let doc;
  try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); } catch { return null; }
  try { const base = doc.createElement('base'); base.href = url; doc.head.insertBefore(base, doc.head.firstChild); } catch { /* ignore */ }
  let article = null;
  try { article = new Readability(doc, { keepClasses: false }).parse(); } catch { article = null; }
  if (!article || !article.content || (article.length || 0) < 200) return null;
  return { title: article.title || '', byline: article.byline || '', content: sanitizeReaderHtml(article.content, url), length: article.length || 0 };
}
const READER_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'BR', 'HR', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DIV', 'SPAN', 'SECTION', 'ARTICLE', 'ASIDE', 'SUP', 'SUB', 'SMALL', 'CITE', 'Q', 'DL', 'DT', 'DD', 'TIME', 'ABBR', 'MARK', 'PICTURE', 'SOURCE']);
/** Allowlist tags and attributes; drop scripts, forms, embeds, handlers and javascript: URLs. Rendered in a scriptless sandbox on top of that. */
function sanitizeReaderHtml(html, baseUrl) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (!READER_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); walk(node); return; }
      for (const attr of [...child.attributes]) {
        const n = attr.name.toLowerCase();
        const v = attr.value;
        const keep = (n === 'href' && child.tagName === 'A') || (n === 'src' && (child.tagName === 'IMG' || child.tagName === 'SOURCE')) || n === 'alt' || n === 'title' || (n === 'srcset' && child.tagName === 'IMG') || n === 'colspan' || n === 'rowspan' || n === 'datetime';
        if (!keep) { child.removeAttribute(attr.name); continue; }
        if (n === 'href' || n === 'src') {
          let abs = '';
          try { abs = new URL(v, baseUrl).toString(); } catch { abs = ''; }
          if (!/^https?:/i.test(abs)) child.removeAttribute(attr.name); else child.setAttribute(attr.name, abs);
        }
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      if (child.tagName === 'IMG') child.setAttribute('loading', 'lazy');
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
function buildReaderView(article) {
  const frame = el('iframe', 'br-reader', { sandbox: '', title: 'Reader view', referrerpolicy: 'no-referrer' });
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
  const fg = cs.getPropertyValue('--vscode-editor-foreground').trim() || '#d4d4d4';
  const link = cs.getPropertyValue('--vscode-textLink-foreground').trim() || '#4daafc';
  const font = cs.getPropertyValue('--vscode-font-family').trim() || 'system-ui, sans-serif';
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'">
<style>html{background:${bg};color:${fg};font-family:${font};font-size:17px;line-height:1.65}body{max-width:720px;margin:0 auto;padding:40px 24px 80px}h1{font-size:28px;line-height:1.25;margin:0 0 6px}.byline{opacity:.65;font-size:13px;margin-bottom:28px}img{max-width:100%;height:auto;border-radius:4px}a{color:${link}}pre{overflow:auto;padding:12px;border-radius:6px;background:rgba(127,127,127,.12);font-size:14px}code{font-size:.95em}blockquote{margin:0;padding:0 0 0 16px;border-left:3px solid rgba(127,127,127,.4);opacity:.9}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid rgba(127,127,127,.3);padding:4px 8px}figure{margin:20px 0}figcaption{font-size:13px;opacity:.7}</style>
<h1>${esc(article.title)}</h1>${article.byline ? `<div class="byline">${esc(article.byline)}</div>` : ''}${article.content}`;
  return frame;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

function createSidebar(container) {
  injectStyles();
  const root = el('div', 'br-sidebar');
  container.appendChild(root);
  const top = el('div', 'br-sidebar-top');
  const newTab = el('button', 'br-action primary', { type: 'button', title: 'Open a new tab (Ctrl+T in a page)' });
  newTab.innerHTML = icon('plus', 14) + '<span>New Tab</span>';
  newTab.addEventListener('click', () => openTab());
  top.appendChild(newTab);
  const privateTab = el('button', 'br-action', { type: 'button', title: 'Open a private tab: no history, and its cookies vanish when the last private tab closes' });
  privateTab.innerHTML = icon('eye-closed', 14);
  privateTab.setAttribute('aria-label', 'New Private Tab');
  privateTab.addEventListener('click', () => openTab(undefined, { private: true }));
  top.appendChild(privateTab);
  // History is a page, not a sidebar list: no browser puts it in the sidebar.
  const historyBtn = el('button', 'br-action', { type: 'button', title: 'History (Ctrl+H in a page)' });
  historyBtn.innerHTML = icon('clock', 14);
  historyBtn.setAttribute('aria-label', 'History');
  historyBtn.addEventListener('click', () => openTab('about:history'));
  top.appendChild(historyBtn);
  root.appendChild(top);
  const scroll = el('div', 'br-sidebar-scroll');
  root.appendChild(scroll);

  // Sections start collapsed; one the user opens stays open for the session
  // (module memory outlives the view being rebuilt). Rebuilds are serialised
  // and coalesced: the burst of startup notifications used to run several
  // builds at once, each clearing the body and each appending its own empty
  // state, so "No bookmarks yet." showed twice.
  function section(title, iconName, buildBody) {
    const head = el('div', 'br-section-head');
    head.innerHTML = icon(iconName, 12);
    head.appendChild(el('span', null, { text: title }));
    const chev = el('span', 'br-chevron');
    chev.innerHTML = icon('chevron-down', 10);
    head.appendChild(chev);
    head.setAttribute('role', 'button');
    const body = el('div', 'br-section-body');
    const apply = () => {
      const c = !_sideOpen.has(title);
      head.classList.toggle('is-collapsed', c);
      body.classList.toggle('is-collapsed', c);
      head.setAttribute('aria-expanded', c ? 'false' : 'true');
    };
    head.addEventListener('click', () => { if (_sideOpen.has(title)) _sideOpen.delete(title); else _sideOpen.add(title); apply(); });
    apply();
    scroll.append(head, body);
    let chain = Promise.resolve();
    let queued = false;
    const refresh = () => {
      if (queued) return chain;
      queued = true;
      chain = chain.then(() => { queued = false; return buildBody(body); }).catch(() => {});
      return chain;
    };
    return { body, refresh };
  }
  const item = (title, meta, onOpen, iconName, actions) => {
    const row = el('div', 'br-item');
    row.innerHTML = icon(iconName || 'globe', 12);
    row.appendChild(el('span', 'br-item-title', { text: title }));
    if (meta) row.appendChild(el('span', 'br-item-meta', { text: meta }));
    for (const a of actions || []) { const b = iconBtn(a.icon, a.title, (e) => { e.stopPropagation(); a.handler(); }); row.appendChild(b); }
    if (onOpen) row.addEventListener('click', onOpen);
    return row;
  };

  // Bookmarks
  let bookmarkQuery = '';
  const bookmarks = section('Bookmarks', 'star', async (body) => {
    body.innerHTML = '';
    const tools = el('div', 'br-section-tools');
    const q = el('input', null, { type: 'text', placeholder: 'Filter bookmarks', 'aria-label': 'Filter bookmarks' });
    q.value = bookmarkQuery;
    q.addEventListener('input', () => { bookmarkQuery = q.value.trim(); bookmarks.refresh(); });
    tools.appendChild(q);
    body.appendChild(tools);
    let rows = [];
    try { rows = await Bookmarks.list(bookmarkQuery); } catch { rows = []; }
    if (!rows.length) { body.appendChild(el('div', 'br-empty', { text: bookmarkQuery ? 'No bookmarks match.' : 'No bookmarks yet.' })); return; }
    const list = el('div', 'br-list');
    for (const bm of rows) list.appendChild(item(bm.title || bm.url, hostOf(bm.url), () => openTab(bm.url), 'star', [{ icon: 'trash', title: 'Remove Bookmark', handler: async () => { await Bookmarks.remove(bm.url); for (const p of _panes.values()) if (p.url === bm.url) { p.bookmarked = false; } notifySidebar(); } }]));
    body.appendChild(list);
    if (q.value) setTimeout(() => { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 0);
  });

  // Downloads
  const downloads = section('Downloads', 'download', async (body) => {
    body.innerHTML = '';
    let rows = [];
    try { rows = await Downloads.list(); } catch { rows = []; }
    const tools = el('div', 'br-section-tools');
    const clear = el('button', 'br-action', { type: 'button', text: 'Clear List' });
    clear.addEventListener('click', async () => { await Downloads.clear(); notifySidebar(); });
    tools.appendChild(el('span', 'br-empty', { text: rows.length ? `${rows.length} download${rows.length === 1 ? '' : 's'}` : 'No downloads yet.' }));
    if (rows.length) tools.appendChild(clear);
    body.appendChild(tools);
    const b = bridge();
    const list = el('div', 'br-list');
    for (const d of rows) {
      const stateText = d.state === 'completed' ? fmtBytes(d.received) : (d.state === 'progressing' ? `${fmtBytes(d.received)}${d.total ? ` of ${fmtBytes(d.total)}` : ''}` : d.state);
      const actions = [{ icon: 'external-link', title: 'Show In Folder', handler: () => { if (b) b.showDownload(d.path); } }];
      if (d.state !== 'progressing' && d.path) actions.push({ icon: 'trash', title: 'Delete File', handler: () => deleteDownload(d) });
      const row = item(d.filename, stateText, () => { if (b && d.state === 'completed') b.openDownload(d.path); }, 'download', actions);
      if (d.state === 'progressing' && d.total > 0) { const bar = el('div', 'br-dlbar'); const fill = el('div'); fill.style.width = `${Math.round((d.received / d.total) * 100)}%`; bar.appendChild(fill); row.appendChild(bar); }
      list.appendChild(row);
    }
    body.appendChild(list);
  });

  // Site settings
  const sitesSec = section('Site Settings', 'settings', async (body) => {
    body.innerHTML = '';
    const b = bridge();
    if (!b) { body.appendChild(el('div', 'br-empty', { text: 'Browser bridge unavailable.' })); return; }
    const [sites, perms] = await Promise.all([b.listSites(), b.listPermissions()]);
    const bySite = new Map();
    for (const s of sites) bySite.set(s.key, { settings: s.settings, perms: [] });
    for (const p of perms) { const e = bySite.get(p.site) || { settings: null, perms: [] }; e.perms.push(p); bySite.set(p.site, e); }
    if (!bySite.size) { body.appendChild(el('div', 'br-empty', { text: 'No site has custom settings. Shields are up, third-party cookies blocked, HTTPS upgraded everywhere.' })); return; }
    const list = el('div', 'br-list');
    for (const [site, e] of bySite) {
      const bits = [];
      if (e.settings) { if (!e.settings.shields) bits.push('shields down'); if (e.settings.cookies !== 'block-third-party') bits.push(e.settings.cookies === 'allow' ? 'all cookies' : 'no cookies'); if (!e.settings.https) bits.push('no HTTPS upgrade'); if (e.settings.redirects) bits.push('redirects allowed'); }
      for (const p of e.perms) bits.push(`${p.permission}: ${p.decision}`);
      list.appendChild(item(site, bits.join(', ') || 'default', () => openTab(`https://${site}/`), 'shield', [{ icon: 'x', title: 'Reset Site', handler: async () => { await b.resetSite(`https://${site}/`); notifySidebar(); } }]));
    }
    body.appendChild(list);
  });

  function refreshAll() {
    bookmarks.refresh(); downloads.refresh(); sitesSec.refresh();
  }
  refreshAll();
  _sidebarListeners.add(refreshAll);
  return { dispose() { _sidebarListeners.delete(refreshAll); container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: COMMANDS AND BRIDGE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

function withActive(fn) { if (_activePane && !_activePane.disposed) fn(_activePane); else openTab(); }

function registerCommands(api, context) {
  const reg = (id, handler) => context.subscriptions.push(api.commands.registerCommand(id, handler));
  // Ctrl+T from a private tab opens a private tab; the sidebar's New Tab button stays regular.
  reg('browser.newTab', () => openTab(undefined, { private: !!(_activePane && !_activePane.disposed && _activePane.isPrivate) }));
  reg('browser.newPrivateTab', () => openTab(undefined, { private: true }));
  reg('browser.openBookmarks', () => withActive((p) => p.navigate('about:bookmarks')));
  reg('browser.openHistory', () => withActive((p) => p.navigate('about:history')));
  reg('browser.openShields', () => withActive((p) => p.navigate('about:shields')));
  reg('browser.openUrl', (...args) => { const u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url); return openTab(u || undefined); });
  reg('browser.focusAddress', () => withActive((p) => p.focusAddress()));
  reg('browser.find', () => withActive((p) => p.openFind()));
  reg('browser.reload', () => withActive((p) => p.reload()));
  reg('browser.back', () => withActive((p) => p.goBack()));
  reg('browser.forward', () => withActive((p) => p.goForward()));
  reg('browser.bookmark', () => withActive((p) => p.toggleBookmark()));
  reg('browser.zoomIn', () => withActive((p) => p.zoomBy(1)));
  reg('browser.zoomOut', () => withActive((p) => p.zoomBy(-1)));
  reg('browser.zoomReset', () => withActive((p) => p.zoomBy(0)));
  reg('browser.toggleReader', () => withActive((p) => p.toggleReader()));
  reg('browser.sendToChat', () => withActive((p) => p.sendToChat()));
  reg('browser.clearData', () => clearBrowsingData());
  reg('browser.clearAgentData', () => clearAgentData());
  reg('browser.refreshLists', async () => { const b = bridge(); if (b) { _lists = await b.refreshLists(); notifySidebar(); for (const p of _panes.values()) p.onLists(); } });
}

function subscribeBridge() {
  const b = bridge();
  if (!b) return;
  b.getState().then((s) => { if (s && s.lists) { _lists = s.lists; notifySidebar(); } }).catch(() => {});
  _unsubscribeBridge = b.onEvent(({ type, payload }) => {
    if (type === 'view:event') {
      const p = _panes.get(payload.tabId);
      if (p && !p.disposed) p.onViewEvent(payload);
      // A sign-in no pane can show would hold the page for minutes: refuse it now.
      else if (payload.type === 'auth-request' && payload.id) V('authCancel', payload.tabId, payload.id).catch(() => {});
    }
    else if (type === 'blocked') { const p = _panesByWc.get(payload.webContentsId); if (p) p.onBlocked(payload); }
    else if (type === 'open-url') {
      // A popup or target=_blank link inherits the privacy of the tab that opened it.
      if (payload && payload.url && /^(https?|about):/i.test(payload.url)) {
        const opener = payload.openerId != null ? _panesByWc.get(payload.openerId) : null;
        if (opener && opener.isAgent) return; // an assistant popup is an assistant tab (the broker's)
        openTab(payload.url, { private: !!(opener && !opener.disposed && opener.isPrivate) });
      }
    }
    else if (type === 'permission-request') { const p = _panesByWc.get(payload.webContentsId) || _activePane; if (p) p.onPermission(payload); else b.permissionReply(payload.requestId, false, false); }
    else if (type === 'download') {
      // The assistant's downloads belong to its run (kept with its artifacts), not your download list.
      if (payload && payload.assistant) return;
      Downloads.upsert(payload).then(notifySidebar).catch(() => {});
      if (payload.state === 'completed') _api.window.showInformationMessage(`Downloaded ${payload.filename}`);
      else if (payload.state === 'failed') _api.window.showWarningMessage(`Download failed: ${payload.filename}`);
    }
    else if (type === 'lists') { _lists = payload; notifySidebar(); for (const p of _panes.values()) p.onLists(); }
  });
}

// Native page views sit above the whole DOM. While anything is being dragged
// (a tab, a file, a resize sash) the document must receive every mouse event
// and every drop indicator must be visible, so all pages freeze into their
// snapshots for the duration and come back on release.
let _frozen = false;
function freezePages() { if (_frozen) return; _frozen = true; for (const p of _panes.values()) { if (!p.disposed && p.freeze) p.freeze(); } }
function thawPages() { if (!_frozen) return; _frozen = false; for (const p of _panes.values()) { if (!p.disposed && p.thaw) p.thaw(); } }
/** The app surface colour: what a tab shows between two documents until it knows its page's colour. */
function surfaceColor() {
  const token = getComputedStyle(document.documentElement).getPropertyValue('--px-bg').trim();
  if (/^(#[0-9a-f]{3,8}|rgba?\()/i.test(token)) return token;
  // Last resorts only: the body's painted colour, then the default dark surface.
  return getComputedStyle(document.body).backgroundColor || 'rgb(22, 23, 26)';
}
/** When the app theme changes, tabs still on the app surface follow it. */
function installThemeHook() {
  const obs = new MutationObserver(() => {
    for (const p of _panes.values()) if (!p.disposed && p.hasView && !p.pageColor) V('background', p.tabId, surfaceColor()).catch(() => {});
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-px-mode', 'data-px-theme', 'class'] });
  return () => obs.disconnect();
}
function installDragHooks() {
  const onDragStart = () => freezePages();
  const onDragDone = () => thawPages();
  const onMouseDown = (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.closest('.grid-sash')) return;
    freezePages();
    const up = () => { window.removeEventListener('mouseup', up, true); thawPages(); };
    window.addEventListener('mouseup', up, true);
  };
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragend', onDragDone, true);
  document.addEventListener('drop', onDragDone, true);
  document.addEventListener('mousedown', onMouseDown, true);
  return () => {
    document.removeEventListener('dragstart', onDragStart, true);
    document.removeEventListener('dragend', onDragDone, true);
    document.removeEventListener('drop', onDragDone, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    thawPages();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: ACTIVATION
// ═══════════════════════════════════════════════════════════════════════════════

export async function activate(api, context) {
  _api = api;
  if (!api.database) { console.error('[browser] api.database is required'); return; }
  const open = await api.database.open();
  if (open.error) { console.error('[browser] database open failed:', open.error.message); return; }
  const toolPath = api.env.toolPath;
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const mig = await api.database.migrate(`${toolPath}${sep}db${sep}migrations`);
  if (mig.error) { console.error('[browser] migration failed:', mig.error.message); return; }
  _dbBridge = api.database;
  await hardenDb();
  Tabs.prune().catch(() => {});
  // The browser itself (sessions, shields, ad-block lists) exists in the main
  // process only while this extension runs: started here, stopped on deactivate.
  try { const b = bridge(); if (b && b.start) await b.start(); } catch (err) { console.warn('[browser] could not start the browser:', err && err.message); }

  context.subscriptions.push(api.editors.registerEditorProvider(EDITOR_TYPE, {
    createEditorPane(container, input) {
      const id = (input && (input.instanceId || input.id)) || '';
      const opts = id.startsWith('agent:') ? { agent: true } : (id.startsWith('private:') ? { partition: PRIVATE_PARTITION, private: true } : {});
      return createPagePane(container, input, opts);
    },
  }));
  context.subscriptions.push(api.views.registerViewProvider('browser.sidebar', {
    createView(container) { return createSidebar(container); },
  }));
  registerCommands(api, context);
  registerAutomationHost(api, context);
  subscribeBridge();
  context.subscriptions.push({ dispose: installDragHooks() });
  context.subscriptions.push({ dispose: installThemeHook() });
  pushAnnoyances();
  pushInAppLinks();
  pushHoldRedirects();
  // Page views outlive panes; a view whose editor is gone is destroyed here,
  // whether the pane was mounted when the tab closed or not.
  const reconcileViews = async () => {
    let list = [];
    try { list = await V('list', null); } catch { return; }
    const open = (api.editors.openEditors || []).map((e) => String(e.id || ''));
    for (const v of list) {
      if (_panes.has(v.tabId)) continue;
      if (v.owned && !_agentShown.has(v.tabId)) continue; // its tab is still being opened
      if (!open.some((id) => id.endsWith(v.tabId))) V('destroy', v.tabId).catch(() => {});
    }
    if (!privateEditorsOpen() && list.some((v) => v.kind === 'private')) { const b = bridge(); if (b) b.clearData('private').catch(() => {}); }
  };
  if (api.editors.onDidChangeOpenEditors) context.subscriptions.push(api.editors.onDidChangeOpenEditors(() => { setTimeout(reconcileViews, 900); }));
  setTimeout(reconcileViews, 1500);
  if (api.workspace.onDidChangeConfiguration) {
    context.subscriptions.push(api.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('browser.pageTheme')) for (const p of _panes.values()) applyPageTheme(p);
      if (e.affectsConfiguration('browser.blockAnnoyances')) pushAnnoyances();
      if (e.affectsConfiguration('browser.openLinksInApp')) pushInAppLinks();
      if (e.affectsConfiguration('browser.holdRedirects')) pushHoldRedirects();
      if (e.affectsConfiguration('browser.showBookmarksBar')) { _bookmarksBarOverride = null; notifySidebar(); }
      if (e.affectsConfiguration('browser.homepage')) _homepageOverride = null;
    }));
  }
  if (!bridge()) console.warn('[browser] the browser bridge is missing; pages will load but shields, permissions and downloads are inactive');
}

export function deactivate() {
  pushInAppLinks(false);
  try { if (_unsubscribeBridge) _unsubscribeBridge(); } catch { /* ignore */ }
  _unsubscribeBridge = null;
  const b = bridge();
  if (b && cfg('clearOnExit', false)) { try { b.clearData('user'); } catch { /* ignore */ } }
  // Turned off: no list checks or sweeps run for it any more.
  if (b && b.stop) { try { void b.stop(); } catch { /* ignore */ } }
  dismissMenu();
  _panes.clear(); _panesByWc.clear(); _livePanes.clear(); _sidebarListeners.clear();
  const style = document.getElementById('browser-styles');
  if (style) style.remove();
  _styleInjected = false;
  _api = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: ASSISTANT BROWSER HOST (docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md)
// ═══════════════════════════════════════════════════════════════════════════════
// The assistant browses in its own tabs on the agent partition: none of the
// user's cookies or logins. This extension brings the assistant's tools
// (AUTOMATION_TOOLS below: names, descriptions, parameters, the broker
// operation each runs) when it registers as the HOST. The core
// (src/services/browserAutomationService.ts) registers them for it and runs
// each call through the main process (electron/browserAutomationBroker.cjs),
// which creates each tab's page, reads it through the accessibility tree and
// acts with real input. The core, not this file, decides what reaches the
// broker: the call's identity, only the declared arguments, and confirmation
// for anything that acts on a page. The host shows those tabs as editor panes,
// shows the run's state on each, and gives the user Pause, Take Over, Hand Back
// and Stop. It cannot start a run or act on a page. While it is registered the
// tools exist; disabling the Browser removes them and ends any run.

const AGENT_REF = { type: 'string', description: 'A target reference from the latest browserRead, like "e12".' };
const AGENT_INDEX = { type: 'integer', description: 'Legacy: the target\'s number (i) in the latest read. Prefer ref.' };
const AGENT_KEYS = ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'Delete', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

/** The assistant's browser tools, registered through the host (contract section 1). */
export const AUTOMATION_TOOLS = [
  {
    name: 'browserOpen', op: 'open', requiresConfirmation: false,
    description: 'Open a web page in the Assistant Browser: a tab the user can watch, always in a private session (a throwaway profile for this chat, separate from the user\'s browsing, that keeps nothing: cookies, sign-ins, site data, captures and unsaved downloads go when its last tab closes). Returns JSON with the page text and its targets (links, buttons, fields), each with a ref such as "e12" for browserClick, browserType and browserAct. Only http(s) addresses. One chat uses the Assistant Browser at a time. Prefer webSearch or webFetch for plain reading; use the browser when a page needs interaction.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'An http(s) address.' },
        newTab: { type: 'boolean', description: 'Open in a new assistant tab instead of the current one.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browserRead', op: 'read', requiresConfirmation: false,
    description: 'Read the current Assistant Browser page again: text and targets with fresh refs. find lists only targets whose role or name contains the words; from pages through more targets; scope "targets" or "text" returns only that part. When the text is truncated, pass next.textFrom as textFrom to read the text that follows. References from older reads can be refused as stale.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string' },
        from: { type: 'integer' },
        scope: { type: 'string', enum: ['all', 'targets', 'text'] },
        textFrom: { type: 'integer', description: 'Character offset in the page text to start from: next.textFrom of a truncated read.' },
      },
    },
  },
  {
    name: 'browserClick', op: 'click', requiresConfirmation: true,
    description: 'Click a target by ref with a real mouse click. Returns what happened (navigated, page changed, popup, download, dialog or no visible change) and the page afterwards. A stale, hidden or covered target is refused, never swapped for another element. A click that reached a site cannot be undone.',
    parameters: { type: 'object', properties: { ref: AGENT_REF, index: AGENT_INDEX } },
  },
  {
    name: 'browserType', op: 'type', requiresConfirmation: true,
    description: 'Type into a text field or editor by ref, replacing its contents; submit presses Enter afterwards. Password and one-time-code fields are refused: the user types those into the Assistant Browser themselves.',
    parameters: { type: 'object', properties: { ref: AGENT_REF, index: AGENT_INDEX, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['text'] },
  },
  {
    name: 'browserBack', op: 'back', requiresConfirmation: false,
    description: 'Go back one page in the current assistant tab and return the page.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'browserAct', op: 'act', requiresConfirmation: true,
    description: 'Other actions: check (a checkbox, radio or switch to checked true or false), select (a dropdown option by value or label), press (a key, optionally on a ref), hover, scroll (a ref into view, or the page up or down without one), dialog (accept or dismiss an open alert, confirm or prompt; text answers a prompt), click_at (x, y in a browserCapture image, with its captureId, for something that has no ref), download (a link\'s file or a picture, by ref, into the assistant\'s run folder; pictures the page names are image targets; browserWait for "download" says when it finishes), save_download (give a finished download to the user: a copy in their Downloads, by its file name). To get a picture or file for the user, use download then save_download, never a screenshot.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['check', 'select', 'press', 'hover', 'scroll', 'dialog', 'click_at', 'download', 'save_download'] },
        ref: AGENT_REF, index: AGENT_INDEX,
        checked: { type: 'boolean' }, value: { type: 'string' }, label: { type: 'string' },
        key: { type: 'string', enum: AGENT_KEYS }, direction: { type: 'string', enum: ['up', 'down'] },
        accept: { type: 'boolean' }, text: { type: 'string' },
        captureId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
        file: { type: 'string', description: 'save_download: the file name of a finished download (from its download evidence).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'browserTabs', op: 'tabs', requiresConfirmation: false,
    description: 'List, switch to, or close this chat\'s assistant tabs. A popup a page opens becomes a new assistant tab.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'switch', 'close'] }, tab: { type: 'string' } } },
  },
  {
    name: 'browserWait', op: 'wait', requiresConfirmation: false,
    description: 'Wait for a condition on the current page: load, url (contains value), text (value appears), gone (value disappears) or download (finishes). Returns as soon as it holds; timeoutMs up to 30000. A timeout is an error, not a success.',
    parameters: { type: 'object', properties: { for: { type: 'string', enum: ['load', 'url', 'text', 'gone', 'download'] }, value: { type: 'string' }, timeoutMs: { type: 'integer' } }, required: ['for'] },
  },
  {
    name: 'browserCapture', op: 'capture', requiresConfirmation: false,
    description: 'Capture the visible Assistant Browser page as an image you can see (models with vision only). Use it when a page cannot be understood from its text and targets; click something in it with browserAct click_at.',
    parameters: { type: 'object', properties: {} },
  },
];

const AGENT_BANNER_PRIVATE = 'A private session: it shares nothing with your logins or the assistant\'s usual profile, and nothing it keeps survives its last private tab closing. Clicks and typing follow your chat\'s approval settings.';
const AGENT_BANNER_IDLE = 'The assistant\'s own profile: none of your logins or cookies. Clicks and typing follow your chat\'s approval settings.';

let _automation = null;             // the host registration
const _agentRunByTab = new Map();   // tabId -> the latest run state
const _agentRunByChat = new Map();  // chatSessionId -> the latest run state
const _agentShown = new Set();      // tabIds whose editor this host opened
const _agentPrivate = new Set();    // assistant tabs in a private session (browserOpen private: true)

function agentEditorId(tabId) {
  try {
    const d = (_api.editors.openEditors || []).find((x) => typeof x.id === 'string' && x.id.endsWith(`:${tabId}`));
    return d ? d.id : null;
  } catch { return null; }
}
async function openAgentTab(tabId, priv) {
  _agentShown.add(tabId);
  if (priv) _agentPrivate.add(tabId);
  const isPriv = _agentPrivate.has(tabId);
  await _api.editors.openEditor({ typeId: EDITOR_TYPE, title: isPriv ? 'Private Assistant Browser' : 'Assistant Browser', icon: isPriv ? 'eye-closed' : 'globe', instanceId: tabId });
}
function agentControl(action) {
  if (_automation) _automation.control(action).catch(() => {});
}
/** The user moved an assistant tab's page (navigate, back, forward, reload from anywhere): that is taking over. */
function agentUserDrove(pane) {
  const s = _agentRunByTab.get(pane.tabId);
  if (s && (s.state === 'running' || (s.state === 'paused' && s.by !== 'user'))) agentControl('takeover');
}
function renderAgentBanner(banner, s) {
  if (!banner) return;
  const stateEl = banner.querySelector('.br-agent-state');
  const note = banner.querySelector('.br-agent-note');
  const actions = banner.querySelector('.br-agent-actions');
  // The buttons are rebuilt only when the state changes. The note changes on
  // every action of a run, and a button replaced between mousedown and mouseup
  // loses the click (and its keyboard focus).
  const key = s && (s.state === 'running' || s.state === 'paused') ? `${s.state}:${s.by === 'user' ? 'user' : ''}` : 'idle';
  if (banner.dataset.key === key) {
    if (key.startsWith('running')) note.textContent = s.note || 'The assistant is using this tab.';
    return;
  }
  banner.dataset.key = key;
  actions.innerHTML = '';
  const button = (text, title, action, primary) => {
    const b = el('button', primary ? 'primary' : null, { type: 'button', text, title });
    b.addEventListener('click', () => agentControl(action));
    actions.appendChild(b);
  };
  if (s && s.state === 'running') {
    stateEl.textContent = 'Assistant Working';
    note.textContent = s.note || 'The assistant is using this tab.';
    button('Pause', 'Stop between actions. Nothing already sent to a site is undone.', 'pause');
    button('Take Over', 'Use the page yourself. The assistant waits until you hand it back.', 'takeover');
    button('Stop', 'End the assistant\'s run in the browser.', 'stop');
  } else if (s && s.state === 'paused') {
    const byUser = s.by === 'user';
    stateEl.textContent = byUser ? 'You Have Control' : 'Paused';
    note.textContent = byUser ? 'The assistant waits until you hand the page back.' : 'The assistant waits between actions.';
    button(byUser ? 'Hand Back' : 'Resume', byUser ? 'Let the assistant continue from the page as it is now.' : 'Let the assistant continue.', 'resume', true);
    button('Stop', 'End the assistant\'s run in the browser.', 'stop');
  } else {
    const priv = banner.dataset.private === '1';
    stateEl.textContent = priv ? 'Private Assistant Browser' : 'Assistant Browser';
    note.textContent = priv ? AGENT_BANNER_PRIVATE : AGENT_BANNER_IDLE;
  }
}

function registerAutomationHost(api, context) {
  if (!api.browser || typeof api.browser.registerAutomationHost !== 'function') {
    console.warn('[browser] the automation host API is missing; the assistant\'s browser tools are off');
    return;
  }
  // The registration, the tools it brings included, is tied to this
  // extension's lifetime by the API itself.
  _automation = api.browser.registerAutomationHost({
    // A new tab of a chat whose run is live (a popup, a second tab) shows that
    // run's state from its first frame, not the idle banner.
    openTab: (tab) => {
      const s = tab.chatSessionId ? _agentRunByChat.get(tab.chatSessionId) : null;
      if (s && s.state !== 'idle' && !_agentRunByTab.has(tab.tabId)) _agentRunByTab.set(tab.tabId, s);
      return openAgentTab(tab.tabId, tab.private === true);
    },
    // Show the tab where it already is: never a second copy in the active
    // group, and never again once the user closed it (the broker pauses the
    // run when its page goes). The page view comes back on show if the user
    // had left it for the New Tab page or an about: page.
    revealTab: async (tabId) => {
      const id = agentEditorId(tabId);
      if (!id) return;
      try { await _api.editors.focusEditor(id); } catch { return; }
      const p = _panes.get(tabId);
      if (p && !p.disposed && p.showView) p.showView();
    },
    closeTab: async (tabId) => {
      _agentRunByTab.delete(tabId);
      const id = agentEditorId(tabId);
      if (id) await _api.editors.closeEditor(id);
      _agentShown.delete(tabId);
    },
    setRunState: (s) => {
      if (s.chatSessionId) _agentRunByChat.set(s.chatSessionId, s);
      for (const tabId of s.tabs || []) {
        _agentRunByTab.set(tabId, s);
        const p = _panes.get(tabId);
        if (p && !p.disposed && p.setRunState) p.setRunState(s);
      }
    },
  }, AUTOMATION_TOOLS);
  context.subscriptions.push({ dispose: () => { _automation = null; _agentRunByTab.clear(); _agentRunByChat.clear(); _agentShown.clear(); } });
}
