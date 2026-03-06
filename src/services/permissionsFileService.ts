// permissionsFileService.ts — .parallx/permissions.json integration (M11 Task 2.10)
//
// Bridges the PermissionService's persistent overrides to the filesystem.
// On startup, reads `.parallx/permissions.json` and loads it into the
// PermissionService. When the user changes a permission (e.g. "Always allow"),
// writes the updated overrides back to disk.
//
// VS Code reference:
//   src/vs/platform/configuration/common/configurationService.ts (save pattern)

import { Disposable } from '../platform/lifecycle.js';
import type { PermissionService } from './permissionService.js';
import type { IConfigFileSystem } from './parallxConfigService.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Path to the permissions file relative to workspace root. */
export const PERMISSIONS_FILE_PATH = '.parallx/permissions.json';

// ═══════════════════════════════════════════════════════════════════════════════
// PermissionsFileService
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads `.parallx/permissions.json` into PermissionService on load,
 * and writes changes back when the user grants persistent permissions.
 */
export class PermissionsFileService extends Disposable {

  private _fs: IConfigFileSystem | undefined;
  private _permissionService: PermissionService | undefined;
  private _writeFs: IPermissionsFileWriter | undefined;
  private _loaded = false;
  private _saveQueued = false;

  // ── Setup ──

  /** Bind the file system reader. */
  setFileSystem(fs: IConfigFileSystem): void {
    this._fs = fs;
  }

  /** Bind a file writer (separate from reader for sandbox safety). */
  setFileWriter(writer: IPermissionsFileWriter): void {
    this._writeFs = writer;
  }

  /** Bind the PermissionService whose overrides we manage. */
  setPermissionService(permissionService: PermissionService): void {
    this._permissionService = permissionService;

    // Listen for changes and auto-save
    this._register(permissionService.onDidChange(() => {
      this._queueSave();
    }));
  }

  /** Whether the permissions file has been loaded. */
  get isLoaded(): boolean {
    return this._loaded;
  }

  // ── Load ──

  /**
   * Read `.parallx/permissions.json` and load into the PermissionService.
   * If the file doesn't exist, does nothing (defaults apply).
   */
  async load(): Promise<void> {
    if (!this._fs || !this._permissionService) { return; }

    try {
      const exists = await this._fs.exists(PERMISSIONS_FILE_PATH);
      if (!exists) {
        this._loaded = true;
        return;
      }

      const content = await this._fs.readFile(PERMISSIONS_FILE_PATH);
      this._permissionService.loadPersistentOverrides(content);
    } catch {
      // File read failed — defaults apply
    }

    this._loaded = true;
  }

  // ── Save ──

  /**
   * Queue a debounced save (avoids writing on every single grant click).
   */
  private _queueSave(): void {
    if (this._saveQueued || !this._loaded) { return; }
    this._saveQueued = true;

    // Debounce: save after 500ms
    setTimeout(() => {
      this._saveQueued = false;
      this._save().catch(() => {
        // Swallow save errors silently
      });
    }, 500);
  }

  /**
   * Write the current persistent overrides to `.parallx/permissions.json`.
   */
  private async _save(): Promise<void> {
    if (!this._writeFs || !this._permissionService) { return; }

    const overrides = this._permissionService.getPersistentOverrides();

    // Don't write an empty file — delete the file instead
    if (overrides.size === 0) { return; }

    const json = this._permissionService.serializeOverrides();

    try {
      await this._writeFs.writeFile(PERMISSIONS_FILE_PATH, json);
    } catch {
      // Swallow write errors
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Writer abstraction
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal write interface for the permissions file service. */
export interface IPermissionsFileWriter {
  writeFile(relativePath: string, content: string): Promise<void>;
}
