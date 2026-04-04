// electron/storageHandlers.cjs — IPC handlers for file-backed storage (M53)
//
// Provides three IPC channels (storage:read-json, storage:write-json,
// storage:exists) that the renderer uses via the preload bridge to persist
// global and workspace settings to JSON files instead of localStorage.

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Validate that a resolved file path is within an allowed storage directory.
 * Allowed roots:
 *   - <appRoot>/data/       (global settings)
 *   - any path containing /.parallx/  (workspace settings)
 *
 * Rejects path traversal (segments containing '..').
 *
 * @param {string} filePath — The absolute path to validate.
 * @param {string} appRoot — The application root directory.
 * @returns {string | null} — The normalized path, or null if rejected.
 */
function validateStoragePath(filePath, appRoot) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return null;
  }

  const normalized = path.resolve(filePath);

  // Reject path traversal — check for '..' in any segment
  const segments = normalized.split(path.sep);
  if (segments.some(s => s === '..')) {
    return null;
  }

  const dataRoot = path.join(appRoot, 'data');
  if (normalized.startsWith(dataRoot + path.sep) || normalized === dataRoot) {
    return normalized;
  }

  // Allow workspace storage paths that contain .parallx directory
  if (normalized.includes(`${path.sep}.parallx${path.sep}`)) {
    return normalized;
  }

  return null;
}

/**
 * Register storage IPC handlers on the given ipcMain instance.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {string} appRoot — Absolute path to the application root.
 */
function setupStorageHandlers(ipcMain, appRoot) {

  // ── storage:read-json ──
  // Reads a JSON file and returns the parsed object, or null if not found.
  ipcMain.handle('storage:read-json', async (_event, filePath) => {
    const safe = validateStoragePath(filePath, appRoot);
    if (!safe) {
      return { error: 'Invalid storage path' };
    }

    try {
      const raw = await fsp.readFile(safe, 'utf-8');
      try {
        return { data: JSON.parse(raw) };
      } catch {
        // Corrupt JSON — return null so the caller can overwrite on next write
        console.warn(`[Storage] Corrupt JSON in ${safe}, returning null`);
        return { data: null };
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { data: null };
      }
      return { error: err.message || String(err) };
    }
  });

  // ── storage:write-json ──
  // Writes data as JSON atomically (write to .tmp then rename).
  ipcMain.handle('storage:write-json', async (_event, filePath, data) => {
    const safe = validateStoragePath(filePath, appRoot);
    if (!safe) {
      return { error: 'Invalid storage path' };
    }

    try {
      // Ensure parent directory exists
      await fsp.mkdir(path.dirname(safe), { recursive: true });

      const json = JSON.stringify(data, null, 2);
      const tmpPath = safe + '.tmp';
      await fsp.writeFile(tmpPath, json, 'utf-8');
      await fsp.rename(tmpPath, safe);
      return { error: null };
    } catch (err) {
      // Clean up .tmp if rename failed
      try { await fsp.unlink(safe + '.tmp'); } catch { /* ignore */ }
      return { error: err.message || String(err) };
    }
  });

  // ── storage:exists ──
  // Returns boolean indicating whether the file exists.
  ipcMain.handle('storage:exists', async (_event, filePath) => {
    const safe = validateStoragePath(filePath, appRoot);
    if (!safe) {
      return false;
    }

    try {
      await fsp.access(safe);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { setupStorageHandlers };
