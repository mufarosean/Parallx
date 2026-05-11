# Milestone 53: Portable Storage Architecture

## Status: COMPLETE ✅

## Overview

Replace all localStorage-based persistence with a portable, file-backed storage
system. After M53, Parallx stores **zero** data in localStorage, APPDATA, or the
user's home directory. All state lives in exactly two locations:

1. **`<app-root>/data/`** — Global app-level state (settings, recent workspaces,
   installed extensions, window bounds, Chromium cache).
2. **`<workspace-folder>/.parallx/`** — Per-workspace state (layout, tool
   enablement, configuration, agent tasks, chat, canvas, memory, skills).

The app becomes fully portable: copy the Parallx directory to a USB drive and
everything works. No registry entries, no APPDATA, no home-directory dotfiles.

---

## Motivation

### Current problems

1. **localStorage is fragile.** Clearing browser data wipes all workspace state.
   Users have lost layout, tool enablement, and AI settings this way.
2. **Privacy violation.** Window state writes to `%APPDATA%`. Tool installations
   write to `~/.parallx/tools/`. Users cannot audit or control what Parallx
   writes outside its own directory.
3. **Workspace identity is UUID-based.** Opening the same folder creates a new
   UUID, fragmenting chat history. The "Default Workspace" UUID contaminates
   folders that are opened later.
4. **No portability.** Moving Parallx to another machine loses all settings
   because they're scattered across localStorage, APPDATA, and home directory.
5. **17 distinct localStorage consumers** — 11 use the `IStorage` abstraction,
   7 bypass it entirely with direct `localStorage.getItem/setItem`. The
   abstraction boundary is inconsistently applied.

### Design principles

| # | Principle |
|---|-----------|
| P1 | **Two locations only** — `data/` for global, `.parallx/` for workspace |
| P2 | **File-backed everything** — JSON files read/written through Electron IPC |
| P3 | **localStorage becomes empty** — disposable renderer cache at most |
| P4 | **Workspace = folder path** — the `.parallx/` directory IS the workspace |
| P5 | **No home directory writes** — nothing in `~/.parallx/` after migration |
| P6 | **No APPDATA writes** — `app.setPath('userData')` redirects to `data/` |
| P7 | **Backward compatible** — first launch migrates existing localStorage data |

---

## Architecture

### Storage topology (after M53)

```
D:\AI\Parallx\                           ← app root
├── data\                                 ← GLOBAL (gitignored)
│   ├── settings.json                     ← theme, PDF prefs, welcome flag
│   ├── recent-workspaces.json            ← [{path, name, lastOpened}]
│   ├── last-workspace.json               ← {path} of last-opened folder
│   ├── models.json                       ← language model configs
│   ├── tool-global-state.json            ← tool globalState memento
│   ├── mcp-servers.json                  ← MCP server configurations
│   ├── extensions\                       ← installed .plx (replaces ~/.parallx/tools/)
│   │   ├── media-organizer\
│   │   └── text-generator\
│   ├── window-state.json                 ← window bounds (moved from APPDATA)
│   └── chromium-cache\                   ← Electron internals (via setPath)
│
├── electron\
├── src\
├── ext\
└── ...

C:\Users\...\MyProject\                   ← any workspace folder
└── .parallx\                             ← PER-WORKSPACE
    ├── workspace-identity.json           ← {id: uuid} (exists today)
    ├── data.db                           ← SQLite (exists today)
    ├── workspace-state.json              ← NEW: layout, sidebar, editors, recent
    │                                        files, recent commands, explorer state,
    │                                        tool enablement, tool workspace memento,
    │                                        configuration values, AI presets,
    │                                        agent tasks/plans/approvals/traces
    ├── ai-config.json                    ← AI config overrides (exists today)
    ├── memory\                           ← (exists today)
    ├── AGENTS.md                         ← (exists today)
    ├── SOUL.md                           ← (exists today)
    ├── TOOLS.md                          ← (exists today)
    ├── rules\                            ← (exists today)
    ├── commands\                         ← (exists today)
    ├── skills\                           ← (exists today)
    └── attachments\                      ← (exists today)
```

### workspace-state.json schema

All per-workspace data that currently lives in localStorage consolidates into
one file. Sections are keyed by domain so services read only what they need:

```jsonc
{
  "version": 1,
  "workbench": {
    // Full WorkspaceState object (layout, sidebar, editors, panels)
    // Currently: parallx:parallx.workspace.{uuid}.state
  },
  "toolEnablement": {
    "disabled": ["tool-id-1"],
    "enabledExternal": ["tool-id-2"]
    // Currently: parallx:ws.{uuid}:tool-enablement:*
  },
  "toolState": {
    "media-organizer": { "lastScanDir": "/photos" },
    "text-generator": { "lastModel": "qwen2.5:7b" }
    // Currently: parallx:tool-ws:{toolId}:*
  },
  "configuration": {
    "editor.fontSize": 14,
    "explorer.sortOrder": "name"
    // Currently: parallx:config:*
  },
  "aiPresets": {
    "presets": [...],
    "activePresetId": "default"
    // Currently: parallx:unified-ai.*
  },
  "agent": {
    "tasks": [...],
    "planSteps": [...],
    "approvals": [...],
    "memory": [...],
    "traces": [...]
    // Currently: parallx:agent.*.v1
  },
  "recentCommands": ["command.id.1", "command.id.2"],
  // Currently: parallx:commandPalette:recent (direct localStorage)
  "recentFiles": ["file:///path/to/file.md"],
  // Currently: parallx:quickAccess:recentFiles (direct localStorage)
  "explorerExpandedPaths": ["/src", "/src/workbench"],
  // Currently: explorer.expandedPaths (direct localStorage)
  "mcpServers": [...]
  // Currently: parallx:mcp.servers — GLOBAL for now, stored per-workspace
  // as a copy to avoid touching AI subsystem. Can scope later.
}
```

### data/settings.json schema

```jsonc
{
  "version": 1,
  "colorTheme": "dark-modern",
  // Currently: parallx.colorTheme (direct localStorage)
  "userThemes": [...],
  // Currently: parallx.userThemes (direct localStorage)
  "pdfOutlineWidth": 250,
  // Currently: parallx.pdfOutlineWidth (direct localStorage)
  "pdfScaleValue": "1.0",
  // Currently: parallx.pdfScaleValue (direct localStorage)
  "welcomeShown": true
  // Currently: parallx:welcome.hasShownWelcome
}
```

### data/recent-workspaces.json schema

```jsonc
{
  "version": 1,
  "entries": [
    {
      "path": "C:\\Users\\...\\MyProject",
      "name": "MyProject",
      "lastOpened": "2026-04-03T12:00:00Z"
    }
  ]
}
```

### data/models.json schema

```jsonc
{
  "version": 1,
  "models": {
    // Currently: parallx-global:languageModels.*
    // Exact structure preserved from LanguageModelsService
  }
}
```

### data/tool-global-state.json schema

```jsonc
{
  "version": 1,
  "tools": {
    "media-organizer": { "globalKey": "value" },
    "text-generator": { "globalKey": "value" }
    // Currently: parallx-global:tool-global:{toolId}:*
  }
}
```

---

## Complete Data Migration Map

Every piece of data that moves. Nothing is left behind.

### localStorage → `data/` (global)

| localStorage Key | Destination | Field |
|---|---|---|
| `parallx.colorTheme` | `data/settings.json` | `colorTheme` |
| `parallx.userThemes` | `data/settings.json` | `userThemes` |
| `parallx.pdfOutlineWidth` | `data/settings.json` | `pdfOutlineWidth` |
| `parallx.pdfScaleValue` | `data/settings.json` | `pdfScaleValue` |
| `parallx:welcome.hasShownWelcome` | `data/settings.json` | `welcomeShown` |
| `parallx:parallx.recentWorkspaces` | `data/recent-workspaces.json` | `entries` |
| `parallx:parallx.activeWorkspaceId` | `data/last-workspace.json` | `path` (resolved from UUID) |
| `parallx-global:languageModels.*` | `data/models.json` | `models` |
| `parallx-global:tool-global:*` | `data/tool-global-state.json` | `tools.*` |

### localStorage → `.parallx/workspace-state.json` (per-workspace)

| localStorage Key | Destination | Section |
|---|---|---|
| `parallx:parallx.workspace.{uuid}.state` | `.parallx/workspace-state.json` | `workbench` |
| `parallx:ws.{uuid}:tool-enablement:disabled` | `.parallx/workspace-state.json` | `toolEnablement.disabled` |
| `parallx:ws.{uuid}:tool-enablement:enabled-external` | `.parallx/workspace-state.json` | `toolEnablement.enabledExternal` |
| `parallx:tool-ws:{toolId}:*` | `.parallx/workspace-state.json` | `toolState.{toolId}` |
| `parallx:config:*` | `.parallx/workspace-state.json` | `configuration` |
| `parallx:unified-ai.presets` | `.parallx/workspace-state.json` | `aiPresets.presets` |
| `parallx:unified-ai.activePresetId` | `.parallx/workspace-state.json` | `aiPresets.activePresetId` |
| `parallx:agent.tasks.v1` | `.parallx/workspace-state.json` | `agent.tasks` |
| `parallx:agent.planSteps.v1` | `.parallx/workspace-state.json` | `agent.planSteps` |
| `parallx:agent.approvals.v1` | `.parallx/workspace-state.json` | `agent.approvals` |
| `parallx:agent.memory.v1` | `.parallx/workspace-state.json` | `agent.memory` |
| `parallx:agent.trace.v1` | `.parallx/workspace-state.json` | `agent.traces` |
| `parallx:mcp.servers` | `.parallx/workspace-state.json` | `mcpServers` |
| `parallx:commandPalette:recent` | `.parallx/workspace-state.json` | `recentCommands` |
| `parallx:quickAccess:recentFiles` | `.parallx/workspace-state.json` | `recentFiles` |
| `explorer.expandedPaths` | `.parallx/workspace-state.json` | `explorerExpandedPaths` |

### File relocations

| Current Path | New Path | Notes |
|---|---|---|
| `%APPDATA%/.../window-state.json` | `data/window-state.json` | Via `app.setPath('userData')` |
| `~/.parallx/tools/*` | `data/extensions/*` | All tool install/uninstall/scan paths |

### Already correct (no change needed)

| Path | Notes |
|---|---|
| `.parallx/data.db` | SQLite — canvas, chat, indexing |
| `.parallx/workspace-identity.json` | Durable UUID |
| `.parallx/ai-config.json` | AI config overrides |
| `.parallx/memory/` | Durable AI memory |
| `.parallx/AGENTS.md`, `SOUL.md`, `TOOLS.md` | AI personality |
| `.parallx/rules/`, `commands/`, `skills/` | Workspace customization |
| `.parallx/attachments/` | File attachments |

### Removed (no longer needed)

| Item | Reason |
|---|---|
| `parallx:parallx.activeWorkspaceId` | Replaced by `data/last-workspace.json` |
| `parallx:parallx.workspace.{uuid}.state` blobs | Replaced by `.parallx/workspace-state.json` |
| `parallx:ai-settings.profiles` (legacy) | Superseded by unified-ai presets |
| `parallx:ai-settings.activeProfileId` (legacy) | Superseded by unified-ai presets |
| UUID-based workspace addressing | Workspace = folder path now |

---

## Execution Domains

### D0: Infrastructure — File-Backed Storage Layer
**Risk: HIGH** — This is the foundation everything else depends on.

| ID | Task | Description |
|----|------|-------------|
| D0.1 | **IPC storage protocol** | Add `storage:read-json`, `storage:write-json`, `storage:exists` IPC handlers in `electron/main.cjs`. These read/write JSON files atomically (write to `.tmp`, rename). All renderer file I/O goes through these. |
| D0.2 | **`app.setPath('userData')` redirect** | In `electron/main.cjs`, before `app.whenReady()`: resolve app root, call `app.setPath('userData', path.join(appRoot, 'data', 'chromium-cache'))`. This moves Chromium's IndexedDB, GPU cache, cookies, etc. into our `data/` folder. |
| D0.3 | **`data/` directory bootstrap** | On startup, ensure `data/` and `data/extensions/` and `data/chromium-cache/` exist. Create if missing. |
| D0.4 | **`.gitignore` update** | Add `data/` to `.gitignore` so git never tracks global state. |
| D0.5 | **`FileBackedGlobalStorage` class** | New `IStorage` implementation in `src/platform/storage.ts`. Reads/writes `data/settings.json` through the IPC protocol. Implements full `IStorage` interface (get/set/delete/has/keys/clear). Caches in-memory after first read, flushes on set. |
| D0.6 | **`FileBackedWorkspaceStorage` class** | New `IStorage` implementation. Reads/writes `.parallx/workspace-state.json` through IPC. Same pattern: in-memory cache, flush on mutation. Needs workspace folder path injected at construction. |
| D0.7 | **Preload bridge** | Expose `storage:read-json`, `storage:write-json`, `storage:exists` through `preload.cjs` → `window.parallxElectron.storage.*`. |
| D0.8 | **App root resolution** | Utility function in `electron/main.cjs`: in dev mode, app root = project directory (`D:\AI\Parallx`). In packaged mode, app root = `process.resourcesPath` parent. This determines where `data/` lives. |

**Dependencies:** None — this is the base layer.

**Verification:** Write unit tests for `FileBackedGlobalStorage` and `FileBackedWorkspaceStorage` using `InMemoryStorage` as a reference. Verify atomic write (no partial JSON on crash). Verify IPC round-trip.

---

### D1: Electron Main Process Migration
**Risk: MEDIUM** — File paths change but logic is preserved.

| ID | Task | Description |
|----|------|-------------|
| D1.1 | **Window state migration** | Move `WINDOW_STATE_FILE` from `app.getPath('userData')` to `path.join(appRoot, 'data', 'window-state.json')`. One-line path change plus migration: if old file exists and new doesn't, copy it over. |
| D1.2 | **Tool directory migration** | Change all `~/.parallx/tools/` references in `main.cjs` to `path.join(appRoot, 'data', 'extensions')`. Affects: `tools:scan-directory`, `tools:get-directories`, `tools:install-from-file`, `tools:uninstall`, `tools:read-module`, `app.whenReady` bootstrap. Six locations total. Add migration: if `~/.parallx/tools/` exists and `data/extensions/` is empty, move contents. |
| D1.3 | **Security path validation** | Update `tools:read-module` security check to validate against `data/extensions/` instead of `~/.parallx/tools/`. |
| D1.4 | **Remove home directory usage** | After D1.2 migration runs, stop referencing `app.getPath('home')` for any Parallx-specific paths. |

**Dependencies:** D0.2, D0.3, D0.8

**Verification:** Install a .plx file → verify it lands in `data/extensions/`. Uninstall → verify removed from `data/extensions/`. Window bounds persist across restart. No files created in `~/.parallx/` or APPDATA.

---

### D2: Storage Backend Swap (The Core Migration)
**Risk: HIGHEST** — This is where localStorage disappears. Every service that
uses `IStorage` gets a new backend.

| ID | Task | Description |
|----|------|-------------|
| D2.1 | **Wire `FileBackedGlobalStorage` in workbench.ts** | Replace `new LocalStorage()` → `new FileBackedGlobalStorage(electronBridge)`. Replace `new NamespacedStorage(rawStorage, 'parallx-global')` → global storage instance backed by `data/` files. |
| D2.2 | **Wire `FileBackedWorkspaceStorage` in workbench.ts** | Replace `new NamespacedStorage(rawStorage, 'parallx')` → workspace storage instance backed by `.parallx/workspace-state.json`. This single change migrates **11 services** automatically: WorkspaceLoader, WorkspaceSaver, RecentWorkspaces, ConfigurationService, UnifiedAIConfigService, AgentTaskStore, AgentApprovalService, ToolEnablementService, ToolMemento, McpClientService, IndexingServices. |
| D2.3 | **Workspace identity by path** | `_restoreWorkspace()` changes: instead of reading `activeWorkspaceId` UUID from storage, read `data/last-workspace.json` to get the folder path. If the folder exists and has `.parallx/workspace-state.json`, load from it. No more UUID-based lookup. |
| D2.4 | **Workspace switching by path** | `switchWorkspace()` and `openFolder()` save current workspace state to `.parallx/workspace-state.json` in the current folder, write the new folder path to `data/last-workspace.json`, and reload. No more UUID-based switching. |
| D2.5 | **Remove `workspaceStorageKey()` UUID function** | The `parallx.workspace.{uuid}.state` key format is dead. Remove `workspaceStorageKey()` from `workspaceTypes.ts`. All callers use file paths now. |
| D2.6 | **Remove `ACTIVE_WORKSPACE_KEY` constant** | The `parallx.activeWorkspaceId` localStorage key is dead. Recent-workspaces list stores paths, not UUIDs. |
| D2.7 | **Recent workspaces by path** | `RecentWorkspaces` reads/writes `data/recent-workspaces.json` instead of localStorage key. Entries are `{path, name, lastOpened}` instead of `{id, name}`. |
| D2.8 | **Update `main.ts` startup** | Remove the localStorage-clear-and-preserve dance in test mode. The new storage is file-backed — there's nothing to clear in localStorage. Test mode can simply delete `data/` and the `.parallx/workspace-state.json` in the test workspace. |
| D2.9 | **Remove `LocalStorage` usage** | After all consumers are migrated, the `LocalStorage` class in `storage.ts` is no longer imported by any production code. Keep it for tests but remove all production imports. |

**Dependencies:** D0 (all tasks)

**Verification:** Open a workspace → close → reopen → layout and tools restored. Switch workspaces → each has independent state. Clear localStorage manually → app still works. Copy `data/` and workspace to another machine → everything loads.

---

### D3: Direct localStorage Consumer Migration
**Risk: MEDIUM** — 7 files bypass `IStorage` and use `localStorage` directly.
Each needs individual migration.

| ID | Task | File | Current Key | Migration |
|----|------|------|-------------|-----------|
| D3.1 | **Theme selection** | `workbench.ts` (Phase 1), `workbenchThemePicker.ts` | `parallx.colorTheme` | Read from `data/settings.json` via global storage. Write on theme change. |
| D3.2 | **Theme editor — user themes** | `themeEditorPanel.ts` | `parallx.userThemes` | Read/write via global storage `data/settings.json`. Multiple call sites (create, delete, import). |
| D3.3 | **Theme editor — selection** | `themeEditorPanel.ts` | `parallx.colorTheme` | Same as D3.1 — shares the key. |
| D3.4 | **PDF outline width** | `pdfEditorPane.ts` | `parallx.pdfOutlineWidth` | Read/write via global storage `data/settings.json`. |
| D3.5 | **PDF scale value** | `pdfEditorPane.ts` | `parallx.pdfScaleValue` | Read/write via global storage `data/settings.json`. |
| D3.6 | **Command palette recent** | `quickAccess.ts` | `parallx:commandPalette:recent` | Read/write via workspace storage `.parallx/workspace-state.json`. |
| D3.7 | **Quick access recent files** | `quickAccess.ts` | `parallx:quickAccess:recentFiles` | Read/write via workspace storage `.parallx/workspace-state.json`. |
| D3.8 | **Explorer expanded paths** | `explorer/main.ts` | `explorer.expandedPaths` | Read/write via workspace storage `.parallx/workspace-state.json`. |
| D3.9 | **Welcome screen flags** | `welcome/main.ts` | `welcome.hasShownWelcome`, reads recent workspaces + recent files | Read from global storage (welcome flag) and workspace storage (recent files). |
| D3.10 | **LanguageModelToolsService** | `languageModelToolsService.ts` | `parallx.chat.disabledTools` | Read/write via workspace storage. |

**Dependencies:** D0, D2.1, D2.2

**Verification:** Each consumer individually tested — change a setting, restart, value persists. No localStorage.getItem/setItem calls remain in production code.

---

### D4: First Launch & Workspace Lifecycle
**Risk: MEDIUM** — Changes how the app starts and how workspaces are created.

| ID | Task | Description |
|----|------|-------------|
| D4.1 | **First launch detection** | If `data/` doesn't exist: create it, show welcome screen, prompt user to open a folder. No "Default Workspace" created. |
| D4.2 | **Open folder = become workspace** | When user opens a folder: create `.parallx/` if missing, create `workspace-identity.json`, write folder path to `data/last-workspace.json`, add to `data/recent-workspaces.json`. The folder IS the workspace now. |
| D4.3 | **Remove Default Workspace concept** | `Workspace.create('Default Workspace')` in workbench.ts Phase 1 → only create workspace object after a folder is opened. If no folder is open, show the welcome/landing screen. |
| D4.4 | **Workspace switching** | "Open Folder" and "Switch Workspace" save current state to `.parallx/workspace-state.json`, write new path to `data/last-workspace.json`, reload. Clean, predictable. |
| D4.5 | **App restart restore** | On startup: read `data/last-workspace.json` → get folder path → read `<folder>/.parallx/workspace-state.json` → restore layout. If file missing/corrupt → show welcome screen. |
| D4.6 | **Remove multi-root workspace support** | Currently workspaces can have multiple folders. Simplify: one workspace = one folder. `workspace.folders` always has exactly one entry. Remove `addFolderToWorkspace` command. |

**Dependencies:** D2 (all tasks)

**Verification:** Fresh install → welcome screen → open folder → workspace created → restart → same workspace loads. Open different folder → switch works → go back → state preserved.

---

### D5: Migration Bridge (Backward Compatibility)
**Risk: MEDIUM** — One-time migration from old localStorage to new file system.

| ID | Task | Description |
|----|------|-------------|
| D5.1 | **Migration detector** | On startup, check: does localStorage have `parallx:parallx.activeWorkspaceId`? If yes → old data exists → run migration. If no → fresh install or already migrated. |
| D5.2 | **Global data migration** | Extract from localStorage: theme, user themes, PDF prefs, welcome flag, language model configs, tool global state. Write to `data/settings.json`, `data/models.json`, `data/tool-global-state.json`. |
| D5.3 | **Workspace data migration** | For each workspace in `parallx:parallx.recentWorkspaces`: find the matching folder path from the workspace state blob's `folders` array. Read the full state blob. Transform and write to `<folder>/.parallx/workspace-state.json`. |
| D5.4 | **Recent workspaces migration** | Transform the old `{id, name}` format to `{path, name, lastOpened}`. Resolve paths from workspace state blobs. Write to `data/recent-workspaces.json`. |
| D5.5 | **Tool installation migration** | If `~/.parallx/tools/` has contents and `data/extensions/` is empty: move each tool directory to `data/extensions/`. |
| D5.6 | **Window state migration** | If `%APPDATA%/.../window-state.json` exists and `data/window-state.json` doesn't: copy. |
| D5.7 | **Post-migration cleanup** | After successful migration: clear localStorage entirely. Log migration summary. |
| D5.8 | **Migration error handling** | If any step fails: log the error, skip that item, continue. Never block app startup due to migration failure. Report skipped items to user via notification. |

**Dependencies:** D0, D1, D2 (migration runs after new storage is available)

**Verification:** Populate localStorage with known test data → run migration → verify all data appears in correct files. Run migration twice → second run is a no-op. Corrupt one localStorage key → migration completes for all others.

---

### D6: Cleanup & Hardening
**Risk: LOW** — Removing dead code and verifying nothing was missed.

| ID | Task | Description |
|----|------|-------------|
| D6.1 | **Remove dead localStorage code** | Search entire codebase for `localStorage.getItem`, `localStorage.setItem`, `localStorage.removeItem`, `localStorage.clear`. Remove all production usage. Keep `LocalStorage` class in `storage.ts` for test use only. |
| D6.2 | **Remove `NamespacedStorage` localStorage dependency** | `NamespacedStorage` wraps any `IStorage` — it's fine. But ensure it's never wrapping a `LocalStorage` instance in production. |
| D6.3 | **Remove `sessionStorage` workspace-switch hack** | The `parallx:pendingSwitch` flag in sessionStorage is no longer needed. Workspace switching is file-path-based now — just write `data/last-workspace.json` and reload. |
| D6.4 | **Remove UUID-based workspace addressing** | Remove `workspaceStorageKey()`, `ACTIVE_WORKSPACE_KEY`, and the UUID-based state blob pattern from `workspaceTypes.ts`. |
| D6.5 | **Remove `chat_sessions.workspace_id` drift fix** | The `repairWorkspaceIdDrift()` function in `chatSessionPersistence.ts` exists to fix UUID fragmentation. With stable folder-based identity, this shouldn't be needed. However: keep it for one release as a safety net, then remove. |
| D6.6 | **Audit for home directory references** | `grep -r "getPath('home')" electron/` — should return zero hits after D1.2. |
| D6.7 | **Audit for APPDATA references** | `grep -r "getPath('userData')" electron/` — should only appear in the `app.setPath('userData')` redirect in D0.2. |
| D6.8 | **Production build test** | Full `npm run build` → launch → open folder → create canvas page → write text → close → reopen → verify data persists. Zero localStorage keys except Chromium internals. |

**Dependencies:** D2, D3, D4, D5

**Verification:** `grep -r "localStorage" src/` returns zero hits (except test files and the kept-for-tests `LocalStorage` class). `grep -r "getPath('home')" electron/` returns zero hits. Full E2E passes.

---

## Execution Order and Dependencies

```
D0 Infrastructure ──────────────────────────────┐
  D0.1 IPC protocol                              │
  D0.2 setPath redirect                          │
  D0.3 data/ bootstrap                           │
  D0.4 .gitignore                                │
  D0.5 FileBackedGlobalStorage                   │
  D0.6 FileBackedWorkspaceStorage                │
  D0.7 Preload bridge                            │
  D0.8 App root resolution                       │
                                                 │
D1 Electron Main ────────────────────────────────┤
  D1.1 Window state path                         │
  D1.2 Tool directory path                       │  (depends on D0)
  D1.3 Security validation                       │
  D1.4 Remove home dir usage                     │
                                                 │
D2 Storage Backend Swap ─────────────────────────┤
  D2.1 Wire global storage                       │
  D2.2 Wire workspace storage                    │
  D2.3 Identity by path                          │  (depends on D0)
  D2.4 Switching by path                         │
  D2.5-D2.9 Remove old patterns                  │
                                                 │
D3 Direct Consumer Migration ────────────────────┤
  D3.1-D3.10 (10 individual consumers)           │  (depends on D0, D2)
                                                 │
D4 Workspace Lifecycle ──────────────────────────┤
  D4.1 First launch                              │
  D4.2 Open folder = workspace                   │  (depends on D2)
  D4.3 Remove Default Workspace                  │
  D4.4 Switching                                 │
  D4.5 Restart restore                           │
  D4.6 Remove multi-root                         │
                                                 │
D5 Migration Bridge ─────────────────────────────┤
  D5.1-D5.8                                      │  (depends on D0, D1, D2)
                                                 │
D6 Cleanup & Hardening ─────────────────────────────(depends on ALL above)
  D6.1-D6.8
```

**Critical path:** D0 → D2 → D3 + D4 (parallel) → D5 → D6

D1 can run in parallel with D2 since it only touches `electron/main.cjs`.

---

## Risk Assessment

| Domain | Risk | Mitigation |
|--------|------|------------|
| D0 | Medium — new IPC + storage classes | Unit test both storage implementations against InMemoryStorage reference |
| D1 | Low — file path changes only | One-line changes, backward-compatible migration |
| D2 | **HIGHEST** — replaces the storage backbone for 11 services | Swap backend behind the `IStorage` interface — services don't change. Test each service individually after swap. |
| D3 | Medium — 7 manual migrations | Each is isolated (different file, different key). Can do one at a time. |
| D4 | Medium — changes startup flow | The welcome screen already exists. Changes are to when/how workspace objects are created. |
| D5 | Medium — one-time migration | Must handle partial failure gracefully. Test with known localStorage snapshots. |
| D6 | Low — cleanup | Automated grep verification. |

**The single highest-risk moment** is D2.2: swapping `this._storage` from
`NamespacedStorage(LocalStorage)` to `FileBackedWorkspaceStorage`. This is one
line change in `workbench.ts` but affects 11 downstream services. The
mitigation is that all 11 services talk to `IStorage` — they don't know or care
what's behind it. If `FileBackedWorkspaceStorage` implements `IStorage`
correctly, everything works.

---

## Files Changed (Estimated)

### New files
| File | Purpose |
|---|---|
| `src/platform/fileBackedStorage.ts` | `FileBackedGlobalStorage` and `FileBackedWorkspaceStorage` classes |
| `electron/storageHandlers.cjs` | IPC handlers for JSON read/write |
| `tests/unit/fileBackedStorage.test.ts` | Storage implementation tests |
| `tests/unit/storageMigration.test.ts` | Migration bridge tests |

### Modified files (core — REQUIRES APPROVAL)
| File | Changes |
|---|---|
| `electron/main.cjs` | `app.setPath('userData')`, tool paths, window state path, IPC registration, app root resolution |
| `electron/preload.cjs` | Expose storage IPC bridge |
| `src/main.ts` | Remove localStorage clear/preserve dance |
| `src/workbench/workbench.ts` | Replace `LocalStorage` with file-backed storage, rewrite `_restoreWorkspace`, `switchWorkspace`, `openFolder` |
| `src/workspace/workspaceTypes.ts` | Remove `workspaceStorageKey()`, `ACTIVE_WORKSPACE_KEY` |
| `src/workspace/workspaceLoader.ts` | Rewrite to read from file-backed storage |
| `src/workspace/workspaceSaver.ts` | Rewrite to write to file-backed storage |
| `src/workspace/recentWorkspaces.ts` | Path-based entries, file-backed storage |
| `src/platform/storage.ts` | Add file-backed implementations (or new file) |

### Modified files (direct localStorage consumers)
| File | Changes |
|---|---|
| `src/workbench/workbenchThemePicker.ts` | Replace `localStorage.setItem` with storage service |
| `src/built-in/theme-editor/themeEditorPanel.ts` | Replace 6 `localStorage` calls with storage service |
| `src/built-in/editor/pdfEditorPane.ts` | Replace 4 `localStorage` calls with storage service |
| `src/commands/quickAccess.ts` | Replace 4 `localStorage` calls with workspace storage |
| `src/built-in/explorer/main.ts` | Replace `localStorage` expand state with workspace storage |
| `src/built-in/welcome/main.ts` | Replace `localStorage.getItem` reads with storage service |
| `src/services/languageModelToolsService.ts` | Replace `localStorage` with injected storage |

### Modified files (workspace lifecycle)
| File | Changes |
|---|---|
| `src/commands/workspaceCommands.ts` | Update open/switch/add commands |
| `src/workspace/workspace.ts` | Simplify — one folder per workspace |

### Unchanged files (already file-backed and correct)
| File | Why unchanged |
|---|---|
| `electron/database.cjs` | Already writes to `.parallx/data.db` |
| `src/services/chatSessionPersistence.ts` | Already uses SQLite |
| `src/aiSettings/unifiedAIConfigService.ts` | Already reads `.parallx/ai-config.json` from filesystem |
| `ext/media-organizer/main.js` | Already uses database API |
| `ext/text-generator/main.js` | Already uses database API |
| All `.parallx/` markdown files | Already file-based |
| `src/built-in/chat/main.ts` | Reads `.parallx/` files via filesystem |

---

## Success Criteria

1. **Zero localStorage keys** after startup (except Chromium internals we don't control)
2. **Zero files in APPDATA** related to Parallx
3. **Zero files in `~/.parallx/`** after migration completes
4. **`data/` folder** contains all global state, is complete and self-contained
5. **`.parallx/` folder** in each workspace contains all workspace state
6. **Copy test:** Copy `D:\AI\Parallx\` to `E:\Parallx\` → open → everything works (window state, theme, recent workspaces resolve relative paths gracefully)
7. **Clear localStorage test:** Manually clear localStorage → restart → app loads normally from files
8. **Migration test:** Start with populated localStorage → first launch under M53 → all data migrated → second launch uses files only
9. **Multi-workspace test:** Open folder A → configure tools → switch to folder B → configure differently → switch back → each has independent state
10. **First-launch test:** Delete `data/` folder → start app → welcome screen → open folder → workspace created → restart → workspace restored

---

## Estimated Scope

- **7 domains**, **~45 individual tasks**
- **~20 files modified**, **~4 new files created**
- **Critical path:** D0 → D2 → D5 → D6
- **Domains D1, D3, D4 can partially parallelize with D2**
