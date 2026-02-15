// workspaceSaver.ts — persist workspace state
import { Disposable } from '../platform/lifecycle.js';
import { IStorage } from '../platform/storage.js';
import {
  WorkspaceState,
  SerializedPartSnapshot,
  SerializedViewContainerSnapshot,
  SerializedViewSnapshot,
  SerializedEditorSnapshot,
  SerializedContextSnapshot,
  workspaceStorageKey,
  ACTIVE_WORKSPACE_KEY,
  WORKSPACE_STATE_VERSION,
  createDefaultEditorSnapshot,
} from './workspaceTypes.js';
import { SerializedLayoutState } from '../layout/layoutModel.js';
import { Workspace } from './workspace.js';
import { Part } from '../parts/part.js';
import { ViewContainer } from '../views/viewContainer.js';
import { ViewManager } from '../views/viewManager.js';

// ─── State Collector ─────────────────────────────────────────────────────────

/**
 * Collectable sources that the saver queries to build a WorkspaceState.
 * Provided by the workbench at initialization time.
 */
export interface WorkspaceStateSources {
  /** The workspace being saved. */
  workspace: Workspace;
  /** Current container dimensions (for layout snapshot). */
  containerWidth: number;
  containerHeight: number;
  /** All registered parts. */
  parts: readonly Part[];
  /** All view containers (sidebar, panel, auxiliary bar, etc.). */
  viewContainers: readonly ViewContainer[];
  /** View manager for collecting per-view state. */
  viewManager: ViewManager;
  /** Function that builds a SerializedLayoutState from the current grid. */
  layoutSerializer: () => SerializedLayoutState;
  /** Current context snapshot. */
  contextProvider: () => SerializedContextSnapshot;
  /** Current editor snapshot (placeholder until Capability 9). */
  editorProvider?: () => SerializedEditorSnapshot;
}

// ─── WorkspaceSaver ──────────────────────────────────────────────────────────

/**
 * Collects state from all workbench subsystems and persists it to storage.
 *
 * Features:
 * - Collects state from parts, views, and containers
 * - Serializes complete state to JSON
 * - Saves to persistent storage by workspace ID
 * - Handles save errors gracefully
 * - Supports both explicit and auto-save
 * - Debounces frequent save requests
 */
export class WorkspaceSaver extends Disposable {
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _sources: WorkspaceStateSources | undefined;
  private _saving = false;

  /** Debounce interval in ms for auto-save requests. */
  private readonly _debounceMs: number;

  constructor(
    private readonly _storage: IStorage,
    debounceMs = 1000,
  ) {
    super();
    this._debounceMs = debounceMs;
  }

  // ── Configuration ──

  /**
   * Set the sources used to collect state.
   * Called once after the workbench is fully initialized.
   */
  setSources(sources: WorkspaceStateSources): void {
    this._sources = sources;
  }

  // ── Explicit save ──

  /**
   * Immediately save the current workspace state (no debounce).
   */
  async save(): Promise<void> {
    if (this._saving) return; // prevent re-entrancy
    if (!this._sources) {
      console.warn('[WorkspaceSaver] No sources configured — skipping save');
      return;
    }

    this._saving = true;
    try {
      const state = this.collectState();
      const key = workspaceStorageKey(state.identity.id);
      const json = JSON.stringify(state);
      await this._storage.set(key, json);

      // Also persist the active workspace ID
      await this._storage.set(ACTIVE_WORKSPACE_KEY, state.identity.id);

      console.log('[WorkspaceSaver] Saved state for workspace "%s" (%d bytes)', state.identity.name, json.length);
    } catch (err) {
      console.error('[WorkspaceSaver] Failed to save workspace state:', err);
    } finally {
      this._saving = false;
    }
  }

  // ── Auto-save (debounced) ──

  /**
   * Request a debounced save. Multiple calls within the debounce window
   * are collapsed into a single save.
   */
  requestSave(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      this.save();
    }, this._debounceMs);
  }

  /**
   * If a debounced save is pending, cancel the timer and save immediately.
   * Returns a resolved promise if no save was pending.
   */
  async flushPendingSave(): Promise<void> {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
      await this.save();
    }
  }

  // ── State collection ──

  /**
   * Collect a complete WorkspaceState snapshot from all sources.
   */
  collectState(): WorkspaceState {
    const src = this._sources!;
    src.workspace.touch(); // update lastAccessedAt

    return {
      version: WORKSPACE_STATE_VERSION,
      identity: src.workspace.identity,
      metadata: src.workspace.metadata,
      layout: src.layoutSerializer(),
      parts: this._collectPartStates(src.parts),
      viewContainers: this._collectViewContainerStates(src.viewContainers),
      views: this._collectViewStates(src),
      editors: src.editorProvider?.() ?? createDefaultEditorSnapshot(),
      context: src.contextProvider(),
      folders: src.workspace.serializeFolders(),
    };
  }

  /**
   * Collect per-part state snapshots.
   */
  private _collectPartStates(parts: readonly Part[]): SerializedPartSnapshot[] {
    return parts.map(part => ({
      partId: part.id,
      visible: part.visible,
      width: part.width,
      height: part.height,
      data: part.saveState().data,
    }));
  }

  /**
   * Collect per-view-container state.
   */
  private _collectViewContainerStates(
    containers: readonly ViewContainer[],
  ): SerializedViewContainerSnapshot[] {
    return containers.map(c => {
      const state = c.saveContainerState();
      return {
        containerId: c.id,
        activeViewId: state.activeViewId,
        tabOrder: [...state.tabOrder],
      };
    });
  }

  /**
   * Collect per-view state blobs from the view manager.
   */
  private _collectViewStates(src: WorkspaceStateSources): SerializedViewSnapshot[] {
    const snapshots: SerializedViewSnapshot[] = [];

    // Save all created views
    src.viewManager.saveAllStates();

    for (const desc of src.viewManager.getDescriptors()) {
      const saved = src.viewManager.getSavedState(desc.id);
      if (saved) {
        snapshots.push({
          viewId: desc.id,
          containerId: desc.containerId,
          state: saved,
        });
      }
    }

    return snapshots;
  }

  // ── Cleanup ──

  override dispose(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    super.dispose();
  }
}