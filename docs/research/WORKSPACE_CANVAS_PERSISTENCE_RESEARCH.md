# Workspace + Canvas Persistence Research (Determinism Audit)

## Scope
This document answers the current determinism questions:
1. Where workspace information is saved.
2. Whether explicit workspace files can be loaded/saved.
3. Where canvas data is saved and how it is scoped.
4. Where the default/active workspace is stored.
5. The exact create/open/switch folder/workspace flows.

## Executive Summary
- Workspace shell state (layout, parts, views, folders, active workspace id, recent workspaces) is persisted in renderer `localStorage` via `LocalStorage` + `NamespacedStorage`.
- Canvas page content is persisted in SQLite at `<firstWorkspaceFolder>/.parallx/data.db` in table `pages`.
- Tool `workspaceState` mementos are **not currently keyed by workspace id**; they are scoped by storage origin + tool id, not by active workspace identity.
- Workspace restore determinism depends on a stable renderer origin. Random localhost ports create different browser origins and break continuity of localStorage-backed state.

---

## 1) Workspace persistence: exact storage model

### Storage backend
- `Workbench._initializeServices()` creates:
  - `this._storage = new NamespacedStorage(new LocalStorage(), 'parallx')`
  - `this._globalStorage = new NamespacedStorage(new LocalStorage(), 'parallx-global')`
- `LocalStorage` reads/writes browser `localStorage` directly.

### Workspace state keys
Defined in `workspaceTypes.ts`:
- `workspaceStorageKey(workspaceId) => parallx.workspace.<workspaceId>.state`
- `ACTIVE_WORKSPACE_KEY => parallx.activeWorkspaceId`
- `RECENT_WORKSPACES_KEY => parallx.recentWorkspaces`

### What is inside a saved workspace state
`WorkspaceState` contains:
- identity + metadata
- layout snapshot
- parts snapshot
- viewContainers snapshot
- per-view state
- editors snapshot
- context snapshot
- folders snapshot

Persistence is performed by `WorkspaceSaver.save()`:
- serializes complete state to `workspaceStorageKey(identity.id)`
- also writes `ACTIVE_WORKSPACE_KEY`

### Restore flow on startup
`Workbench._restoreWorkspace()`:
1. Reads `ACTIVE_WORKSPACE_KEY` via `WorkspaceLoader.getActiveWorkspaceId()`.
2. Loads `workspaceStorageKey(activeId)` via `loadById()`.
3. If valid, reconstructs workspace identity + metadata from saved state.
4. Applies restored layout/parts/views.
5. Restores folders.
6. Configures saver and immediately persists initial state.
7. Updates recent list and writes active workspace id.

---

## 2) Explicit workspace-file support status

### Current status
In currently traced command/workbench flows, there is no explicit `.code-workspace`-style file model used as canonical workspace persistence.

### What exists today
- `workspace.openFolder`: opens native folder dialog and atomically replaces workspace folders via `IWorkspaceService.updateFolders(...)`.
- `workspace.addFolderToWorkspace`: appends folder(s).
- `workspace.closeFolder`: clears folders.
- `workspace.saveAs` and `workspace.duplicateWorkspace`: clone current in-memory workspace state into a new workspace identity stored in localStorage.

### Determinism implication
Workspace identity/state continuity is currently tied to renderer storage origin and localStorage availability, not to a user-visible workspace file on disk.

---

## 3) Canvas persistence: exact storage model

### Physical database location
Renderer `DatabaseService.openForWorkspace(workspacePath)` uses:
- DB path: `<workspacePath>/.parallx/data.db`

Main process `DatabaseManager` confirms same location and handles SQLite lifecycle.

### Workspace binding rule
`Workbench._openDatabaseForWorkspace()`:
- if no folders: closes DB
- else: opens DB for **first** workspace folder (`folders[0]`)

Therefore canvas data scope is effectively:
- one SQLite DB per first-opened workspace folder
- switching first folder changes which DB is active

### Canvas schema + service
- Canvas pages are CRUDed in table `pages` (migrations in `src/built-in/canvas/migrations`).
- `CanvasDataService` performs all SQL through IPC bridge.
- Canvas tool runs migrations at activation (if DB already open) and again when workspace folders change.

---

## 4) Default/active workspace behavior

### Default workspace initialization
On boot, before restore:
- `this._workspace = Workspace.create('Default Workspace')`

After restore:
- if active workspace id + valid state exist, current workspace is replaced from saved identity/metadata.
- otherwise default workspace remains and is saved.

### Active workspace marker
- Active workspace id is persisted at `parallx.activeWorkspaceId` (within `parallx` namespace).
- Recent list is maintained separately (`parallx.recentWorkspaces`).

---

## 5) Exact operational flows

### A) Create workspace (`createWorkspace`)
1. Generates new workspace UUID (`Workspace.create(name, path?)`).
2. Builds state:
   - clone provided state with new identity/metadata, or
   - default state from current container size.
3. Saves state to `parallx.workspace.<newId>.state`.
4. Adds workspace to recent list.
5. Optionally switches to it.

### B) Switch workspace (`switchWorkspace`)
1. Saves current workspace state.
2. Tears down workspace content.
3. Loads target workspace state by id.
4. Rebuilds content.
5. Applies restored UI state.
6. Fires workspace switch event.
7. Restores folders.
8. Reconfigures saver.
9. Updates recent + active id.

### C) Open folder (`workspace.openFolder`)
1. Shows native folder picker.
2. Calls `IWorkspaceService.updateFolders([{uri:file(selected)}])`.
3. This atomically replaces folder list (single event).
4. Saves workspace.
5. DB open/close reacts to folder change:
   - opens `<selected>/.parallx/data.db` (as first folder).

### D) Add folder (`workspace.addFolderToWorkspace`)
1. Shows native folder picker.
2. Calls `addFolder` for each selected path.
3. Saves workspace.
4. DB remains bound to `folders[0]` (unless first folder changes elsewhere).

### E) Close folder (`workspace.closeFolder`)
1. Removes all folders.
2. Saves workspace.
3. DB closes because workspace has zero folders.

---

## 6) Determinism risks found

1. Renderer-origin dependence
- Because workspace state uses browser localStorage, origin changes break continuity.
- Prior random localhost ports changed origin per run and caused restore regression.

2. Tool `workspaceState` is not workspace-id partitioned
- Tool mementos use key shape `tool-ws:<toolId>/<key>` in shared `this._storage`.
- No workspace id suffix/prefix is applied.
- Effect: tool state can bleed across workspace switches (same origin).

3. Canvas DB bound only to first folder
- Multi-folder workspaces still persist canvas into first folder’s `.parallx/data.db`.
- Reordering/changing first folder changes backing DB scope.

4. Folder-change DB reopen/migration race sensitivity
- DB reopen on folder changes is async and event-driven.
- Canvas migration-on-folder-change currently waits fixed delay (500ms), which is pragmatic but not strictly deterministic.

---

## 7) Practical conclusions for next design step

If strict deterministic behavior is the goal, the next high-impact choices are:
1. Introduce explicit workspace-on-disk artifact (or equivalent canonical workspace persistence) and treat localStorage as cache.
2. Partition tool `workspaceState` by active workspace id.
3. Decide and document canvas DB strategy for multi-folder workspaces:
   - first-folder binding (current), or
   - workspace-id-based stable DB location.
4. Replace delay-based migration timing with explicit DB-open lifecycle event coupling.

---

## Code References (primary)
- `src/workbench/workbench.ts`
- `src/workspace/workspace.ts`
- `src/workspace/workspaceTypes.ts`
- `src/workspace/workspaceLoader.ts`
- `src/workspace/workspaceSaver.ts`
- `src/commands/structuralCommands.ts`
- `src/services/workspaceService.ts`
- `src/platform/storage.ts`
- `src/services/databaseService.ts`
- `electron/database.cjs`
- `src/built-in/canvas/canvasDataService.ts`
- `src/built-in/canvas/main.ts`
- `src/built-in/canvas/migrations/001_canvas_schema.sql`
- `electron/main.cjs`
