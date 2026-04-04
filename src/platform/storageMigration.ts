// storageMigration.ts — One-time migration from localStorage to file-backed storage (M53 D5)
//
// Detects old localStorage data (keyed by UUID-based workspace identity),
// extracts it, and writes to the new file-backed storage locations:
// - Global data → globalStorage (data/global-storage.json)
// - Workspace data → per-workspace storage (<folder>/.parallx/workspace-state.json)
// - Recent workspaces → transformed to path-based entries
//
// Safe to run multiple times: gated by sentinel key in localStorage.
// Never blocks startup: all errors are caught and logged.

import type { IStorage } from './storage.js';
import type { IStorageBridge } from './fileBackedStorage.js';

/** Sentinel key — presence means old data exists and migration hasn't completed. */
const SENTINEL_KEY = 'parallx:parallx.activeWorkspaceId';

/**
 * Run the one-time localStorage → file-backed storage migration.
 * Returns immediately if no old data is detected.
 */
export async function migrateFromLocalStorage(
  globalStorage: IStorage,
  _workspaceStorage: IStorage,
  _wsPath: string | undefined,
  bridge: IStorageBridge,
  _appPath: string,
): Promise<void> {
  try {
    if (localStorage.getItem(SENTINEL_KEY) === null) {
      return; // Fresh install or already migrated — nothing to do
    }

    console.log('[M53 Migration] Old localStorage data detected — starting migration');
    const errors: string[] = [];

    // D5.2: Migrate global data
    try {
      migrateGlobalData(globalStorage);
    } catch (err) {
      errors.push(`Global data: ${err}`);
      console.error('[M53 Migration] Global data migration failed:', err);
    }

    // D5.3: Migrate workspace data
    try {
      await migrateWorkspaceData(bridge);
    } catch (err) {
      errors.push(`Workspace data: ${err}`);
      console.error('[M53 Migration] Workspace data migration failed:', err);
    }

    // D5.4: Migrate + transform recent workspaces
    try {
      await migrateRecentWorkspaces(globalStorage);
    } catch (err) {
      errors.push(`Recent workspaces: ${err}`);
      console.error('[M53 Migration] Recent workspaces migration failed:', err);
    }

    // D5.7 + D5.8: Post-migration cleanup — clear localStorage regardless of errors
    localStorage.clear();
    if (errors.length === 0) {
      console.log('[M53 Migration] Complete — localStorage cleared');
    } else {
      console.warn('[M53 Migration] Completed with %d errors:', errors.length, errors);
    }
  } catch (err) {
    // Never block startup
    console.error('[M53 Migration] Unexpected error — skipping migration:', err);
  }
}

// ─── D5.2: Global data ──────────────────────────────────────────────────────

const GLOBAL_PREFIX = 'parallx-global:';

/** Known direct-consumer keys stored without namespace prefix. */
const DIRECT_GLOBAL_KEYS = [
  'parallx.colorTheme',
  'parallx.userThemes',
  'parallx.pdfOutlineWidth',
  'parallx.pdfScaleValue',
  'parallx.chat.disabledTools',
];

function migrateGlobalData(globalStorage: IStorage): void {
  // Migrate namespaced global keys (strip prefix)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    if (key.startsWith(GLOBAL_PREFIX)) {
      const strippedKey = key.slice(GLOBAL_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value !== null) {
        globalStorage.set(strippedKey, value); // fire-and-forget
      }
    }
  }

  // Migrate known direct-consumer keys (same key, just move to file storage)
  for (const key of DIRECT_GLOBAL_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      globalStorage.set(key, value);
    }
  }

  console.log('[M53 Migration] Global data migrated');
}

// ─── D5.3: Workspace data ────────────────────────────────────────────────────

const WS_STATE_PATTERN = /^parallx:parallx\.workspace\.([a-f0-9-]+)\.state$/;

async function migrateWorkspaceData(bridge: IStorageBridge): Promise<void> {
  // Collect workspace UUIDs and their state blobs
  const workspaces = new Map<string, string>(); // uuid → state JSON

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    const match = key.match(WS_STATE_PATTERN);
    if (match) {
      const uuid = match[1];
      const value = localStorage.getItem(key);
      if (value) workspaces.set(uuid, value);
    }
  }

  const activeUuid = localStorage.getItem(SENTINEL_KEY);

  for (const [uuid, stateJson] of workspaces) {
    try {
      const state = JSON.parse(stateJson);
      const folders = state.folders;
      if (!Array.isArray(folders) || folders.length === 0) {
        console.warn('[M53 Migration] Workspace %s has no folders — skipping', uuid);
        continue;
      }

      // Extract folder path from first folder URI
      const folderPath = resolveFolderPath(folders[0].uri);
      if (!folderPath) {
        console.warn('[M53 Migration] Workspace %s: cannot resolve folder path — skipping', uuid);
        continue;
      }

      // Build the workspace-state envelope
      const wsData: Record<string, string> = {};

      // Store the full workbench state blob
      wsData['workbench'] = stateJson;

      // Migrate workspace-scoped keys for this specific UUID
      const wsKeyPrefix = `parallx:ws.${uuid}:`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(wsKeyPrefix)) continue;
        const strippedKey = key.slice(wsKeyPrefix.length);
        const val = localStorage.getItem(key);
        if (val !== null) wsData[strippedKey] = val;
      }

      // For the active workspace, also migrate generic parallx:-prefixed keys
      // that aren't UUID-scoped or otherwise accounted for
      if (uuid === activeUuid) {
        const skipPrefixes = [
          'parallx:parallx.activeWorkspaceId',
          'parallx:parallx.recentWorkspaces',
          'parallx:parallx.workspace.',
          'parallx:ws.',
        ];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith('parallx:')) continue;
          if (key.startsWith(GLOBAL_PREFIX)) continue;
          if (skipPrefixes.some(p => key.startsWith(p))) continue;

          const strippedKey = key.slice('parallx:'.length);
          if (!(strippedKey in wsData)) {
            const val = localStorage.getItem(key);
            if (val !== null) wsData[strippedKey] = val;
          }
        }
      }

      // Write via bridge (atomic write-tmp-then-rename handled by D0)
      const envelope: Record<string, unknown> = { version: 1, ...wsData };
      await bridge.writeJson(`${folderPath}/.parallx/workspace-state.json`, envelope);
      console.log('[M53 Migration] Workspace %s → %s', uuid, folderPath);
    } catch (err) {
      console.error('[M53 Migration] Workspace %s migration failed:', uuid, err);
    }
  }
}

// ─── D5.4: Recent workspaces ─────────────────────────────────────────────────

async function migrateRecentWorkspaces(globalStorage: IStorage): Promise<void> {
  const raw = localStorage.getItem('parallx:parallx.recentWorkspaces');
  if (!raw) return;

  let oldEntries: unknown[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    oldEntries = parsed;
  } catch {
    return;
  }

  const newEntries: unknown[] = [];

  for (const entry of oldEntries) {
    try {
      const e = entry as { identity?: { id?: string }; metadata?: unknown };
      const uuid = e.identity?.id;
      if (!uuid) continue;

      // Try to find the folder path from the workspace state blob
      const stateJson = localStorage.getItem(`parallx:parallx.workspace.${uuid}.state`);
      let path: string | undefined;

      if (stateJson) {
        const state = JSON.parse(stateJson);
        const folders = state.folders;
        if (Array.isArray(folders) && folders.length > 0) {
          path = resolveFolderPath(folders[0].uri);
        }
      }

      if (!path) {
        console.warn('[M53 Migration] Recent workspace %s: no folder path — skipping', uuid);
        continue;
      }

      newEntries.push({
        identity: { ...(e.identity as object), path },
        metadata: e.metadata,
      });
    } catch {
      // Skip corrupt entries
    }
  }

  if (newEntries.length > 0) {
    await globalStorage.set('recentWorkspaces', JSON.stringify(newEntries));
    console.log('[M53 Migration] Migrated %d recent workspaces', newEntries.length);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a filesystem path from a folder URI (string or object).
 * Returns undefined if the URI cannot be resolved.
 */
function resolveFolderPath(uri: unknown): string | undefined {
  if (typeof uri === 'string') {
    if (uri.startsWith('file:///')) {
      return decodeURIComponent(uri.slice('file:///'.length));
    }
    if (uri.startsWith('file://')) {
      return decodeURIComponent(uri.slice('file://'.length));
    }
    return uri;
  }
  if (uri && typeof uri === 'object' && 'fsPath' in uri) {
    return (uri as { fsPath: string }).fsPath;
  }
  return undefined;
}
