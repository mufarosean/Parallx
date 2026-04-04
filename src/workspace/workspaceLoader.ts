// workspaceLoader.ts — load workspace state
import { IStorage } from '../platform/storage.js';
import {
  WorkspaceState,
  WORKSPACE_STATE_VERSION,
} from './workspaceTypes.js';

// ─── WorkspaceLoader ────────────────────────────────────────────────────────

/**
 * Loads workspace state from persistent storage.
 *
 * M53: Storage is already scoped to the correct workspace file,
 * so load() reads from the 'workbench' key directly.
 *
 * Features:
 * - Validates schema version for compatibility
 * - Migrates old schemas to current version
 * - Returns undefined when no state exists
 * - Handles corrupt state gracefully
 * - Logs loading errors for debugging
 */
export class WorkspaceLoader {
  constructor(private readonly _storage: IStorage) {}

  // ── Load workspace state ──

  /**
   * Load workspace state from storage.
   * M53: Storage is already scoped to the workspace file, so we read
   * from the 'workbench' key directly. Returns undefined if no saved
   * state exists (first launch or empty workspace).
   */
  async load(): Promise<WorkspaceState | undefined> {
    try {
      const json = await this._storage.get('workbench');
      if (!json) return undefined;

      const parsed = JSON.parse(json);

      if (!this._isValidState(parsed)) {
        console.warn('[WorkspaceLoader] Invalid saved state — discarding');
        return undefined;
      }

      const migrated = this._migrate(parsed);
      console.log('[WorkspaceLoader] Loaded state (v%d)', migrated.version);
      return migrated;
    } catch (err) {
      console.error('[WorkspaceLoader] Failed to load state:', err);
      return undefined;
    }
  }

  // ── Validation ──

  /**
   * Validate that a parsed object conforms to the WorkspaceState shape.
   */
  private _isValidState(parsed: unknown): parsed is WorkspaceState {
    if (typeof parsed !== 'object' || parsed === null) return false;

    const obj = parsed as Record<string, unknown>;

    // Must have a numeric version
    if (typeof obj.version !== 'number') return false;

    // Version must not be from the future
    if (obj.version > WORKSPACE_STATE_VERSION) {
      console.warn('[WorkspaceLoader] State version %d is newer than supported (%d)', obj.version, WORKSPACE_STATE_VERSION);
      return false;
    }

    // Must have identity with at least an id
    if (typeof obj.identity !== 'object' || obj.identity === null) return false;
    const identity = obj.identity as Record<string, unknown>;
    if (typeof identity.id !== 'string' || identity.id.length === 0) return false;

    // Must have metadata
    if (typeof obj.metadata !== 'object' || obj.metadata === null) return false;

    // Must have layout with at least a grid
    if (typeof obj.layout !== 'object' || obj.layout === null) return false;
    const layout = obj.layout as Record<string, unknown>;
    if (typeof layout.version !== 'number') return false;
    if (typeof layout.grid !== 'object' || layout.grid === null) return false;

    // parts, viewContainers, views must be arrays
    if (!Array.isArray(obj.parts)) return false;
    if (!Array.isArray(obj.viewContainers)) return false;
    if (!Array.isArray(obj.views)) return false;

    // editors must be an object
    if (typeof obj.editors !== 'object' || obj.editors === null) return false;

    // context must be an object
    if (typeof obj.context !== 'object' || obj.context === null) return false;

    return true;
  }

  // ── Migration ──

  /**
   * Migrate state from older schema versions to current.
   */
  private _migrate(state: WorkspaceState): WorkspaceState {
    if (state.version === WORKSPACE_STATE_VERSION) {
      return state;
    }

    let migrated = { ...state };

    // v1 → v2: add folders field if missing
    if (migrated.version < 2) {
      if (!('folders' in migrated) || !migrated.folders) {
        migrated = { ...migrated, folders: [] };
      }
    }

    console.log('[WorkspaceLoader] Migrated state from v%d to v%d', state.version, WORKSPACE_STATE_VERSION);
    return { ...migrated, version: WORKSPACE_STATE_VERSION };
  }
}