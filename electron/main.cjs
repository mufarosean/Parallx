// electron/main.cjs — Electron main process
// Uses CommonJS because Electron's main process doesn't support ESM by default.

// Widen libuv's async-I/O worker pool BEFORE anything can use it — the pool is
// sized once, on first use, from this env var (default: 4 threads). EVERY
// async fs.* call in this process shares the pool: thumbnail reads, the media
// organizer's exists/stat polling, document extraction. With only 4 slots, a
// handful of slow stats against a saturated disk (e.g. while Eraser runs a
// multi-pass secure overwrite) queues every other fs IPC behind them and the
// whole app feels laggy. worker_threads and child processes spawned later
// inherit the env var too.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(Math.min(32, Math.max(8, require('os').cpus().length)));
}

const { app, BrowserWindow, ipcMain, dialog, shell, screen, safeStorage, nativeImage, session, desktopCapturer, protocol } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
// SQLite runs in a worker thread (databaseWorker.cjs) so its synchronous
// execution never blocks the main process, which routes user input.  These
// are async proxies with the same API (see databaseClient.cjs).
const { databaseManager, extensionDatabaseManager } = require('./databaseClient.cjs');
const { extractText, extractEpubReadingData, extractDocxReadingData, extractSpreadsheetReadingData, isRichDocument, RICH_DOCUMENT_EXTENSIONS } = require('./documentExtractor.cjs');
const doclingBridge = require('./doclingBridge.cjs');
const { setupMcpBridge, killAllMcpProcesses } = require('./mcpBridge.cjs');
const { setupStorageHandlers } = require('./storageHandlers.cjs');
const { setupWebFetchBridge } = require('./webFetchBridge.cjs');
const { setupGoogleSyncBridge } = require('./googleSyncBridge.cjs');
const { registerDashboardAssetScheme, setupDashboardAssetBridge } = require('./dashboardAssetBridge.cjs');

// The parallx-asset:// scheme (dashboard image/GIF assets) must be registered
// as privileged BEFORE app 'ready'; the handler itself is wired in whenReady.
registerDashboardAssetScheme(protocol);
const { setupAnthropicBridge } = require('./anthropicBridge.cjs');

// ════════════════════════════════════════════════════════════════════════════════
// Workspace Teardown Registry
// ════════════════════════════════════════════════════════════════════════════════
//
// Central registry for workspace-scoped cleanup. Subsystems register their
// teardown function ONCE when they initialize. Both workspace:prepareSwitch
// (renderer reload) and before-quit (app exit) drain the same list — so new
// subsystems only need to add one registration and they're automatically
// cleaned up in both paths.
//
// Two scopes:
//   'workspace' — runs on BOTH workspace switch AND app quit
//   'appQuit'   — runs ONLY on app quit (e.g. renderer server, docling)

const _teardownCallbacks = [];

/**
 * Register a teardown callback for workspace-scoped state cleanup.
 *
 * @param {string} name — Human-readable name for logging.
 * @param {'workspace'|'appQuit'} scope — When to run: 'workspace' = both paths, 'appQuit' = quit only.
 * @param {() => void | Promise<void>} fn — Cleanup function. Errors are caught and logged.
 */
function registerTeardown(name, scope, fn) {
  _teardownCallbacks.push({ name, scope, fn });
}

/**
 * Run all registered teardown callbacks for the given trigger.
 * MUST remain synchronous — Electron's before-quit does not await async callbacks.
 * All registered teardown functions must be synchronous (execSync, close(), etc.).
 * @param {'workspaceSwitch'|'appQuit'} trigger
 */
function runTeardown(trigger) {
  for (const { name, scope, fn } of _teardownCallbacks) {
    // 'workspace' callbacks run in both triggers; 'appQuit' only on quit
    if (scope === 'appQuit' && trigger !== 'appQuit') continue;
    try {
      fn();
    } catch (err) {
      console.warn(`[Teardown] "${name}" failed:`, err.message);
    }
  }
  console.log(`[Teardown] ${trigger} complete (${_teardownCallbacks.length} registered)`);
}

// ── Register core subsystem teardowns ──

registerTeardown('mcp-servers', 'workspace', () => {
  killAllMcpProcesses();
});

registerTeardown('shared-database', 'workspace', () => {
  // Async proxy; WAL-mode SQLite recovers cleanly if quit outruns the close.
  void databaseManager.close().catch(() => {});
});

registerTeardown('extension-databases', 'workspace', () => {
  // NOTE: do NOT disposeDatabaseWorker() here — this teardown also fires on
  // workspace SWITCH, and terminating the worker races the queued close()
  // (a killed thread can leak a locked DB file handle on Windows).  The
  // worker is long-lived and unref'd; process exit reaps it at quit.
  // (disposeDatabaseWorker stays exported for tests/dev tooling.)
  void extensionDatabaseManager.closeAll().catch(() => {});
});

// Docling is app-global — shutting down on workspace switch is unnecessary
// since it's a stateless document conversion service.
registerTeardown('docling', 'appQuit', () => {
  try { doclingBridge.stopServiceSync(); } catch { /* best-effort */ }
});

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('http').Server | null} */
let rendererServer = null;
/** @type {number | null} */
let rendererServerPort = null;
/** @type {Set<import('net').Socket>} Track open sockets so we can force-destroy them at quit */
const _rendererSockets = new Set();
let isAppQuitting = false;
let lastEditableContextMenu = null;

registerTeardown('renderer-server', 'appQuit', () => {
  if (rendererServer) {
    for (const socket of _rendererSockets) {
      try { socket.destroy(); } catch { /* ignore */ }
    }
    _rendererSockets.clear();
    try { rendererServer.close(); } catch { /* ignore */ }
    rendererServer = null;
    rendererServerPort = null;
  }
});

app.setAppUserModelId('com.parallx.app');
app.name = 'Parallx';

// ── M53: Portable data root ──────────────────────────────────────────────────
const APP_ROOT = app.isPackaged
  ? path.resolve(process.resourcesPath, '..')
  : path.join(__dirname, '..');

fsSync.mkdirSync(path.join(APP_ROOT, 'data', 'chromium-cache'), { recursive: true });
fsSync.mkdirSync(path.join(APP_ROOT, 'data', 'extensions'), { recursive: true });
fsSync.mkdirSync(path.join(APP_ROOT, 'data', 'tmp'), { recursive: true });

// Redirect every Electron-managed write location into APP_ROOT/data so the
// install folder is fully self-contained. `userData` is the big one (Chromium
// cache, localStorage, dictionary, preferences). The others rarely contain
// data in practice, but pointing them all at APP_ROOT prevents any future
// Electron upgrade from spontaneously starting to write %APPDATA% or %TEMP%.
//
// Must run before `app.whenReady()` AND before any code calls `app.getPath`
// for these keys \u2014 hence the position at module top level.
// `PARALLX_USER_DATA` lets tests/CI point userData (and thus localStorage —
// where the last-opened workspace lives) at a throwaway dir, so an automated
// launch never touches a real workspace or collides with a running instance.
const USER_DATA_DIR = process.env.PARALLX_USER_DATA || path.join(APP_ROOT, 'data', 'chromium-cache');
app.setPath('userData', USER_DATA_DIR);
// `sessionData` was split out from `userData` in Electron 26+. Defaults to
// userData so this is mostly belt-and-suspenders, but pin it explicitly.
try { app.setPath('sessionData', USER_DATA_DIR); } catch { /* older electron */ }
// Crash dumps would otherwise land in %LOCALAPPDATA%\Temp\<AppName> Crashes.
// We don't enable the crash reporter, but if anything ever does, redirect it.
try { app.setPath('crashDumps', path.join(APP_ROOT, 'data', 'crash-dumps')); } catch { /* ignore */ }
// `logs` is used by Electron's built-in logging facilities (none active here)
// and by some native modules. Pin it to be safe.
try { app.setPath('logs', path.join(APP_ROOT, 'data', 'logs')); } catch { /* ignore */ }

// One database owner per user-data root. Multiple Parallx instances can hold
// different in-memory Canvas documents and autosave stale content over each
// other, which no renderer-local revision guard can prevent.
// Test mode is exempt: the e2e harness launches Electron against the shared
// user-data dir (and can overlap a dev instance), and must never be quit by
// the lock.
const HAS_SINGLE_INSTANCE_LOCK = process.env.PARALLX_TEST_MODE === '1'
  ? true
  : app.requestSingleInstanceLock({ userData: USER_DATA_DIR });

// True once the renderer commits a window close (lifecycle:closing) or the
// app enters before-quit. While teardown runs, this process still holds the
// single-instance lock, so a user relaunch would otherwise just die (and the
// old handler would re-SHOW the hidden, half-torn-down window). Instead:
// queue ONE app.relaunch() so a fresh instance starts the moment this
// process finally exits.
let _closingDown = false;
let _relaunchQueued = false;

if (!HAS_SINGLE_INSTANCE_LOCK) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (_closingDown || isAppQuitting) {
      if (!_relaunchQueued) {
        _relaunchQueued = true;
        app.relaunch();
        console.log('[Main] Relaunch queued — user reopened while the previous instance was shutting down');
      }
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

ipcMain.on('lifecycle:closing', () => {
  _closingDown = true;
});

setupStorageHandlers(ipcMain, APP_ROOT);
setupWebFetchBridge(ipcMain, APP_ROOT, _readSecretString);
setupGoogleSyncBridge(ipcMain, APP_ROOT, {
  readSecret: _readSecretString,
  writeSecret: _writeSecretString,
  deleteSecret: _deleteSecretString,
});
setupAnthropicBridge(ipcMain, {
  readSecret: _readSecretString,
  writeSecret: _writeSecretString,
  deleteSecret: _deleteSecretString,
});
doclingBridge.setAppRoot(APP_ROOT);

const USER_EXTENSIONS_DIR = path.join(APP_ROOT, 'data', 'extensions');

const RENDERER_ROOT = path.join(__dirname, '..');
const DEFAULT_RENDERER_PORT = 31789;
const IS_TEST_MODE = process.env.PARALLX_TEST_MODE === '1';

function getRequestedRendererPort() {
  const raw = process.env.PARALLX_RENDERER_PORT;
  if (raw === undefined || raw === '') {
    return DEFAULT_RENDERER_PORT;
  }

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
    return parsed;
  }

  return DEFAULT_RENDERER_PORT;
}

const RENDERER_PORT = getRequestedRendererPort();

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.mjs': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.pdf': return 'application/pdf';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    case '.eot': return 'application/vnd.ms-fontobject';
    case '.pfb': return 'application/x-font-type1';
    case '.map': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function resolveRendererFile(requestPathname) {
  const safePathname = decodeURIComponent(requestPathname || '/');
  const normalizedPathname = safePathname === '/' ? '/index.html' : safePathname;
  // index.html lives in electron/, everything else (dist/, src/) in RENDERER_ROOT
  if (normalizedPathname === '/index.html') {
    const indexFile = path.join(__dirname, 'index.html');
    if (fsSync.existsSync(indexFile)) { return indexFile; }
    return null;
  }
  const candidate = path.normalize(path.join(RENDERER_ROOT, normalizedPathname));

  if (!candidate.startsWith(RENDERER_ROOT)) {
    return null;
  }

  if (fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile()) {
    return candidate;
  }

  // SPA-style fallback for app routes
  const indexFile = path.join(__dirname, 'index.html');
  if (fsSync.existsSync(indexFile)) {
    return indexFile;
  }

  return null;
}

async function ensureRendererServer() {
  if (rendererServer && rendererServerPort) {
    return `http://127.0.0.1:${rendererServerPort}/`;
  }

  rendererServer = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const filePath = resolveRendererFile(reqUrl.pathname);
      if (!filePath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const body = fsSync.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Renderer server error: ${err?.message || 'unknown'}`);
    }
  });

  await new Promise((resolve, reject) => {
    rendererServer.once('error', (err) => {
      // Port in use (another Parallx instance) — retry on a random free port
      if (err.code === 'EADDRINUSE') {
        rendererServer.listen(0, '127.0.0.1', () => {
          const address = rendererServer.address();
          if (address && typeof address === 'object') {
            rendererServerPort = address.port;
            resolve();
          } else {
            reject(new Error('Failed to bind renderer server on fallback port'));
          }
        });
        return;
      }
      reject(err);
    });
    rendererServer.listen(RENDERER_PORT, '127.0.0.1', () => {
      const address = rendererServer.address();
      if (address && typeof address === 'object') {
        rendererServerPort = address.port;
        resolve();
      } else {
        reject(new Error('Failed to bind renderer server'));
      }
    });
  });

  // Track connections so we can force-close them at quit
  rendererServer.on('connection', (socket) => {
    _rendererSockets.add(socket);
    socket.once('close', () => _rendererSockets.delete(socket));
  });

  return `http://127.0.0.1:${rendererServerPort}/`;
}

// ── Window bounds persistence ───────────────────────────────────────────────
// Save position, size, and maximized state to a JSON file so the window
// reopens on the same monitor in the same spot.

const WINDOW_STATE_FILE = path.join(APP_ROOT, 'data', 'window-state.json');

const DEFAULT_BOUNDS = { width: 1280, height: 800 };

function loadWindowState() {
  try {
    const raw = fsSync.readFileSync(WINDOW_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow) return;
  const state = {
    isMaximized: mainWindow.isMaximized(),
    bounds: mainWindow.isMaximized()
      ? mainWindow._lastNormalBounds ?? mainWindow.getNormalBounds()
      : mainWindow.getBounds(),
  };
  try {
    fsSync.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state), 'utf8');
  } catch { /* non-critical */ }
}

/**
 * Check that the saved bounds are still visible on a connected display.
 * If the monitor was disconnected, fall back to defaults.
 */
function boundsOnScreen(bounds) {
  const displays = screen.getAllDisplays();
  // A window is "on screen" if at least 100px of it is visible on any display
  return displays.some((d) => {
    const { x, y, width, height } = d.workArea;
    const overlapX = Math.max(
      0,
      Math.min(bounds.x + bounds.width, x + width) - Math.max(bounds.x, x),
    );
    const overlapY = Math.max(
      0,
      Math.min(bounds.y + bounds.height, y + height) - Math.max(bounds.y, y),
    );
    return overlapX > 100 && overlapY > 100;
  });
}

function normalizeLocaleTag(locale) {
  return typeof locale === 'string'
    ? locale.trim().replace(/_/g, '-').toLowerCase()
    : '';
}

function selectSpellCheckerLanguages(availableLanguages, preferredLanguages) {
  const available = Array.isArray(availableLanguages) ? availableLanguages : [];
  const preferred = Array.isArray(preferredLanguages) ? preferredLanguages : [];
  const availableByNormalized = new Map(
    available.map((language) => [normalizeLocaleTag(language), language]),
  );
  const selected = [];

  for (const locale of preferred) {
    const normalized = normalizeLocaleTag(locale);
    if (!normalized) {
      continue;
    }

    const exactMatch = availableByNormalized.get(normalized);
    if (exactMatch && !selected.includes(exactMatch)) {
      selected.push(exactMatch);
      continue;
    }

    const baseLanguage = normalized.split('-')[0];
    if (!baseLanguage) {
      continue;
    }

    const baseMatch = available.find((language) => {
      const candidate = normalizeLocaleTag(language);
      return candidate === baseLanguage || candidate.startsWith(`${baseLanguage}-`);
    });

    if (baseMatch && !selected.includes(baseMatch)) {
      selected.push(baseMatch);
    }
  }

  if (selected.length === 0) {
    const fallback = availableByNormalized.get('en-us') || available[0];
    if (fallback) {
      selected.push(fallback);
    }
  }

  return selected;
}

function configureSpellCheckerForWindow(window) {
  const session = window?.webContents?.session;
  if (!session) {
    return;
  }

  session.setSpellCheckerEnabled(true);

  const availableLanguages = Array.isArray(session.availableSpellCheckerLanguages)
    ? session.availableSpellCheckerLanguages
    : [];
  if (availableLanguages.length === 0) {
    return;
  }

  const currentLanguages = typeof session.getSpellCheckerLanguages === 'function'
    ? session.getSpellCheckerLanguages()
    : [];
  const preferredSystemLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  const locale = typeof app.getLocale === 'function' ? app.getLocale() : '';
  const selectedLanguages = selectSpellCheckerLanguages(availableLanguages, [
    ...currentLanguages,
    ...preferredSystemLanguages,
    locale,
    'en-US',
  ]);

  if (selectedLanguages.length > 0) {
    session.setSpellCheckerLanguages(selectedLanguages);
  }
}

function buildEditableMenuState(params) {
  const editFlags = params?.editFlags || {};
  const dictionarySuggestions = Array.isArray(params?.dictionarySuggestions)
    ? params.dictionarySuggestions.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : [];
  const misspelledWord = typeof params?.misspelledWord === 'string' ? params.misspelledWord : '';

  return {
    x: typeof params?.x === 'number' ? params.x : 0,
    y: typeof params?.y === 'number' ? params.y : 0,
    editFlags: {
      canUndo: !!editFlags.canUndo,
      canRedo: !!editFlags.canRedo,
      canCut: !!editFlags.canCut,
      canCopy: !!editFlags.canCopy,
      canPaste: !!editFlags.canPaste,
      canSelectAll: !!editFlags.canSelectAll,
    },
    dictionarySuggestions,
    misspelledWord,
  };
}

async function createWindow() {
  const saved = loadWindowState();
  const useSaved = saved?.bounds && boundsOnScreen(saved.bounds);

  const opts = {
    width: useSaved ? saved.bounds.width : DEFAULT_BOUNDS.width,
    height: useSaved ? saved.bounds.height : DEFAULT_BOUNDS.height,
    ...(useSaved ? { x: saved.bounds.x, y: saved.bounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    // Frameless for custom titlebar (like VS Code)
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'parallx.ico'),
    // Dark background while loading
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      // Enables <webview> for the dashboard Video widget's page fallback
      // (embedding arbitrary video sites that block plain iframes). Every
      // webview is hardened in will-attach-webview below.
      webviewTag: true,
    },
  };

  mainWindow = new BrowserWindow(opts);

  // Harden every <webview> the renderer attaches (dashboard Video widget page
  // fallback): no Node, isolated, sandboxed, no inherited preload. It only ever
  // loads a remote page to show its video — it must never touch app internals.
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    delete webPreferences.preload;
  });

  // Tell Windows taskbar this is "Parallx", not "Electron"
  mainWindow.setAppDetails({
    appId: 'com.parallx.app',
    appIconPath: path.join(__dirname, 'parallx.ico'),
    appIconIndex: 0,
    relaunchCommand: `wscript.exe "${path.join(__dirname, '..', 'scripts', 'Parallx.vbs')}"`,
    relaunchDisplayName: 'Parallx',
  });

  // Override the window icon explicitly (taskbar + title bar)
  mainWindow.setIcon(path.join(__dirname, 'parallx.ico'));

  configureSpellCheckerForWindow(mainWindow);

  mainWindow.webContents.on('context-menu', (event, params) => {
    if (params?.isEditable) {
      event.preventDefault();
      lastEditableContextMenu = {
        webContentsId: mainWindow.webContents.id,
        timestamp: Date.now(),
        params,
      };
      mainWindow.webContents.send('editableMenu:open', buildEditableMenuState(params));
      return;
    }
    lastEditableContextMenu = null;
  });

  // M67 Phase 4.2 — Block renderer-initiated window.open() calls. Extensions
  // must use api.window.startDrag() or shell.openExternal() via IPC; they must
  // NOT be able to spawn new BrowserWindows that bypass CSP/preload.
  //
  // Carve-out: when the URL is an http(s) or mailto link, hand it to the
  // OS browser via shell.openExternal. The new BrowserWindow is still
  // denied — we never let the renderer spawn anything. Without this carve-
  // out, anchor clicks inside the PDF viewer (and any embedded content)
  // are silently swallowed.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url).catch((err) => {
        console.warn('[main] openExternal failed for', url, err?.message);
      });
    }
    return { action: 'deny' };
  });

  if (saved?.isMaximized) {
    mainWindow.maximize();
  }

  // ── D1: MCP Bridge ──
  setupMcpBridge(ipcMain, () => mainWindow, APP_ROOT);

  // Track normal (non-maximized) bounds so we can save them even when
  // the window is maximized at quit time.
  mainWindow._lastNormalBounds = mainWindow.getNormalBounds();
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      mainWindow._lastNormalBounds = mainWindow.getBounds();
    }
  });
  mainWindow.on('move', () => {
    if (!mainWindow.isMaximized()) {
      mainWindow._lastNormalBounds = mainWindow.getBounds();
    }
  });

  const rendererUrl = await ensureRendererServer();
  mainWindow.loadURL(rendererUrl);

  // Open DevTools (uncomment for debugging)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ── Unsaved changes guard ──
  // Intercept close to let the renderer check for dirty editors.
  // The renderer will either confirm (send 'lifecycle:confirmClose') or
  // veto (the user chose "Cancel" in the save dialog).
  let closeConfirmed = false;
  mainWindow.on('close', (e) => {
    // Save window position/size before anything else
    saveWindowState();
    if (closeConfirmed || isAppQuitting || IS_TEST_MODE) return; // already confirmed — let it close
    e.preventDefault();
    mainWindow?.webContents.send('lifecycle:beforeClose');
  });
  ipcMain.on('lifecycle:confirmClose', () => {
    closeConfirmed = true;
    mainWindow?.close();
  });

  // Hide window instantly on request (used before slow teardown)
  ipcMain.on('lifecycle:hideWindow', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  // Notify renderer on maximize/unmaximize
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false);
  });
}

// ── IPC handlers for window controls ──
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('editableMenu:replaceMisspelling', (event, suggestion) => {
  if (typeof suggestion !== 'string' || suggestion.trim().length === 0) {
    return false;
  }
  event.sender.replaceMisspelling(suggestion);
  return true;
});
ipcMain.handle('editableMenu:addToDictionary', (event, word) => {
  const value = typeof word === 'string' && word.trim().length > 0
    ? word.trim()
    : (typeof lastEditableContextMenu?.params?.misspelledWord === 'string' ? lastEditableContextMenu.params.misspelledWord : '');
  if (!value) {
    return false;
  }
  return event.sender.session.addWordToSpellCheckerDictionary(value);
});

app.whenReady().then(async () => {
  if (!HAS_SINGLE_INSTANCE_LOCK) return;

  // File-backed dashboard image/GIF assets (served over parallx-asset://).
  setupDashboardAssetBridge(ipcMain, protocol, APP_ROOT);
  // ── M53: Migrate tools from ~/.parallx/tools/ → data/extensions/ ──
  const oldToolsDir = path.join(app.getPath('home'), '.parallx', 'tools');
  try {
    const oldEntries = await fs.readdir(oldToolsDir).catch(() => []);
    for (const entry of oldEntries) {
      const oldPath = path.join(oldToolsDir, entry);
      const newPath = path.join(USER_EXTENSIONS_DIR, entry);
      const stat = await fs.stat(oldPath).catch(() => null);
      if (stat && stat.isDirectory()) {
        const exists = await fs.stat(newPath).catch(() => null);
        if (!exists) {
          await fs.cp(oldPath, newPath, { recursive: true });
        }
      }
    }
  } catch { /* old dir doesn't exist — nothing to migrate */ }

  await createWindow();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  runTeardown('appQuit');
});

// ── IPC handlers for tool scanning ──

/**
 * Scan a directory for tool manifests.
 * Returns an array of { toolPath, manifestJson } objects for each valid manifest found.
 * Returns { error } for scanning failures.
 */
ipcMain.handle('tools:scan-directory', async (_event, dirPath) => {
  try {
    let stat;
    try {
      stat = await fs.stat(dirPath);
    } catch {
      return { entries: [], error: null };
    }

    if (!stat.isDirectory()) {
      return { entries: [], error: `Not a directory: ${dirPath}` };
    }

    const entries = [];
    const children = await fs.readdir(dirPath);

    for (const child of children) {
      const childPath = path.join(dirPath, child);
      try {
        const childStat = await fs.stat(childPath);
        if (!childStat.isDirectory()) continue;

        const manifestPath = path.join(childPath, 'parallx-manifest.json');
        try {
          await fs.access(manifestPath);
        } catch {
          continue;
        }

        const raw = await fs.readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw);
        entries.push({ toolPath: childPath, manifestJson: parsed });
      } catch (err) {
        // Individual tool directory errors are reported but don't stop scanning
        entries.push({ toolPath: childPath, error: err.message });
      }
    }

    return { entries, error: null };
  } catch (err) {
    return { entries: [], error: err.message };
  }
});

/**
 * Get the default tool directories.
 * Returns { builtinDir, userDir, devDir }.
 * devDir is the ext/ directory at the project root (only present during development).
 */
ipcMain.handle('tools:get-directories', async () => {
  const builtinDir = path.join(app.getAppPath(), 'tools');
  const userDir = USER_EXTENSIONS_DIR;
  const devCandidate = path.join(APP_ROOT, 'ext');
  let devDir = null;
  try {
    const stat = fsSync.statSync(devCandidate);
    if (stat.isDirectory()) devDir = devCandidate;
  } catch { /* not present — production build */ }
  return { builtinDir, userDir, devDir };
});

// ── .plx package integrity verification (M67 Phase 4.3) ─────────────────────

const _PLX_INTEGRITY_FILENAME = 'parallx-integrity.json';

// SubjectPublicKeyInfo DER prefix for Ed25519 (OID 1.3.101.112). Prepend to
// a raw 32-byte public key to produce the DER-SPKI format Node.js expects.
const _ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify the SHA-256 hash manifest inside a .plx zip, and optionally verify
 * the manifest's Ed25519 signature.
 *
 * The file `parallx-integrity.json` in the archive must have the shape:
 *   {
 *     "version": 1,
 *     "files": { "<filename>": "<sha256-hex>", ... },
 *     "publicKey": "<base64 raw 32-byte Ed25519 key>",   // optional
 *     "signature": "<base64 Ed25519 signature>"           // optional, requires publicKey
 *   }
 *
 * If `parallx-integrity.json` is absent, this function returns null and the
 * install proceeds without integrity verification (backward-compatible).
 *
 * SECURITY LIMITATION — Ed25519 signature trust anchor:
 *   The publicKey is embedded in the same file as the signature it verifies.
 *   This means the signature provides tamper-evidence (any modification to a
 *   listed file changes its SHA-256 and breaks the signature) but it does NOT
 *   provide publisher authentication — an attacker who fully rebuilds the
 *   package can substitute their own publicKey + signature and the check still
 *   passes. A publisher key registry or pinned trust anchor is required for
 *   real authentication; M67 ships tamper-evidence only.
 *
 * @returns {string|null} null on success, error message string on failure.
 */
function _verifyPackageIntegrity(zip) {
  const entry = zip.getEntry(_PLX_INTEGRITY_FILENAME);
  if (!entry) return null; // integrity file optional

  let integrity;
  try {
    integrity = JSON.parse(entry.getData().toString('utf8'));
  } catch {
    return 'parallx-integrity.json is not valid JSON';
  }

  if (!integrity || typeof integrity.files !== 'object' || integrity.files === null) {
    return 'parallx-integrity.json is missing the "files" hash map';
  }

  // Verify SHA-256 of every declared file.
  for (const [filename, expectedHash] of Object.entries(integrity.files)) {
    if (filename === _PLX_INTEGRITY_FILENAME) continue; // skip self
    const fileEntry = zip.getEntry(filename);
    if (!fileEntry) {
      return `Integrity check failed: declared file "${filename}" not found in package`;
    }
    const actualHash = crypto.createHash('sha256').update(fileEntry.getData()).digest('hex');
    if (actualHash !== expectedHash) {
      return `Integrity check failed: SHA-256 mismatch for "${filename}"`;
    }
  }

  // Enumerate every ZIP entry and require it to be covered by `integrity.files`
  // (other than the integrity file itself and pure directory entries).
  // Without this check, an attacker could append a malicious file to a
  // legitimately-signed package; the SHA-256 loop above would not detect it
  // because it only iterates the declared files.
  const allEntries = zip.getEntries();
  for (const ze of allEntries) {
    if (ze.isDirectory) continue;
    const name = ze.entryName;
    if (name === _PLX_INTEGRITY_FILENAME) continue;
    if (!Object.prototype.hasOwnProperty.call(integrity.files, name)) {
      return `Integrity check failed: package contains undeclared file "${name}"`;
    }
  }

  // Optional Ed25519 signature over the sorted canonical JSON of the files map.
  if (integrity.signature && integrity.publicKey) {
    const filesCanonical = JSON.stringify(
      Object.fromEntries(Object.entries(integrity.files).sort(([a], [b]) => a.localeCompare(b))),
    );
    try {
      const rawKey = Buffer.from(integrity.publicKey, 'base64');
      if (rawKey.length !== 32) {
        return 'Package publicKey must be a base64-encoded 32-byte Ed25519 key';
      }
      const spkiKey = Buffer.concat([_ED25519_SPKI_PREFIX, rawKey]);
      const isValid = crypto.verify(
        null,
        Buffer.from(filesCanonical, 'utf8'),
        { key: spkiKey, format: 'der', type: 'spki' },
        Buffer.from(integrity.signature, 'base64'),
      );
      if (!isValid) {
        return 'Package Ed25519 signature is invalid — package may have been tampered with';
      }
    } catch (err) {
      return `Package signature verification error: ${err.message}`;
    }
  }

  return null; // all checks passed
}

// ── IPC handlers for tool package installation/uninstallation ──

/**
 * Install a tool from a .plx package file.
 *
 * .plx files are ZIP archives containing:
 *   - parallx-manifest.json (required)
 *   - main.js (required — the tool entry point)
 *   - additional assets (optional)
 *
 * Flow:
 * 1. Opens native file dialog filtered for .plx files
 * 2. Reads and validates the ZIP archive
 * 3. Validates the manifest inside the archive
 * 4. Extracts to data/extensions/<tool-id>/
 * 5. Returns the manifest + path for the renderer to register
 *
 * VS Code reference: ExtensionManagementService.install() for .vsix files
 */
ipcMain.handle('tools:install-from-file', async (_event) => {
  try {
    // 1. Open native file dialog
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Install Tool Package',
      filters: [
        { name: 'Parallx Tool Package', extensions: ['plx'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const plxPath = result.filePaths[0];

    // 2. Read and parse the ZIP archive
    let zip;
    try {
      zip = new AdmZip(plxPath);
    } catch (err) {
      return { error: `Invalid package file: ${err.message}` };
    }

    // 3. Validate required files exist in the archive
    const manifestEntry = zip.getEntry('parallx-manifest.json');
    if (!manifestEntry) {
      return { error: 'Invalid tool package: missing parallx-manifest.json' };
    }

    const mainEntry = zip.getEntry('main.js');
    if (!mainEntry) {
      return { error: 'Invalid tool package: missing main.js entry point' };
    }

    // 4. Parse and validate the manifest
    let manifest;
    try {
      const manifestText = zip.readAsText(manifestEntry);
      manifest = JSON.parse(manifestText);
    } catch (err) {
      return { error: `Invalid manifest JSON: ${err.message}` };
    }

    if (!manifest.id || typeof manifest.id !== 'string') {
      return { error: 'Invalid manifest: missing or invalid "id" field' };
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
      return { error: 'Invalid manifest: missing or invalid "name" field' };
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      return { error: 'Invalid manifest: missing or invalid "version" field' };
    }

    // 4b. Verify SHA-256 hash manifest + optional Ed25519 signature (M67 Phase 4.3).
    const integrityError = _verifyPackageIntegrity(zip);
    if (integrityError) {
      return { error: integrityError };
    }

    // 5. Extract to data/extensions/<tool-id>/
    const userToolsDir = USER_EXTENSIONS_DIR;
    const toolDir = path.join(userToolsDir, manifest.id);

    // Remove existing installation if present (upgrade flow)
    try {
      await fs.rm(toolDir, { recursive: true, force: true });
    } catch { /* ignore — may not exist */ }

    // Create the tool directory
    await fs.mkdir(toolDir, { recursive: true });

    // Extract all files from the ZIP into the tool directory
    zip.extractAllTo(toolDir, /* overwrite */ true);

    console.log(`[ToolInstall] Installed "${manifest.name}" (${manifest.id}) v${manifest.version} to ${toolDir}`);

    return {
      canceled: false,
      error: null,
      toolId: manifest.id,
      toolPath: toolDir,
      manifest,
    };
  } catch (err) {
    return { error: `Installation failed: ${err.message}` };
  }
});

/**
 * Uninstall an external tool by removing its directory from data/extensions/.
 *
 * @param {string} toolId — The tool's unique identifier (directory name).
 * @returns {{ error: null }} on success or {{ error: string }} on failure.
 */
ipcMain.handle('tools:uninstall', async (_event, toolId) => {
  try {
    if (!toolId || typeof toolId !== 'string') {
      return { error: 'Invalid tool ID' };
    }

    // Prevent path traversal attacks
    if (toolId.includes('..') || toolId.includes('/') || toolId.includes('\\')) {
      return { error: 'Invalid tool ID: path traversal not allowed' };
    }

    const userToolsDir = USER_EXTENSIONS_DIR;
    const toolDir = path.join(userToolsDir, toolId);

    // Verify the directory exists
    try {
      const stat = await fs.stat(toolDir);
      if (!stat.isDirectory()) {
        return { error: `Tool "${toolId}" is not installed` };
      }
    } catch {
      return { error: `Tool "${toolId}" is not installed` };
    }

    // Remove the tool directory
    await fs.rm(toolDir, { recursive: true, force: true });

    console.log(`[ToolInstall] Uninstalled tool "${toolId}" from ${toolDir}`);

    return { error: null };
  } catch (err) {
    return { error: `Uninstallation failed: ${err.message}` };
  }
});

/**
 * Read a tool module's JavaScript source code.
 * The renderer uses this to create a blob URL for dynamic import(),
 * since file:// URLs cannot be imported from an http:// origin.
 * Only used for external (non-builtin) tool modules.
 *
 * @param {string} filePath — Absolute path to the .js file.
 * @returns {{ source: string }} on success or {{ error: string }} on failure.
 */
ipcMain.handle('tools:read-module', async (_event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { error: 'Invalid file path' };
    }

    // Security: only allow reading from the user tools directory, builtin tools directory, or dev ext directory
    const userToolsDir = USER_EXTENSIONS_DIR;
    const builtinToolsDir = path.join(app.getAppPath(), 'tools');
    const devToolsDir = path.join(APP_ROOT, 'ext');
    const normalized = path.normalize(filePath);

    if (!normalized.startsWith(userToolsDir) && !normalized.startsWith(builtinToolsDir) && !normalized.startsWith(devToolsDir)) {
      return { error: 'Access denied: path is outside tool directories' };
    }

    // Only allow .js files
    if (!normalized.endsWith('.js')) {
      return { error: 'Only .js files can be loaded as tool modules' };
    }

    const source = await fs.readFile(normalized, 'utf-8');
    return { source };
  } catch (err) {
    return { error: `Failed to read module: ${err.message}` };
  }
});

/**
 * Start a native OS drag operation. The renderer calls this from a
 * `dragstart` handler when it wants the dragged item to be droppable into
 * external apps (Discord, Explorer, browser file uploads, etc.). HTML5
 * DataTransfer alone does not produce a real OS file drag — webContents
 * .startDrag() does.
 *
 * Args:
 *   - filePaths: string | string[] — absolute path(s) to the file(s)
 *   - iconDataUrl?: string — data URL for the drag-image (PNG/JPEG)
 *
 * Reference: https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop
 */
ipcMain.handle('shell:startDrag', async (event, payload) => {
  try {
    const raw = payload?.filePaths;
    const files = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (files.length === 0) return { error: 'No file paths provided' };

    // Validate every file exists and is absolute
    for (const f of files) {
      if (typeof f !== 'string' || !path.isAbsolute(f)) {
        return { error: `Invalid file path: ${f}` };
      }
      try {
        await fs.access(f);
      } catch {
        return { error: `File not found: ${f}` };
      }
    }

    // Build the drag icon. Windows requires a non-empty icon or startDrag throws.
    let icon;
    const iconDataUrl = payload?.iconDataUrl;
    if (iconDataUrl && typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')) {
      icon = nativeImage.createFromDataURL(iconDataUrl);
    } else {
      // Try the file itself (works for images on most platforms)
      try {
        icon = nativeImage.createFromPath(files[0]);
      } catch {
        icon = null;
      }
    }
    // Fallback: 1x1 transparent PNG (last resort — Windows just needs *something*)
    if (!icon || icon.isEmpty()) {
      icon = nativeImage.createFromBuffer(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      ));
    } else {
      // Resize so the drag-image isn't huge
      const size = icon.getSize();
      if (size.width > 128 || size.height > 128) {
        icon = icon.resize({ width: 128, quality: 'good' });
      }
    }

    if (files.length === 1) {
      event.sender.startDrag({ file: files[0], icon });
    } else {
      event.sender.startDrag({ files, icon });
    }
    return { error: null };
  } catch (err) {
    return { error: `Failed to start drag: ${err.message}` };
  }
});

app.on('window-all-closed', () => {
  // On macOS, apps stay active until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // Re-create window on macOS dock click
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Filesystem IPC Handlers (M4 Cap 0 — Task 0.1)
// ════════════════════════════════════════════════════════════════════════════════
//
// All filesystem operations are async, use fs/promises, and return structured
// errors with { code, message, path }. Matches VS Code's DiskFileSystemProvider
// pattern adapted for Electron IPC.

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB guard (text files)
const MAX_BINARY_FILE_SIZE = 512 * 1024 * 1024; // 512MB guard (PDFs, images, etc.)

/**
 * Normalize a filesystem error into a structured { code, message, path } object.
 */
function normalizeError(err, filePath) {
  const code = err.code || 'EUNKNOWN';
  return { code, message: err.message || String(err), path: filePath || '' };
}

/**
 * File extensions that are always binary (no heuristic needed).
 */
const BINARY_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.svg',
  '.zip', '.tar', '.gz', '.7z', '.rar', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.avi', '.mkv', '.mov', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.sqlite', '.db',
]);

/**
 * Check if a buffer is likely binary by scanning for null bytes in the first 8KB.
 * Also checks file extension for known binary types.
 */
function isBinary(buffer, filePath) {
  // Fast path: known binary extensions
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return true;
  }
  // Heuristic: scan for null bytes
  const check = buffer.subarray(0, 8192);
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

// ── M67 Phase 2.4 — IPC write-path validation ────────────────────────────────
//
// Track the workspace root path registered by the renderer. Write operations
// (writeFile, delete, rename, mkdir, copy) are constrained to paths within the
// workspace root or APP_ROOT/data. This is defense-in-depth: the tool layer
// (sanitizeRelativePath) is the primary guard; this IPC-layer check prevents
// any future renderer code that constructs an absolute path from bypassing it.
//
// If no root is registered yet (early init or test mode), writes are allowed
// anywhere — backward compatible. Once a root is set, escaping it is blocked.

/** Currently-open workspace root path (absolute, normalized). Null = unrestricted. */
let _fsWorkspaceRoot = null;

/**
 * Extra allow-listed roots registered by extensions via
 * `fs:registerExtraRoots`. Used for both read and write validation. Intended
 * for user-blessed external folders (e.g. media-organizer scan roots) that
 * live outside the workspace. The renderer is the trust boundary — only
 * folders the user explicitly added through an extension UI should appear
 * here. Stored as absolute, path.resolve()-normalized strings.
 */
const _fsExtraRoots = new Set();

function _matchesAnyRoot(normalized, roots) {
  for (const root of roots) {
    if (normalized === root || normalized.startsWith(root + path.sep)) {
      return true;
    }
  }
  return false;
}

/**
 * Return true when filePath is within an allowed write zone:
 *   - the registered workspace root (any depth inside it),
 *   - APP_ROOT/data (our own portable data directory), or
 *   - any extra root registered via fs:registerExtraRoots.
 *
 * When no workspace root is registered, always returns true.
 */
function _isAllowedWritePath(filePath) {
  if (!_fsWorkspaceRoot) return true;       // no workspace registered yet
  const normalized = path.resolve(filePath);
  const wsRoot = path.resolve(_fsWorkspaceRoot);
  const dataDir = path.resolve(path.join(APP_ROOT, 'data'));
  if (
    normalized === wsRoot ||
    normalized.startsWith(wsRoot + path.sep) ||
    normalized === dataDir ||
    normalized.startsWith(dataDir + path.sep)
  ) {
    return true;
  }
  return _matchesAnyRoot(normalized, _fsExtraRoots);
}

/**
 * M67 finding #3 — read-path IPC validation. Reads were previously
 * unconstrained: a renderer-side caller (extension or any future code
 * that constructs an absolute path) could read any file on the user's
 * disk. The tool layer guarded its own callers but the IPC was a single
 * layer wide open. This function closes that.
 *
 * Read scope is intentionally wider than write scope because legitimate
 * reads happen outside the workspace:
 *   - APP_ROOT             — bundled resources, icons, fonts
 *   - APP_ROOT/data        — portable Parallx data
 *   - workspace root       — user content (any depth)
 *   - ~/.parallx           — user-level Parallx config (LLM keys, etc.)
 *   - os.tmpdir() subtree  — indexing pipelines (Docling, image conversion)
 *     write to system tmp then read back; we ourselves point children at
 *     APP_ROOT/data/tmp but some upstream code still uses the OS default.
 *
 * Anything outside that list is rejected. The same "no workspace yet →
 * allow" early-init pass-through that the write check uses applies.
 */
function _isAllowedReadPath(filePath) {
  if (!_fsWorkspaceRoot) return true;
  const normalized = path.resolve(filePath);
  const roots = [
    path.resolve(APP_ROOT),
    path.resolve(path.join(APP_ROOT, 'data')),
    path.resolve(_fsWorkspaceRoot),
    path.resolve(path.join(os.homedir(), '.parallx')),
    path.resolve(os.tmpdir()),
  ];
  for (const root of roots) {
    if (normalized === root || normalized.startsWith(root + path.sep)) {
      return true;
    }
  }
  if (_matchesAnyRoot(normalized, _fsExtraRoots)) return true;
  // Short-lived consent grant from a user-initiated dialog selection.
  // Image / cover / media upload popups call dialog:openFile, then read the
  // returned path back into base64 — that path lives outside the workspace
  // by design (Pictures, Downloads, …). The grant is created when the dialog
  // returns and expires shortly after, so the read window is bounded.
  return _consumeDialogReadGrant(normalized);
}

// ── Dialog-returned read grants ──────────────────────────────────────────
// Map<absPath, expiryMs>. Entries are inserted by dialog:openFile and
// consumed by _isAllowedReadPath. TTL is short on purpose — the dialog
// is followed immediately by a read in every popup that calls it.
const _DIALOG_READ_GRANT_TTL_MS = 60_000;
const _dialogReadGrants = new Map();

function _registerDialogReadGrant(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return;
  const abs = path.resolve(filePath);
  _dialogReadGrants.set(abs, Date.now() + _DIALOG_READ_GRANT_TTL_MS);
}

function _consumeDialogReadGrant(absPath) {
  const expiry = _dialogReadGrants.get(absPath);
  if (expiry === undefined) return false;
  if (expiry <= Date.now()) {
    _dialogReadGrants.delete(absPath);
    return false;
  }
  _dialogReadGrants.delete(absPath);
  return true;
}

// ── fs:setWorkspaceRoot ──
// Called by the renderer when a workspace is opened or switched. Registers the
// workspace root so write-path validation can enforce containment.
ipcMain.handle('fs:setWorkspaceRoot', (_event, rootPath) => {
  if (typeof rootPath === 'string' && rootPath.length > 0) {
    _fsWorkspaceRoot = path.resolve(rootPath);
  } else {
    _fsWorkspaceRoot = null;
  }
  return { ok: true };
});

// ── fs:registerExtraRoots ──
// Called by extensions to register user-blessed external folders (e.g.
// media-organizer scan roots) that the user added via an extension UI but
// which live outside the workspace. Without this, fs:* IPC writes/reads
// against those folders fail with EACCES once a workspace is registered.
// The renderer is the trust boundary — only paths the user explicitly added
// through an extension UI should be passed in. Replaces the previous set
// each call; callers re-send the full list when the user adds or removes
// a root.
ipcMain.handle('fs:registerExtraRoots', (_event, roots) => {
  _fsExtraRoots.clear();
  if (Array.isArray(roots)) {
    for (const r of roots) {
      if (typeof r === 'string' && r.length > 0) {
        _fsExtraRoots.add(path.resolve(r));
      }
    }
  }
  return { ok: true, count: _fsExtraRoots.size };
});

// ── fs:readFile ──
ipcMain.handle('fs:readFile', async (_event, filePath, encoding) => {
  if (!_isAllowedReadPath(filePath)) {
    return { error: { code: 'EACCES', message: 'Read path is outside the allowed roots', path: filePath } };
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      return { error: { code: 'EISDIR', message: 'Is a directory', path: filePath } };
    }
    // Apply higher limit for known binary files (PDFs, images, etc.)
    const ext = path.extname(filePath).toLowerCase();
    const sizeLimit = BINARY_EXTENSIONS.has(ext) ? MAX_BINARY_FILE_SIZE : MAX_FILE_SIZE;
    if (stat.size > sizeLimit) {
      return { error: { code: 'ETOOLARGE', message: `File exceeds ${sizeLimit} byte limit`, path: filePath } };
    }
    const buffer = await fs.readFile(filePath);
    if (isBinary(buffer, filePath)) {
      return { content: buffer.toString('base64'), encoding: 'base64', size: stat.size, mtime: stat.mtimeMs };
    }
    return { content: buffer.toString(encoding || 'utf-8'), encoding: encoding || 'utf-8', size: stat.size, mtime: stat.mtimeMs };
  } catch (err) {
    return { error: normalizeError(err, filePath) };
  }
});

// ── fs:writeFile ──
ipcMain.handle('fs:writeFile', async (_event, filePath, content, encoding) => {
  if (!_isAllowedWritePath(filePath)) {
    return { error: { code: 'EACCES', message: 'Write path is outside the workspace root', path: filePath } };
  }
  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (encoding === 'base64') {
      await fs.writeFile(filePath, Buffer.from(content, 'base64'));
    } else {
      await fs.writeFile(filePath, content, encoding || 'utf-8');
    }
    return { error: null };
  } catch (err) {
    return { error: normalizeError(err, filePath) };
  }
});

// ── fs:stat ──
ipcMain.handle('fs:stat', async (_event, filePath) => {
  if (!_isAllowedReadPath(filePath)) {
    return { error: { code: 'EACCES', message: 'Path is outside the allowed roots', path: filePath } };
  }
  try {
    const stat = await fs.stat(filePath);
    let type = 'file';
    if (stat.isDirectory()) type = 'directory';
    else if (stat.isSymbolicLink()) type = 'symlink';

    // Check readonly: try access with W_OK
    let isReadonly = false;
    try {
      await fs.access(filePath, fsSync.constants.W_OK);
    } catch {
      isReadonly = true;
    }

    return {
      type,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      isReadonly,
      error: null,
    };
  } catch (err) {
    return { error: normalizeError(err, filePath) };
  }
});

// ── fs:readdir ──
ipcMain.handle('fs:readdir', async (_event, dirPath) => {
  if (!_isAllowedReadPath(dirPath)) {
    return { error: { code: 'EACCES', message: 'Directory is outside the allowed roots', path: dirPath } };
  }
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      let type = 'file';
      let size = 0;
      let mtime = 0;
      if (entry.isDirectory()) {
        type = 'directory';
      } else if (entry.isSymbolicLink()) {
        type = 'symlink';
      }
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
        mtime = stat.mtimeMs;
        if (stat.isDirectory()) type = 'directory';
      } catch {
        // stat may fail on broken symlinks — keep defaults
      }
      results.push({ name: entry.name, type, size, mtime });
    }
    // Sort: directories first, then alphabetical (case-insensitive)
    results.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return { entries: results, error: null };
  } catch (err) {
    return { error: normalizeError(err, dirPath) };
  }
});

// ── fs:exists ──
ipcMain.handle('fs:exists', async (_event, filePath) => {
  if (!_isAllowedReadPath(filePath)) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// ── fs:hashFile ──
// Streaming media fingerprints (full-contents MD5 + optional 64KB head/tail
// oshash) computed in a small worker_thread pool (hashWorker.cjs). The media
// organizer previously spawned certutil / a node one-liner per file — one
// process launch per hash made bulk scans crawl, and hashing inline here
// would chop the event loop that routes user input. Jobs beyond the pool
// size queue FIFO, so callers can fire freely.
const HASH_POOL_SIZE = Math.max(2, Math.min(8, Math.floor(require('os').cpus().length / 2)));
const _hashPool = { workers: [], queue: [], nextId: 1, pending: new Map() };

function _hashPoolWorkerDown(worker, err) {
  const idx = _hashPool.workers.indexOf(worker);
  if (idx >= 0) _hashPool.workers.splice(idx, 1);
  if (worker._currentJobId != null) {
    const job = _hashPool.pending.get(worker._currentJobId);
    if (job) {
      _hashPool.pending.delete(worker._currentJobId);
      job.reject(err);
    }
    worker._currentJobId = null;
  }
  _hashPoolDispatch();
}

function _hashPoolSpawnWorker() {
  const { Worker } = require('worker_threads');
  const worker = new Worker(path.join(__dirname, 'hashWorker.cjs'));
  worker._busy = false;
  worker._currentJobId = null;
  worker.on('message', (msg) => {
    const job = _hashPool.pending.get(msg.id);
    if (job) {
      _hashPool.pending.delete(msg.id);
      if (msg.ok) job.resolve(msg.result);
      else job.reject(new Error(msg.error));
    }
    worker._busy = false;
    worker._currentJobId = null;
    _hashPoolDispatch();
  });
  worker.on('error', (err) => _hashPoolWorkerDown(worker, err));
  worker.on('exit', (code) => {
    if (code !== 0) _hashPoolWorkerDown(worker, new Error(`hash worker exited with code ${code}`));
  });
  // Unref so idle hash workers never keep the app alive at quit.
  worker.unref();
  _hashPool.workers.push(worker);
  return worker;
}

function _hashPoolDispatch() {
  while (_hashPool.queue.length > 0) {
    let worker = _hashPool.workers.find((w) => !w._busy);
    if (!worker) {
      if (_hashPool.workers.length >= HASH_POOL_SIZE) return;
      worker = _hashPoolSpawnWorker();
    }
    const job = _hashPool.queue.shift();
    const id = _hashPool.nextId++;
    _hashPool.pending.set(id, job);
    worker._busy = true;
    worker._currentJobId = id;
    worker.postMessage({ id, filePath: job.filePath, oshash: job.wantOshash });
  }
}

function _hashPoolRun(filePath, wantOshash) {
  return new Promise((resolve, reject) => {
    _hashPool.queue.push({ filePath, wantOshash, resolve, reject });
    _hashPoolDispatch();
  });
}

ipcMain.handle('fs:hashFile', async (_event, filePath, options) => {
  if (!_isAllowedReadPath(filePath)) {
    return { error: { code: 'EACCES', message: 'Path is outside the allowed read roots', path: filePath } };
  }
  try {
    const result = await _hashPoolRun(filePath, !!(options && options.oshash));
    return { ...result, error: null };
  } catch (err) {
    return { error: normalizeError(err, filePath) };
  }
});

// ── fs:rename ──
ipcMain.handle('fs:rename', async (_event, oldPath, newPath) => {
  if (!_isAllowedWritePath(oldPath) || !_isAllowedWritePath(newPath)) {
    return { error: { code: 'EACCES', message: 'Rename path is outside the workspace root', path: oldPath } };
  }
  try {
    await fs.rename(oldPath, newPath);
    return { error: null };
  } catch (err) {
    return { error: normalizeError(err, oldPath) };
  }
});

// ── fs:delete ──
// options.useTrash:
//   'auto' (default) — cross-volume safety: only use the OS recycle bin when
//                      the file lives on the same volume as the user's home
//                      dir. Otherwise permanently delete in place. This
//                      prevents the OS from copying/moving external-drive
//                      files into the internal recycle bin (macOS ~/.Trash,
//                      Linux XDG trash, Windows C:\$Recycle.Bin) — critical
//                      for encrypted volumes (VeraCrypt, BitLocker To Go,
//                      LUKS) where landing in the system recycle bin would
//                      leak plaintext to an unencrypted location.
//   true             — always send to OS recycle bin (legacy; not recommended
//                      for callers that may operate on external/encrypted
//                      drives).
//   false            — permanent delete (no recycle bin).
ipcMain.handle('fs:delete', async (_event, filePath, options) => {
  if (!_isAllowedWritePath(filePath)) {
    return { error: { code: 'EACCES', message: 'Delete path is outside the workspace root', path: filePath } };
  }
  try {
    const opt = options?.useTrash === undefined ? 'auto' : options.useTrash;
    let useTrash = opt !== false; // default: true (then refined below)
    let crossVolume = false;
    if (opt === 'auto') {
      try {
        const sf = await fs.stat(filePath);
        const sh = await fs.stat(os.homedir());
        crossVolume = sf.dev !== sh.dev;
        useTrash = !crossVolume;
      } catch {
        // If we can't stat, fall back to permanent delete in place — never
        // risk the OS routing the file to a different volume's trash.
        useTrash = false;
        crossVolume = true;
      }
    }
    if (useTrash) {
      // shell.trashItem uses Windows Shell COM APIs (IFileOperation) which
      // require native backslash paths. path.resolve normalises slashes.
      await shell.trashItem(path.resolve(filePath));
    } else {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(filePath);
      }
    }
    return { error: null, deletedPermanently: !useTrash, crossVolume };
  } catch (err) {
    return { error: normalizeError(err, filePath) };
  }
});

// ── shell:showItemInFolder ──
ipcMain.handle('shell:showItemInFolder', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
});

// ── shell:openPath ──
ipcMain.handle('shell:openPath', async (_event, filePath) => {
  return shell.openPath(filePath);
});

// ── shell:openExternal ──
//
// M60 §T6.F2 — Gmail OAuth desktop flow needs to launch the user's
// default browser at Google's auth endpoint. Renderer cannot call
// shell.openExternal directly (contextIsolation: true), so it goes
// through this IPC.
//
// Validation: the URL MUST be a normal web URL (`http://` or `https://`).
// Any other scheme (`file://`, `javascript:`, `data:`, custom protocols) is
// rejected. This keeps renderer-triggered shell launches scoped to browser
// navigation while allowing regular links from editor content.
ipcMain.handle('shell:openExternal', async (_event, url) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'invalid-url' };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'invalid-url-scheme: only http:// and https:// are allowed' };
  }
  try {
    await shell.openExternal(parsedUrl.toString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Secret Storage IPC (M60 §T6.F3)
// ════════════════════════════════════════════════════════════════════════════════
//
// Encrypted-at-rest secret storage backed by `app.safeStorage`. Used by
// the Gmail OAuth service for the long-lived refresh token. Access
// tokens stay in renderer memory and never reach disk.
//
// Storage path: <APP_ROOT>/data/secrets/<sha256(key)[:32]>.enc
//   — Lives inside the portable APP_ROOT/data tree (M53), so encrypted
//     blobs travel with the install. This is a deliberate trade-off:
//     portability beats per-user-profile isolation. Documented in
//     docs/ai/GMAIL_MCP_INTEGRATION.md.
//
// Key allowlist:   /^[a-zA-Z0-9._-]{1,128}$/
//   — keeps the filename derivation tight and prevents traversal.
//
// Linux fallback: when `safeStorage.isEncryptionAvailable()` is false
// (no libsecret / unseeded keyring), set/get/delete all return
// { ok: false, error: 'safe-storage-unavailable' }. We do NOT fall
// through to plaintext storage.

const SECRETS_DIR = path.join(APP_ROOT, 'data', 'secrets');
const SECRET_KEY_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;

function _secretKeyValid(key) {
  return typeof key === 'string' && SECRET_KEY_REGEX.test(key);
}

function _secretFilePath(key) {
  const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32);
  return path.join(SECRETS_DIR, hash + '.enc');
}

async function _ensureSecretsDir() {
  try {
    await fs.mkdir(SECRETS_DIR, { recursive: true });
  } catch (err) {
    if (err && err.code !== 'EEXIST') throw err;
  }
}

// Main-process-only reader for a secret. Returns the decoded UTF-8 string
// (after base64 decode — see secretStorageService.ts for the round-trip
// contract) or null when the secret is missing/unavailable. Used by the
// web-research bridge so the Brave API key never enters the renderer.
async function _readSecretString(key) {
  if (!_secretKeyValid(key)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = await fs.readFile(_secretFilePath(key));
    const valueB64 = safeStorage.decryptString(encrypted);
    if (typeof valueB64 !== 'string') return null;
    return Buffer.from(valueB64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// Main-process-only writer/deleter, symmetric with _readSecretString. Used by
// the Google sync bridge so the OAuth refresh token is persisted/cleared from
// main without round-tripping through the renderer. `value` is plain UTF-8;
// we base64-encode it to match the renderer round-trip contract
// (see secretStorageService.ts).
async function _writeSecretString(key, value) {
  if (!_secretKeyValid(key) || typeof value !== 'string') return false;
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    await _ensureSecretsDir();
    const valueB64 = Buffer.from(value, 'utf8').toString('base64');
    const encrypted = safeStorage.encryptString(valueB64);
    await fs.writeFile(_secretFilePath(key), encrypted);
    return true;
  } catch {
    return false;
  }
}

async function _deleteSecretString(key) {
  if (!_secretKeyValid(key)) return false;
  try {
    await fs.unlink(_secretFilePath(key));
    return true;
  } catch (err) {
    // Treat "already gone" as success — delete is idempotent.
    return !!(err && err.code === 'ENOENT');
  }
}

ipcMain.handle('secret:set', async (_event, key, valueB64) => {
  if (!_secretKeyValid(key)) {
    return { ok: false, error: 'invalid-key' };
  }
  if (typeof valueB64 !== 'string') {
    return { ok: false, error: 'invalid-value' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'safe-storage-unavailable' };
  }
  try {
    await _ensureSecretsDir();
    const encrypted = safeStorage.encryptString(valueB64);
    await fs.writeFile(_secretFilePath(key), encrypted);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('secret:get', async (_event, key) => {
  if (!_secretKeyValid(key)) {
    return { ok: false, error: 'invalid-key' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'safe-storage-unavailable' };
  }
  const filePath = _secretFilePath(key);
  try {
    const encrypted = await fs.readFile(filePath);
    const valueB64 = safeStorage.decryptString(encrypted);
    return { ok: true, valueB64 };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ok: false, error: 'not-found' };
    }
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('secret:delete', async (_event, key) => {
  if (!_secretKeyValid(key)) {
    return { ok: false, error: 'invalid-key' };
  }
  const filePath = _secretFilePath(key);
  try {
    await fs.unlink(filePath);
    return { ok: true };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      // Idempotent — deleting a missing key is success.
      return { ok: true };
    }
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// ── fs:mkdir ──
ipcMain.handle('fs:mkdir', async (_event, dirPath) => {
  if (!_isAllowedWritePath(dirPath)) {
    return { error: { code: 'EACCES', message: 'mkdir path is outside the workspace root', path: dirPath } };
  }
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { error: null };
  } catch (err) {
    return { error: normalizeError(err, dirPath) };
  }
});

// ── fs:copy ──
ipcMain.handle('fs:copy', async (_event, source, destination) => {
  if (!_isAllowedWritePath(destination)) {
    return { error: { code: 'EACCES', message: 'Copy destination is outside the workspace root', path: destination } };
  }
  try {
    const stat = await fs.stat(source);
    if (stat.isDirectory()) {
      await fs.cp(source, destination, { recursive: true });
    } else {
      await fs.copyFile(source, destination);
    }
    return { error: null };
  } catch (err) {
    return { error: normalizeError(err, source) };
  }
});

// ── fs:isInWorkspace ──
// Containment check exposed to the renderer/extensions. Returns whether a path
// is an allowed WRITE target (workspace root / data dir / extra roots). Used by
// features that write via a SPAWNED process (e.g. ffmpeg), which bypasses the
// fs:* gate — so they must validate their output path themselves first. Note
// _isAllowedWritePath returns true when no workspace is registered, so callers
// must independently confirm a workspace is actually open.
ipcMain.handle('fs:isInWorkspace', (_event, filePath) => {
  try {
    return { ok: typeof filePath === 'string' && filePath.length > 0 && !!_fsWorkspaceRoot && _isAllowedWritePath(filePath) };
  } catch {
    return { ok: false };
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// File Dialog IPC Handlers (M4 Cap 0 — Task 0.2)
// ════════════════════════════════════════════════════════════════════════════════

// ── dialog:openFile ──
ipcMain.handle('dialog:openFile', async (_event, options) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: [
      'openFile',
      ...(options?.multiSelect ? ['multiSelections'] : []),
    ],
    filters: options?.filters || [],
    defaultPath: options?.defaultPath || app.getPath('home'),
  });
  if (result.canceled) return null;
  // Grant the renderer a short read window for each path the user just
  // picked. Without this, fs:readFile rejects paths outside the workspace —
  // breaking image upload, cover upload, and the media-insert popups.
  for (const p of result.filePaths) _registerDialogReadGrant(p);
  return result.filePaths;
});

// ── dialog:openFolder ──
ipcMain.handle('dialog:openFolder', async (_event, options) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: [
      'openDirectory',
      ...(options?.multiSelect ? ['multiSelections'] : []),
    ],
    defaultPath: options?.defaultPath || app.getPath('home'),
  });
  return result.canceled ? null : result.filePaths;
});

// ── dialog:saveFile ──
ipcMain.handle('dialog:saveFile', async (_event, options) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: options?.filters || [],
    defaultPath: options?.defaultPath || (options?.defaultName ? path.join(app.getPath('home'), options.defaultName) : undefined),
  });
  return result.canceled ? null : result.filePath;
});

// ── dialog:showMessageBox ──
ipcMain.handle('dialog:showMessageBox', async (_event, options) => {
  if (!mainWindow) return { response: 0, checkboxChecked: false };
  const result = await dialog.showMessageBox(mainWindow, {
    type: options.type || 'question',
    title: options.title || 'Parallx',
    message: options.message || '',
    detail: options.detail || undefined,
    buttons: options.buttons || ['OK'],
    defaultId: options.defaultId ?? 0,
    cancelId: options.cancelId ?? -1,
    checkboxLabel: options.checkboxLabel || undefined,
    checkboxChecked: options.checkboxChecked || false,
  });
  return { response: result.response, checkboxChecked: result.checkboxChecked };
});

// ════════════════════════════════════════════════════════════════════════════════
// PDF Export IPC Handler (M93 — canvas "print to PDF")
// ════════════════════════════════════════════════════════════════════════════════
//
// Renders caller-provided standalone HTML in a hidden, fully sandboxed
// BrowserWindow and prints it via webContents.printToPDF. The HTML comes from
// our own renderer (a cloned canvas page), never from the network; the hidden
// window still gets no Node, no preload, and denies navigation/window.open so
// a malicious payload embedded in page content can't reach anything.
//
// Returns { ok: true, data: <base64> } — and additionally writes the file when
// `savePath` is provided — or { ok: false, error }.

const PDF_EXPORT_MAX_HTML = 32 * 1024 * 1024; // 32 MB of HTML is already absurd
const PDF_EXPORT_PAGE_SIZES = new Set(['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid', 'Ledger']);

function sanitizePdfOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const margins = o.margins && typeof o.margins === 'object' ? o.margins : {};
  return {
    pageSize: PDF_EXPORT_PAGE_SIZES.has(o.pageSize) ? o.pageSize : 'A4',
    landscape: o.landscape === true,
    printBackground: o.printBackground !== false,
    scale: clamp(o.scale, 0.4, 2, 1),
    margins: {
      top: clamp(margins.top, 0, 4, 0.6),
      bottom: clamp(margins.bottom, 0, 4, 0.6),
      left: clamp(margins.left, 0, 4, 0.6),
      right: clamp(margins.right, 0, 4, 0.6),
    },
    displayHeaderFooter: o.displayHeaderFooter === true,
    headerTemplate: typeof o.headerTemplate === 'string' ? o.headerTemplate : '<span></span>',
    footerTemplate: typeof o.footerTemplate === 'string' ? o.footerTemplate : '<span></span>',
  };
}

ipcMain.handle('pdfExport:render', async (_event, payload) => {
  const html = payload?.html;
  if (typeof html !== 'string' || html.length === 0) {
    return { ok: false, error: 'No content to export.' };
  }
  if (html.length > PDF_EXPORT_MAX_HTML) {
    return { ok: false, error: 'Page is too large to export.' };
  }
  const savePath = typeof payload?.savePath === 'string' && payload.savePath.length > 0
    ? payload.savePath
    : null;
  const options = sanitizePdfOptions(payload?.options);

  const tmpDir = path.join(app.getPath('temp'), 'parallx-pdf-export');
  const tmpFile = path.join(tmpDir, `export-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`);
  let win = null;
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(tmpFile, html, 'utf-8');

    win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1200,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    await win.loadFile(tmpFile);
    // Let fonts load and images decode before printing — half-decoded images
    // print as blank boxes. Best-effort with a hard cap so a broken resource
    // can't hang the export.
    await Promise.race([
      win.webContents.executeJavaScript(
        `(async () => {
           try { await document.fonts.ready; } catch {}
           try {
             await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
           } catch {}
           return true;
         })()`,
        true,
      ),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    const data = await win.webContents.printToPDF({
      pageSize: options.pageSize,
      landscape: options.landscape,
      printBackground: options.printBackground,
      scale: options.scale,
      margins: options.margins,
      displayHeaderFooter: options.displayHeaderFooter,
      headerTemplate: options.headerTemplate,
      footerTemplate: options.footerTemplate,
    });

    if (savePath) {
      await fs.writeFile(savePath, data);
    }
    return { ok: true, data: data.toString('base64') };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch { /* ignore */ }
    }
    fs.unlink(tmpFile).catch(() => {});
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Document Extraction IPC Handlers
// ════════════════════════════════════════════════════════════════════════════════
//
// Extracts plain text from rich document formats (PDF, Excel, Word, EPUB) for the
// indexing pipeline. Heavy extraction runs in the main process which has full
// Node.js access to the parsing libraries.

// ── document:extractText ──
ipcMain.handle('document:extractText', async (_event, filePath) => {
  try {
    const result = await extractText(filePath);
    return { text: result.text, format: result.format, metadata: result.metadata };
  } catch (err) {
    return { error: { code: 'EXTRACTION_FAILED', message: err.message || String(err), path: filePath } };
  }
});

// ── document:isRichDocument ──
ipcMain.handle('document:readEpub', async (_event, filePath) => {
  try {
    const result = await extractEpubReadingData(filePath);
    return result;
  } catch (err) {
    return { error: { code: 'EPUB_READ_FAILED', message: err.message || String(err), path: filePath } };
  }
});

// ── document:readDocx — formatted Word HTML for the viewer ──
ipcMain.handle('document:readDocx', async (_event, filePath) => {
  try {
    return await extractDocxReadingData(filePath);
  } catch (err) {
    return { error: { code: 'DOCX_READ_FAILED', message: err.message || String(err), path: filePath } };
  }
});

// ── document:readSpreadsheet — per-sheet rows for the viewer ──
ipcMain.handle('document:readSpreadsheet', async (_event, filePath) => {
  try {
    return await extractSpreadsheetReadingData(filePath);
  } catch (err) {
    return { error: { code: 'SPREADSHEET_READ_FAILED', message: err.message || String(err), path: filePath } };
  }
});

ipcMain.handle('document:isRichDocument', (_event, ext) => {
  return isRichDocument(ext);
});

// ── document:richExtensions ──
ipcMain.handle('document:richExtensions', () => {
  return [...RICH_DOCUMENT_EXTENSIONS];
});

// ════════════════════════════════════════════════════════════════════════════════
// Docling Bridge IPC Handlers (M21 Phase A)
// ════════════════════════════════════════════════════════════════════════════════
//
// Manages the Docling Python bridge for intelligent document extraction.
// Falls back to legacy extractors (above) when Docling is unavailable.

// ── docling:status ──
ipcMain.handle('docling:status', () => {
  return doclingBridge.getStatus();
});

// ── docling:start ──
// Explicitly request the bridge to start (e.g. after workspace open).
ipcMain.handle('docling:start', async () => {
  try {
    const started = await doclingBridge.startService();
    return { ok: started, ...doclingBridge.getStatus() };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// ── docling:convert ──
// Convert a single rich document to structured Markdown via Docling.
ipcMain.handle('docling:convert', async (_event, filePath, options) => {
  try {
    const result = await doclingBridge.convertDocument(filePath, options || {});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// ── docling:convertBatch ──
// Convert multiple documents in a single batch call.
ipcMain.handle('docling:convertBatch', async (_event, files) => {
  try {
    const results = await doclingBridge.convertBatch(files || []);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err.message || String(err), results: [] };
  }
});

// ── docling:install ──
// Install the Docling Python package via pip. Returns { ok, pythonPath, output, alreadyInstalled }.
ipcMain.handle('docling:install', async () => {
  try {
    return await doclingBridge.installDocling();
  } catch (err) {
    return { ok: false, pythonPath: null, output: err.message || String(err), alreadyInstalled: false };
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Database IPC Handlers (M6 Cap 1 — Task 1.4)
// ════════════════════════════════════════════════════════════════════════════════
//
// Exposes SQLite database operations via IPC invoke channels.
// The renderer calls these through window.parallxElectron.database.*.
// All operations are synchronous within the main process (better-sqlite3 is sync)
// but exposed as async IPC invoke for the renderer.

/**
 * Serialize a database error for IPC transport.
 * @param {Error} err
 * @returns {{ code: string, message: string }}
 */
function normalizeDatabaseError(err) {
  return {
    code: err.code || 'SQLITE_ERROR',
    message: err.message || String(err),
  };
}

// ── database:open ──
// Opens a database at <workspacePath>/.parallx/data.db and runs migrations.
ipcMain.handle('database:open', async (_event, workspacePath, migrationsDir) => {
  try {
    const dbDir = path.join(workspacePath, '.parallx');
    const dbPath = path.join(dbDir, 'data.db');
    await databaseManager.open(dbPath);

    // Run migrations if a directory is provided
    if (migrationsDir) {
      await databaseManager.migrate(migrationsDir);
    }

    return { error: null, dbPath };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ── database:migrate ──
// Run migrations from a directory on the currently-open database.
ipcMain.handle('database:migrate', async (_event, migrationsDir) => {
  try {
    await databaseManager.migrate(migrationsDir);
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ── database:close ──
ipcMain.handle('database:close', async () => {
  try {
    await databaseManager.close();
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ── M78 Phase 1 — IPC timing instrumentation (dev mode only) ──
//
// Wraps a database IPC handler with a duration timer that logs anything
// slower than IPC_SLOW_LOG_MS. The wrapper is a no-op in packaged
// builds — `app.isPackaged` is true in production, false in dev — so
// users never pay the (tiny) instrumentation cost. The goal is to give
// a baseline for the rest of M78's perf phases and to surface
// regressions caught in development before they reach users.
const IPC_SLOW_LOG_MS = 50;
function timedDbHandler(channelName, handler) {
  if (app.isPackaged) return handler;
  return async (event, ...args) => {
    const start = Date.now();
    try {
      return await handler(event, ...args);
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed >= IPC_SLOW_LOG_MS) {
        // Log only the SQL prefix to keep output readable; full SQL is
        // available via console history if needed.
        const sql = typeof args[0] === 'string' ? args[0].replace(/\s+/g, ' ').slice(0, 80) : '';
        console.warn(`[IPC slow] ${channelName} ${elapsed}ms${sql ? ` "${sql}"` : ''}`);
      }
    }
  };
}

/**
 * Normalize IPC-transported params for better-sqlite3.
 *
 * Electron's structured clone can deliver Uint8Array/ArrayBuffer as
 * a `{ type: 'Buffer', data: [...] }` object, or as a Uint8Array that
 * isn't a Node Buffer. better-sqlite3 (and sqlite-vec) require Node
 * Buffer for blob binding.
 */
function normalizeDbParams(params) {
  if (!Array.isArray(params)) return params || [];
  return params.map((p, idx) => {
    if (!p || typeof p !== 'object') return p;
    // Electron sometimes serializes Buffer/Uint8Array as { type: 'Buffer', data: [...] }
    if (p.type === 'Buffer' && Array.isArray(p.data)) {
      return Buffer.from(p.data);
    }
    // Convert Uint8Array (or any TypedArray view) to a proper Node Buffer
    if (ArrayBuffer.isView(p) && !(p instanceof Buffer)) {
      return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
    }
    // Convert raw ArrayBuffer to Buffer
    if (p instanceof ArrayBuffer) {
      return Buffer.from(p);
    }
    return p;
  });
}

// ── database:run ──
// Execute SQL (INSERT, UPDATE, DELETE, CREATE, etc.)
ipcMain.handle('database:run', timedDbHandler('database:run', async (_event, sql, params) => {
  try {
    const result = await databaseManager.run(sql, normalizeDbParams(params));
    return {
      error: null,
      changes: result.changes,
      lastInsertRowid: typeof result.lastInsertRowid === 'bigint'
        ? Number(result.lastInsertRowid)
        : result.lastInsertRowid,
    };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
}));

// ── database:get ──
// Fetch a single row. Returns null if no match.
ipcMain.handle('database:get', timedDbHandler('database:get', async (_event, sql, params) => {
  try {
    const row = await databaseManager.get(sql, normalizeDbParams(params));
    return { error: null, row: row || null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
}));

// ── database:all ──
// Fetch all matching rows.
ipcMain.handle('database:all', timedDbHandler('database:all', async (_event, sql, params) => {
  try {
    const rows = await databaseManager.all(sql, normalizeDbParams(params));
    return { error: null, rows };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
}));

// ── database:isOpen ──
// Check if a database is currently open.
ipcMain.handle('database:isOpen', async () => {
  return { isOpen: databaseManager.isOpen };
});

// ── database:dropToolData ──
// Drop all tables and migration records belonging to an external tool.
ipcMain.handle('database:dropToolData', async (_event, migrationPrefix, tablePrefix) => {
  try {
    if (!databaseManager.isOpen) {
      return { error: { code: 'DB_NOT_OPEN', message: 'No database is open' } };
    }
    const result = await databaseManager.dropToolData(migrationPrefix, tablePrefix);
    return { error: null, ...result };
  } catch (err) {
    return { error: { code: 'DROP_FAILED', message: err.message } };
  }
});

// ── database:runTransaction ──
// Execute multiple operations inside a single IMMEDIATE transaction.
ipcMain.handle('database:runTransaction', timedDbHandler('database:runTransaction', async (_event, operations) => {
  try {
    // Normalize blob params before passing to better-sqlite3
    const normalizedOps = operations.map(op => ({
      ...op,
      params: normalizeDbParams(op.params),
    }));
    const rawResults = await databaseManager.runTransaction(normalizedOps);
    // Normalize results for IPC (BigInt → Number for lastInsertRowid)
    const results = rawResults.map((r, i) => {
      const op = operations[i];
      if (op.type === 'run') {
        return {
          changes: r.changes,
          lastInsertRowid: typeof r.lastInsertRowid === 'bigint'
            ? Number(r.lastInsertRowid)
            : r.lastInsertRowid,
        };
      }
      if (op.type === 'get') {
        return { row: r || null };
      }
      // 'all'
      return { rows: r };
    });
    return { error: null, results };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
}));

// ════════════════════════════════════════════════════════════════════════════════
// Extension Database IPC — per-extension isolated SQLite databases
// ════════════════════════════════════════════════════════════════════════════════
//
// External extensions get their own database at
//   <workspace>/.parallx/extensions/<extensionName>/data.db
// Deleting the extension's folder removes all its data.

/** Validate extensionId: alphanumeric, dash, underscore, dot only. */
function validateExtensionId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (/[^a-zA-Z0-9._-]/.test(id)) return false;
  if (id.includes('..')) return false;
  return true;
}

ipcMain.handle('ext-database:open', async (_event, extensionId, workspacePath) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    if (!workspacePath || typeof workspacePath !== 'string') return { error: { code: 'INVALID_PATH', message: 'Invalid workspace path' } };
    const dbPath = await extensionDatabaseManager.open(extensionId, workspacePath);
    return { error: null, dbPath };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:close', async (_event, extensionId) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    await extensionDatabaseManager.close(extensionId);
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:migrate', async (_event, extensionId, migrationsDir) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    await extensionDatabaseManager.migrate(extensionId, migrationsDir);
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:run', async (_event, extensionId, sql, params) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    const result = await extensionDatabaseManager.run(extensionId, sql, normalizeDbParams(params));
    return {
      error: null,
      changes: result.changes,
      lastInsertRowid: typeof result.lastInsertRowid === 'bigint'
        ? Number(result.lastInsertRowid)
        : result.lastInsertRowid,
    };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:get', async (_event, extensionId, sql, params) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    const row = await extensionDatabaseManager.get(extensionId, sql, normalizeDbParams(params));
    return { error: null, row: row || null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:all', async (_event, extensionId, sql, params) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    const rows = await extensionDatabaseManager.all(extensionId, sql, normalizeDbParams(params));
    return { error: null, rows: rows || [] };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:isOpen', async (_event, extensionId) => {
  if (!validateExtensionId(extensionId)) return { isOpen: false };
  return { isOpen: extensionDatabaseManager.isOpen(extensionId) };
});

ipcMain.handle('ext-database:closeAll', async () => {
  try {
    await extensionDatabaseManager.closeAll();
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

ipcMain.handle('ext-database:runTransaction', async (_event, extensionId, operations) => {
  try {
    if (!validateExtensionId(extensionId)) return { error: { code: 'INVALID_ID', message: 'Invalid extension ID' } };
    const normalizedOps = operations.map(op => ({
      ...op,
      params: normalizeDbParams(op.params),
    }));
    const rawResults = await extensionDatabaseManager.runTransaction(extensionId, normalizedOps);
    const results = rawResults.map((r, i) => {
      const op = operations[i];
      if (op.type === 'run') {
        return {
          changes: r.changes,
          lastInsertRowid: typeof r.lastInsertRowid === 'bigint'
            ? Number(r.lastInsertRowid)
            : r.lastInsertRowid,
        };
      }
      if (op.type === 'get') {
        return { row: r || null };
      }
      return { rows: r };
    });
    return { error: null, results };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// Workspace Switch — Main-Process Teardown
// ════════════════════════════════════════════════════════════════════════════════
//
// Called by the renderer BEFORE window.location.reload() during openFolder().
// Tears down all workspace-scoped main-process state so the next workspace
// starts cleanly.  Unlike before-quit, the app stays alive.

ipcMain.handle('workspace:prepareSwitch', async () => {
  try {
    runTeardown('workspaceSwitch');
    return { error: null };
  } catch (err) {
    console.error('[Main] Workspace switch teardown error:', err);
    return { error: { message: err.message } };
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// File Watcher IPC (M4 Cap 0 — Task 0.3)
// ════════════════════════════════════════════════════════════════════════════════
//
// Uses Node.js `fs.watch()` with recursive option. Events are debounced and
// pushed to the renderer via IPC. Limited to 10 active watchers.

const MAX_WATCHERS = 10;
let _nextWatchId = 1;

/** @type {Map<string, { watcher: fsSync.FSWatcher, debounceTimer: any, pendingEvents: Array<{ type: string, path: string }> }>} */
const _activeWatchers = new Map();

registerTeardown('file-watchers', 'workspace', () => {
  for (const [id] of _activeWatchers) {
    _cleanupWatcher(id);
  }
});

const WATCHER_IGNORE = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '__pycache__']);
const WATCHER_IGNORE_FILES = new Set(['workspace-state.json', 'global-storage.json']);
const WATCHER_DEBOUNCE_MS = 100;

// ── fs:watch ──
ipcMain.handle('fs:watch', async (_event, watchPath, _options) => {
  if (_activeWatchers.size >= MAX_WATCHERS) {
    return { error: { code: 'ELIMIT', message: `Maximum ${MAX_WATCHERS} watchers reached`, path: watchPath } };
  }

  const watchId = `watch-${_nextWatchId++}`;

  try {
    const watcher = fsSync.watch(watchPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Ignore noise
      const parts = filename.split(path.sep);
      if (parts.some(p => WATCHER_IGNORE.has(p))) return;
      // Ignore internal state files (and their .tmp atomic-write intermediates)
      const basename = parts[parts.length - 1];
      if (WATCHER_IGNORE_FILES.has(basename)) return;
      if (basename.endsWith('.tmp') && WATCHER_IGNORE_FILES.has(basename.slice(0, -4))) return;

      const entry = _activeWatchers.get(watchId);
      if (!entry) return;

      const fullPath = path.join(watchPath, filename);

      if (eventType === 'rename') {
        // Node.js fs.watch fires 'rename' for BOTH creates and deletes.
        // Stat the file to determine which actually happened.
        fsSync.stat(fullPath, (err) => {
          const entryNow = _activeWatchers.get(watchId);
          if (!entryNow) return;
          const changeType = err ? 'deleted' : 'created';
          entryNow.pendingEvents.push({ type: changeType, path: fullPath });
          _flushWatcherDebounce(watchId);
        });
      } else {
        entry.pendingEvents.push({ type: 'changed', path: fullPath });
        _flushWatcherDebounce(watchId);
      }
    });

    /**
     * Flush pending watcher events after debounce.
     * Extracted so both the sync (changed) and async (rename→stat) paths
     * can share the same debounce/send logic.
     */
    function _flushWatcherDebounce(id) {
      const e = _activeWatchers.get(id);
      if (!e) return;
      if (e.debounceTimer) clearTimeout(e.debounceTimer);
      e.debounceTimer = setTimeout(() => {
        const events = e.pendingEvents.splice(0);
        if (events.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
          // Deduplicate by path — keep last event per path
          const deduped = new Map();
          for (const ev of events) deduped.set(ev.path, ev);
          mainWindow.webContents.send('fs:change', { watchId: id, events: [...deduped.values()] });
        }
      }, WATCHER_DEBOUNCE_MS);
    }

    watcher.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:change', {
          watchId,
          error: { code: 'EWATCHER', message: err.message, path: watchPath },
        });
      }
      // Auto-unwatch on error
      _cleanupWatcher(watchId);
    });

    _activeWatchers.set(watchId, { watcher, debounceTimer: null, pendingEvents: [] });
    return { watchId, error: null };
  } catch (err) {
    return { error: normalizeError(err, watchPath) };
  }
});

// ── fs:unwatch ──
ipcMain.handle('fs:unwatch', async (_event, watchId) => {
  _cleanupWatcher(watchId);
  return { error: null };
});

function _cleanupWatcher(watchId) {
  const entry = _activeWatchers.get(watchId);
  if (entry) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try { entry.watcher.close(); } catch { /* ignore */ }
    _activeWatchers.delete(watchId);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Terminal API (M11 Phase 4 — Task 4.1)
// ══════════════════════════════════════════════════════════════════════════════

const { spawn, exec: execCb } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(execCb);

/** Active terminal sessions (spawned interactive shells). */
const _activeTerminals = new Map();
let _terminalIdCounter = 0;

/** Circular buffer of recent terminal output lines (for @terminal mention). */
let _terminalOutputBuffer = [];
const TERMINAL_BUFFER_MAX_LINES = 200;

registerTeardown('terminals', 'workspace', () => {
  const isWin = process.platform === 'win32';
  for (const [, entry] of _activeTerminals) {
    try {
      if (isWin && entry.proc.pid) {
        // Fire-and-forget tree kill. taskkill is its own process and finishes
        // the job even after we exit; the old execSync serialized up to 3s
        // per stubborn shell INSIDE before-quit, keeping a windowless zombie
        // process alive (and the single-instance lock held) for seconds.
        try {
          require('child_process')
            .spawn('taskkill', ['/pid', String(entry.proc.pid), '/T', '/F'], { windowsHide: true, detached: true, stdio: 'ignore' })
            .unref();
        } catch { /* best-effort */ }
      } else {
        entry.proc.kill();
      }
    } catch { /* ignore */ }
  }
  _activeTerminals.clear();
});

registerTeardown('terminal-output-buffer', 'workspace', () => {
  _terminalOutputBuffer = [];
});

function _appendToTerminalBuffer(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    _terminalOutputBuffer.push(line);
  }
  // Trim to max
  if (_terminalOutputBuffer.length > TERMINAL_BUFFER_MAX_LINES) {
    _terminalOutputBuffer = _terminalOutputBuffer.slice(-TERMINAL_BUFFER_MAX_LINES);
  }
}

// ── terminal:exec — Run a single command, capture output, return result ──
ipcMain.handle('terminal:exec', async (_event, command, options) => {
  try {
    const timeout = options?.timeout ?? 30000;
    const cwd = options?.cwd || (mainWindow ? app.getPath('home') : undefined);
    const shellOption = process.platform === 'win32' ? { shell: 'powershell.exe' } : { shell: true };

    const result = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024, // 1 MB
      ...shellOption,
    });

    const stdout = (result.stdout || '').toString();
    const stderr = (result.stderr || '').toString();
    _appendToTerminalBuffer(`$ ${command}\n${stdout}${stderr ? '\n[stderr] ' + stderr : ''}`);

    return { stdout, stderr, exitCode: 0, error: null };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    const stderr = (err.stderr || '').toString();
    _appendToTerminalBuffer(`$ ${command}\n${stdout}${stderr ? '\n[stderr] ' + stderr : ''}`);

    if (err.killed) {
      return { stdout, stderr, exitCode: -1, error: { code: 'TIMEOUT', message: `Command timed out after ${options?.timeout ?? 30000}ms` } };
    }
    return { stdout, stderr, exitCode: err.code ?? 1, error: null };
  }
});

// ── terminal:execStream — Run a command and stream stdout/stderr ──
// Unlike terminal:exec which buffers everything until the process exits, this
// spawns the command and forwards each chunk to the renderer in real time via
// a webContents event. Used by media-organizer to read ffmpeg's `-progress`
// pipe for real percent/ETA updates during long encodes.
//
// Renderer contract:
//   const { streamId } = await invoke('terminal:execStream:start', { command, args, timeout })
//   webContents.on('terminal:execStream:data',  ({ streamId, channel: 'stdout'|'stderr', chunk }) => …)
//   webContents.on('terminal:execStream:exit',  ({ streamId, exitCode, error }) => …)
//   await invoke('terminal:execStream:cancel', streamId)   // optional early cancel
//
// `command` is a single executable path; `args` is an array (no shell parsing,
// so paths with spaces are safe without quoting). This is intentionally
// stricter than terminal:exec to avoid shell-injection footguns when streaming
// untrusted progress output.
const _execStreams = new Map();
let _execStreamSeq = 0;
ipcMain.handle('terminal:execStream:start', async (_event, payload) => {
  try {
    const { command, args = [], cwd, timeout = 1800000, streamId: providedId } = payload || {};
    if (!command || typeof command !== 'string') {
      return { streamId: null, error: { code: 'BAD_ARGS', message: 'command required' } };
    }
    // Renderer pre-generates the streamId so it can attach listeners before
    // we spawn (avoids losing fast-failing exit events). Fall back to a
    // server-generated id for any legacy callers that don't pass one.
    const streamId = providedId && typeof providedId === 'string'
      ? providedId
      : `xstream-${++_execStreamSeq}`;
    const proc = spawn(command, Array.isArray(args) ? args : [], {
      cwd: cwd || (mainWindow ? app.getPath('home') : undefined),
      windowsHide: true,
    });
    let timer = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      }, timeout);
    }
    _execStreams.set(streamId, { proc, timer });
    const send = (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    };
    proc.stdout.on('data', (data) => {
      send('terminal:execStream:data', { streamId, channel: 'stdout', chunk: data.toString() });
    });
    proc.stderr.on('data', (data) => {
      send('terminal:execStream:data', { streamId, channel: 'stderr', chunk: data.toString() });
    });
    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      _execStreams.delete(streamId);
      send('terminal:execStream:exit', { streamId, exitCode: -1, error: { code: 'SPAWN_ERROR', message: err.message } });
    });
    proc.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      _execStreams.delete(streamId);
      send('terminal:execStream:exit', { streamId, exitCode: code ?? (signal ? -1 : 0), error: null });
    });
    return { streamId, error: null };
  } catch (err) {
    return { streamId: null, error: { code: 'EXEC_STREAM_FAILED', message: err.message } };
  }
});

ipcMain.handle('terminal:execStream:cancel', async (_event, streamId) => {
  const entry = _execStreams.get(streamId);
  if (!entry) return { error: null };
  try {
    if (process.platform === 'win32' && entry.proc.pid) {
      try { require('child_process').execSync(`taskkill /pid ${entry.proc.pid} /T /F`, { windowsHide: true, timeout: 3000 }); } catch { /* ignore */ }
    } else {
      entry.proc.kill('SIGKILL');
    }
  } catch { /* ignore */ }
  if (entry.timer) clearTimeout(entry.timer);
  _execStreams.delete(streamId);
  return { error: null };
});

// ── terminal:spawn — Spawn an interactive shell session ──
ipcMain.handle('terminal:spawn', async (_event, options) => {
  try {
    const id = `term-${++_terminalIdCounter}`;
    const shellCmd = options?.shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
    const cwd = options?.cwd || app.getPath('home');

    const proc = spawn(shellCmd, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    _activeTerminals.set(id, { proc, cwd });

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      _appendToTerminalBuffer(text);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', { id, data: text });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      _appendToTerminalBuffer(text);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', { id, data: text });
      }
    });

    proc.on('exit', (code) => {
      _activeTerminals.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', { id, exitCode: code ?? 0 });
      }
    });

    return { id, error: null };
  } catch (err) {
    return { id: null, error: { code: 'SPAWN_FAILED', message: err.message } };
  }
});

// ── terminal:write — Send data to a spawned shell ──
ipcMain.on('terminal:write', (_event, id, data) => {
  const entry = _activeTerminals.get(id);
  if (entry && entry.proc.stdin.writable) {
    entry.proc.stdin.write(data);
  }
});

// ── terminal:kill — Kill a spawned shell ──
ipcMain.handle('terminal:kill', async (_event, id) => {
  const entry = _activeTerminals.get(id);
  if (entry) {
    try { entry.proc.kill(); } catch { /* ignore */ }
    _activeTerminals.delete(id);
  }
  return { error: null };
});

// ── terminal:getOutput — Get recent terminal output buffer ──
ipcMain.handle('terminal:getOutput', async (_event, lineCount) => {
  const count = lineCount || TERMINAL_BUFFER_MAX_LINES;
  const lines = _terminalOutputBuffer.slice(-count);
  return { output: lines.join('\n'), lineCount: lines.length };
});

// ════════════════════════════════════════════════════════════════════════════════
// Screen Recorder (media-organizer) — transparent framing window + ffmpeg gdigrab
// ════════════════════════════════════════════════════════════════════════════════
// A floating, transparent, always-on-top, resizable "frame" window the user
// positions over the screen region they want. ffmpeg records the HOLLOW inner
// rect (so the frame's own border + toolbar are never captured), writing to a
// path the extension already validated as in-workspace (we re-check here). On
// stop, 'q' is sent to ffmpeg's stdin for a clean finalize, then the resulting
// path is handed back to the renderer via the 'recorder:complete' event.
const RECORDER_BORDER = 2;    // px — MUST match recorderFrame.html (border around the capture area only)
const RECORDER_TOOLBAR = 44;  // px — MUST match recorderFrame.html
const _recorderFrames = new Map(); // frameId -> { win, proc, outputPath, ffmpegPath, fps, recording }
let _recorderIdCounter = 0;

// Persist the frame's size + position app-wide (like the main window), so it
// reopens where the user last left it — ScreenToGif-style. Saved on move/resize
// (debounced); restored on open if still on a connected display.
const RECORDER_STATE_FILE = path.join(APP_ROOT, 'data', 'recorder-frame-state.json');
let _recorderSaveTimer = null;
function loadRecorderFrameState() {
  try {
    const s = JSON.parse(fsSync.readFileSync(RECORDER_STATE_FILE, 'utf8'));
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y) &&
        Number.isFinite(s.width) && Number.isFinite(s.height) &&
        s.width >= 200 && s.height >= 160) return s;
  } catch { /* none yet */ }
  return null;
}
function saveRecorderFrameState(bounds) {
  if (!bounds) return;
  if (_recorderSaveTimer) clearTimeout(_recorderSaveTimer);
  _recorderSaveTimer = setTimeout(() => {
    try {
      fsSync.writeFileSync(RECORDER_STATE_FILE, JSON.stringify({
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.round(bounds.width), height: Math.round(bounds.height),
      }), 'utf8');
    } catch { /* non-critical */ }
  }, 400);
}

function _recorderSendState(frameId, state) {
  const entry = _recorderFrames.get(frameId);
  if (entry && entry.win && !entry.win.isDestroyed()) {
    entry.win.webContents.send('recorder:state', state);
  }
}

// Physical-pixel capture rect of the hollow centre, from the frame's DIP bounds
// (DPI-correct: dipToScreenPoint for the origin, scaleFactor for the size).
function _recorderCaptureRect(win) {
  const b = win.getBounds(); // DIP
  const innerDip = {
    x: b.x + RECORDER_BORDER,
    y: b.y + RECORDER_BORDER,
    w: Math.max(2, b.width - RECORDER_BORDER * 2),
    h: Math.max(2, b.height - RECORDER_BORDER * 2 - RECORDER_TOOLBAR),
  };
  const disp = screen.getDisplayNearestPoint({ x: innerDip.x, y: innerDip.y });
  const sf = (disp && disp.scaleFactor) || 1;
  const tl = screen.dipToScreenPoint({ x: innerDip.x, y: innerDip.y });
  let pw = Math.round(innerDip.w * sf);
  let ph = Math.round(innerDip.h * sf);
  if (pw % 2 !== 0) pw -= 1;   // even dims required by libx264 + yuv420p
  if (ph % 2 !== 0) ph -= 1;
  return { x: Math.round(tl.x), y: Math.round(tl.y), w: Math.max(2, pw), h: Math.max(2, ph) };
}

// ── Audio capture (WASAPI loopback via Electron) ────────────────────────────
// ffmpeg/DirectShow can't tap an output device (Bluetooth/USB/HDMI). Instead the
// frame renderer captures audio through Chromium: getDisplayMedia + this handler
// returns `audio: 'loopback'` to grab whatever the OS is playing (any device),
// or the renderer uses getUserMedia for the mic. The captured audio is sent back
// and muxed with the gdigrab video. The handler is set once, lazily.
let _recorderLoopbackHandlerSet = false;
function _ensureLoopbackAudioHandler() {
  if (_recorderLoopbackHandlerSet) return;
  _recorderLoopbackHandlerSet = true;
  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      // getDisplayMedia requires a video source; the recorder frame discards it
      // and keeps only the loopback audio track.
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback(sources && sources.length ? { video: sources[0], audio: 'loopback' } : {});
      }).catch(() => { try { callback({}); } catch { /* ignore */ } });
    }, { useSystemPicker: false });
  } catch { /* older Electron — frame falls back to video-only */ }
}

// Belt for app teardown: per-window 'closed' handlers normally kill capture
// procs, but make quit unconditionally sweep anything still running so an
// ffmpeg can never outlive the app (an orphan keeps recording the screen to
// disk forever and holds its temp file locked).
app.on('before-quit', () => {
  for (const [, e] of _recorderFrames) {
    if (e && e.proc) { try { e.proc.kill('SIGKILL'); } catch { /* ignore */ } }
  }
});

// Lets the media-organizer self-heal a wedged "recording in progress" flag:
// if it believes a recording is active but no recorder frame actually exists,
// the flag is stale (a missed completion event) and can be cleared safely.
ipcMain.handle('recorder:anyActive', () => ({ active: _recorderFrames.size > 0 }));

ipcMain.handle('recorder:openFrame', async (_event, opts) => {
  try {
    const fps = Math.max(1, Math.min(60, parseInt(opts?.fps, 10) || 30));
    const ffmpegPath = String(opts?.ffmpegPath || '');
    const outputPath = String(opts?.outputPath || '');
    // Re-validate containment in main — spawned ffmpeg bypasses the fs gate, and
    // _isAllowedWritePath returns true when no workspace is set, so require one.
    if (!ffmpegPath || !outputPath || !_fsWorkspaceRoot || !_isAllowedWritePath(outputPath)) {
      return { error: { code: 'BAD_ARGS', message: 'Missing ffmpeg/output, or output is outside the workspace' } };
    }
    const frameId = `rec-${++_recorderIdCounter}`;
    // Restore last size/position if it's still on a connected display, else
    // fall back to the caller's defaults (centred).
    const saved = loadRecorderFrameState();
    const useSaved = saved && boundsOnScreen(saved);
    const initW = useSaved ? saved.width : Math.max(240, parseInt(opts?.width, 10) || 640) + RECORDER_BORDER * 2;
    const initH = useSaved ? saved.height : Math.max(160, parseInt(opts?.height, 10) || 360) + RECORDER_BORDER * 2 + RECORDER_TOOLBAR;
    const win = new BrowserWindow({
      width: initW,
      height: initH,
      ...(useSaved ? { x: saved.x, y: saved.y } : {}),
      minWidth: 200,
      minHeight: 160,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      maximizable: false,
      // Non-activating (WS_EX_NOACTIVATE on Windows): the frame receives mouse
      // clicks / drag / resize but never becomes the foreground window. Without
      // this, clicking the frame steals foreground from a fullscreen app being
      // recorded, so Windows un-hides the taskbar and drops the app out of
      // fullscreen mid-record.
      focusable: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'recorderFramePreload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // Audio capture mode: 'off' | 'system' (loopback) | 'mic'. Capture itself
    // happens in the frame renderer; the toolbar speaker button mutes it
    // locally. Main only needs the mode to pass to the frame.
    const audioMode = ['system', 'mic'].includes(opts?.audio) ? opts.audio : 'off';
    // gdigrab writes video to a temp; final output is muxed (video + captured
    // audio) into outputPath on stop. videoPath is a sibling temp file.
    const videoPath = outputPath.replace(/\.mp4$/i, '') + '.video.mp4';
    const entry = {
      win, proc: null, outputPath, videoPath, audioPath: null, ffmpegPath, fps,
      recording: false, audioMode,
    };
    _recorderFrames.set(frameId, entry);
    if (audioMode === 'system') _ensureLoopbackAudioHandler();
    const search = new URLSearchParams({ frameId, fps: String(fps), audio: audioMode }).toString();
    win.loadFile(path.join(__dirname, 'recorderFrame.html'), { search });
    // Unexpected close (OS, app quit) that didn't go through stop/cancel: tear
    // down the recording and tell the renderer it was cancelled so it doesn't
    // wait forever. stop/cancel delete from the map first, so they no-op here.
    win.on('closed', () => {
      const e = _recorderFrames.get(frameId);
      if (!e) return;
      if (e.proc) { try { e.proc.kill('SIGKILL'); } catch { /* ignore */ } }
      _recorderFrames.delete(frameId);
      _recorderCleanupTemps(e);
      if (e.outputPath) fs.unlink(e.outputPath).catch(() => {});
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recorder:complete', { frameId, path: null, ok: false, cancelled: true });
      }
    });
    return { frameId, error: null };
  } catch (err) {
    return { error: { code: 'OPEN_FAILED', message: err.message } };
  }
});

// Manual move/resize for the transparent frame (-webkit-app-region: drag does
// not work on transparent windows on Windows, and frameless transparent windows
// get no native resize). The renderer computes the new DIP bounds and sends them.
ipcMain.handle('recorder:setBounds', (_event, frameId, bounds) => {
  const entry = _recorderFrames.get(frameId);
  if (!entry || !entry.win || entry.win.isDestroyed() || entry.recording || !bounds) return { error: null };
  try {
    entry.win.setBounds({
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(200, Math.round(bounds.width)),
      height: Math.max(160, Math.round(bounds.height)),
    });
    saveRecorderFrameState(entry.win.getBounds()); // persist last position/size (debounced)
  } catch { /* ignore */ }
  return { error: null };
});

// Toggle window-wide click-through. The renderer flips this on every region
// transition so the hollow centre passes clicks to the app being recorded,
// while the border / corners / toolbar stay interactive. forward:true keeps
// mousemove events flowing to the renderer even while click-through, so it can
// detect when the cursor re-enters the chrome.
ipcMain.handle('recorder:setIgnoreMouse', (_event, frameId, ignore) => {
  const entry = _recorderFrames.get(frameId);
  if (entry && entry.win && !entry.win.isDestroyed()) {
    try { entry.win.setIgnoreMouseEvents(!!ignore, { forward: true }); } catch { /* ignore */ }
  }
  return { error: null };
});

function _recorderCleanupTemps(entry) {
  if (!entry) return;
  if (entry.videoPath) fs.unlink(entry.videoPath).catch(() => {});
  if (entry.audioPath) fs.unlink(entry.audioPath).catch(() => {});
}

// Header-only duration probe via ffprobe (sibling of ffmpeg). Returns 0 on any
// failure so the caller can fall back to wall-clock timing. Fast + size-
// independent, unlike loading the whole file in the renderer.
function _recorderProbeDuration(ffmpegPath, file) {
  return new Promise((resolve) => {
    const ffprobe = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m, e) => 'ffprobe' + (e || ''));
    let out = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { windowsHide: true });
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('exit', () => { const n = parseFloat(out.trim()); finish(Number.isFinite(n) && n > 0 ? n : 0); });
      p.on('error', () => finish(0));
      setTimeout(() => { try { p.kill(); } catch { /* ignore */ } finish(0); }, 5000);
    } catch { finish(0); }
  });
}

// Produce the final output from the lossless capture temp. This is the OFFLINE
// stage (no real-time constraint), so it does the heavy lifting the live capture
// deliberately skipped:
//   1. Drift correction — retime the video so it plays back over its REAL
//      wall-clock capture span (gdigrab's CFR assumption can drift from real
//      time; the renderer-captured audio is the real-time reference). This is
//      why audio no longer slides out of sync over the clip.
//   2. A/V start alignment — the audio (MediaRecorder, started on getDisplayMedia
//      latency) and video (gdigrab) begin at different instants; `-itsoffset`
//      shifts whichever started later so t=0 lines up.
//   3. High-quality encode — libx264 crf 18 medium from the near-lossless
//      yuv420p capture temp (light, GPU-decodable), replacing the old live
//      ultrafast/crf-default encode.
// Graceful fallbacks so a take is never lost: plain re-encode, then promote the
// temp as-is. Resolves true when outputPath exists.
async function _recorderFinalize(entry) {
  const { ffmpegPath, videoPath, audioPath, outputPath } = entry;
  if (!videoPath || !fsSync.existsSync(videoPath)) return false;
  const hasAudio = !!(audioPath && fsSync.existsSync(audioPath));

  // Drift factor: play the video over its real wall-clock span. factor > 1 slows
  // a time-compressed capture (dropped frames) back to real time.
  //
  // The bounds are deliberately WIDE (0.2–8): when gdigrab can't sustain the
  // declared framerate (busy screen, large region), media time accrues at a
  // fraction of wall time and the factor is exactly 2, 3, 4× — the old
  // 0.5–2.0 "sanity" clamp rejected precisely the worst compressions, which
  // shipped recordings that played several times too fast. Only degenerate
  // probe garbage should be rejected here.
  const videoDur = await _recorderProbeDuration(ffmpegPath, videoPath);
  let factor = 1;
  if (videoDur > 0 && entry.wallDur > 0) {
    const f = entry.wallDur / videoDur;
    if (Number.isFinite(f) && f > 0.2 && f < 8.0) factor = f;
  }

  // A/V start offset (same wall clock). >0 → audio started later → delay audio;
  // <0 → video started later → delay video. Sanity-bounded.
  let offset = 0;
  if (hasAudio && entry.audioStartedAt && entry.videoFirstFrameAt) {
    const o = (entry.audioStartedAt - entry.videoFirstFrameAt) / 1000;
    if (Number.isFinite(o) && Math.abs(o) <= 10) offset = o;
  }

  const runFfmpeg = (args, timeoutMs) => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
      p.on('exit', (code) => finish(code === 0 && fsSync.existsSync(outputPath)));
      p.on('error', () => finish(false));
      setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch { /* ignore */ } finish(false); } }, timeoutMs);
    } catch { finish(false); }
  });
  // Re-encode can take a while; scale the cap with clip length but bound it.
  const encodeTimeout = Math.min(600000, 60000 + Math.round((entry.wallDur || 0) * 4000));

  // ── Primary: retime + align + high-quality re-encode (+ mux) ──
  const args = ['-y'];
  if (offset < 0) args.push('-itsoffset', (-offset).toFixed(3));
  args.push('-i', videoPath);
  if (hasAudio) {
    if (offset > 0) args.push('-itsoffset', offset.toFixed(3));
    args.push('-i', audioPath);
  }
  // 3% tolerance: below it a speed error is imperceptible and stream-copy
  // (fast, zero quality loss) wins; the old 0.5% threshold forced a full
  // re-encode over probe noise. Above it, retiming is mandatory.
  const needsRetime = Math.abs(factor - 1) > 0.03;
  if (needsRetime) {
    // Drift correction needs a re-encode — do it near-lossless (one-time export).
    args.push('-vf', `setpts=${factor.toFixed(6)}*PTS`);
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p');
  } else {
    // No retiming needed → copy the captured video stream verbatim. This drops
    // the whole second lossy generation (capture was already near-lossless) and
    // makes the export much faster — the recording keeps the full capture quality.
    args.push('-c:v', 'copy');
  }
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  else args.push('-an');
  args.push('-movflags', '+faststart', outputPath);
  if (await runFfmpeg(args, encodeTimeout)) { _recorderCleanupTemps(entry); return true; }

  // ── Fallback: plain video-only re-encode (still high quality) ──
  // The drift retime MUST survive into the fallback: this path fires exactly
  // when the primary is struggling (long/heavy recordings) — the same cases
  // where gdigrab fell behind — so dropping setpts here shipped the
  // time-compressed temp at full speed.
  try { if (fsSync.existsSync(outputPath)) fsSync.unlinkSync(outputPath); } catch { /* ignore */ }
  const fb = ['-y', '-i', videoPath];
  if (needsRetime) fb.push('-vf', `setpts=${factor.toFixed(6)}*PTS`);
  fb.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', outputPath);
  if (await runFfmpeg(fb, encodeTimeout)) { _recorderCleanupTemps(entry); return true; }

  // ── Last resort: promote the lossless temp as-is (large, but never lose it) ──
  try { if (!fsSync.existsSync(outputPath)) fsSync.renameSync(videoPath, outputPath); } catch { /* ignore */ }
  const okFinal = fsSync.existsSync(outputPath);
  _recorderCleanupTemps(entry);
  return okFinal;
}

ipcMain.handle('recorder:start', async (_event, frameId) => {
  const entry = _recorderFrames.get(frameId);
  if (!entry || !entry.win || entry.win.isDestroyed()) return { error: { code: 'NO_FRAME', message: 'No frame' } };
  if (entry.recording) return { error: null };
  try {
    const rect = _recorderCaptureRect(entry.win);
    // Video only — gdigrab to a temp file. Audio is captured by the frame
    // renderer (loopback / mic) and muxed in on stop.
    const args = [
      '-y',
      '-thread_queue_size', '1024',
      '-f', 'gdigrab',
      '-framerate', String(entry.fps),
      '-offset_x', String(rect.x),
      '-offset_y', String(rect.y),
      '-video_size', `${rect.w}x${rect.h}`,
      '-i', 'desktop',
      // Capture stage: LIGHT, GPU-DECODABLE, near-lossless. `ultrafast` keeps CPU
      // low so gdigrab holds its frame rate on long recordings (dropped frames =
      // stutter + A/V drift); `crf 18` is visually near-lossless; `yuv420p` is
      // hardware-decodable, so the preview and long clips play back SMOOTHLY.
      // (The previous lossless 4:4:4 was not GPU-decodable → software-decode
      // stutter, and its huge bitrate stalled long captures + broke the frame
      // strip.) The final export re-encodes from this temp.
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '14',
      '-pix_fmt', 'yuv420p',
      // Progress on stdout so we can timestamp the FIRST captured frame, used to
      // align audio (which starts on its own clock) against video in the mux.
      '-progress', 'pipe:1',
      entry.videoPath,
    ];
    const proc = spawn(entry.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    entry.proc = proc;
    entry.recording = true;
    entry.startedAt = Date.now();
    entry.videoFirstFrameAt = 0;
    // Keep the tail of ffmpeg's stderr — when capture dies, this is the ONLY
    // place the real reason lives (gdigrab/encoder/disk errors). Previously
    // stderr was 'ignore'd and failures surfaced as a bare exit code.
    entry.lastStderr = '';
    if (proc.stderr) {
      proc.stderr.on('data', (d) => {
        entry.lastStderr = (entry.lastStderr + d.toString()).slice(-2000);
      });
    }
    // ffmpeg -progress emits key=value lines; the first update carrying a frame
    // count marks the first captured frame. Stamp it once (same wall clock as the
    // renderer's audio start) for the A/V start-offset math on finalize.
    // Accumulate a small rolling buffer: "frame=" can split across chunk
    // boundaries, and a missed stamp silently degrades wallDur + A/V offset.
    if (proc.stdout) {
      let progressTail = '';
      proc.stdout.on('data', (d) => {
        if (entry.videoFirstFrameAt) return;
        progressTail = (progressTail + d.toString()).slice(-256);
        const m = /frame=\s*(\d+)/.exec(progressTail);
        if (m && parseInt(m[1], 10) >= 1) entry.videoFirstFrameAt = Date.now();
      });
    }
    proc.on('error', (err) => {
      entry.recording = false; entry.proc = null;
      console.error('[recorder] ffmpeg failed to start:', err.message);
      _recorderSendState(frameId, { recording: false, error: 'ffmpeg failed to start: ' + err.message });
    });
    proc.on('exit', (code) => {
      // recorder:stop removes the entry from the map BEFORE awaiting exit, so if
      // it's still here + recording this is an unexpected death — reset the frame.
      const e = _recorderFrames.get(frameId);
      if (e && e.recording && e.proc === proc) {
        e.recording = false; e.proc = null;
        const tail = (e.lastStderr || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
        console.error('[recorder] capture died (code ' + code + '):', e.lastStderr || '(no stderr)');
        _recorderSendState(frameId, {
          recording: false,
          error: 'Recording failed (code ' + code + ')' + (tail ? ': ' + tail : ''),
        });
      }
    });
    _recorderSendState(frameId, { recording: true });
    return { error: null };
  } catch (err) {
    entry.recording = false;
    return { error: { code: 'START_FAILED', message: err.message } };
  }
});

// The frame renderer captures audio (loopback/mic) and sends the encoded
// webm/opus bytes just before stop. We stash it to a temp file for muxing.
ipcMain.handle('recorder:sendAudio', async (_event, frameId, buffer, startedAt) => {
  const entry = _recorderFrames.get(frameId);
  if (!entry) return { error: null };
  try {
    const buf = buffer ? Buffer.from(buffer) : null;
    if (buf && buf.length > 0) {
      const audioPath = entry.outputPath.replace(/\.mp4$/i, '') + '.audio.webm';
      await fs.writeFile(audioPath, buf);
      entry.audioPath = audioPath;
      // Wall-clock instant audio actually started (MediaRecorder.onstart) — same
      // clock as entry.videoFirstFrameAt, so their difference is the A/V offset.
      entry.audioStartedAt = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
    }
  } catch { entry.audioPath = null; }
  return { error: null };
});

ipcMain.handle('recorder:stop', async (_event, frameId) => {
  const entry = _recorderFrames.get(frameId);
  if (!entry) return { error: { code: 'NO_FRAME', message: 'No frame' }, ok: false };
  const proc = entry.proc;
  _recorderFrames.delete(frameId); // claim it so win.on('closed') no-ops
  if (!proc || !entry.recording) {
    if (entry.win && !entry.win.isDestroyed()) entry.win.close();
    _recorderCleanupTemps(entry);
    return { error: null, path: null, ok: false };
  }
  _recorderSendState(frameId, { recording: false, processing: true });
  const stopAt = Date.now();
  // Stop gdigrab gracefully so the temp video finalizes. Allow time for longer
  // recordings to flush + write the moov atom before we hard-kill.
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if (proc.exitCode !== null || proc.killed) { finish(); return; }
    proc.once('exit', finish);
    proc.once('error', finish);
    try { proc.stdin.write('q'); } catch { /* fall through to timeout */ }
    setTimeout(() => { if (!done) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } finish(); } }, 12000);
  });
  // Real capture span (wall clock) — the ground truth the video is retimed to on
  // finalize, since gdigrab's CFR assumption can drift from real time. Prefer the
  // first-frame stamp; fall back to spawn time.
  const videoStart = entry.videoFirstFrameAt || entry.startedAt || 0;
  entry.wallDur = videoStart ? Math.max(0, (stopAt - videoStart) / 1000) : 0;
  let ok = false;
  try { ok = await _recorderFinalize(entry); } catch { ok = false; }
  // Report the duration ourselves (exact via ffprobe, wall-clock fallback) so
  // the renderer never has to load the whole file to read it.
  let duration = 0;
  if (ok) {
    duration = await _recorderProbeDuration(entry.ffmpegPath, entry.outputPath);
    if (!duration && entry.startedAt) duration = Math.max(0, (stopAt - entry.startedAt) / 1000);
  }
  if (entry.win && !entry.win.isDestroyed()) entry.win.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recorder:complete', { frameId, path: ok ? entry.outputPath : null, ok, duration });
  }
  return { error: null, path: ok ? entry.outputPath : null, ok };
});

ipcMain.handle('recorder:cancel', async (_event, frameId) => {
  const entry = _recorderFrames.get(frameId);
  if (!entry) return { error: null };
  _recorderFrames.delete(frameId); // claim it so win.on('closed') no-ops
  if (entry.proc) { try { entry.proc.kill('SIGKILL'); } catch { /* ignore */ } }
  if (entry.win && !entry.win.isDestroyed()) entry.win.close();
  _recorderCleanupTemps(entry);
  if (entry.outputPath) fs.unlink(entry.outputPath).catch(() => {});
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recorder:complete', { frameId, path: null, ok: false, cancelled: true });
  }
  return { error: null };
});

// Note: watcher, terminal, database, and docling cleanup are handled by the
// teardown registry (runTeardown) called from before-quit and workspace:prepareSwitch.
