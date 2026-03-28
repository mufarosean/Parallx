// electron/main.cjs — Electron main process
// Uses CommonJS because Electron's main process doesn't support ESM by default.

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const AdmZip = require('adm-zip');
const { databaseManager } = require('./database.cjs');
const { extractText, isRichDocument, RICH_DOCUMENT_EXTENSIONS } = require('./documentExtractor.cjs');
const doclingBridge = require('./doclingBridge.cjs');
const { setupMcpBridge, killAllMcpProcesses } = require('./mcpBridge.cjs');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('http').Server | null} */
let rendererServer = null;
/** @type {number | null} */
let rendererServerPort = null;
let isAppQuitting = false;
let lastEditableContextMenu = null;

app.setAppUserModelId('com.parallx.app');
app.name = 'Parallx';

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
    rendererServer.once('error', reject);
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

  return `http://127.0.0.1:${rendererServerPort}/`;
}

// ── Window bounds persistence ───────────────────────────────────────────────
// Save position, size, and maximized state to a JSON file so the window
// reopens on the same monitor in the same spot.

const WINDOW_STATE_FILE = path.join(
  app.getPath('userData'),
  'window-state.json',
);

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
    },
  };

  mainWindow = new BrowserWindow(opts);

  // Tell Windows taskbar this is "Parallx", not "Electron"
  mainWindow.setAppDetails({
    appId: 'com.parallx.app',
    appIconPath: path.join(__dirname, 'parallx.ico'),
    appIconIndex: 0,
    relaunchDisplayName: 'Parallx',
  });

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

  if (saved?.isMaximized) {
    mainWindow.maximize();
  }

  // ── D1: MCP Bridge ──
  setupMcpBridge(ipcMain, () => mainWindow);

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
  // Ensure user tools directory exists before anything tries to scan it
  const userToolsDir = path.join(app.getPath('home'), '.parallx', 'tools');
  try {
    await fs.mkdir(userToolsDir, { recursive: true });
  } catch { /* ignore — directory already exists */ }

  await createWindow();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  killAllMcpProcesses();
  if (rendererServer) {
    try { rendererServer.close(); } catch { /* ignore */ }
    rendererServer = null;
    rendererServerPort = null;
  }
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
 * Returns { builtinDir, userDir }.
 */
ipcMain.handle('tools:get-directories', async () => {
  const builtinDir = path.join(app.getAppPath(), 'tools');
  const userDir = path.join(app.getPath('home'), '.parallx', 'tools');
  return { builtinDir, userDir };
});

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
 * 4. Extracts to ~/.parallx/tools/<tool-id>/
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

    // 5. Extract to ~/.parallx/tools/<tool-id>/
    const userToolsDir = path.join(app.getPath('home'), '.parallx', 'tools');
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
 * Uninstall an external tool by removing its directory from ~/.parallx/tools/.
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

    const userToolsDir = path.join(app.getPath('home'), '.parallx', 'tools');
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

// ── fs:readFile ──
ipcMain.handle('fs:readFile', async (_event, filePath, encoding) => {
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
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// ── fs:rename ──
ipcMain.handle('fs:rename', async (_event, oldPath, newPath) => {
  try {
    await fs.rename(oldPath, newPath);
    return { error: null };
  } catch (err) {
    return { error: normalizeError(err, oldPath) };
  }
});

// ── fs:delete ──
ipcMain.handle('fs:delete', async (_event, filePath, options) => {
  try {
    const useTrash = options?.useTrash !== false; // default: true
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
    return { error: null };
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

// ── fs:mkdir ──
ipcMain.handle('fs:mkdir', async (_event, dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { error: null };
  } catch (err) {
    return { error: normalizeError(err, dirPath) };
  }
});

// ── fs:copy ──
ipcMain.handle('fs:copy', async (_event, source, destination) => {
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
  return result.canceled ? null : result.filePaths;
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
// Document Extraction IPC Handlers
// ════════════════════════════════════════════════════════════════════════════════
//
// Extracts plain text from rich document formats (PDF, Excel, Word) for the
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
    databaseManager.open(dbPath);

    // Run migrations if a directory is provided
    if (migrationsDir) {
      databaseManager.migrate(migrationsDir);
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
    databaseManager.migrate(migrationsDir);
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ── database:close ──
ipcMain.handle('database:close', async () => {
  try {
    databaseManager.close();
    return { error: null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

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
ipcMain.handle('database:run', async (_event, sql, params) => {
  try {
    const result = databaseManager.run(sql, normalizeDbParams(params));
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

// ── database:get ──
// Fetch a single row. Returns null if no match.
ipcMain.handle('database:get', async (_event, sql, params) => {
  try {
    const row = databaseManager.get(sql, normalizeDbParams(params));
    return { error: null, row: row || null };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ── database:all ──
// Fetch all matching rows.
ipcMain.handle('database:all', async (_event, sql, params) => {
  try {
    const rows = databaseManager.all(sql, normalizeDbParams(params));
    return { error: null, rows };
  } catch (err) {
    return { error: normalizeDatabaseError(err) };
  }
});

// ── database:isOpen ──
// Check if a database is currently open.
ipcMain.handle('database:isOpen', async () => {
  return { isOpen: databaseManager.isOpen };
});

// ── database:runTransaction ──
// Execute multiple operations inside a single IMMEDIATE transaction.
ipcMain.handle('database:runTransaction', async (_event, operations) => {
  try {
    // Normalize blob params before passing to better-sqlite3
    const normalizedOps = operations.map(op => ({
      ...op,
      params: normalizeDbParams(op.params),
    }));
    const rawResults = databaseManager.runTransaction(normalizedOps);
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

const WATCHER_IGNORE = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db', '__pycache__']);
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

// Clean up all watchers on window close
app.on('before-quit', () => {
  for (const [id] of _activeWatchers) {
    _cleanupWatcher(id);
  }
  // Kill all terminal sessions
  for (const [, entry] of _activeTerminals) {
    try { entry.proc.kill(); } catch { /* ignore */ }
  }
  _activeTerminals.clear();
  // Close the database cleanly on app quit
  databaseManager.close();
  // Shut down Docling bridge (M21)
  doclingBridge.stopService().catch(() => { /* best-effort */ });
});
