// electron/preload.cjs — Electron preload script
// Exposes a minimal API to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('parallxElectron', {
  platform: process.platform,
  // Window controls for the custom titlebar
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback) => {
    // Remove any previous listener to prevent stacking
    ipcRenderer.removeAllListeners('window:maximized-changed');
    ipcRenderer.on('window:maximized-changed', (_event, maximized) => callback(maximized));
  },
  // Tool scanning API
  scanToolDirectory: (dirPath) => ipcRenderer.invoke('tools:scan-directory', dirPath),
  getToolDirectories: () => ipcRenderer.invoke('tools:get-directories'),
});
