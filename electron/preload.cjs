// electron/preload.cjs — Electron preload script
// Exposes a minimal API to the renderer via contextBridge.

const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('parallxElectron', {
  platform: process.platform,
  testMode: process.env.PARALLX_TEST_MODE === '1',

  /** Absolute path to the application root directory. */
  appPath: process.cwd(),

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

  // ── Tool scanning API ──
  scanToolDirectory: (dirPath) => ipcRenderer.invoke('tools:scan-directory', dirPath),
  getToolDirectories: () => ipcRenderer.invoke('tools:get-directories'),

  // ── Tool install/uninstall API ──
  /** Open native file dialog for .plx files, extract and install. Returns install result. */
  installToolFromFile: () => ipcRenderer.invoke('tools:install-from-file'),
  /** Remove an external tool's directory. Returns { error: null } on success. */
  uninstallTool: (toolId) => ipcRenderer.invoke('tools:uninstall', toolId),

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
  // Shell API
  // ══════════════════════════════════════════════════════════════════════════

  shell: {
    /** Reveal file in OS native file manager (Explorer/Finder). */
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    /** Open file with the system default application. Returns error string or ''. */
    openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),
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

  // ══════════════════════════════════════════════════════════════════════════
  // Document Extraction API
  // ══════════════════════════════════════════════════════════════════════════

  document: {
    /** Extract plain text from a rich document (PDF, Excel, Word). Returns { text, format, metadata } or { error }. */
    extractText: (filePath) => ipcRenderer.invoke('document:extractText', filePath),

    /** Check if a file extension is a supported rich document format. Returns boolean. */
    isRichDocument: (ext) => ipcRenderer.invoke('document:isRichDocument', ext),

    /** Get array of supported rich document extensions. Returns string[]. */
    richExtensions: () => ipcRenderer.invoke('document:richExtensions'),
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
});
