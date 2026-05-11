# Milestone 54 — Workspace Isolation: Clean Reload Architecture

**Date:** 2026-04-05  
**Status:** In Progress

## Problem

The `openFolder()` method in the workbench treats workspace switching as a multi-step orchestration: save state, seed target workspace state, write `last-workspace.json`, reload. This creates several issues:

1. **State bleeding** — Seeding logic can accidentally inject current workspace data into the target.
2. **Stale state** — If a previous buggy seed wrote bad data (e.g., empty folders), opening that workspace is permanently broken unless the user manually deletes `.parallx/`.
3. **Unnecessary complexity** — `openFolder()` tries to pre-create workspace state before reload, duplicating logic that the normal startup path already handles.

## Design Principle

**Opening a folder = launching Parallx fresh into that folder.** Nothing more.

Each folder is a self-contained workspace. Opening a folder should be identical to launching the app targeting that folder — the normal startup path reads the `.parallx/workspace-state.json` if it exists, or initializes a clean workspace if it doesn't. No seeding, no state replacement, no special cases.

## Architecture

### Current Flow (broken)
```
openFolder(path):
  1. Save current state
  2. Check if target has .parallx/workspace-state.json
     → If no: CREATE and WRITE default state (seeding — causes bugs)
     → If yes: skip
  3. Write last-workspace.json = { path }
  4. Close DB
  5. window.location.reload()

On reload:
  Phase 1: Read last-workspace.json → get path → create storage(path)
  Phase 4: _restoreWorkspace() → load state from storage
```

### New Flow (clean)
```
openFolder(path):
  1. Save current workspace state
  2. Write last-workspace.json = { path }
  3. Close DB
  4. window.location.reload()

On reload:
  Phase 1: Read last-workspace.json → get path → create storage(path)
  Phase 4: _restoreWorkspace():
    → If state exists in storage: restore it (existing workspace)
    → If no state: initialize fresh workspace with folder, persist default state
```

**Key change:** The startup path (`_restoreWorkspace`) handles both cases — existing and new workspaces. `openFolder()` just points the app at the folder and reloads. Zero seeding logic.

## Tasks

### Task 1: Simplify `openFolder()`
**File:** `src/workbench/workbench.ts`

Remove all seeding/state-creation logic from `openFolder()`. The method becomes:
1. End session
2. Save current workspace state
3. Write `last-workspace.json` with target path
4. Close DB
5. Reload

### Task 2: Move new-workspace initialization into `_restoreWorkspace()`
**File:** `src/workbench/workbench.ts`

After `_workspaceLoader.load()` returns `undefined` (no saved state), check if `wsPath` is available (from `last-workspace.json`). If so:
- Create a `Workspace` with the folder
- Call `createDefaultState()`
- Persist it immediately via the saver
- Continue normal restore flow

This handles both "first time opening this folder" and "app relaunch" identically.

### Task 3: Align `switchWorkspace()` 
**File:** `src/workbench/workbench.ts`

`switchWorkspace()` already follows the clean pattern (save → write last-workspace → close DB → reload). Verify it needs no changes. `openFolder()` should converge to the same shape.

### Task 4: Audit `createWorkspace()`
**File:** `src/workbench/workbench.ts`

`createWorkspace()` writes state to the target folder before calling `switchWorkspace()`. This is acceptable because the user explicitly asks to create a new workspace (Save As / Duplicate). Verify it doesn't conflict with the new startup init path.

### Task 5: Clean up dead code
Remove any orphaned helpers, comments, or logic that referenced the old seeding approach.

### Task 6: TypeScript check + manual verification
Build clean, verify both scenarios work:
- Open folder with existing `.parallx/` → restores that workspace's state
- Open folder without `.parallx/` → initializes fresh workspace with that folder
