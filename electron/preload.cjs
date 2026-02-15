// electron/preload.cjs — Electron preload script
// Exposes a minimal API to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('parallxElectron', {
  platform: process.platform,
  testMode: process.env.PARALLX_TEST_MODE === '1',

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
});
