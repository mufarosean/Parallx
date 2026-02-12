// workspaceTypes.ts — workspace-related types
import { SerializedLayoutState } from '../layout/layoutModel.js';
import { ViewState } from '../views/view.js';
import { PartState } from '../parts/partTypes.js';
import { ViewContainerState } from '../views/viewContainer.js';

// ─── Schema Version ──────────────────────────────────────────────────────────

/**
 * Current workspace state schema version.
 * Incremented on breaking changes; used for migration decisions.
 */
export const WORKSPACE_STATE_VERSION = 2;

// ─── Workspace Identity ──────────────────────────────────────────────────────

/**
 * Uniquely identifies a workspace.
 */
export interface WorkspaceIdentity {
  /** Unique ID (UUID). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Optional file path or folder URI. */
  readonly path?: string;
  /** Optional icon identifier or colour tag. */
  readonly iconOrColor?: string;
}

// ─── Workspace Metadata ──────────────────────────────────────────────────────

/**
 * Non-structural metadata about a workspace.
 */
export interface WorkspaceMetadata {
  /** ISO-8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of last access. */
  readonly lastAccessedAt: string;
  /** Optional description. */
  readonly description?: string;
}

// ─── WorkbenchState (M4 Cap 2) ──────────────────────────────────────────────

/**
 * Classifies the workspace state based on open folders.
 * Matches VS Code's WorkbenchState enum.
 */
export const enum WorkbenchState {
  /** No folder open. */
  EMPTY = 1,
  /** Single folder open. */
  FOLDER = 2,
  /** Multi-root workspace (reserved for future milestone). */
  WORKSPACE = 3,
}

// ─── Workspace Folder (M4 Cap 2) ────────────────────────────────────────────

/**
 * A folder opened in the workspace.
 * Matches VS Code's IWorkspaceFolder ({ uri, name, index }).
 */
export interface WorkspaceFolder {
  /** URI of the folder root. */
  readonly uri: import('../platform/uri.js').URI;
  /** Display name (defaults to directory basename, can be customized). */
  readonly name: string;
  /** Position index (0-based). */
  readonly index: number;
}

/**
 * Serialized form of a workspace folder for persistence.
 */
export interface SerializedWorkspaceFolder {
  readonly scheme: string;
  readonly path: string;
  readonly name: string;
}

/**
 * Event payload when workspace folders change.
 */
export interface WorkspaceFoldersChangeEvent {
  readonly added: readonly WorkspaceFolder[];
  readonly removed: readonly WorkspaceFolder[];
}

// ─── Part Snapshot ───────────────────────────────────────────────────────────

/**
 * Serialized snapshot of a structural part's state at save time.
 */
export interface SerializedPartSnapshot {
  /** Part identifier. */
  readonly partId: string;
  /** Whether the part is visible. */
  readonly visible: boolean;
  /** Current pixel width. */
  readonly width: number;
  /** Current pixel height. */
  readonly height: number;
  /** Part-specific data (e.g. sidebar collapsed sections). */
  readonly data?: Record<string, unknown>;
}

// ─── View Container Snapshot ────────────────────────────────────────────────

/**
 * State of a view container (tab order, active view).
 */
export interface SerializedViewContainerSnapshot {
  /** Container identifier (e.g. 'sidebar', 'panel'). */
  readonly containerId: string;
  /** Active view ID inside this container. */
  readonly activeViewId: string | undefined;
  /** Ordered list of view IDs (tab order). */
  readonly tabOrder: readonly string[];
}

// ─── View Snapshot ───────────────────────────────────────────────────────────

/**
 * Serialized per-view state (opaque blob saved by each view).
 */
export interface SerializedViewSnapshot {
  /** View identifier. */
  readonly viewId: string;
  /** Container the view belongs to. */
  readonly containerId: string;
  /** View-specific state blob. */
  readonly state: ViewState;
}

// ─── Editor Snapshot ─────────────────────────────────────────────────────────

/**
 * Serialized editor state — placeholder for Capability 9.
 * Defined now so the workspace schema is extensible.
 */
export interface SerializedEditorSnapshot {
  /** Open editor input identifiers per group. */
  readonly groups: SerializedEditorGroupSnapshot[];
  /** Index of the active editor group. */
  readonly activeGroupIndex: number;
}

export interface SerializedEditorGroupSnapshot {
  /** Open editor input IDs, in tab order. */
  readonly editors: SerializedEditorInputSnapshot[];
  /** Index of the active editor in this group. */
  readonly activeEditorIndex: number;
}

export interface SerializedEditorInputSnapshot {
  /** Editor input type identifier. */
  readonly typeId: string;
  /** Editor input unique ID. */
  readonly inputId: string;
  /** Whether the editor is pinned (vs preview). */
  readonly pinned: boolean;
  /** Serialised editor-specific state (scroll, selection, etc.). */
  readonly state?: Record<string, unknown>;
}

// ─── Context Snapshot ────────────────────────────────────────────────────────

/**
 * Serialized structural context at save time.
 */
export interface SerializedContextSnapshot {
  /** ID of the active part. */
  readonly activePart?: string;
  /** ID of the currently focused view. */
  readonly focusedView?: string;
  /** ID of the active editor (if any). */
  readonly activeEditor?: string;
  /** ID of the active editor group (if any). */
  readonly activeEditorGroup?: string;
}

// ─── Full Workspace State ────────────────────────────────────────────────────

/**
 * The complete workspace state — everything needed to reconstruct
 * the workbench from scratch for a given workspace.
 *
 * Top-level structure mirrors the runtime object graph:
 *   identity → layout → parts → viewContainers → views → editors → context
 */
export interface WorkspaceState {
  /** Schema version for migration support. */
  readonly version: number;
  /** Workspace identity. */
  readonly identity: WorkspaceIdentity;
  /** Workspace metadata. */
  readonly metadata: WorkspaceMetadata;
  /** Layout grid state (delegated to layoutModel's schema). */
  readonly layout: SerializedLayoutState;
  /** Per-part state snapshots. */
  readonly parts: readonly SerializedPartSnapshot[];
  /** Per-view-container state. */
  readonly viewContainers: readonly SerializedViewContainerSnapshot[];
  /** Per-view state blobs. */
  readonly views: readonly SerializedViewSnapshot[];
  /** Editor state (groups, tabs, scroll positions). */
  readonly editors: SerializedEditorSnapshot;
  /** Context state (active part, focused view). */
  readonly context: SerializedContextSnapshot;
  /** Open workspace folders (M4 Cap 2). */
  readonly folders?: readonly SerializedWorkspaceFolder[];
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

/**
 * Build a storage key for a specific workspace's state.
 */
export function workspaceStorageKey(workspaceId: string): string {
  return `parallx.workspace.${workspaceId}.state`;
}

/**
 * Storage key for the list of recent workspace identities.
 */
export const RECENT_WORKSPACES_KEY = 'parallx.recentWorkspaces';

/**
 * Storage key for the active workspace ID.
 */
export const ACTIVE_WORKSPACE_KEY = 'parallx.activeWorkspaceId';

// ─── Default Factories ──────────────────────────────────────────────────────

/**
 * Create a default (empty) editor snapshot.
 */
export function createDefaultEditorSnapshot(): SerializedEditorSnapshot {
  return {
    groups: [{
      editors: [],
      activeEditorIndex: -1,
    }],
    activeGroupIndex: 0,
  };
}

/**
 * Create a default context snapshot.
 */
export function createDefaultContextSnapshot(): SerializedContextSnapshot {
  return {
    activePart: undefined,
    focusedView: undefined,
    activeEditor: undefined,
    activeEditorGroup: undefined,
  };
}

// ─── Recent Workspaces ──────────────────────────────────────────────────────

/**
 * An entry in the recent workspaces list.
 */
export interface RecentWorkspaceEntry {
  readonly identity: WorkspaceIdentity;
  readonly metadata: WorkspaceMetadata;
}

/**
 * Default maximum number of recent workspaces to track.
 */
export const DEFAULT_MAX_RECENT_WORKSPACES = 20;