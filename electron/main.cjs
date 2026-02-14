// electron/main.cjs — Electron main process
// Uses CommonJS because Electron's main process doesn't support ESM by default.

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

/**
 * Create the Parallx "Prism P" logo as a nativeImage for the window icon.
 * Uses a 32×32 RGBA buffer drawn programmatically — no external files needed.
 */
function createAppIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4, 0); // RGBA

  // Brand color: #569cd6
  const R = 0x56, G = 0x9c, B = 0xd6;

  // Helper: set pixel with alpha blending
  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i]     = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  }

  // Fill a rect
  function fillRect(x0, y0, w, h, r, g, b, a) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        setPixel(x0 + dx, y0 + dy, r, g, b, a);
      }
    }
  }

  // Back face (offset shadow) — semi-transparent
  // Vertical stem: x=8..14, y=4..28
  fillRect(8, 4, 6, 24, R, G, B, 120);
  // Top bar: x=8..24, y=4..8
  fillRect(8, 4, 16, 4, R, G, B, 120);
  // Right curve top: x=22..24, y=8..14
  fillRect(22, 8, 2, 6, R, G, B, 120);
  // Bowl bottom: x=14..22, y=18..20
  fillRect(14, 18, 8, 2, R, G, B, 120);

  // Front face (main P shape) — full opacity
  // Vertical stem: x=6..12, y=6..28
  fillRect(6, 6, 6, 22, R, G, B, 220);
  // Top bar: x=6..22, y=6..10
  fillRect(6, 6, 16, 4, R, G, B, 220);
  // Right side of bowl: x=20..22, y=10..15
  fillRect(20, 10, 2, 5, R, G, B, 220);
  // Bowl bottom: x=12..22, y=15..18
  fillRect(12, 15, 10, 3, R, G, B, 220);

  // Clear inner bowl (transparent) — forms the P counter
  fillRect(12, 10, 8, 5, 0, 0, 0, 0);

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // Frameless for custom titlebar (like VS Code)
    frame: false,
    titleBarStyle: 'hidden',
    icon: createAppIcon(),
    // Dark background while loading
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

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
    if (closeConfirmed) return; // already confirmed — let it close
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

app.whenReady().then(createWindow);

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

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB guard

/**
 * Normalize a filesystem error into a structured { code, message, path } object.
 */
function normalizeError(err, filePath) {
  const code = err.code || 'EUNKNOWN';
  return { code, message: err.message || String(err), path: filePath || '' };
}

/**
 * Check if a buffer is likely binary by scanning for null bytes in the first 8KB.
 */
function isBinary(buffer) {
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
    if (stat.size > MAX_FILE_SIZE) {
      return { error: { code: 'ETOOLARGE', message: `File exceeds ${MAX_FILE_SIZE} byte limit`, path: filePath } };
    }
    const buffer = await fs.readFile(filePath);
    if (isBinary(buffer)) {
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
      await shell.trashItem(filePath);
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

      const changeType = eventType === 'rename' ? 'created' : 'changed';
      const fullPath = path.join(watchPath, filename);
      entry.pendingEvents.push({ type: changeType, path: fullPath });

      // Debounce: coalesce rapid changes
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        const events = entry.pendingEvents.splice(0);
        if (events.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
          // Deduplicate by path — keep last event per path
          const deduped = new Map();
          for (const e of events) deduped.set(e.path, e);
          mainWindow.webContents.send('fs:change', { watchId, events: [...deduped.values()] });
        }
      }, WATCHER_DEBOUNCE_MS);
    });

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

// Clean up all watchers on window close
app.on('before-quit', () => {
  for (const [id] of _activeWatchers) {
    _cleanupWatcher(id);
  }
});
