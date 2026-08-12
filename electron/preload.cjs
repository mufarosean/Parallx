// electron/preload.cjs — Electron preload script
// Exposes a minimal API to the renderer via contextBridge.

const { contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');

contextBridge.exposeInMainWorld('parallxElectron', {
  platform: process.platform,
  testMode: process.env.PARALLX_TEST_MODE === '1',

  /** Absolute path to the application root directory. */
  appPath: process.cwd(),

  // ── Workspace switch teardown ──
  prepareWorkspaceSwitch: () => ipcRenderer.invoke('workspace:prepareSwitch'),

  // ── Window controls for the custom titlebar ──
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback) => {
    // Remove any previous listener to prevent stacking
    ipcRenderer.removeAllListeners('window:maximized-changed');
    ipcRenderer.on('window:maximized-changed', (_event, maximized) => callback(maximized));
  },

  // ── Lifecycle: unsaved changes guard ──
  /** Register a callback that fires before the window closes (dirty check). */
  onBeforeClose: (callback) => {
    ipcRenderer.removeAllListeners('lifecycle:beforeClose');
    ipcRenderer.on('lifecycle:beforeClose', () => callback());
  },
  /** Confirm that close may proceed (called after save/discard decision). */
  confirmClose: () => ipcRenderer.send('lifecycle:confirmClose'),
  /**
   * Tell main the close is COMMITTED (teardown started). From this point a
   * second-instance launch queues an automatic relaunch instead of poking the
   * dying window.
   */
  notifyClosing: () => ipcRenderer.send('lifecycle:closing'),
  /** Hide window immediately (called before slow teardown to prevent UI flash). */
  hideWindow: () => ipcRenderer.send('lifecycle:hideWindow'),

  // ── Tool scanning API ──
  scanToolDirectory: (dirPath) => ipcRenderer.invoke('tools:scan-directory', dirPath),
  getToolDirectories: () => ipcRenderer.invoke('tools:get-directories'),

  // ── Tool install/uninstall API ──
  /** Open native file dialog for .plx files, extract and install. Returns install result. */
  installToolFromFile: () => ipcRenderer.invoke('tools:install-from-file'),
  /** Remove an external tool's directory. Returns { error: null } on success. */
  uninstallTool: (toolId) => ipcRenderer.invoke('tools:uninstall', toolId),
  /** Read a tool module's source code for blob URL loading (external tools only). Returns { source } or { error }. */
  readToolModule: (filePath) => ipcRenderer.invoke('tools:read-module', filePath),

  // ── Native OS drag-and-drop ──
  /**
   * Initiate a real OS-level file drag so the user can drop files into
   * external apps (Discord, Explorer, browser uploads, etc.).
   * MUST be called synchronously from a `dragstart` handler. The HTML5
   * DataTransfer object should typically be left empty (or set with
   * preventDefault()) since startDrag takes over.
   *
   * @param {{ filePaths: string | string[], iconDataUrl?: string }} payload
   */
  startDrag: (payload) => ipcRenderer.invoke('shell:startDrag', payload),

  // ══════════════════════════════════════════════════════════════════════════
  // Filesystem API (M4 Cap 0)
  // ══════════════════════════════════════════════════════════════════════════

  fs: {
    /** Read file content. Returns { content, encoding, size, mtime } or { error }. */
    readFile: (filePath, encoding) => ipcRenderer.invoke('fs:readFile', filePath, encoding),

    /** Write content to file. Returns { error: null } on success or { error }. */
    writeFile: (filePath, content, encoding) => ipcRenderer.invoke('fs:writeFile', filePath, content, encoding),

    /** Get file/directory stat. Returns { type, size, mtime, ctime, isReadonly } or { error }. */
    stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),

    /** List directory entries. Returns { entries: [{ name, type, size, mtime }] } or { error }. */
    readdir: (dirPath) => ipcRenderer.invoke('fs:readdir', dirPath),

    /** Check if path exists. Returns boolean. */
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),

    /**
     * Streaming media fingerprint computed in a main-process worker pool:
     * full-contents MD5 plus (with options.oshash) the 64KB head/tail oshash.
     * Returns { md5, oshash, size } or { error }.
     */
    hashFile: (filePath, options) => ipcRenderer.invoke('fs:hashFile', filePath, options),

    /** Rename/move a file or directory. Returns { error: null } on success or { error }. */
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),

    /** Delete a file or directory. Options: { useTrash?: boolean, recursive?: boolean }. */
    delete: (filePath, options) => ipcRenderer.invoke('fs:delete', filePath, options),

    /** Create directory (recursive). Returns { error: null } on success or { error }. */
    mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),

    /** Copy file or directory. Returns { error: null } on success or { error }. */
    copy: (source, destination) => ipcRenderer.invoke('fs:copy', source, destination),

    /** Start watching a path. Returns { watchId } or { error }. */
    watch: (watchPath, options) => ipcRenderer.invoke('fs:watch', watchPath, options),

    /** Stop watching. Returns { error: null }. */
    unwatch: (watchId) => ipcRenderer.invoke('fs:unwatch', watchId),

    /**
     * Register the current workspace root with the main process for write-path
     * validation (M67 Phase 2.4). Call this when a workspace is opened or
     * switched. Pass null to clear the root (unrestricted mode).
     */
    setWorkspaceRoot: (rootPath) => ipcRenderer.invoke('fs:setWorkspaceRoot', rootPath),

    /**
     * Register user-blessed external folders (e.g. media-organizer scan
     * roots) that live outside the workspace but should be writable/readable
     * by extensions. Pass the full list each call — the main process
     * replaces the previous set. Only pass paths the user explicitly added
     * through an extension UI.
     */
    registerExtraRoots: (roots) => ipcRenderer.invoke('fs:registerExtraRoots', roots),

    /**
     * Returns { ok: boolean } — whether `filePath` is an allowed WRITE target
     * (inside the workspace root / data dir / extra roots) AND a workspace is
     * actually open. Use this to validate paths handed to a spawned process
     * (e.g. ffmpeg), which bypasses the fs:* gate entirely.
     */
    isInWorkspace: (filePath) => ipcRenderer.invoke('fs:isInWorkspace', filePath),

    /**
     * Subscribe to file change events.
     * Callback receives { watchId, events: [{ type: 'created'|'changed'|'deleted', path }] }
     * or { watchId, error }.
     * Returns an unsubscribe function.
     */
    onDidChange: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('fs:change', handler);
      return () => ipcRenderer.removeListener('fs:change', handler);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Screen Recorder API (media-organizer)
  // ══════════════════════════════════════════════════════════════════════════
  // Opens a transparent always-on-top framing window; ffmpeg (in main) records
  // the hollow inner rect to the caller-provided, in-workspace output path.
  recorder: {
    /** Open the framing window. opts: { ffmpegPath, outputPath, fps, width, height, audio }. Returns { frameId } or { error }. */
    openFrame: (opts) => ipcRenderer.invoke('recorder:openFrame', opts),
    /** Whether any recorder frame is currently open ({ active }). Used to self-heal a stale in-progress flag. */
    anyActive: () => ipcRenderer.invoke('recorder:anyActive'),
    /** Fires when a recording finishes/cancels: { frameId, path, ok, cancelled? }. Returns an unsubscribe fn. */
    onComplete: (callback) => {
      const handler = (_event, payload) => { try { callback(payload); } catch { /* ignore */ } };
      ipcRenderer.on('recorder:complete', handler);
      return () => ipcRenderer.removeListener('recorder:complete', handler);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Shell API
  // ══════════════════════════════════════════════════════════════════════════

  shell: {
    /** Reveal file in OS native file manager (Explorer/Finder). */
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    /** Open file with the system default application. Returns error string or ''. */
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
    /**
     * Open an external http(s) URL in the user's default browser.
     * Main-process validation: only `http://` and `https://` are accepted;
     * any other scheme (`file://`, `javascript:`, custom protocols, etc.) is rejected.
     * Returns { ok: true } on success or { ok: false, error } on rejection.
     * (M60 §T6.F2 — Gmail OAuth desktop flow.)
     */
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Secret Storage API (M60 §T6.F3 — encrypted token storage)
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Backed by Electron's `app.safeStorage` (DPAPI on Windows, Keychain on
  // macOS, libsecret on Linux). Encrypted blobs are written to
  // `<APP_ROOT>/data/secrets/<sha256(key)[:32]>.enc` so they travel with
  // the portable install (M53 contract — see GMAIL_MCP_INTEGRATION.md).
  //
  // Key allowlist regex: `^[a-zA-Z0-9._-]{1,128}$`. Values are passed as
  // base64-encoded strings to avoid utf8 round-tripping.

  secret: {
    /** Store a base64-encoded value under `key`. Returns { ok, error? }. */
    set: (key, valueB64) => ipcRenderer.invoke('secret:set', key, valueB64),
    /** Retrieve the base64 value for `key`. Returns { ok, valueB64?, error? }. */
    get: (key) => ipcRenderer.invoke('secret:get', key),
    /** Remove the encrypted blob for `key`. Returns { ok, error? }. */
    delete: (key) => ipcRenderer.invoke('secret:delete', key),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Database API (M6 Cap 1 — SQLite via main process)
  // ══════════════════════════════════════════════════════════════════════════

  database: {
    /**
     * Open a workspace database. Creates <workspacePath>/.parallx/data.db
     * and runs migrations from migrationsDir if provided.
     * @param {string} workspacePath — absolute path to the workspace root
     * @param {string} [migrationsDir] — absolute path to migrations folder
     * @returns {Promise<{ error: null, dbPath: string } | { error: { code: string, message: string } }>}
     */
    open: (workspacePath, migrationsDir) =>
      ipcRenderer.invoke('database:open', workspacePath, migrationsDir),

    /**
     * Run migrations from a directory on the currently-open database.
     * @param {string} migrationsDir — absolute path to migrations folder
     * @returns {Promise<{ error: null } | { error: { code: string, message: string } }>}
     */
    migrate: (migrationsDir) =>
      ipcRenderer.invoke('database:migrate', migrationsDir),

    /**
     * Close the current database.
     * @returns {Promise<{ error: null } | { error: { code: string, message: string } }>}
     */
    close: () => ipcRenderer.invoke('database:close'),

    /**
     * Execute SQL (INSERT, UPDATE, DELETE, CREATE, etc.).
     * @param {string} sql — SQL statement
     * @param {any[]} [params] — bound parameters
     * @returns {Promise<{ error: null, changes: number, lastInsertRowid: number } | { error: { code: string, message: string } }>}
     */
    run: (sql, params) => ipcRenderer.invoke('database:run', sql, params),

    /**
     * Fetch a single row. Returns null if no match.
     * @param {string} sql — SQL query
     * @param {any[]} [params] — bound parameters
     * @returns {Promise<{ error: null, row: object | null } | { error: { code: string, message: string } }>}
     */
    get: (sql, params) => ipcRenderer.invoke('database:get', sql, params),

    /**
     * Fetch all matching rows.
     * @param {string} sql — SQL query
     * @param {any[]} [params] — bound parameters
     * @returns {Promise<{ error: null, rows: object[] } | { error: { code: string, message: string } }>}
     */
    all: (sql, params) => ipcRenderer.invoke('database:all', sql, params),

    /**
     * Check if a database is currently open.
     * @returns {Promise<{ isOpen: boolean }>}
     */
    isOpen: () => ipcRenderer.invoke('database:isOpen'),

    /**
     * Execute multiple operations inside a single IMMEDIATE transaction.
     * Each op is { type: 'run'|'get'|'all', sql: string, params?: any[] }.
     * @param {{ type: string, sql: string, params?: any[] }[]} operations
     * @returns {Promise<{ error: null, results: any[] } | { error: { code: string, message: string } }>}
     */
    runTransaction: (operations) =>
      ipcRenderer.invoke('database:runTransaction', operations),

    /**
     * Drop all tables and migration records belonging to an external tool.
     * @param {string} migrationPrefix — prefix of migration filenames (e.g. 'media-organizer')
     * @param {string} tablePrefix — prefix of table names (e.g. 'mo_')
     * @returns {Promise<{ error: null, droppedTables: string[], removedMigrations: number } | { error: { code: string, message: string } }>}
     */
    dropToolData: (migrationPrefix, tablePrefix) =>
      ipcRenderer.invoke('database:dropToolData', migrationPrefix, tablePrefix),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Extension Database API — per-extension isolated SQLite databases
  // ══════════════════════════════════════════════════════════════════════════

  extensionDatabase: {
    open: (extensionId, workspacePath) =>
      ipcRenderer.invoke('ext-database:open', extensionId, workspacePath),
    close: (extensionId) =>
      ipcRenderer.invoke('ext-database:close', extensionId),
    migrate: (extensionId, migrationsDir) =>
      ipcRenderer.invoke('ext-database:migrate', extensionId, migrationsDir),
    run: (extensionId, sql, params) =>
      ipcRenderer.invoke('ext-database:run', extensionId, sql, params),
    get: (extensionId, sql, params) =>
      ipcRenderer.invoke('ext-database:get', extensionId, sql, params),
    all: (extensionId, sql, params) =>
      ipcRenderer.invoke('ext-database:all', extensionId, sql, params),
    isOpen: (extensionId) =>
      ipcRenderer.invoke('ext-database:isOpen', extensionId),
    runTransaction: (extensionId, operations) =>
      ipcRenderer.invoke('ext-database:runTransaction', extensionId, operations),
    closeAll: () =>
      ipcRenderer.invoke('ext-database:closeAll'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Dialog API (M4 Cap 0)
  // ══════════════════════════════════════════════════════════════════════════

  dialog: {
    /** Open native file picker. Returns string[] of selected paths, or null if cancelled. */
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),

    /** Open native folder picker. Returns string[] of selected paths, or null if cancelled. */
    openFolder: (options) => ipcRenderer.invoke('dialog:openFolder', options),

    /** Open native save dialog. Returns string path, or null if cancelled. */
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),

    /**
     * Show a native message box (e.g. "Save before closing?").
     * Returns { response: number, checkboxChecked: boolean }.
     */
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),
  },

  // ── Clipboard API ──
  clipboard: {
    readText: () => clipboard.readText(),
    readHTML: () => clipboard.readHTML(),
    writeText: (text) => clipboard.writeText(text ?? ''),
  },

  editableMenu: {
    onOpen: (callback) => {
      ipcRenderer.removeAllListeners('editableMenu:open');
      ipcRenderer.on('editableMenu:open', (_event, payload) => callback(payload));
    },
    replaceMisspelling: (suggestion) => ipcRenderer.invoke('editableMenu:replaceMisspelling', suggestion),
    addToDictionary: (word) => ipcRenderer.invoke('editableMenu:addToDictionary', word),
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Web Research API (M65 — ext/web-research/ chokepoint)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // SECURITY: This is the ONLY outbound HTTP channel the web-research
  // extension may use. See electron/webFetchBridge.cjs for the egress
  // controls (DNS allowlist, blocklist, HTTPS-only, redirect re-resolve,
  // body/timeout caps, fixed UA, no cookies/auth/referer).

  webFetch: {
    /** Fetch a single URL through the egress chokepoint. Returns { ok, result?, error? }. */
    request: (opts) => ipcRenderer.invoke('webFetch:request', opts),
    /** Reset the per-turn fetch backstop counter for the given turnId. */
    resetTurn: (turnId) => ipcRenderer.invoke('webFetch:resetTurn', turnId),
  },

  webSearch: {
    /** Call Brave Search API (host-locked). Returns { ok, result?, error? }. */
    request: (opts) => ipcRenderer.invoke('webSearch:request', opts),
  },

  // ── PDF export (M93 — canvas print-to-PDF) ──
  pdfExport: {
    /**
     * Render standalone HTML to PDF in a hidden sandboxed window.
     * Returns { ok, data?: base64, error? }; also writes `savePath` when given.
     */
    render: (payload) => ipcRenderer.invoke('pdfExport:render', payload),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Document Extraction API
  // ══════════════════════════════════════════════════════════════════════════

  anki: {
    /**
     * Parse an Anki export (.apkg or "Notes in Plain Text" .txt) into decks of
     * plain-text cards. Returns { ok, decks:[{name, cards:[{front,back,tags}]}],
     * cardCount, mediaSkipped } or { ok:false, error }.
     */
    read: (filePath) => ipcRenderer.invoke('anki:read', filePath),
  },

  /**
   * Filesystem path of an OS-dragged File object. Electron removed the
   * nonstandard File.path in v32; this is the sanctioned replacement and the
   * only way a renderer drop zone can resolve a real path. Returns '' when
   * the File has no backing path (e.g. a browser-synthesized file).
   */
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },

  document: {
    /** Extract plain text from a rich document (PDF, Excel, Word, EPUB). Returns { text, format, metadata } or { error }. */
    extractText: (filePath) => ipcRenderer.invoke('document:extractText', filePath),

    /** Full workbook cell grid (values + formulas + merges + widths) for the
     *  Worksheets practice-item importer. Returns { sheets } or { error }. */
    extractWorkbookGrid: (filePath) => ipcRenderer.invoke('document:extractWorkbookGrid', filePath),

    /** Extract sanitized EPUB reader chapters. Returns { title, chapters, metadata } or { error }. */
    readEpub: (filePath) => ipcRenderer.invoke('document:readEpub', filePath),

    /** Render a Word (.docx) file as HTML for the viewer. Returns { title, html, messages } or { error }. */
    readDocx: (filePath) => ipcRenderer.invoke('document:readDocx', filePath),

    /** Read a spreadsheet into per-sheet rows for the viewer. Returns { title, sheets } or { error }. */
    readSpreadsheet: (filePath) => ipcRenderer.invoke('document:readSpreadsheet', filePath),

    /** Check if a file extension is a supported rich document format. Returns boolean. */
    isRichDocument: (ext) => ipcRenderer.invoke('document:isRichDocument', ext),

    /** Get array of supported rich document extensions. Returns string[]. */
    richExtensions: () => ipcRenderer.invoke('document:richExtensions'),
  },

  // ── Dashboard image/GIF assets (file-backed, served over parallx-asset://) ──
  dashboardAssets: {
    /** Persist uploaded image bytes to disk. Returns { id } or { error }. */
    save: (bytes, mime) => ipcRenderer.invoke('dashboardAsset:save', bytes, mime),
    /** Delete a stored asset by id (best-effort). */
    delete: (id) => ipcRenderer.invoke('dashboardAsset:delete', id),
    /**
     * M86 C3: read a .csv/.tsv/.xlsx/.xls as structured rows for the
     * Table/Chart widget. Returns { header, rows, sheetNames, totalRows }
     * or { error }.
     */
    readTable: (filePath, opts) => ipcRenderer.invoke('dashboard:readTable', filePath, opts),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Terminal API (M11 Phase 4 — Task 4.1)
  // ══════════════════════════════════════════════════════════════════════════

  terminal: {
    /** Execute a single command and return stdout/stderr/exitCode. */
    exec: (command, options) => ipcRenderer.invoke('terminal:exec', command, options),

    /** Spawn an interactive shell session. Returns { id }. */
    spawn: (options) => ipcRenderer.invoke('terminal:spawn', options),

    /** Send data to a spawned shell. */
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),

    /** Kill a spawned shell. */
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),

    /** Get recent terminal output buffer. */
    getOutput: (lineCount) => ipcRenderer.invoke('terminal:getOutput', lineCount),

    /** Which venv a NEW shell would activate. Returns { active, venvPath, binDir }. */
    envInfo: (workspaceRoot) => ipcRenderer.invoke('terminal:envInfo', workspaceRoot),

    /** Which venv a RUNNING shell was started with. Returns { ok, venv }. */
    sessionEnv: (id) => ipcRenderer.invoke('terminal:sessionEnv', id),

    /** Subscribe to terminal output data. Returns unsubscribe function. */
    onData: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },

    /** Subscribe to terminal exit events. Returns unsubscribe function. */
    onExit: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },

    /**
     * Run an executable with argv (no shell parsing) and stream stdout/stderr
     * back chunk-by-chunk via the provided callbacks. Returns a Promise that
     * resolves with { exitCode, error }. Used for long-running commands where
     * progress needs to be observed in real time (e.g. ffmpeg `-progress`).
     *
     * @param {{command:string, args?:string[], cwd?:string, timeout?:number}} payload
     * @param {{onStdout?:(chunk:string)=>void, onStderr?:(chunk:string)=>void}} handlers
     * @returns {Promise<{exitCode:number, error:any, cancel:()=>Promise<void>}>}
     *
     * The returned object exposes a `cancel()` to terminate early; the same
     * promise then resolves with exitCode -1.
     */
    execStream: (payload, handlers = {}) => {
      // Generate the streamId on the renderer side so we can register the
      // data/exit listeners *before* the spawn happens in main — otherwise
      // a fast-failing process (e.g. ENOENT on the command path) emits its
      // exit event before our listener is attached, and the promise hangs
      // forever.
      const streamId = `xstream-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      let onDataHandler = null;
      let onExitHandler = null;
      let started = false;
      const promise = new Promise((resolve) => {
        onDataHandler = (_event, p) => {
          if (!p || p.streamId !== streamId) return;
          if (p.channel === 'stdout' && handlers.onStdout) handlers.onStdout(p.chunk);
          else if (p.channel === 'stderr' && handlers.onStderr) handlers.onStderr(p.chunk);
        };
        onExitHandler = (_event, p) => {
          if (!p || p.streamId !== streamId) return;
          ipcRenderer.removeListener('terminal:execStream:data', onDataHandler);
          ipcRenderer.removeListener('terminal:execStream:exit', onExitHandler);
          resolve({ exitCode: p.exitCode, error: p.error });
        };
        ipcRenderer.on('terminal:execStream:data', onDataHandler);
        ipcRenderer.on('terminal:execStream:exit', onExitHandler);
        // Now safe to ask main to spawn — any events it emits will find us.
        ipcRenderer.invoke('terminal:execStream:start', { ...(payload || {}), streamId })
          .then((res) => {
            started = true;
            if (res?.error) {
              ipcRenderer.removeListener('terminal:execStream:data', onDataHandler);
              ipcRenderer.removeListener('terminal:execStream:exit', onExitHandler);
              resolve({ exitCode: -1, error: res.error });
            }
          })
          .catch((err) => {
            ipcRenderer.removeListener('terminal:execStream:data', onDataHandler);
            ipcRenderer.removeListener('terminal:execStream:exit', onExitHandler);
            resolve({ exitCode: -1, error: { code: 'EXEC_STREAM_FAILED', message: err?.message || String(err) } });
          });
      });
      // Attach cancel to the promise so callers can abort an in-flight stream.
      promise.cancel = async () => {
        if (!started) {
          // Race: cancel called before start resolved. We can still ask main
          // to cancel by streamId since main now uses our pre-generated one.
        }
        await ipcRenderer.invoke('terminal:execStream:cancel', streamId);
      };
      return promise;
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MCP Bridge API (D1 — Model Context Protocol)
  // ══════════════════════════════════════════════════════════════════════════

  mcp: {
    spawn: (serverId, command, args, env) =>
      ipcRenderer.invoke('mcp:spawn', serverId, command, args, env),
    send: (serverId, message) =>
      ipcRenderer.invoke('mcp:send', serverId, message),
    kill: (serverId) =>
      ipcRenderer.invoke('mcp:kill', serverId),
    oauthBootstrap: (serverId, command, args, env) =>
      ipcRenderer.invoke('mcp:oauth-bootstrap', serverId, command, args, env),
    onMessage: (callback) => {
      const handler = (_event, serverId, data) => callback(serverId, data);
      ipcRenderer.on('mcp:message', handler);
      return () => ipcRenderer.removeListener('mcp:message', handler);
    },
    onExit: (callback) => {
      const handler = (_event, serverId, code) => callback(serverId, code);
      ipcRenderer.on('mcp:exit', handler);
      return () => ipcRenderer.removeListener('mcp:exit', handler);
    },
    onOauthStderr: (callback) => {
      const handler = (_event, serverId, text) => callback(serverId, text);
      ipcRenderer.on('mcp:oauth-stderr', handler);
      return () => ipcRenderer.removeListener('mcp:oauth-stderr', handler);
    },
    onOauthUrl: (callback) => {
      const handler = (_event, serverId, url) => callback(serverId, url);
      ipcRenderer.on('mcp:oauth-url', handler);
      return () => ipcRenderer.removeListener('mcp:oauth-url', handler);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Google Sync API — planner two-way Google Calendar / Tasks sync
  // ══════════════════════════════════════════════════════════════════════════
  //
  // OAuth + all Google REST calls run in the main process (electron/
  // googleSyncBridge.cjs). The refresh token lives only in main + safeStorage;
  // the renderer never sees it. `fetch` is host-allowlisted to www.googleapis.com.

  google: {
    /** Run the OAuth consent flow. Opens the browser; resolves { ok, email }. */
    authorize: (scopes) => ipcRenderer.invoke('google:authorize', scopes),
    /** { connected, email, hasClient } — whether a token + OAuth client exist. */
    status: () => ipcRenderer.invoke('google:status'),
    /** Clear the stored refresh token + cached account. */
    disconnect: () => ipcRenderer.invoke('google:disconnect'),
    /** Authenticated Google API call: { method, url, body? } → { ok, status, data, error? }. */
    fetch: (opts) => ipcRenderer.invoke('google:fetch', opts),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Claude (Anthropic) cloud model bridge
  // ══════════════════════════════════════════════════════════════════════════
  //
  // The API key lives ONLY in the main process (safeStorage); the renderer never
  // sees it. Streaming /v1/messages runs in main and is relayed here as
  // `anthropic:event` pushes. See electron/anthropicBridge.cjs.

  anthropic: {
    /** Whether an API key is stored. */
    hasKey: () => ipcRenderer.invoke('anthropic:hasKey'),
    /** Store the API key (main-process safeStorage). */
    setKey: (key) => ipcRenderer.invoke('anthropic:setKey', key),
    /** Delete the stored API key. */
    clearKey: () => ipcRenderer.invoke('anthropic:clearKey'),
    /** Begin a streaming request; chunks arrive via onStreamEvent. */
    startStream: (requestId, body) => ipcRenderer.invoke('anthropic:start', { requestId, body }),
    /** Cancel an in-flight request. */
    abortStream: (requestId) => ipcRenderer.invoke('anthropic:abort', requestId),
    /** Subscribe to relayed stream events; returns an unsubscribe fn. */
    onStreamEvent: (cb) => {
      const listener = (_e, payload) => { try { cb(payload); } catch { /* consumer error */ } };
      ipcRenderer.on('anthropic:event', listener);
      return () => ipcRenderer.removeListener('anthropic:event', listener);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Storage API (M53 — Portable file-backed storage)
  // ══════════════════════════════════════════════════════════════════════════

  storage: {
    readJson: (filePath) => ipcRenderer.invoke('storage:read-json', filePath),
    writeJson: (filePath, data) => ipcRenderer.invoke('storage:write-json', filePath, data),
    exists: (filePath) => ipcRenderer.invoke('storage:exists', filePath),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Docling Bridge API (M21 Phase A)
  // ══════════════════════════════════════════════════════════════════════════

  docling: {
    /** Get Docling bridge status. Returns { status, port, pythonPath, doclingInstalled }. */
    status: () => ipcRenderer.invoke('docling:status'),

    /** Start the Docling bridge service. Returns { ok, status, ... }. */
    start: () => ipcRenderer.invoke('docling:start'),

    /** Convert a single document. Returns { ok, markdown, page_count, tables_found, ... } or { ok: false, error }. */
    convert: (filePath, options) => ipcRenderer.invoke('docling:convert', filePath, options),

    /** Convert multiple documents. Returns { ok, results } or { ok: false, error }. */
    convertBatch: (files) => ipcRenderer.invoke('docling:convertBatch', files),

    /** Install Docling via pip. Returns { ok, pythonPath, output, alreadyInstalled }. */
    install: () => ipcRenderer.invoke('docling:install'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Per-workspace Python runtime (M94)
  //
  // Every call takes an explicit workspaceRoot — the main process never
  // assumes which workspace is current. The consent gate (`python.enabled`)
  // lives in the renderer service, not here.
  // ══════════════════════════════════════════════════════════════════════════

  python: {
    /** Environment status for a workspace. Never creates anything. */
    status: (workspaceRoot) => ipcRenderer.invoke('python:status', workspaceRoot),

    /** Recursive size of the environment. Returns { ok, sizeBytes, fileCount }. */
    envSize: (workspaceRoot) => ipcRenderer.invoke('python:envSize', workspaceRoot),

    /** Create <workspace>/.parallx/venv. Idempotent. */
    createEnv: (workspaceRoot) => ipcRenderer.invoke('python:createEnv', workspaceRoot),

    /** Delete the environment. Scripts and outputs are untouched. */
    removeEnv: (workspaceRoot) => ipcRenderer.invoke('python:removeEnv', workspaceRoot),

    /** pip install. Specifiers are validated in the main process. */
    install: (workspaceRoot, packages) => ipcRenderer.invoke('python:install', workspaceRoot, packages),

    /** pip uninstall. */
    uninstall: (workspaceRoot, packages) => ipcRenderer.invoke('python:uninstall', workspaceRoot, packages),

    /** Installed packages: { ok, packages: [{ name, version }] }. */
    listPackages: (workspaceRoot) => ipcRenderer.invoke('python:listPackages', workspaceRoot),

    /** Start a script. Returns { ok, runId, outDir } — output arrives on the subscriptions below. */
    runScript: (payload) => ipcRenderer.invoke('python:runScript', payload),

    /** Stop a run. */
    cancelRun: (runId) => ipcRenderer.invoke('python:cancelRun', runId),

    /**
     * Subscribe to live output from long environment operations (create,
     * install, uninstall). Returns an unsubscribe function.
     */
    onProgress: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('python:progress', handler);
      return () => ipcRenderer.removeListener('python:progress', handler);
    },

    /** Which formatters (black / ruff) are importable here. */
    detectFormatters: (workspaceRoot) => ipcRenderer.invoke('python:detectFormatters', workspaceRoot),

    /** Format source over stdin. Returns { ok, formatted } or { ok: false, error }. */
    format: (workspaceRoot, source, tool) => ipcRenderer.invoke('python:format', workspaceRoot, source, tool),

    /** Subscribe to streamed run output. Returns an unsubscribe function. */
    onRunData: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('python:run:data', handler);
      return () => ipcRenderer.removeListener('python:run:data', handler);
    },

    /** Subscribe to run completion. Returns an unsubscribe function. */
    onRunExit: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('python:run:exit', handler);
      return () => ipcRenderer.removeListener('python:run:exit', handler);
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Notebook kernel (M96)
  //
  // One Jupyter kernel per workspace, hosted by tools/jupyter-bridge/
  // parallx_kernel_host.py. Every call names its workspace explicitly.
  // ══════════════════════════════════════════════════════════════════════════

  notebookKernel: {
    /** Kernel status without starting one. */
    status: (workspaceRoot) => ipcRenderer.invoke('notebook:kernel:status', workspaceRoot),

    /** Whether ipykernel is importable in the workspace environment. */
    checkDeps: (workspaceRoot) => ipcRenderer.invoke('notebook:kernel:checkDeps', workspaceRoot),

    /** Start the kernel. Idempotent. */
    start: (workspaceRoot) => ipcRenderer.invoke('notebook:kernel:start', workspaceRoot),

    /** Stop it, gracefully then forcibly. */
    stop: (workspaceRoot) => ipcRenderer.invoke('notebook:kernel:stop', workspaceRoot),

    /** Queue code. Output arrives on the event subscription below. */
    execute: (workspaceRoot, requestId, code) =>
      ipcRenderer.invoke('notebook:kernel:execute', workspaceRoot, requestId, code),

    /** Completion candidates at a cursor position. */
    complete: (workspaceRoot, requestId, code, cursorPos) =>
      ipcRenderer.invoke('notebook:kernel:complete', workspaceRoot, requestId, code, cursorPos),

    /** SIGINT the running cell. */
    interrupt: (workspaceRoot, requestId) =>
      ipcRenderer.invoke('notebook:kernel:interrupt', workspaceRoot, requestId),

    /** Restart — every variable is lost. */
    restart: (workspaceRoot, requestId) =>
      ipcRenderer.invoke('notebook:kernel:restart', workspaceRoot, requestId),

    /** Subscribe to kernel events. Returns an unsubscribe function. */
    onEvent: (callback) => {
      const handler = (_e, payload) => callback(payload);
      ipcRenderer.on('notebook:kernel:event', handler);
      return () => ipcRenderer.removeListener('notebook:kernel:event', handler);
    },
  },
});
