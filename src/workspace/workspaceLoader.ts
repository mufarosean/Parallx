// workspaceLoader.ts — load workspace state
import { IStorage } from '../platform/storage.js';
import {
  WorkspaceState,
  WORKSPACE_STATE_VERSION,
  workspaceStorageKey,
  ACTIVE_WORKSPACE_KEY,
} from './workspaceTypes.js';
import { Workspace } from './workspace.js';

// ─── WorkspaceLoader ────────────────────────────────────────────────────────

/**
 * Loads workspace state from persistent storage.
 *
 * Features:
 * - Loads state by workspace ID from namespaced storage
 * - Validates schema version for compatibility
 * - Migrates old schemas to current version
 * - Returns default state when none exists
 * - Handles corrupt state gracefully (fallback to default)
 * - Logs loading errors for debugging
 */
export class WorkspaceLoader {
  constructor(private readonly _storage: IStorage) {}

  // ── Load workspace state ──

  /**
   * Load the complete workspace state for the given workspace.
   *
   * @param workspace - The workspace to load state for.
   * @param fallbackWidth - Container width for default layout if no state exists.
   * @param fallbackHeight - Container height for default layout if no state exists.
   * @returns The loaded (and possibly migrated) state, or a default state.
   */
  async load(
    workspace: Workspace,
    fallbackWidth: number,
    fallbackHeight: number,
  ): Promise<WorkspaceState> {
    const key = workspaceStorageKey(workspace.id);

    try {
      const json = await this._storage.get(key);

      if (!json) {
        console.log('[WorkspaceLoader] No saved state for workspace "%s" — using defaults', workspace.name);
        return workspace.createDefaultState(fallbackWidth, fallbackHeight);
      }

      const parsed = JSON.parse(json);

      if (!this._isValidState(parsed)) {
        console.warn('[WorkspaceLoader] Invalid state for workspace "%s" — using defaults', workspace.name);
        return workspace.createDefaultState(fallbackWidth, fallbackHeight);
      }

      const migrated = this._migrate(parsed);
      console.log('[WorkspaceLoader] Loaded state for workspace "%s" (v%d)', workspace.name, migrated.version);
      return migrated;
    } catch (err) {
      console.error('[WorkspaceLoader] Failed to load state for workspace "%s":', workspace.name, err);
      return workspace.createDefaultState(fallbackWidth, fallbackHeight);
    }
  }

  /**
   * Load by workspace ID string (for bootstrap when we don't yet have a Workspace object).
   */
  async loadById(
    workspaceId: string,
    _fallbackWidth: number,
    _fallbackHeight: number,
  ): Promise<WorkspaceState | undefined> {
    const key = workspaceStorageKey(workspaceId);

    try {
      const json = await this._storage.get(key);
      if (!json) return undefined;

      const parsed = JSON.parse(json);
      if (!this._isValidState(parsed)) return undefined;

      return this._migrate(parsed);
    } catch {
      return undefined;
    }
  }

  // ── Active workspace ID ──

  /**
   * Retrieve the ID of the last-active workspace.
   */
  async getActiveWorkspaceId(): Promise<string | undefined> {
    return this._storage.get(ACTIVE_WORKSPACE_KEY);
  }

  /**
   * Store the active workspace ID so it can be restored on next launch.
   */
  async setActiveWorkspaceId(id: string): Promise<void> {
    await this._storage.set(ACTIVE_WORKSPACE_KEY, id);
  }

  // ── Check existence ──

  /**
   * Check whether saved state exists for a workspace.
   */
  async hasSavedState(workspaceId: string): Promise<boolean> {
    return this._storage.has(workspaceStorageKey(workspaceId));
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