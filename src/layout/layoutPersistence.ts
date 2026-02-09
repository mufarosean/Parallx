// layoutPersistence.ts — load/save layout state

import { IStorage } from '../platform/storage.js';
import {
  SerializedLayoutState,
  LAYOUT_SCHEMA_VERSION,
  createDefaultLayoutState,
} from './layoutModel.js';

/**
 * Storage key for layout state.
 */
const LAYOUT_STORAGE_KEY = 'parallx.layout.state';

/**
 * Handles saving and loading layout state to/from persistent storage.
 *
 * Features:
 * - Serializes complete grid structure to JSON
 * - Restores layout from JSON
 * - Validates schema version for compatibility
 * - Falls back to default layout on missing or invalid state
 */
export class LayoutPersistence {
  constructor(private readonly _storage: IStorage) {}

  /**
   * Save layout state to storage.
   */
  async save(state: SerializedLayoutState): Promise<void> {
    try {
      const json = JSON.stringify(state);
      await this._storage.set(LAYOUT_STORAGE_KEY, json);
    } catch (err) {
      console.error('[LayoutPersistence] Failed to save layout state:', err);
    }
  }

  /**
   * Load layout state from storage.
   *
   * Returns the saved state if valid, or a default layout if:
   * - No state is saved
   * - State is corrupt (invalid JSON)
   * - State has incompatible schema version
   *
   * @param fallbackWidth - Width for default layout if no state exists
   * @param fallbackHeight - Height for default layout if no state exists
   */
  async load(fallbackWidth: number, fallbackHeight: number): Promise<SerializedLayoutState> {
    try {
      const json = await this._storage.get(LAYOUT_STORAGE_KEY);
      if (!json) {
        return createDefaultLayoutState(fallbackWidth, fallbackHeight);
      }

      const parsed = JSON.parse(json);

      // Validate schema version
      if (!this._isValidState(parsed)) {
        console.warn('[LayoutPersistence] Invalid or outdated state, using default layout');
        return createDefaultLayoutState(fallbackWidth, fallbackHeight);
      }

      // Migrate if needed
      const migrated = this._migrate(parsed);
      return migrated;
    } catch (err) {
      console.error('[LayoutPersistence] Failed to load layout state:', err);
      return createDefaultLayoutState(fallbackWidth, fallbackHeight);
    }
  }

  /**
   * Check if saved state exists.
   */
  async hasSavedState(): Promise<boolean> {
    return this._storage.has(LAYOUT_STORAGE_KEY);
  }

  /**
   * Clear saved state.
   */
  async clear(): Promise<void> {
    await this._storage.delete(LAYOUT_STORAGE_KEY);
  }

  /**
   * Validate that a parsed object looks like a valid SerializedLayoutState.
   */
  private _isValidState(parsed: any): parsed is SerializedLayoutState {
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }
    if (typeof parsed.version !== 'number') {
      return false;
    }
    if (!parsed.grid || typeof parsed.grid !== 'object') {
      return false;
    }
    if (!parsed.grid.root || typeof parsed.grid.root !== 'object') {
      return false;
    }
    // Version must be compatible (same major version)
    if (parsed.version > LAYOUT_SCHEMA_VERSION) {
      return false;
    }
    return true;
  }

  /**
   * Migrate state from older schema versions to current.
   * For now, v1 is the only version — this is a placeholder for future migrations.
   */
  private _migrate(state: SerializedLayoutState): SerializedLayoutState {
    // Currently at version 1 — no migrations needed
    if (state.version === LAYOUT_SCHEMA_VERSION) {
      return state;
    }

    // Future: add migration logic per version
    // e.g., if (state.version === 1) { state = migrateV1toV2(state); }

    return state;
  }
}
