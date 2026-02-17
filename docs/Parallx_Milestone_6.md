# Milestone 6 — Tool Infrastructure & Canvas Tool

> **Authoritative Scope Notice**
>
> This document is the single source of truth for Milestone 6.
> All implementation must conform to the structures and boundaries defined here.
> VS Code source files are referenced strictly as inspiration and validation, not as scope drivers.
> Referenced material must not expand scope unless a missing core tool infrastructure interaction is identified.
> Parallx is **not** a code IDE. It is a VS Code-like structural shell that hosts arbitrary domain-specific tools.
> All VS Code references are filtered through this lens — only structural, shell, and hosting patterns apply.

---

## Milestone Definition

### Vision
Parallx becomes a **tool platform** — a shell where domain-specific tools can be enabled, disabled, and toggled at runtime, with their contributions (activity bar entries, sidebar views, editor panes, commands, keybindings) appearing and disappearing cleanly. The first tool built on this platform is **Canvas** — a Notion-like note-taking tool with a Tiptap-based rich text editor backed by SQLite, demonstrating the full tool lifecycle from manifest to UI.

### Purpose
Milestones 1–5 built a complete workbench shell with layout, parts, views, editor groups, commands, keybindings, filesystem access, theming, and a tool activation pipeline. But the tool system has a critical gap: **tools cannot be enabled or disabled at runtime**. Once a tool activates, there is no user-facing way to turn it off. The Tool Gallery is read-only — it lists tools but cannot control them. The external tool scanner exists but is not wired into the startup flow. The state machine supports re-activation (`Deactivated → Activating`) but nothing triggers it.

This milestone closes that gap in two phases:
1. **Capability 0 (Tool Infrastructure)** — Enable/disable toggle for tools with full contribution cleanup and re-registration, persisted across sessions, exposed through the Tool Gallery UI and the `parallx.tools` API.
2. **Capabilities 1–6 (Canvas Tool)** — A Notion-like note-taking tool that demonstrates every integration point: activity bar entry, sidebar tree view, custom editor pane (Tiptap), SQLite data layer, auto-save, all contributed via manifest.

### Background — What Already Exists

**Tool System Infrastructure (built in M2–M4):**

| Component | File | Status |
|-----------|------|--------|
| Manifest types | `src/tools/toolManifest.ts` | ✅ Complete — `IToolManifest`, `IToolDescription`, `IManifestContributions`, activation event types |
| JSON Schema | `src/tools/parallx-manifest.schema.json` | ✅ Complete — Draft-07 validation schema |
| Built-in manifests | `src/tools/builtinManifests.ts` | ✅ Complete — 6 built-in tool manifests (Explorer, Search, TextEditor, Welcome, Output, ToolGallery) |
| Tool scanner | `src/tools/toolScanner.ts` | ⚠️ Exists but unused — `scanDefaults()` and `scanDirectory()` implemented, but startup flow only uses `registerFromManifest()` for built-ins |
| Tool validator | `src/tools/toolValidator.ts` | ✅ Complete — Full manifest validation with engine compat check |
| Module loader | `src/tools/toolModuleLoader.ts` | ✅ Complete — Dynamic `import()` with security guards; unused for built-ins |
| Tool registry | `src/tools/toolRegistry.ts` | ✅ Complete — State machine (Discovered→Registered→Activating→Activated→Deactivating→Deactivated→Disposed), `Deactivated → Activating` re-activation supported |
| Activation events | `src/tools/activationEventService.ts` | ✅ Complete — `*`, `onStartupFinished`, `onCommand:`, `onView:` with replay |
| Tool activator | `src/tools/toolActivator.ts` | ✅ Complete — `activate()`, `activateBuiltin()`, `deactivate()`, `deactivateAll()` |
| Error isolation | `src/tools/toolErrorIsolation.ts` | ✅ Complete — `wrap()`, `recordError()`, force-deactivation at 50 errors |
| API factory | `src/api/apiFactory.ts` | ✅ Complete — Per-tool frozen `parallx.*` API with 7 bridges |
| API type definitions | `src/api/parallx.d.ts` | ✅ Complete — Full `parallx.*` namespace: views, commands, window, context, workspace, editors, tools, env |
| Bridges | `src/api/bridges/*.ts` | ✅ Complete — Commands, Views, Window, Context, Workspace, FileSystem, Editors |
| Contribution processors | `src/contributions/*.ts` | ✅ Complete — Command (proxy handler), View (placeholder→content), Keybinding, Menu |
| Configuration service | `src/configuration/configurationService.ts` | ✅ Complete — Scoped config, persisted to storage |
| Tool memento | `src/configuration/toolMemento.ts` | ✅ Complete — Per-tool key-value storage with quota enforcement |
| Workbench init | `src/workbench/workbench.ts` | ✅ Complete — Phase 5 wires contribution processors, creates ToolActivator, activates built-ins |

**What Does NOT Exist (Gaps Identified):**

1. **No enable/disable for tools at runtime.** `ToolRegistry` tracks `ToolState` but has no concept of "enabled" vs "disabled." Once activated, the only way to stop a tool is `deactivate()` via the error threshold (50 errors) or shell teardown. No user-facing toggle, no persisted enablement preference, no `api.tools.enable()`/`disable()`.

2. **Tool Gallery is read-only.** `src/built-in/tool-gallery/main.ts` lists tools via `api.tools.getAll()` but has no enable/disable buttons, no settings link, no action controls. The `api.tools` bridge exposes only `getAll()` and `getById()`.

3. **No tool enablement service.** VS Code has `IWorkbenchExtensionEnablementService` with 8 enablement states (`EnabledGlobally`, `DisabledGlobally`, `DisabledWorkspace`, etc.). Parallx has nothing equivalent — no service, no storage, no API.

4. **External tool scanner not wired.** `ToolScanner.scanDefaults()` exists but is never called during startup. All 6 tools are built-in and statically imported. External tool loading via `ToolModuleLoader` is wired but has no discovery path from the workbench.

5. **Contribution cleanup IS wired (good).** When `ToolActivator.onDidDeactivate` fires, all 4 contribution processors call `removeContributions(toolId)`. This means disable→re-enable can work cleanly for commands, views, keybindings, and menus — the infrastructure is there, just not triggered.

6. **No `contributes.activityBarEntries` in manifest schema.** Tools can contribute `viewContainers` (which add tabs to sidebar/panel/auxiliary bar) but cannot contribute activity bar icon entries directly. The activity bar is hardcoded in workbench init.

7. **No custom editor type registration via manifest.** Tools register editor providers via `api.editors.registerEditorProvider()` at activation time, but there's no `contributes.editors` manifest point for declaring editor associations upfront.

8. **No SQLite integration.** No database layer exists. All persistence uses `localStorage`-backed storage via `ToolMemento`.

9. **No Tiptap or rich text editor dependency.** No rich text editing capability exists in the workbench.

### Conceptual Scope

**Capability 0 — Tool Enable/Disable Infrastructure**
- Tool Enablement Service — persisted enabled/disabled state per tool, globally and per-workspace
- Enable/disable triggers contribution add/remove and activation/deactivation
- Tool Gallery gains enable/disable toggle UI
- `api.tools` gains `setEnabled()`, `isEnabled()`, event hooks
- Persisted across sessions via storage
- Built-in tools cannot be disabled (mirrors VS Code behavior)

**Capability 1 — SQLite Data Layer**
- `better-sqlite3` integration in Electron main process
- Per-workspace SQLite database with schema migration
- IPC bridge channels for CRUD operations
- Workspace-scoped database lifecycle (open on workspace load, close on workspace change)

**Capability 2 — Canvas Data Service**
- Data service layer in renderer process wrapping IPC calls
- Page CRUD (create, read, update, delete, move, reorder)
- Page tree operations (nesting, reparenting, sort order)
- Auto-save with debounce
- Change events for UI reactivity

**Capability 3 — Canvas Tool Manifest and Activation**
- `parallx-manifest.json` with activity bar entry, sidebar view container, view, commands, keybindings
- Tool `activate()` / `deactivate()` lifecycle
- Registration of sidebar view provider and editor provider

**Capability 4 — Canvas Sidebar View**
- Tree view showing page hierarchy (nested pages)
- Inline rename, create page, delete page
- Drag-and-drop reorder and reparent
- Page icons and emoji support
- Context menu (New subpage, Rename, Delete, Duplicate)

**Capability 5 — Canvas Editor Pane**
- `CanvasEditorInput` with `canvas:{pageId}` URI scheme
- `CanvasEditorPane` extending `EditorPane` hosting Tiptap
- Tiptap rich text editor with block-level editing (headings, lists, quotes, code blocks, dividers)
- Slash command menu for block insertion
- Keyboard shortcuts for formatting

**Capability 6 — Canvas Auto-Save and State Persistence**
- Debounced auto-save (500ms after last edit)
- Dirty state tracking integrated with editor tab indicators
- Workspace state persistence (expanded nodes, last-opened page)
- Page serialization as Tiptap JSON

**Excluded (Deferred)**
- External tool scanner wiring (M7 — marketplace / sideloading)
- External tool installation from filesystem or URL (M7)
- Tool marketplace / gallery search (M7)
- Tool updates / versioning (M7)
- Tool sandboxing / permission system (M7+)
- Canvas: real-time collaboration (future)
- Canvas: database/table views (future)
- Canvas: file embeds / image upload (future)
- Canvas: page properties / metadata UI (future — schema exists)
- Canvas: export to Markdown / PDF (future)
- Canvas: page templates (future)
- Canvas: backlinks / graph view (future)
- Light / HC theme variants for Canvas UI (deferred — follows M5 theme system)

### Structural Commitments

- **Capability 0 must be complete before any Canvas work begins.** The Canvas tool must be the first tool that exercises the enable/disable infrastructure end-to-end.
- **Canvas is a standard Parallx tool.** It uses `parallx-manifest.json`, activates via `activate(api, context)`, registers views and editors via the `parallx.*` API. No special-casing in the shell.
- **SQLite runs in the Electron main process only.** The renderer communicates via IPC channels exposed through the preload bridge. No `better-sqlite3` in the renderer.
- **Canvas data is workspace-scoped.** Each workspace has its own SQLite database file stored alongside workspace metadata. Opening a different workspace opens a different database.
- **Tiptap is the rich text engine.** It is the only approved external UI library for Canvas. All other UI follows Parallx's vanilla TypeScript + CSS conventions.
- **Canvas pages are trees.** Pages have `parent_id` for nesting. The root level has `parent_id = null`. Sort order uses `REAL` values for O(1) insertion between siblings.
- **Canvas contributes via manifest only.** Activity bar entry, sidebar view, commands, and keybindings are all declared in `parallx-manifest.json`. No hardcoding in the shell.

### Architectural Principles

- **Tool Infrastructure First:** The enable/disable system is not Canvas-specific. It is a foundational shell capability that all future tools will use. Canvas is merely the first consumer.
- **VS Code Extension Parity:** Tool enablement follows VS Code's `IWorkbenchExtensionEnablementService` pattern — persisted state, UI toggle in gallery, API surface. Simplified to two states (enabled/disabled) rather than VS Code's 8 states, since Parallx has no remote servers or workspace trust.
- **Manifest-Driven:** Every Canvas feature is contributed through the standard manifest contribution points. If a contribution point doesn't exist (e.g., `activityBarEntries`), it must be added to the shell infrastructure as part of Capability 0, not special-cased for Canvas.
- **Separation of Concerns:** SQLite ↔ IPC ↔ Data Service ↔ UI. Each layer has a clear boundary. The data service doesn't know about the DOM. The editor pane doesn't know about SQLite.
- **Incremental Delivery:** Each capability builds on the previous one and is independently testable. Capability 0 can be verified without Canvas. Capability 1 can be verified with raw IPC calls. And so on.

### VS Code Reference (Curated)

**Extension enable/disable:**
- `src/vs/workbench/services/extensionManagement/common/extensionManagement.ts` — `EnablementState` enum (8 states: `EnabledGlobally`, `DisabledGlobally`, `EnabledWorkspace`, `DisabledWorkspace`, `DisabledByTrustRequirement`, `DisabledByExtensionKind`, `DisabledByEnvironment`, `DisabledByVirtualWorkspace`)
- `src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts` — `ExtensionEnablementService` persists enablement to storage, fires events, checks if builtin
- `src/vs/workbench/contrib/extensions/browser/extensionsActions.ts` — `EnableDropDownAction`, `DisableDropDownAction` — UI actions with dropdown for scope (globally vs workspace)

**Extension Management UI:**
- `src/vs/workbench/contrib/extensions/browser/extensionsViewlet.ts` — `ExtensionsViewPaneContainer`: sidebar container with search, filters, installed/recommended views
- `src/vs/workbench/contrib/extensions/browser/extensionEditor.ts` — `ExtensionEditor`: detail view with README, features, changelog tabs; action bar with Install/Uninstall/Enable/Disable
- `src/vs/workbench/contrib/extensions/browser/extensionsList.ts` — List renderer with `ManageExtensionAction` gear menu
- `src/vs/workbench/contrib/extensions/browser/extensionsWidgets.ts` — `ExtensionWidget` base class with render pattern

**Extension model:**
- `src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts` — `Extension` class unifying local/gallery/runtime state; `ExtensionState` enum (Installing, Installed, Uninstalling, Uninstalled); `enablementState` property
- `src/vs/workbench/contrib/extensions/common/extensions.ts` — `IExtension` interface, `IExtensionsWorkbenchService`

**DeepWiki:**
- [Extension Management Service](https://deepwiki.com/microsoft/vscode/8.4-extension-management-service) — Architecture, state management, enablement states, actions, events
- [Extension Management UI](https://deepwiki.com/microsoft/vscode/8.5-extension-management-ui) — View container, view panes, extension editor, list rendering, search, widgets

### VS Code Alignment Audit

**✅ Aligned — following VS Code's proven approach:**
- Tool manifest mirrors VS Code `package.json` extension manifest (`contributes`, `activationEvents`, `engines`)
- `activate()` / `deactivate()` lifecycle matches VS Code extension API exactly
- Activation events (`*`, `onStartupFinished`, `onCommand:`, `onView:`) match VS Code
- Contribution processing (proxy handler pattern for commands, placeholder→content for views) follows VS Code
- Frozen per-tool API (`Object.freeze()`) prevents monkey-patching
- Error isolation with force-deactivation mirrors VS Code's extension crash recovery
- State machine with valid transitions mirrors VS Code's extension lifecycle states

**⚠️ Intentional deviations (acceptable for M6 scope):**
- **2 enablement states vs 8** — VS Code has 8 states covering remote servers, workspace trust, virtual workspaces. Parallx simplifies to `Enabled` / `Disabled` since it has no remote execution contexts or workspace trust model. Per-workspace disable is supported but not scoped by server.
- **No extension host process** — VS Code runs extensions in a separate process via RPC. Parallx tools run in the renderer thread (Electron's renderer process). This is acceptable for the current scope — sandboxing is deferred to M7+.
- **No marketplace/gallery service** — VS Code has `IExtensionGalleryService` for marketplace queries. Parallx has built-in tools and filesystem-loaded tools only. Remote marketplace is deferred.
- **SQLite in main process** — VS Code doesn't use SQLite for extension data. This is a Parallx-specific choice for Canvas. The SQLite layer is behind IPC, keeping the renderer clean.
- **Tiptap in renderer** — External UI library approved only for Canvas editor content. All surrounding UI (sidebar, tabs, toolbars) follows Parallx vanilla TS+CSS conventions.

---

## Capability 0 — Tool Enable/Disable Infrastructure

### Capability Description
A runtime enable/disable system for Parallx tools. Users can toggle tools on/off from the Tool Gallery. Disabling a tool deactivates it and removes all its contributions (activity bar entries, sidebar views, commands, keybindings, menus). Enabling re-activates the tool and restores contributions. Enablement state is persisted across sessions. Built-in tools may not be disabled. The Tool Gallery UI gains toggle controls. The `parallx.tools` API gains enablement methods.

### Goals
- Users can enable/disable tools from the Tool Gallery sidebar view
- Disabling a tool: calls `deactivate()`, removes all contributions (views, commands, keybindings, menus), hides activity bar entry
- Enabling a tool: re-processes contributions, calls `activate()`, restores activity bar entry
- Enablement state persists across app restarts via workspace storage
- Built-in tools are always enabled (disable button hidden or disabled)
- `api.tools.isEnabled(toolId)` / `api.tools.setEnabled(toolId, enabled)` / `api.tools.onDidChangeEnablement` added to tool API
- Tool Gallery `view.tools` shows enable/disable toggle per tool

### Dependencies
- `src/tools/toolRegistry.ts` (state machine)
- `src/tools/toolActivator.ts` (activate/deactivate)
- `src/contributions/*.ts` (all 4 contribution processors)
- `src/configuration/toolMemento.ts` or workspace storage (persistence)
- `src/built-in/tool-gallery/main.ts` (UI updates)
- `src/api/parallx.d.ts` and `src/api/apiFactory.ts` (API additions)

### VS Code Reference
- `src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts` — `ExtensionEnablementService`: `setEnablement()`, `getEnablementStates()`, persisted to storage with `DISABLED_EXTENSIONS_STORAGE_PATH` key
- `src/vs/workbench/services/extensionManagement/common/extensionManagement.ts` — `EnablementState` enum, `IWorkbenchExtensionEnablementService` interface
- `src/vs/workbench/contrib/extensions/browser/extensionsActions.ts` — `EnableDropDownAction`, `DisableDropDownAction`

#### Tasks

**Task 0.1 — Define Tool Enablement Types** ✅
- **Task Description:** Add enablement types to `src/tools/toolManifest.ts` or a new `src/tools/toolEnablement.ts`.
- **Output:** `ToolEnablementState` enum, `IToolEnablementService` interface, `ToolEnablementChangeEvent` type.
- **Completion Criteria:**
  - `ToolEnablementState` enum: `EnabledGlobally`, `DisabledGlobally` (extensible later to per-workspace)
  - `IToolEnablementService` interface: `isEnabled(toolId): boolean`, `setEnablement(toolId, enabled): Promise<void>`, `getEnablementState(toolId): ToolEnablementState`, `canChangeEnablement(toolId): boolean`, `onDidChangeEnablement: Event<ToolEnablementChangeEvent>`
  - `ToolEnablementChangeEvent`: `{ toolId: string; newState: ToolEnablementState }`
  - `canChangeEnablement()` returns `false` for built-in tools
  - All types exported

**Task 0.2 — Implement ToolEnablementService** ✅
- **Task Description:** Create `src/tools/toolEnablementService.ts` implementing `IToolEnablementService`.
- **Output:** `ToolEnablementService` class with persistent storage.
- **Completion Criteria:**
  - Extends `Disposable` for lifecycle management
  - Constructor accepts `IStorage` (workspace-scoped storage) and `ToolRegistry`
  - Stores disabled tool IDs in storage under key `tool-enablement:disabled` as JSON array
  - `isEnabled(toolId)` — returns `true` if tool ID is NOT in the disabled set
  - `setEnablement(toolId, enabled)` — adds/removes from disabled set, persists to storage, fires event
  - `canChangeEnablement(toolId)` — returns `false` if `toolDescription.isBuiltin === true`
  - `getDisabledToolIds()` — returns the full set for startup filtering
  - Fires `onDidChangeEnablement` event on every state change
  - Loads disabled set from storage on construction; handles missing/corrupt data gracefully

**Task 0.3 — Wire Enablement into Workbench Startup** ✅
- **Task Description:** Modify `src/workbench/workbench.ts` to create `ToolEnablementService` during phase 5 (`_initializeToolLifecycle`) and respect enablement state during built-in tool activation.
- **Output:** Disabled tools are skipped during `_registerAndActivateBuiltinTools()`.
- **Completion Criteria:**
  - `ToolEnablementService` created after storage is initialized, before tool registration
  - `_registerAndActivateBuiltinTools()` checks `enablementService.isEnabled(toolId)` before activating each tool
  - Disabled tools are still registered in `ToolRegistry` (their descriptions are known) but NOT activated
  - Contributions for disabled tools are NOT processed (since they never activate)
  - Service identifier added to `src/services/serviceTypes.ts` as `IToolEnablementService`
  - Registered in DI container so other components can consume it

**Task 0.4 — Implement Enable Action (Tool Gallery → Activate)** ✅
- **Task Description:** Wire the enable action: when a tool is enabled via `setEnablement(toolId, true)`, re-process its contributions and activate it.
- **Output:** Enabling a disabled tool fully restores its UI presence.
- **Completion Criteria:**
  - `ToolEnablementService.setEnablement(toolId, true)` triggers:
    1. All 4 contribution processors call `processContributions(toolDescription)` for the tool
    2. `ActivationEventService.registerToolEvents(toolId, events)` is called
    3. `ToolActivator.activate(toolId)` or `ToolActivator.activateBuiltin(toolId, module)` is called
    4. Tool state transitions: `Deactivated → Activating → Activated`
  - Views reappear in their containers, commands reappear in palette, keybindings re-register
  - Activity bar entry reappears if tool contributes a view container with `location: 'sidebar'`
  - All of this is orchestrated from within or listening to `ToolEnablementService` — not hardcoded in Tool Gallery

**Task 0.5 — Implement Disable Action (Tool Gallery → Deactivate)** ✅
- **Task Description:** Wire the disable action: when a tool is disabled via `setEnablement(toolId, false)`, deactivate and remove all contributions.
- **Output:** Disabling a tool fully removes its UI presence.
- **Completion Criteria:**
  - `ToolEnablementService.setEnablement(toolId, false)` triggers:
    1. `ToolActivator.deactivate(toolId)` — calls `deactivate()`, disposes subscriptions, disposes API
    2. All 4 contribution processors call `removeContributions(toolId)` (already wired via `ToolActivator.onDidDeactivate`)
    3. `ActivationEventService.clearActivated(toolId)` is called
  - Views disappear from containers, commands removed from palette, keybindings removed, menus cleaned
  - Activity bar entry disappears
  - Open editors from the tool are closed (or show "tool disabled" placeholder)
  - Tool data (Memento state) is NOT deleted — preserved for re-enable
  - Disabled state persisted to storage

**Task 0.6 — Update Tool Gallery UI** ✅
- **Task Description:** Modify `src/built-in/tool-gallery/main.ts` to show enable/disable toggle per tool in the tool list.
- **Output:** Tool Gallery sidebar shows toggle switch or enable/disable button per tool.
- **Completion Criteria:**
  - Each tool entry shows a toggle/button for enable/disable (visible only if `canChangeEnablement()` returns `true`)
  - Built-in tools show no toggle (or a disabled/greyed-out toggle)
  - Toggle calls `api.tools.setEnabled(toolId, !currentState)` 
  - Tool list updates reactively when enablement changes (via `api.tools.onDidChangeEnablement`)
  - Visual indicator of current state: enabled tools show normally, disabled tools show greyed out with "(disabled)" label
  - CSS follows existing tool gallery patterns; new CSS in `src/built-in/tool-gallery/toolGallery.css`

**Task 0.7 — Extend `parallx.tools` API** ✅
- **Task Description:** Add enablement methods to `src/api/parallx.d.ts`, `src/api/apiFactory.ts`, and implement in a new or existing bridge.
- **Output:** `parallx.tools.isEnabled()`, `parallx.tools.setEnabled()`, `parallx.tools.onDidChangeEnablement` available to all tools.
- **Completion Criteria:**
  - `parallx.d.ts` additions:
    - `tools.isEnabled(toolId: string): boolean`
    - `tools.setEnabled(toolId: string, enabled: boolean): Promise<void>`
    - `tools.onDidChangeEnablement: Event<{ toolId: string; enabled: boolean }>`
  - `apiFactory.ts` wires these to `ToolEnablementService` via existing or new bridge
  - `setEnabled()` respects `canChangeEnablement()` — throws if tool is built-in
  - Events fire for all tools' API instances (not scoped to calling tool)

**Task 0.8 — ViewContributionProcessor: `updateViewManager()` for Re-Enable** ✅
- **Task Description:** Ensure `ViewContributionProcessor` can re-register views and containers when a tool is re-enabled after disable.
- **Output:** `processContributions()` works correctly when called for a tool that was previously processed and then removed.
- **Completion Criteria:**
  - `processContributions()` does not throw on re-registration of the same view/container IDs
  - View descriptors are re-registered with `ViewManager`
  - Pending resolvers are cleared on remove so re-enable starts fresh
  - Container events (`onDidAddContainer`, `onDidRemoveContainer`) fire correctly on re-enable

---

## Capability 1 — SQLite Data Layer

### Capability Description
A SQLite database layer in the Electron main process, providing structured data storage for tools via IPC. The first consumer is Canvas, but the layer is generic — any tool can use it for relational data. Each workspace has its own database file. Schema migrations run automatically on database open.

### Goals
- `better-sqlite3` available in Electron main process
- Per-workspace SQLite database created/opened on workspace load
- Schema migration system (versioned SQL files applied in order)
- IPC channels exposed via preload bridge for renderer-side CRUD
- Database closes cleanly on workspace change and app shutdown
- Canvas schema (workspaces, pages, page_properties) applied via migrations

### Dependencies
- `electron/main.cjs` (main process)
- `electron/preload.cjs` (IPC bridge)
- `npm install better-sqlite3` (native module)

### VS Code Reference
- VS Code does not use SQLite for extension data — this is Parallx-specific. However, the IPC bridge pattern follows the existing `window.parallxElectron` convention from `electron/preload.cjs`.

#### Tasks

**Task 1.1 — Install and Configure `better-sqlite3`** ✅
- **Task Description:** Add `better-sqlite3` to the project and configure the Electron build to include native modules.
- **Output:** `better-sqlite3` importable in `electron/main.cjs`.
- **Completion Criteria:**
  - `npm install better-sqlite3` in project root
  - `npm install --save-dev @types/better-sqlite3` for type definitions
  - Electron rebuild script handles native module compilation (`electron-rebuild` or `@electron/rebuild`)
  - Verify `const Database = require('better-sqlite3')` works in main process
  - Build script (`scripts/build.mjs`) includes native module in packaged app

**Task 1.2 — Implement Database Manager in Main Process** ✅
- **Task Description:** Create `electron/database.cjs` (or `.mjs`) managing SQLite database lifecycle.
- **Output:** `DatabaseManager` class with open/close/migrate operations.
- **Completion Criteria:**
  - `DatabaseManager` class:
    - `open(dbPath: string)` — opens (or creates) SQLite database at path, enables WAL mode, sets `PRAGMA foreign_keys = ON`
    - `close()` — closes current database cleanly
    - `migrate(migrationsDir: string)` — reads `*.sql` files from directory, runs them in order, tracks applied migrations in `_migrations` table
    - `run(sql: string, params?: any[])` — execute SQL with params
    - `get(sql: string, params?: any[])` — fetch single row
    - `all(sql: string, params?: any[])` — fetch all rows
  - Database file stored alongside workspace metadata (e.g., `<workspacePath>/.parallx/data.db`)
  - WAL mode for concurrent read performance
  - Error handling: corrupt database detection, migration failure recovery

**Task 1.3 — Define Canvas Schema Migrations** ✅
- **Task Description:** Create SQL migration files for the Canvas data model.
- **Output:** Migration files in `src/built-in/canvas/migrations/` (or bundled location).
- **Completion Criteria:**
  - Migration `001_canvas_schema.sql`:
    ```sql
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Untitled',
      icon TEXT DEFAULT NULL,
      content TEXT DEFAULT '{}',
      sort_order REAL NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
    CREATE INDEX IF NOT EXISTS idx_pages_sort ON pages(parent_id, sort_order);
    ```
  - Migration `002_page_properties.sql`:
    ```sql
    CREATE TABLE IF NOT EXISTS page_properties (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'text',
      value TEXT DEFAULT NULL,
      UNIQUE(page_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_props_page ON page_properties(page_id);
    ```
  - Migrations are idempotent (`IF NOT EXISTS`)
  - A `_migrations` table tracks which migrations have been applied

**Task 1.4 — Wire Database IPC Channels** ✅
- **Task Description:** Expose database operations via IPC channels in `electron/main.cjs` and `electron/preload.cjs`.
- **Output:** Renderer can call database operations through `window.parallxElectron.database.*`.
- **Completion Criteria:**
  - IPC channels registered in `main.cjs`:
    - `database:open` — opens database for workspace path
    - `database:close` — closes current database
    - `database:run` — execute SQL
    - `database:get` — fetch single row
    - `database:all` — fetch all rows
  - Preload bridge exposes:
    - `window.parallxElectron.database.open(workspacePath)`
    - `window.parallxElectron.database.close()`
    - `window.parallxElectron.database.run(sql, params)`
    - `window.parallxElectron.database.get(sql, params)`
    - `window.parallxElectron.database.all(sql, params)`
  - All IPC calls return `Promise` (async IPC invoke pattern)
  - Error serialization: database errors are serialized across IPC boundary with helpful messages

**Task 1.5 — Workspace Database Lifecycle** ✅
- **Task Description:** Wire database open/close to workspace lifecycle events.
- **Output:** Database opens when workspace loads, closes on workspace change/app quit.
- **Completion Criteria:**
  - On workspace load: `DatabaseManager.open()` with workspace-specific path, run migrations
  - On workspace change: close current database, open new one
  - On app quit (`lifecycle:beforeClose`): close database cleanly
  - If no workspace is open: database not opened (Canvas views show empty state)
  - Database path: `<workspacePath>/.parallx/data.db` (created if not exists)

---

## Capability 2 — Canvas Data Service

### Capability Description
A renderer-side data service that wraps the database IPC calls into a typed, event-driven API for Canvas UI components. Provides page CRUD operations, tree manipulation, and change notification.

### Goals
- Typed page model: `IPage` interface with all database fields
- Page CRUD: create, read, update, delete
- Tree operations: get children, get ancestors, move page, reorder siblings
- Change events for reactive UI updates
- Debounced content save for auto-save integration
- No direct IPC calls from UI components — all go through this service

### Dependencies
- Capability 1 (SQLite Data Layer — IPC channels available)
- `src/platform/lifecycle.ts` (Disposable)
- `src/platform/events.ts` (Emitter)

#### Tasks

**Task 2.1 — Define Page Data Types** ✅
- **Task Description:** Create `src/built-in/canvas/canvasTypes.ts` with page data model types.
- **Output:** `IPage`, `IPageTreeNode`, `PageChangeEvent`, `PageChangeKind` types.
- **Completion Criteria:**
  - `IPage` interface: `id: string`, `parentId: string | null`, `title: string`, `icon: string | null`, `content: string` (Tiptap JSON stringified), `sortOrder: number`, `isArchived: boolean`, `createdAt: string`, `updatedAt: string`
  - `IPageTreeNode` interface: extends `IPage` with `children: IPageTreeNode[]`
  - `PageChangeKind` enum: `Created`, `Updated`, `Deleted`, `Moved`, `Reordered`
  - `PageChangeEvent`: `{ kind: PageChangeKind; pageId: string; page?: IPage }`
  - All types exported

**Task 2.2 — Implement CanvasDataService** ✅
- **Task Description:** Create `src/built-in/canvas/canvasDataService.ts` wrapping IPC calls.
- **Output:** `CanvasDataService` class with full page lifecycle operations.
- **Completion Criteria:**
  - `createPage(parentId?: string, title?: string): Promise<IPage>` — generates UUID, calculates sort order (max sibling + 1), inserts, returns created page
  - `getPage(pageId: string): Promise<IPage | null>` — fetch single page
  - `getRootPages(): Promise<IPage[]>` — pages where `parent_id IS NULL`, ordered by `sort_order`
  - `getChildren(parentId: string): Promise<IPage[]>` — child pages ordered by `sort_order`
  - `getPageTree(): Promise<IPageTreeNode[]>` — full tree assembled from flat rows
  - `updatePage(pageId: string, updates: Partial<Pick<IPage, 'title' | 'icon' | 'content'>>): Promise<IPage>` — partial update, sets `updated_at`
  - `deletePage(pageId: string): Promise<void>` — cascading delete (SQLite `ON DELETE CASCADE`)
  - `movePage(pageId: string, newParentId: string | null, afterSiblingId?: string): Promise<void>` — reparent and reorder
  - `reorderPages(parentId: string | null, orderedIds: string[]): Promise<void>` — batch sort order update
  - `onDidChangePage: Event<PageChangeEvent>` — fires on every mutation
  - All methods use `window.parallxElectron.database.*` IPC calls
  - UUID generation via `crypto.randomUUID()`

**Task 2.3 — Implement Auto-Save Debounce** ✅
- **Task Description:** Add debounced content save to `CanvasDataService`.
- **Output:** `scheduleContentSave(pageId, content)` method with 500ms debounce.
- **Completion Criteria:**
  - `scheduleContentSave(pageId: string, content: string)` — debounces by 500ms per page
  - Multiple rapid calls for the same page coalesce into a single write
  - Different pages have independent debounce timers
  - Fires `PageChangeEvent` with `Updated` kind after save completes
  - `flushPendingSaves(): Promise<void>` — force-save all pending (for shutdown)
  - Pending save count queryable for dirty state tracking

---

## Capability 3 — Canvas Tool Manifest and Activation

### Capability Description
The Canvas tool is a standard Parallx tool with a `parallx-manifest.json` declaring its contributions. It activates on startup (or when enabled), registers a sidebar view provider and an editor provider, and deactivates cleanly.

### Goals
- Canvas tool manifest declares: activity bar entry, sidebar view container, sidebar view, commands, keybindings
- Tool activates via standard `activate(api, context)` lifecycle
- Registers sidebar view provider for page tree
- Registers editor provider for Canvas editor panes
- Deactivates cleanly: disposes all subscriptions, flushes pending saves

### Dependencies
- Capability 0 (Tool enable/disable — Canvas is togglable)
- Capability 2 (Canvas Data Service — used by sidebar and editor)
- `src/tools/builtinManifests.ts` (manifest registration)
- `src/workbench/workbench.ts` (built-in tool activation)

#### Tasks

**Task 3.1 — Create Canvas Tool Manifest** ✅
- **Task Description:** Add Canvas manifest to `src/tools/builtinManifests.ts` or create `src/built-in/canvas/parallx-manifest.json`.
- **Output:** Canvas manifest registered as a built-in tool.
- **Completion Criteria:**
  - Manifest declares:
    - `id`: `parallx.canvas`
    - `name`: `Canvas`
    - `version`: `0.1.0`
    - `publisher`: `parallx`
    - `activationEvents`: `['onStartupFinished']`
    - `contributes.viewContainers`: `[{ id: 'canvas-container', title: 'Canvas', location: 'sidebar', icon: '$(notebook)' }]`
    - `contributes.views`: `[{ id: 'view.canvas', name: 'Pages', defaultContainerId: 'canvas-container' }]`
    - `contributes.commands`: New page (`canvas.newPage`), Delete page (`canvas.deletePage`), Rename page (`canvas.renamePage`), Duplicate page (`canvas.duplicatePage`)
    - `contributes.keybindings`: At minimum `Ctrl+N` → `canvas.newPage` (when Canvas is focused)
  - Manifest validated against `parallx-manifest.schema.json`
  - Added to built-in tool array in `builtinManifests.ts` as `CANVAS_MANIFEST`

**Task 3.2 — Implement Canvas Tool Entry Point** ✅
- **Task Description:** Create `src/built-in/canvas/main.ts` with `activate()` and `deactivate()`.
- **Output:** Canvas tool entry point following the standard tool pattern.
- **Completion Criteria:**
  - `activate(api, context)`:
    1. Creates `CanvasDataService` instance
    2. Registers sidebar view provider for `view.canvas` via `api.views.registerViewProvider()`
    3. Registers editor provider for `canvas` type via `api.editors.registerEditorProvider()`
    4. Registers command handlers for all contributed commands via `api.commands.registerCommand()`
    5. Pushes all disposables to `context.subscriptions`
  - `deactivate()`:
    1. Flushes pending saves (`canvasDataService.flushPendingSaves()`)
    2. Clears module-level state
  - Follows same pattern as `src/built-in/explorer/main.ts` (reference implementation)

**Task 3.3 — Wire Canvas as Built-in Tool in Workbench** ✅
- **Task Description:** Add Canvas to the built-in tool activation list in `src/workbench/workbench.ts`.
- **Output:** Canvas tool activates during startup alongside Explorer, Search, etc.
- **Completion Criteria:**
  - Static `import * as CanvasTool from '../built-in/canvas/main'` in workbench.ts
  - Added to `_registerAndActivateBuiltinTools()` array: `{ manifest: CANVAS_MANIFEST, module: CanvasTool }`
  - Subject to enablement check (Capability 0) — disabled Canvas does not activate
  - Canvas appears in Tool Gallery tool list

---

## Capability 4 — Canvas Sidebar View

### Capability Description
A tree view in the Canvas sidebar showing the page hierarchy. Users can create, rename, delete, and reorder pages. Clicking a page opens it in the editor pane.

### Goals
- Tree view shows all pages nested by `parent_id`
- Click page → opens `CanvasEditorPane` via `api.editors.openEditor()`
- Inline rename via double-click or F2
- Create new page via toolbar button or `Ctrl+N`
- Delete page via context menu or Delete key
- Drag-and-drop to reorder and reparent pages
- Reactive: updates when `CanvasDataService` fires change events

### Dependencies
- Capability 2 (Canvas Data Service — data and events)
- Capability 3 (Canvas tool activation — view provider registration)
- `src/api/bridges/viewsBridge.ts` (view registration)
- `src/api/bridges/editorsBridge.ts` (editor opening)

#### Tasks

**Task 4.1 — Implement Page Tree Renderer** ✅
- **Task Description:** Create `src/built-in/canvas/canvasSidebar.ts` implementing the sidebar view provider.
- **Output:** Tree view rendering page hierarchy with expand/collapse.
- **Completion Criteria:**
  - Implements `ViewProvider` interface: `createView(container): IDisposable`
  - Renders page tree using recursive DOM construction
  - Each tree node: icon (emoji or default), title, expand/collapse arrow for nodes with children
  - Indentation per nesting level (20px per level, matching Explorer)
  - Selected page highlighted with list selection colors (theme tokens)
  - Empty state: "No pages yet. Click + to create one."
  - CSS in `src/built-in/canvas/canvas.css`

**Task 4.2 — Implement Page Selection and Editor Opening** ✅
- **Task Description:** Wire page click to open the Canvas editor pane.
- **Output:** Clicking a page opens it in the editor area.
- **Completion Criteria:**
  - Single click on page → calls `api.editors.openEditor({ typeId: 'canvas', editorId: pageId, name: pageTitle, icon: pageIcon })`
  - Already-open page activates the existing editor tab (no duplicates)
  - Selected page in tree stays in sync with active editor tab
  - `api.editors.onDidChangeOpenEditors` listened to for syncing active state back to tree

**Task 4.3 — Implement Create/Rename/Delete Actions** ✅
- **Task Description:** Wire command handlers for page CRUD from the sidebar.
- **Output:** Users can create, rename, and delete pages.
- **Completion Criteria:**
  - **Create:** `canvas.newPage` command → `canvasDataService.createPage()` → tree refreshes → new page opens in editor → title input focused for inline rename
  - **Rename:** Double-click title or F2 → inline text input replaces title → Enter commits → Escape cancels → `canvasDataService.updatePage(id, { title })`
  - **Delete:** `canvas.deletePage` command → confirmation dialog via `api.window.showWarningMessage()` → `canvasDataService.deletePage()` → close editor if open → tree refreshes
  - All operations fire `PageChangeEvent` → tree listens and re-renders affected subtree

**Task 4.4 — Implement Drag-and-Drop Reorder** ✅
- **Task Description:** Add drag-and-drop to the page tree for reordering and reparenting.
- **Output:** Users can drag pages to reorder within siblings or reparent under a different page.
- **Completion Criteria:**
  - Drag source: any page (except root-level if protection needed)
  - Drop targets: between siblings (reorder) or onto a page (reparent as child)
  - Visual indicators: thin line between items (reorder), highlight on item (reparent)
  - On drop: calls `canvasDataService.movePage(pageId, newParentId, afterSiblingId)`
  - Prevent dropping a page onto its own descendant (cycle detection)
  - Smooth animations on reorder

---

## Capability 5 — Canvas Editor Pane

### Capability Description
A custom editor pane hosting a Tiptap rich text editor for editing Canvas pages. Integrates with the editor group system via `CanvasEditorInput`. Provides block-level editing with headings, lists, quotes, code blocks, and a slash command menu.

### Goals
- `CanvasEditorInput` extends `EditorInput` with `canvas:{pageId}` URI scheme
- `CanvasEditorPane` extends `EditorPane`, hosts Tiptap editor instance
- Block-level editing: paragraphs, headings (H1-H3), bullet lists, numbered lists, to-do lists, blockquotes, code blocks, dividers
- Slash command menu (`/`) for quick block insertion
- Keyboard formatting shortcuts (Ctrl+B bold, Ctrl+I italic, etc.)
- Content loaded from `CanvasDataService`, saved via auto-save debounce
- Multiple pages can be open simultaneously in different editor tabs

### Dependencies
- Capability 2 (Canvas Data Service — load/save content)
- Capability 3 (Canvas tool activation — editor provider registration)
- `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-placeholder` (Tiptap packages)
- `src/editor/editorInput.ts` (EditorInput base class)
- `src/editor/editorPane.ts` (EditorPane base class)
- `src/services/editorService.ts` (editor opening)

#### Tasks

**Task 5.1 — Install Tiptap Dependencies** ✅
- **Task Description:** Add Tiptap packages to the project.
- **Output:** Tiptap available for import in Canvas tool code.
- **Completion Criteria:**
  - `npm install @tiptap/core @tiptap/pm @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-task-list @tiptap/extension-task-item`
  - Packages resolve correctly in the Electron renderer environment
  - Build system handles Tiptap's ESM/CJS correctly

**Task 5.2 — Implement CanvasEditorInput** ✅
- **Task Description:** Create `src/built-in/canvas/canvasEditorInput.ts` extending `EditorInput`.
- **Output:** `CanvasEditorInput` class for the editor group system.
- **Completion Criteria:**
  - Extends `EditorInput`
  - `typeId` = `'canvas'`
  - `resource` returns URI with scheme `canvas:` and path from `pageId`
  - `getName()` returns page title
  - `getIcon()` returns page icon (emoji or default canvas icon)
  - `matches(other)` compares by `pageId`
  - `serialize()` / `deserialize()` for editor state persistence
  - `isDirty()` returns `true` if pending auto-save exists
  - Updates title/icon when page data changes

**Task 5.3 — Implement CanvasEditorPane** ✅
- **Task Description:** Create `src/built-in/canvas/canvasEditorPane.ts` extending `EditorPane`.
- **Output:** Editor pane hosting Tiptap with full rich text editing.
- **Completion Criteria:**
  - Extends `EditorPane`
  - `createEditor(parent: HTMLElement)` — creates Tiptap editor instance in the container
  - `setInput(input: CanvasEditorInput)` — loads page content from `CanvasDataService`, sets Tiptap content
  - Tiptap extensions: StarterKit (paragraph, heading, bold, italic, strike, code, bulletList, orderedList, blockquote, codeBlock, horizontalRule), Placeholder ("Type '/' for commands..."), TaskList, TaskItem
  - Content changes trigger `canvasDataService.scheduleContentSave(pageId, json)`
  - `layout(width, height)` — resizes Tiptap editor to fill pane
  - `dispose()` — destroys Tiptap instance
  - CSS styling follows the workbench theme tokens (editor background, foreground, selection colors)
  - CSS in `src/built-in/canvas/canvas.css`

**Task 5.4 — Implement Slash Command Menu** ✅
- **Task Description:** Add a slash command popup menu triggered by typing `/` at the start of an empty line.
- **Output:** Dropdown menu with block type options.
- **Completion Criteria:**
  - Typing `/` at the start of an empty block shows a popup menu
  - Menu items: Heading 1, Heading 2, Heading 3, Bullet List, Numbered List, To-Do List, Quote, Code Block, Divider
  - Arrow key navigation, Enter to select, Escape to dismiss
  - Selecting an item replaces the `/` with the appropriate block type
  - Menu positioned below the cursor, positioned within viewport
  - Filter: typing after `/` filters the menu items (e.g., `/head` shows only heading options)
  - Vanilla TS+CSS implementation (not a Tiptap extension component) — styled with theme tokens

**Task 5.5 — Implement Formatting Keyboard Shortcuts** ✅
- **Task Description:** Wire common formatting keyboard shortcuts within the Tiptap editor.
- **Output:** Standard formatting shortcuts work inside the editor.
- **Completion Criteria:**
  - `Ctrl+B` — toggle bold
  - `Ctrl+I` — toggle italic
  - `Ctrl+Shift+S` — toggle strikethrough
  - `Ctrl+E` — toggle inline code
  - `Ctrl+Shift+1/2/3` — heading 1/2/3
  - `Ctrl+Shift+8` — bullet list
  - `Ctrl+Shift+9` — numbered list
  - Shortcuts are handled by Tiptap (StarterKit provides most) — verify they work, add missing ones
  - Shortcuts should NOT propagate to Parallx keybinding system when editor is focused

---

## Capability 6 — Canvas Auto-Save and State Persistence

### Capability Description
Canvas pages auto-save as the user types, with dirty state properly tracked and reflected in editor tab indicators. Sidebar tree state (expanded nodes, selected page) persists across sessions.

### Goals
- Content auto-saves 500ms after last keystroke (debounced)
- Dirty indicator (dot) shown on editor tab while save is pending
- Sidebar expanded nodes persist in workspace memento
- Last-opened page restores on tool re-activation
- All pending saves flush before workspace close or tool deactivation

### Dependencies
- Capability 2 (Canvas Data Service — auto-save mechanics)
- Capability 5 (Canvas Editor Pane — dirty state integration)
- `src/configuration/toolMemento.ts` (workspace state persistence)

#### Tasks

**Task 6.1 — Integrate Dirty State with Editor Tab** ✅
- **Task Description:** Wire `CanvasEditorInput.isDirty()` to `CanvasDataService` pending save state.
- **Output:** Editor tab shows dirty indicator while content save is pending.
- **Completion Criteria:**
  - `CanvasEditorInput` tracks dirty state: `true` when `canvasDataService` has a pending save for this page
  - Editor group system reflects dirty state via tab dot indicator (existing EditorGroup behavior)
  - State clears when save completes
  - `onDidChangeDirty` event fires on transitions
  - Window close prompt if any Canvas editors are dirty (via existing `lifecycle:beforeClose` integration)

**Task 6.2 — Persist Sidebar Expanded State** ✅
- **Task Description:** Save and restore expanded tree nodes in workspace memento.
- **Output:** Expanded/collapsed page nodes persist across sessions.
- **Completion Criteria:**
  - Expanded page IDs stored in `context.workspaceState` under key `canvas.expandedPages`
  - On expand/collapse: update the stored set
  - On view creation: read stored set and apply expand state to tree
  - Handles stale IDs gracefully (deleted pages silently ignored)

**Task 6.3 — Persist Last-Opened Page** ✅
- **Task Description:** Remember which page was last opened and restore it on next activation.
- **Output:** Last-opened page reopens when Canvas activates.
- **Completion Criteria:**
  - Store last-opened page ID in `context.workspaceState` under key `canvas.lastOpenedPage`
  - On Canvas activation: if value exists and page still exists, open it in editor
  - If page was deleted: clear stored value, show empty state
  - Update stored value whenever user opens a different page

**Task 6.4 — Flush Pending Saves on Shutdown** ✅
- **Task Description:** Ensure all pending auto-saves complete before workspace close or tool deactivation.
- **Output:** No data loss on app close.
- **Completion Criteria:**
  - `deactivate()` in `main.ts` calls `canvasDataService.flushPendingSaves()`
  - Workspace change handler flushes before switching databases
  - `lifecycle:beforeClose` handler waits for flush completion
  - Verified: rapid typing → close app → reopen → content preserved

---

## Execution Order

```
Capability 0 (Tool Enable/Disable)     ← Foundation — must complete first
    │
    ├── Task 0.1–0.3: Types, service, startup wiring
    ├── Task 0.4–0.5: Enable/disable orchestration
    ├── Task 0.6: Tool Gallery UI
    ├── Task 0.7: API extensions
    └── Task 0.8: View re-registration
         │
Capability 1 (SQLite Data Layer)        ← Can begin after 0.3
    │
    ├── Task 1.1: Install better-sqlite3
    ├── Task 1.2: Database manager
    ├── Task 1.3: Canvas schema
    ├── Task 1.4: IPC channels
    └── Task 1.5: Workspace lifecycle
         │
Capability 2 (Canvas Data Service)     ← Depends on Cap 1
    │
    ├── Task 2.1: Page types
    ├── Task 2.2: Data service
    └── Task 2.3: Auto-save debounce
         │
Capability 3 (Canvas Manifest/Activation) ← Depends on Cap 0 + Cap 2
    │
    ├── Task 3.1: Manifest
    ├── Task 3.2: Entry point
    └── Task 3.3: Workbench wiring
         │
    ┌────┴──────────────┐
    │                   │
Capability 4            Capability 5
(Sidebar View)          (Editor Pane)     ← Both depend on Cap 3, parallel-capable
    │                   │
    ├── Task 4.1–4.4    ├── Task 5.1–5.5
    │                   │
    └────┬──────────────┘
         │
Capability 6 (Auto-Save & Persistence)  ← Depends on Cap 4 + Cap 5
    │
    └── Task 6.1–6.4
```

### Estimated Scope
- **Capability 0:** 8 tasks — new service, workbench wiring, API changes, Tool Gallery UI
- **Capability 1:** 5 tasks — native module, main process, IPC, migrations
- **Capability 2:** 3 tasks — types, service, debounce
- **Capability 3:** 3 tasks — manifest, entry point, wiring
- **Capability 4:** 4 tasks — tree view, selection, CRUD, drag-and-drop
- **Capability 5:** 5 tasks — Tiptap install, editor input, editor pane, slash menu, shortcuts
- **Capability 6:** 4 tasks — dirty state, expanded state, last page, flush

**Total: 7 capabilities, 32 tasks**

---

## Commit Strategy
- Each completed capability = one commit (or multiple if a capability is large)
- Commit message format: `M6 Cap X: [description]` (e.g., `M6 Cap 0: Tool enable/disable infrastructure`)
- All commits on `milestone-6` branch
- Merge to `master` on milestone completion

---

## Files Changed / Created

### New Files (Expected)
| File | Purpose |
|------|---------|
| `src/tools/toolEnablementService.ts` | Tool enablement service |
| `src/tools/toolEnablement.ts` | Enablement types (or in `toolManifest.ts`) |
| `electron/database.cjs` | SQLite database manager |
| `src/built-in/canvas/main.ts` | Canvas tool entry point |
| `src/built-in/canvas/canvasTypes.ts` | Page data types |
| `src/built-in/canvas/canvasDataService.ts` | Page CRUD + auto-save |
| `src/built-in/canvas/canvasSidebar.ts` | Sidebar tree view |
| `src/built-in/canvas/canvasEditorInput.ts` | Editor input for pages |
| `src/built-in/canvas/canvasEditorPane.ts` | Editor pane with Tiptap |
| `src/built-in/canvas/canvasSlashMenu.ts` | Slash command popup |
| `src/built-in/canvas/canvas.css` | Canvas tool styles |
| `src/built-in/canvas/migrations/001_canvas_schema.sql` | Database schema |
| `src/built-in/canvas/migrations/002_page_properties.sql` | Properties table |

### Modified Files (Expected)
| File | Changes |
|------|---------|
| `src/tools/builtinManifests.ts` | Add `CANVAS_MANIFEST` |
| `src/tools/toolManifest.ts` | Enablement types (if co-located) |
| `src/workbench/workbench.ts` | Enablement service init, Canvas activation |
| `src/services/serviceTypes.ts` | `IToolEnablementService` identifier |
| `src/api/parallx.d.ts` | `tools.isEnabled`, `setEnabled`, `onDidChangeEnablement` |
| `src/api/apiFactory.ts` | Wire enablement methods |
| `src/built-in/tool-gallery/main.ts` | Enable/disable UI |
| `src/built-in/tool-gallery/toolGallery.css` | Toggle styles |
| `electron/main.cjs` | Database IPC handlers |
| `electron/preload.cjs` | Database bridge |
| `package.json` | `better-sqlite3`, Tiptap dependencies |
| `ARCHITECTURE.md` | Update built-in tools section |

---

## Post-Milestone Bug Fixes

### Fix 1: Contributed views invisible + database path doubling ✅

**Commit:** `870c49f`

Two bugs fixed:

1. **Contributed sidebar views (Tools, Canvas) invisible.** The CSS rule `.view { display: none }` hid all view elements. The contributed view's `setVisible()` called `show()` which set `display=''` (empty string), removing the inline style but falling back to the CSS `display: none`. **Fix:** Toggle a `.visible` class via `classList.toggle()` instead of `show()`/`hide()`, matching the `.view.visible { display: block }` CSS rule.

2. **Database path doubling on Windows.** `_openDatabaseForWorkspace()` used `firstFolder.uri.path` (returns `/D:/AI/Parallx` in URI format) instead of `uri.fsPath` (strips the leading slash for Windows drive letters → `D:/AI/Parallx`). Resulted in `ENOENT: mkdir d:\D:\AI\...`. **Fix:** `uri.path` → `uri.fsPath` in `workbench.ts`.

| File | Change |
|------|--------|
| `src/contributions/viewContribution.ts` | `.visible` class toggle instead of `show()`/`hide()` |
| `src/workbench/workbench.ts` | `uri.path` → `uri.fsPath` for database path |

### Fix 2: Missing views dropped by saved tab order ✅

**Commit:** separate commit on `milestone-6`

**Problem:** `restoreContainerState()` replaced `_tabOrder` with the persisted array, then `_rebuildTabBar()` only re-appended tabs in that order. Views registered after the workspace was last saved (e.g. `view.output`) were orphaned — their tab elements existed but were never put back into the DOM.

**Fix:** Append any registered-but-missing view IDs to the end of the restored tab order before rebuilding the tab bar.

| File | Change |
|------|--------|
| `src/views/viewContainer.ts` | Append missing view IDs to restored tab order |

### Fix 3: Workspace save-as/duplicate clone full state ✅

**Commit:** `d738dc0`

Four workspace bugs fixed:

1. **`createWorkspace()` always persisted blank default state.** Save-as and duplicate produced empty workspaces because `createWorkspace()` always called `ws.createDefaultState()`. **Fix:** Added optional `cloneState` parameter. When provided, the new workspace is persisted with the cloned state (identity/metadata overwritten with the new workspace's).

2. **`workspace.saveAs` silently appended "(Copy)".** No user prompt for a workspace name. **Fix:** Shows a modal input box (`showInputBoxModal`) prompting for a name (pre-filled with `"<current> (Copy)"`), with non-empty validation. Cancellable via Escape. Collects current live state via `collectState()` and clones it.

3. **`workspace.duplicateWorkspace` created empty clone.** Same root cause as #1. **Fix:** Collects current live state and passes it as `cloneState` to `createWorkspace()`.

4. **`workspace.openRecent` was non-functional in its original form.** **Fix:** Simplified to delegate directly to Quick Access general provider, which already lists and switches recent workspaces.

**Additional improvements:**
- `WorkspaceSaver._collectState()` made public as `collectState()` so commands can snapshot live state
- Initial workspace save added to `_restoreWorkspace()` so storage always has an entry for the active workspace on first boot
- Workbench instance exposed as `window.__parallx_workbench__` in test mode (`PARALLX_TEST_MODE=1`)

| File | Change |
|------|--------|
| `src/workspace/workspaceSaver.ts` | `_collectState()` → public `collectState()` |
| `src/workbench/workbench.ts` | `createWorkspace()` accepts `cloneState`; initial save on boot |
| `src/commands/structuralCommands.ts` | `workspace.saveAs` shows input modal + clones state; `workspace.duplicateWorkspace` clones state; `workspace.openRecent` simplified |
| `src/main.ts` | Expose workbench as `__parallx_workbench__` in test mode |

### E2E Tests: Workspace Management ✅

**Commit:** `2986811` (rewrite), `fa21959` (additions)

**File:** `tests/e2e/08-workspaces.spec.ts` — 18 tests, all passing

**Principle:** Every assertion answers "What does the user SEE right now?" Every step is either a user action (click, type, press key) or a visual assertion (element count, text content, visibility). No `evaluate()` calls to inspect localStorage or JavaScript objects.

| # | Test | Validates |
|---|------|-----------|
| 1 | Initial launch shows Explorer with no placeholder fake files | Header label count = 1, placeholder-tree-row count = 0, gear icon count = 1 |
| 2 | Initial launch shows "No folder opened" empty state | No `.placeholder-explorer` element |
| 3 | Open folder shows real files from disk | `.tree-node-label` contains README.md/src/docs, NOT workbench.css/lifecycle.ts |
| 4 | Close folder removes tree and shows empty state | tree-node count = 0 after File → Close Folder |
| 5 | Save As shows name prompt and switches to new workspace | Modal appears, default "(Copy)", titlebar updates to new name |
| 6 | Save As does NOT duplicate sidebar elements | After Save As: header=1, gear=1, placeholder=0, explorer section=1 |
| 7 | Save As preserves real Explorer (no fake placeholder files) | Open folder → Save As → placeholder count=0, real tree nodes present |
| 8 | Save As can be cancelled with Escape | Modal → Escape → titlebar unchanged |
| 9 | Duplicate Workspace does not switch away from current | Titlebar unchanged, no duplication |
| 10 | Switching workspace updates titlebar and preserves UI integrity | Full UI integrity check after switch |
| 11 | Switching back and forth does not accumulate elements | Two switches, still 1 header, 1 gear, 0 placeholders |
| 12 | Opening a folder after Save As shows real files | Save As → open folder → real files appear |
| 13 | Save As preserves Explorer tree immediately without app restart | Open folder → Save As → tree nodes > 0, placeholder = 0 |
| 14 | Rename Workspace updates the titlebar name | Input contains current name, fill new name → titlebar shows it |
| 15 | Rename Workspace can be cancelled with Escape | Fill "Should Not Apply" → Escape → name unchanged |
| 16 | Rename Workspace modal has OK and Cancel buttons | OK/Cancel buttons visible and functional |
| 17 | Open Recent shows the quick access overlay | `.command-palette-overlay` visible → Escape dismisses |
| 18 | Ctrl+B toggles sidebar visibility | Sidebar hidden → shown via keyboard shortcut |

### Fix 4: Preserve view providers across workspace switch ✅

**Commit:** `2986811`

Four bugs fixed in workspace switching:

1. **Sidebar header not cleared during teardown.** `_teardownWorkspaceContent` cleared `.sidebar-views` innerHTML but not `.sidebar-header`. `_setupSidebarViews` appended new header label + actions, causing labels to accumulate on each switch. **Fix:** Added `sidebarHeader.innerHTML = ''` to teardown.

2. **Gear icon not removed during teardown.** `_addManageGearIcon` appended to `.activity-bar-bottom` which teardown didn't touch. `getIcons()` doesn't return the gear (it's manually added, not tracked). **Fix:** Added `gearBtn?.remove()` to teardown.

3. **View providers lost during workspace switch → placeholder fake files persisted.** Root cause: `removeContributions()` in teardown deletes the `_providers` map. Tools activate once on boot via `onStartupFinished` — they don't re-activate after a switch, so `registerViewProvider()` is never called again. `_replaceBuiltinPlaceholderIfNeeded` never triggers, and the `ExplorerPlaceholderView` with 12 hardcoded fake file rows stays forever. **Fix:** Save providers in `switchWorkspace()` BEFORE teardown via `getProviders()`, pass to `_rebuildWorkspaceContent(savedProviders)`, re-register after contribution replay. Added `getProviders(): ReadonlyMap` method to `ViewContributionProcessor`.

4. **Container redirects not cleared during teardown.** `_containerRedirects` map accumulated stale entries across switches. **Fix:** Added `this._containerRedirects.clear()` to teardown.

| File | Change |
|------|--------|
| `src/workbench/workbench.ts` | Teardown: clear sidebar header, remove gear icon, clear redirects. Switch: save providers before teardown, pass to rebuild |
| `src/contributions/viewContribution.ts` | Added `getProviders()` method |

### Fix 5: Explorer clears on Save As — folders not restored ✅

**Commit:** `fa21959`

**Problem:** Save As cleared Explorer items — only restarting the app brought them back. The root cause: `switchWorkspace()` fired `onDidSwitchWorkspace` AFTER calling `restoreFolders()`. `WorkspaceService._bindFolderEvents()` subscribes to the new workspace's `onDidChangeFolders` inside the `onDidSwitchWorkspace` handler. So when `restoreFolders()` fired `onDidChangeFolders`, WorkspaceService hadn't re-subscribed yet — the event was lost, and the Explorer was never notified about the restored folders.

**Fix:** Moved `_onDidSwitchWorkspace.fire()` BEFORE `restoreFolders()` so that WorkspaceService re-binds folder events first, then `restoreFolders()` fires through the active subscription chain (Workspace → WorkspaceService → WorkspaceBridge → Explorer → `rebuildTree()`).

| File | Change |
|------|--------|
| `src/workbench/workbench.ts` | Reordered: fire switch event before restoring folders |

### Fix 6: Input modal UX improvements ✅

**Commit:** `fa21959`

**Problem:** The `showInputBoxModal` used for Save As naming had poor UX:
- Text not pre-selected (user had to manually select-all to replace)
- Clicking inside the input to position cursor dismissed the modal (click event bubbled to overlay)
- Drag-to-select text dismissed the modal
- No visible OK/Cancel buttons — only keyboard Enter/Escape
- No focus ring on input

**Fix:** Complete rewrite of `showInputBoxModal`:
- `input.select()` on focus — text pre-selected for immediate typing
- `box.addEventListener('mousedown/click', e.stopPropagation())` — prevents event bubbling to overlay dismiss handler
- `-webkit-app-region: no-drag` on input — prevents titlebar drag interference
- OK/Cancel buttons added (`.parallx-modal-btn--primary`, `.parallx-modal-btn--secondary`)
- CSS for buttons: VS Code-style primary (blue) and secondary (gray) buttons with hover states
- Focus ring on input (`:focus` border-color)
- Double-resolve guard (`resolved` flag) prevents cleanup race conditions

| File | Change |
|------|--------|
| `src/api/notificationService.ts` | Rewrote `showInputBoxModal` with buttons, text selection, event isolation |
| `src/api/notificationService.css` | Added `.parallx-modal-btn`, primary/secondary variants, input focus ring |

### Fix 7: Rename Workspace command ✅

**Commit:** `fa21959`

**Problem:** No way to rename an existing workspace. Users had to create a new workspace with the desired name and delete the old one.

**Fix:** Added `workspace.rename` command that shows the improved input modal with the current workspace name pre-selected. On confirm:
1. Calls `workspace.rename(newName)` (method already existed on `Workspace` class)
2. Updates titlebar via `_titlebar.setWorkspaceName()`
3. Updates window title via `_updateWindowTitle()`
4. Persists via `_workspaceSaver.save()`

Added to File menu between "Save Workspace As…" and "Duplicate Workspace".

| File | Change |
|------|--------|
| `src/commands/structuralCommands.ts` | Added `workspaceRename` command + `WorkbenchLike` interface extensions (`_titlebar`, `_updateWindowTitle`, `workspace.rename`) |
| `src/workbench/workbench.ts` | Added "Rename Workspace…" to File menu dropdown |

### Fix 8: Explorer sub-folder expand state lost on file-watcher refresh ✅

**Commit:** `3bb3b86`

**Problem:** Expanding a sub-folder worked momentarily but collapsed ~300ms later. The file-system watcher fires `onDidFilesChange` events frequently. The debounced `refreshTree()` handler:
1. Wiped all node children arrays recursively (`unload()`)
2. Reloaded only root-level expanded nodes
3. `loadChildren()` always created new child nodes with `expanded: false`

All sub-folder expand state was destroyed every refresh cycle.

**Fix:** Before wiping the tree, `refreshTree()` now collects all expanded URIs into a `Set`. New `loadChildrenDeep()` function checks each child directory's URI against this set — marking previously-expanded directories as `expanded: true` and recursively loading their children. `rebuildTree()` also updated to use `loadChildrenDeep()` with the persisted expand state so deep trees reopen correctly on folder changes.

| File | Change |
|------|--------|
| `src/built-in/explorer/main.ts` | Added `loadChildrenDeep()`, `refreshTree()` captures expanded URIs before wipe, `rebuildTree()` uses `loadChildrenDeep()` |
### Fix 9: Tool Gallery GUI overhaul + .plx package install/uninstall ✅

**Problem:** The Tool Gallery used emoji icons, had no install/uninstall mechanism for external tools, and lacked a polished editor pane for tool details.

**Fix — GUI overhaul:**
- Replaced all emoji icons with monochrome SVG icons (`fill="currentColor"`) for built-in (document), external (plug), and install (download arrow) tools
- Redesigned the Install button: primary blue `.tool-gallery-install-btn` with SVG download icon, sits beside the search bar
- Added Canvas icon to the codicon map in `workbench.ts` (pen-on-page SVG)

**Fix — .plx package install/uninstall pipeline:**
The full pipeline for installing external tools from `.plx` (ZIP) packages at runtime without restart:

1. **Main process** (`electron/main.cjs`): `tools:install-from-file` IPC handler opens native file dialog filtered for `.plx`, validates ZIP structure (requires `parallx-manifest.json` + `main.js`), extracts to `~/.parallx/tools/<tool-id>/`, returns manifest + path. `tools:uninstall` IPC handler removes the tool directory.
2. **Preload bridge** (`electron/preload.cjs`): Exposes `installToolFromFile()` and `uninstallTool(toolId)`.
3. **API surface** (`src/api/apiFactory.ts`): Added `tools.installFromFile()`, `tools.uninstall(toolId)`, `tools.onDidInstallTool`, `tools.onDidUninstallTool` to the `parallx.*` API. Install delegates to Electron bridge then to a late-bound workbench callback for registration + activation.
4. **Workbench wiring** (`src/workbench/workbench.ts`): Late-bound `onToolInstalled` callback registers the tool in `ToolRegistry`, wires activation events, and activates immediately. `onToolUninstalled` callback deactivates, clears activation tracking, and unregisters.
5. **Tool Gallery UI** (`src/built-in/tool-gallery/main.ts`): Install button calls `api.tools.installFromFile()`. Each external tool card gets an Uninstall button. Success/error shown via `api.window.showInformationMessage` / `showErrorMessage`. Sidebar rebuilds on `onDidInstallTool` / `onDidUninstallTool`.

| File | Change |
|------|--------|
| `electron/main.cjs` | `tools:install-from-file` + `tools:uninstall` IPC handlers, AdmZip dependency |
| `electron/preload.cjs` | `installToolFromFile()` + `uninstallTool()` bridge methods |
| `src/api/apiFactory.ts` | `tools.installFromFile()`, `tools.uninstall()`, install/uninstall events, late-bound callbacks |
| `src/workbench/workbench.ts` | `onToolInstalled` / `onToolUninstalled` callbacks, Canvas codicon SVG |
| `src/built-in/tool-gallery/main.ts` | Install button, uninstall buttons, SVG icon constants, `window.*` API usage |
| `src/built-in/tool-gallery/toolGallery.css` | `.tool-gallery-install-btn`, SVG icon sizing, card layout tweaks |
| `package.json` | `adm-zip` dependency |

### Fix 10: Canvas editor Notion-parity extensions + blank screen fix ✅

**Problem:** The Canvas editor rendered a blank white area after upgrading to TipTap v3 with Notion-parity extensions. Three root causes:

1. **Duplicate extensions.** StarterKit v3 bundles Link + Underline. Importing them separately caused `Duplicate extension names found: ['link', 'underline']` — TipTap refused to initialize.
2. **Corrupted saved content.** Some pages had TipTap JSON with `type: undefined` nodes (saved during a crash). On load, TipTap threw `RangeError: Unknown node type: undefined`.
3. **CSS selector mismatch.** Styles used `.canvas-tiptap-editor .ProseMirror` (child selector), but TipTap v3 puts both classes on the same `<div>` — needed `.canvas-tiptap-editor.ProseMirror` (same-element selector).

**Fix — StarterKit v3 configuration:**
Extensions now configured through StarterKit where bundled (link, underline) and separately for new additions:
- `StarterKit.configure({ link: { openOnClick: false, autolink: true, linkOnPaste: true }, underline: {} })`
- Separate: `TextStyle`, `Color`, `Highlight.configure({ multicolor: true })`, `Image`, `GlobalDragHandle`

**Fix — Content validation:**
`_loadContent()` filters corrupted nodes from saved JSON before passing to TipTap:
```ts
const filterInvalid = (node: any): any => {
  if (!node || !node.type) return null;
  if (node.content) node.content = node.content.map(filterInvalid).filter(Boolean);
  return node;
};
```

**Fix — Bubble menu:**
Floating toolbar with 7 formatting buttons (bold, italic, underline, strikethrough, code, highlight, link) + collapsible link input. Shows on text selection, hidden on empty selection. Active states refresh on `selectionUpdate` and `transaction`.

**New TipTap extension packages added:**
- `@tiptap/extension-text-style` — required for Color
- `@tiptap/extension-color` — text color via TextStyle mark
- `@tiptap/extension-highlight` — background highlight with multicolor
- `@tiptap/extension-image` — inline images
- `@tiptap/suggestion` — slash command framework (peer dep)
- `tiptap-extension-global-drag-handle` — Notion-style drag handle

| File | Change |
|------|--------|
| `src/built-in/canvas/canvasEditorProvider.ts` | StarterKit v3 config, separate extensions, bubble menu, content validation, drag handle |
| `src/built-in/canvas/canvas.css` | `.canvas-tiptap-editor.ProseMirror` selector fix, ~200 lines for drag handle, bubble menu, links, highlights, images |
| `package.json` | 6 new TipTap extension dependencies |

### Fix 11: Canvas slash command click handler ✅

**Problem:** Clicking a slash menu item (`/heading`, `/bullet list`, etc.) did nothing. Two bugs:

1. **`mouseenter` destroyed click target.** Hovering over a slash menu item called `_renderSlashMenuItems()` which did `innerHTML = ''` and recreated all DOM elements. The element being clicked was removed mid-click — the `mousedown` event target no longer existed when the browser tried to fire `click`.
2. **Re-entrant `_checkSlashTrigger` during execution.** `_executeSlashItem()` called `deleteRange().run()` which fired TipTap's `onUpdate` → `_checkSlashTrigger()` → `_hideSlashMenu()`. The menu was hidden and state cleared mid-execution.

**Fix:**
- `mouseenter` now toggles CSS classes (`.active` on the new item, remove from the old item) instead of rebuilding the DOM
- `_executeSlashItem()` wraps the command execution in `_suppressUpdate = true` to prevent `onUpdate` from triggering `_checkSlashTrigger` mid-execution
- Added `stopPropagation()` to `mousedown` on slash menu items to prevent event bubbling

| File | Change |
|------|--------|
| `src/built-in/canvas/canvasEditorProvider.ts` | `_renderSlashMenuItems()` uses class toggle; `_executeSlashItem()` suppresses updates; `mousedown` stopPropagation |

### Fix 12: Placeholder, block alignment, and toggle Enter behaviour ✅

**Problems:**

1. **Placeholder indentation + cursor at end.** The `float: left; height: 0` technique for placeholder `::before` pushed the cursor to the right end of placeholder text inside callout/toggle/todo wrapper blocks. The content appeared indented compared to blocks with typed text.
2. **Todo checkbox misaligned with text.** The `label` `margin-top: 2px` didn't center the 16px checkbox with the text line (line-height 1.625).
3. **Toggle chevron and summary misaligned.** The `>` chevron button was offset (`left: 2px`) and the summary text had `padding-left: 26px`, causing the toggle to not align with surrounding blocks. The drag handle was also misaligned because the details container had no `padding-top` for the drag handle plugin to read.
4. **Toggle content line spacing.** Summary `line-height: 1.5` differed from the editor's `1.625`, and excessive `min-height: 28px` and padding caused uneven vertical spacing.
5. **Enter on collapsed toggle created paragraph.** TipTap's built-in Details extension Enter handler creates a plain `<p>` below a collapsed toggle. Notion creates a new toggle block instead.

**Fixes:**

- **Placeholder:** Replaced `float: left; height: 0` with `position: absolute` on `::before`. Added `position: relative` to `p`, `h1`–`h3`, and `detailsSummary` so the placeholder anchors to its parent block. Completely out-of-flow — no width reservation, no indentation, cursor always at left edge.
- **Removed `float: none` override:** The earlier wrapper-block `float: none` override (lines 322–329) was removed since `position: absolute` makes it unnecessary.
- **Todo checkbox:** `label` `margin-top: 2px` → `5px` to vertically center with text baseline.
- **Toggle alignment:** Chevron `left: 0` (at text edge), summary `padding-left: 24px` (text after chevron), matching the todo checkbox+text pattern. Added `padding-top: 4px` to the details container so the drag handle plugin accounts for it.
- **Toggle spacing:** Summary `line-height: 1.5` → `1.625` (matches editor), `min-height: 28px` → `24px`, tightened padding on summary and content area.
- **Enter on collapsed toggle:** New `DetailsEnterHandler` TipTap Extension (priority 200) intercepts Enter when cursor is in a `detailsSummary` and the content is collapsed. Inserts a new `details` block below with cursor in the new summary. Falls through to built-in handler when toggle is open.

| File | Change |
|------|--------|
| `src/built-in/canvas/canvas.css` | Placeholder `position: absolute` + `position: relative` on blocks; removed `float: none` override; todo label `margin-top: 5px`; toggle alignment and spacing fixes |
| `src/built-in/canvas/canvasEditorProvider.ts` | Added `Extension` import; `DetailsEnterHandler` extension for collapsed toggle Enter; registered in editor extensions array |

### Fix 13: Formula / Equation Rendering — Inline & Block (KaTeX) ✅

**Feature:** Notion-parity formula rendering using KaTeX. Both inline equations (within text) and block equations (full-width standalone) are supported.

**Research:**

- Notion uses KaTeX for all math rendering. Two types: inline (`$...$`, Ctrl+Shift+E) and block (`/math`, `/block equation`). Click-to-edit UX with raw LaTeX input, live previews.
- Evaluated existing TipTap extensions:
  - `@aarkue/tiptap-math-extension` v1.4.0 — MIT, TipTap v3 compatible, ~4.7K weekly npm downloads, provides inline math node with `$...$` input rules and KaTeX rendering.
  - `tiptap-math` (Buttondown) — TipTap v2 only, stale, block-only, 135 weekly downloads. Not viable.
  - `@tiptap-pro/extension-mathematics` — Paid/Pro only. Not viable for open-source project.
- KaTeX chosen over MathJax: faster (synchronous rendering), smaller bundle (~300KB vs ~1.5MB), used by Notion/Khan Academy/GitHub.

**Implementation:**

- **Inline math:** `@aarkue/tiptap-math-extension`'s `InlineMathNode` — automatically converts `$...$` (inline) and `$$...$$` (display) delimiters to rendered KaTeX nodes. Backspace to unwrap and re-edit.
- **Block math:** Custom `MathBlock` TipTap Node (`atom: true`, `draggable: true`) with full NodeView:
  - Click-to-edit: shows raw LaTeX `<textarea>` input with live KaTeX preview below
  - Enter to confirm, Escape to revert, blur to auto-commit
  - Empty blocks auto-open in edit mode with "Empty equation — click to edit" placeholder
  - KaTeX `displayMode: true` for centered, full-width rendering
- **Slash menu:** Two new items — "Block Equation" (`/equation`, `/math`) and "Inline Equation"
- **Icons:** Two new SVG icons (`math`, `math-block`) added to icon system
- **CSS:** KaTeX stylesheet (`katex.min.css`) concatenated first in `workbench.css`; KaTeX font files copied to `dist/renderer/fonts/`; custom styles for `.canvas-math-block`, `.canvas-math-block-editor`, `.tiptap-math.latex`
- **Markdown export:** `mathBlock` → `$$\nlatex\n$$`, `inlineMath` → `$latex$` (or `$$latex$$` for display mode)

**Dependencies added:** `katex@0.16.28`, `@aarkue/tiptap-math-extension@1.4.0`

| File | Change |
|------|--------|
| `package.json` | Added `katex`, `@aarkue/tiptap-math-extension` dependencies |
| `src/built-in/canvas/canvasEditorProvider.ts` | `InlineMathNode` + `MathBlock` custom node; slash menu items; import `katex` |
| `src/built-in/canvas/canvas.css` | Inline math hover/styling; block math container, editor, preview, empty states |
| `src/built-in/canvas/canvasIcons.ts` | Added `math` and `math-block` SVG icons |
| `src/built-in/canvas/markdownExport.ts` | `mathBlock` → `$$...$$`; `inlineMath` → `$...$` in export |
| `scripts/build.mjs` | KaTeX CSS concatenation + font file copy to `dist/renderer/fonts/` |

---

### Fix 14: Inline Equation — Click-to-Edit Popup & Bubble Menu Integration ✅

**Problem:** Three issues with inline equation UX:
1. Inline equations created via slash menu render with a placeholder (`f(x)`) but users cannot edit them — the node is `atom: true` and has no interactive editing surface.
2. No way to convert existing text to an inline equation — the bubble menu (text selection toolbar) had no formula option.
3. The `$...$` input rule from the library works but is not the primary creation workflow most users expect.

**Solution:**

1. **Click-to-edit popup** — Clicking any inline math node opens a floating editor popup positioned below it with:
   - Text input field for LaTeX source (monospace font, auto-focused with text selected)
   - Live KaTeX preview below the input
   - Enter to confirm, Escape to cancel, blur to auto-commit
   - Empty input removes the node from the document
   - Event delegation via click handler on editor container targeting `.tiptap-math.latex` elements

2. **Bubble menu formula button** — Added formula icon (Σ) as 8th button in the floating toolbar:
   - Appears when text is selected alongside Bold, Italic, Underline, Strikethrough, Code, Link, Highlight
   - Converts selected text into an `inlineMath` node with the selected text as LaTeX content
   - Auto-opens the inline math editor popup after conversion so users can refine the formula
   - Hides the bubble menu when the math editor opens (no overlapping popups)

3. **Auto-open editor on slash menu insert** — When "Inline Equation" is chosen from the slash menu, the inline math editor popup automatically opens for the newly inserted node.

**Implementation approach:** Event delegation for clicks (no NodeView override needed), positioned popup similar to existing link-input pattern, integrated into existing bubble menu and slash menu flows.

| File | Change |
|------|--------|
| `src/built-in/canvas/canvasEditorProvider.ts` | Added `_inlineMathPopup/Input/Preview/Pos` fields; `_createInlineMathEditor()`, `_showInlineMathEditor()`, `_commitInlineMathEdit()`, `_hideInlineMathEditor()` methods; click handler on editor container; formula button in bubble menu; auto-open in `_executeSlashItem()`; blur handler excludes popup; dispose cleanup |
| `src/built-in/canvas/canvas.css` | Added `.canvas-inline-math-editor` popup styles (positioned, dark bg, border-radius, shadow), input, preview, hint, and empty states |

---

### Fix 15: Equation Editor UX Polish ✅

**Changes:**
1. **Inline math styling** — Removed grey background, increased font size from `1em` to `1.15em` for better readability within text.
2. **Block equation drag handle** — Added `'mathBlock'` to `GlobalDragHandle.configure({ customNodes })` so equation blocks can be reordered via the drag handle (was missing from the selector list).
3. **Block equation editor redesign (Notion-style)** — Replaced the full-width inline card editor with a floating popup that appears below the rendered equation:
   - Rendered equation stays visible and updates live as you type (it *is* the preview)
   - Floating popup: absolutely-positioned, centered, dark bg, rounded corners, drop shadow
   - Minimal layout: textarea (monospace) + blue "Done ↵" button
   - Textarea wraps text and expands height dynamically (auto-resize)
   - Wide popup (600–900px) for comfortable editing of complex expressions
   - Enter to confirm, Escape to revert, blur to auto-commit

| File | Change |
|------|--------|
| `src/built-in/canvas/canvas.css` | Inline math: `background: none`, `font-size: 1.15em`. Block editor: floating popup with `position: absolute`, `translate`, `min-width: 600px`, textarea with `resize: none; overflow: hidden; white-space: pre-wrap`, blue Done button |
| `src/built-in/canvas/canvasEditorProvider.ts` | Block equation NodeView: `<textarea>` instead of `<input>`, auto-resize on input, Done button with mousedown handler, live KaTeX update to render area; `GlobalDragHandle` `customNodes: ['mathBlock']` |

---

## Canvas Editor — Notion Parity Gap Analysis

Research based on **Novel** (16k stars, gold-standard Notion-style TipTap editor) and **tiptap-block-editor** by phyohtetarkar.

### Architecture Notes

- **No React needed.** Novel uses React, but all TipTap extensions are framework-agnostic. Parallx's vanilla TS `new Editor(...)` approach works perfectly — just add extensions to the array.
- **Bubble menu needs custom DOM.** Since we can't use `@tiptap/react`, the floating toolbar is built as a vanilla TS ProseMirror plugin / TipTap `Extension.create()` that watches selection changes and positions a DOM overlay. Novel uses React's BubbleMenu, but the underlying ProseMirror plugin (`@tiptap/extension-bubble-menu`) works headlessly.
- **Slash command upgrade path.** The current slash menu works but should ideally be refactored to use `@tiptap/suggestion` (the same approach Novel uses), which gives proper positioning, filtering, and keyboard navigation "for free."
- **Callout node** — Notion's colored info boxes. Requires a custom TipTap node (`Node.create({ name: 'callout', ... })`) with an emoji picker and background color. No off-the-shelf npm package — both Novel and tiptap-block-editor implement this custom.
- **Drag handle** — `tiptap-extension-global-drag-handle` (153 stars, used by Novel) is headless — needs CSS for the handle icon (a 6-dot grip). It gives every block a draggable handle that appears on hover.

### Tier 1 — Essential (core Notion feel) ✅ COMPLETED

| # | Feature | Extension | Status |
|---|---------|-----------|--------|
| 1 | Global drag handle | `tiptap-extension-global-drag-handle` | ✅ Implemented |
| 2 | Link with preview | `@tiptap/extension-link` (via StarterKit v3) | ✅ Configured via StarterKit |
| 3 | Underline | `@tiptap/extension-underline` (via StarterKit v3) | ✅ Configured via StarterKit |
| 4 | Text color / highlight | `@tiptap/extension-color`, `@tiptap/extension-highlight`, `@tiptap/extension-text-style` | ✅ Implemented |
| 5 | Image embed | `@tiptap/extension-image` | ✅ Implemented (URL-based) |
| 6 | Floating toolbar (bubble menu) | Custom vanilla TS selection-based overlay | ✅ Implemented — 7 buttons + link input |
| 7 | Slash command | Custom DOM implementation (functional, not `@tiptap/suggestion`) | ✅ Working — 11 items, keyboard nav, click fixed |

**Packages added for Tier 1:** `@tiptap/extension-text-style`, `@tiptap/extension-color`, `@tiptap/extension-highlight`, `@tiptap/extension-image`, `@tiptap/suggestion`, `tiptap-extension-global-drag-handle`

### Tier 2 — Important (power-user Notion features) ✅ COMPLETED

| # | Feature | Extension | Status | Complexity |
|---|---------|-----------|--------|------------|
| 1 | **Callout / info box** | Custom node (`Node.create({ name: 'callout' })`) | ✅ Implemented — emoji + colored background box | Medium |
| 2 | **Toggle list (collapsible)** | `@tiptap/extension-details` + DetailsSummary + DetailsContent (official v3) | ✅ Implemented — persist: true, animated arrow | Low |
| 3 | **Table** | `TableKit` from `@tiptap/extension-table` (bundles Table + Row + Cell + Header) | ✅ Implemented — resizable columns, header row | Medium |
| 4 | **Code block with syntax highlighting** | `@tiptap/extension-code-block-lowlight` + lowlight + highlight.js | ✅ Implemented — VS Code Dark+ token colors, common languages | Medium |
| 5 | **Character count** | `@tiptap/extension-character-count` | ✅ Installed | Low |
| 6 | **Auto-joiner** | `tiptap-extension-auto-joiner` | ✅ Installed — companion to drag handle | Low |

### Tier 3 — Nice to Have ⬜ FUTURE

| # | Feature | Extension | Status |
|---|---------|-----------|--------|
| 1 | YouTube / embed | `@tiptap/extension-youtube` | ⬜ Missing |
| 2 | Mathematics / KaTeX | Custom + katex | ⬜ Missing |
| 3 | Mention / page links | `@tiptap/extension-mention` + custom | ⬜ Missing |
| 4 | AI writing assist | Custom + LLM API | ⬜ Missing |
| 5 | Mermaid diagrams | Custom node | ⬜ Missing |

### Implementation Priority (recommended order within each tier)

**Tier 1** (completed):
1. ~~Drag handle + link + underline + highlight/color~~ ✅
2. ~~Bubble menu~~ ✅
3. ~~Image support~~ ✅
4. ~~Slash command fixes~~ ✅

**Tier 2** (completed):
1. ~~Callout block — custom TipTap node with emoji + colored background~~ ✅
2. ~~Toggle list — `@tiptap/extension-details` (official v3 extension)~~ ✅
3. ~~Table — `TableKit` from `@tiptap/extension-table` (resizable)~~ ✅
4. ~~Code block syntax highlighting — `@tiptap/extension-code-block-lowlight` + lowlight + highlight.js~~ ✅
5. ~~Character count — `@tiptap/extension-character-count`~~ ✅
6. ~~Auto-joiner — `tiptap-extension-auto-joiner` (companion to drag handle)~~ ✅

### Visual Overhaul — Modern Notion Feel ✅ COMPLETED

After Tier 2 functional implementation, a comprehensive visual/UX overhaul was performed based on deep research of **Novel** (16k stars, gold standard Notion-like TipTap editor) and **BlockNote** (10k stars, professional block editor).

**Research findings applied:**

| Area | Before (IDE-like) | After (Notion-like) | Reference |
|------|-------------------|---------------------|-----------|
| **Font** | `var(--vscode-font-family)` 15px | Inter / system sans-serif stack, 16px | Novel, BlockNote |
| **Headings** | h1=2em, h2=1.5em, h3=1.25em | h1=2.25em, h2=1.75em, h3=1.375em + letter-spacing | Notion, BlockNote (3em/2em/1.3em) |
| **Editor padding** | 24px 48px | 48px 64px 96px (generous Notion-style) | Novel uses `p-12 px-8` |
| **Block spacing** | 0.3em paragraph margin | Tighter 0.125em + generous heading margins | Notion |
| **Inline code** | VS Code dark bg, 3px radius | `rgba(255,255,255,0.08)`, 4px radius, red text | Notion (red inline code) |
| **Code blocks** | 4px radius, 12px pad, VS Code border | 8px radius, 20px pad, no border, `tab-size: 2` | Novel/BlockNote |
| **Callout** | Left border + VS Code bg | No border, subtle `rgba(255,255,255,0.04)` bg | Notion |
| **Toggle list** | Visible border, bg summary | Borderless, SVG chevron arrow, hover highlight | Notion |
| **Table** | UPPERCASE headers, heavy borders | Normal case, rgba borders, soft header bg | Notion |
| **Slash menu** | 4px radius, VS Code widget colors | 10px radius, 6px padding, 280px min-width, fade-in animation | Novel |
| **Bubble menu** | VS Code widget chrome | Dark (#252525), 8px radius, smooth fade-in, clean buttons | Novel |
| **Drag handle** | Radial gradient dots | SVG 6-dot pattern (matches Novel exactly), smooth transitions | Novel |
| **Links** | Blue underline, `textLink-foreground` | Inherit color, subtle underline with `underline-offset: 3px` | Notion |
| **Selection** | VS Code blue overlay | Soft `rgba(45,170,219,0.3)` blue | Notion |
| **Checkboxes** | Native browser checkbox | Custom CSS: rounded, blue checked, white checkmark clip-path | Notion |
| **Scrollbars** | Native | Thin 6px, transparent track, subtle thumb | Modern editors |
| **Placeholder** | Italic, VS Code muted | `rgba(255,255,255,0.25)`, non-italic, heading-specific text | Novel |

---

## Canvas Page Experience — Notion Model Research & Implementation Plan

> **Design Principle:** Working systems mean nothing if we cannot present a cohesive UI that is free of bugs, intuitive, and pleasing to use and look at. Every feature below must be evaluated not only for functional correctness but for visual polish, interaction smoothness, and consistency with the Notion-like experience users expect. If it doesn't *feel* right, it's not done.

### Notion Page Model — Research Summary

**How Notion works (single-user-relevant subset):**

Notion's data model is: *everything is a block*. A page is a block. A database is a block. Content inside a page is blocks. For Parallx Canvas — a local, single-user app — we don't need the full block-as-entity abstraction (TipTap handles content blocks internally). What we *do* need is the **page-level metadata, UI chrome, and settings** that make Notion feel polished.

A Notion page has five distinct zones:

```
┌──────────────────────────────────────────────────────────┐
│  COVER IMAGE (full width, 280px tall, repositionable)    │
├──────────────────────────────────────────────────────────┤
│  ICON (large, overlapping cover bottom-left)             │
│  TITLE (large editable text — IS the page name)          │
│                                                          │
│  PROPERTIES BAR (structured metadata below title)        │
│  ┌─ Status: Draft ─┐ ┌─ Tags: design, ux ─┐            │
│  └──────────────────┘ └────────────────────┘            │
│  + Add a property                                        │
│                                                          │
│  ─────────────────────────────────────────────────── ─── │
│                                                          │
│  CONTENT BODY (TipTap editor — blocks)                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Key Notion behaviors researched:**

1. **Title ↔ Sidebar sync.** The in-editor title IS the page name. Editing it instantly updates the sidebar label. There is no separate "rename" — the title is the first thing you see and edit on a page. The title is NOT part of the TipTap document body — it's a separate input element above the editor.

2. **Icon system.** Each page has an emoji icon (or uploaded image in Notion Pro). The icon appears: (a) in the sidebar tree, (b) large above the title in the editor, (c) in editor tab labels. Clicking the icon opens an emoji picker. "Remove" option to clear it back to none (sidebar shows default page icon).

3. **Cover image.** Full-width banner at top of page. ~280px tall. `object-fit: cover` with adjustable `object-position` (y-offset 0.0–1.0). Sources: upload from disk, paste URL, built-in gallery (gradients, photos). "Reposition" mode: drag vertically to adjust crop. "Change cover" / "Remove" buttons appear on hover.

4. **Page settings.** Found in the "⋯" menu at top-right of page:
   - **Full width** — widens content from ~720px to ~900px+
   - **Small text** — reduces base font (16px → 14px)
   - **Font** — three choices: Default (system sans), Serif, Mono
   - **Lock page** — prevents editing (read-only mode)

5. **Properties.** Structured metadata between title and content body. Each property has a type (text, number, select, multi-select, date, checkbox, URL, relation) and a value. Users can add/remove/reorder properties. Properties appear as a subtle key-value list. Our existing `page_properties` table already supports this — we need the UI.

6. **Favorites / pinning.** Star a page to pin it to a "Favorites" section at the top of the sidebar. Quick access to frequently-used pages.

7. **Trash / archive.** Deleted pages go to trash (soft-delete). Trash is viewable (sidebar section or modal). Pages can be restored or permanently deleted. We already have `is_archived` — we need the UI.

8. **Duplicate.** Deep-copy a page including all content and child pages.

9. **Breadcrumbs.** Path trail showing: Parent Page > Current Page. Clickable to navigate up.

### What Already Exists in Our Codebase

| System | File(s) | Status | Reuse Opportunity |
|--------|---------|--------|-------------------|
| Page data model | `canvasTypes.ts` → `IPage` | ✅ Has id, parentId, title, icon, content, sortOrder, isArchived, timestamps | Extend with new columns |
| Page CRUD | `canvasDataService.ts` | ✅ Full CRUD, auto-save, tree assembly | Extend `updatePage()` to accept new fields |
| Properties table | `002_page_properties.sql` | ✅ Schema exists — `page_properties(id, page_id, key, value_type, value)` | Add CRUD methods + UI |
| Sidebar tree | `canvasSidebar.ts` | ✅ Full tree with DnD, rename, create, delete | Add Favorites section, Trash section |
| Editor pane | `canvasEditorProvider.ts` | ✅ TipTap with 14 slash commands, bubble menu | Add title input, cover, icon, properties |
| Page icon | `IPage.icon` column + sidebar display | 🟡 Stored in DB, shows in sidebar, no picker | Add emoji picker + editor header icon |
| Soft delete | `IPage.isArchived` column | 🟡 Column exists, no UI for trash/restore | Add trash view |
| Migration system | `electron/database.cjs` | ✅ Versioned SQL migrations | Create `003_page_settings.sql` |
| CSS architecture | `canvas.css` | ✅ ~1000 lines, Notion-style dark theme | Extend with cover, title, properties, menu styles |
| TipTap instance | `canvasEditorProvider.ts` → `CanvasEditorPane` | ✅ Full editor with extensions | Mount title/cover/props ABOVE the TipTap element |

### Existing Libraries & Approaches to Leverage (Don't Reinvent the Wheel)

| Need | Existing Solution | How We Use It |
|------|-------------------|---------------|
| **Emoji picker** | `emoji-mart` (11k stars) or `picmo` (1.3k stars) — both provide a standalone, framework-agnostic emoji picker component | Import and mount as a popup on icon click. `emoji-mart` has a vanilla JS version (`emoji-mart/element`). Alternatively, build a simpler inline grid of common emojis (Notion only shows ~200 in the quick picker). |
| **Cover image positioning** | CSS `object-fit: cover` + `object-position: center {Y}%` | No library needed. Store Y offset (0–100), apply via inline style. Drag-to-reposition is a simple `mousedown` → `mousemove` → `mouseup` handler that updates the Y value. |
| **Cover image gradients** | CSS `linear-gradient()` / `radial-gradient()` | Ship 10–15 built-in gradient presets as CSS strings. No images needed for these. |
| **Date picker (for date properties)** | `flatpickr` (16k stars) — lightweight, no deps, dark theme | Mount inline in property editor row. Native `<input type="date">` is also viable for MVP but looks inconsistent across platforms. |
| **Color picker (for select tag colors)** | Hardcoded palette of 10 Notion colors | Notion uses a fixed set: light gray, gray, brown, orange, yellow, green, blue, purple, pink, red. No color picker library needed — just a grid of swatches. |
| **Multi-select tags** | Vanilla TS tokenized input | Standard pattern: input with pill/chip elements, backspace to remove, enter to add. No library needed. |
| **Breadcrumbs** | We already have `breadcrumbsBar.ts` in `src/editor/` | Check if it can be adapted for Canvas parent chain display. May need custom renderer. |
| **ContentEditable title** | Native `contenteditable="true"` on a `<div>` or `<h1>` | Simpler than a full `<input>`. Notion uses this. Handles multiline paste prevention, placeholder text via CSS `:empty::before`. |
| **File upload (covers, images)** | Electron `dialog.showOpenDialog()` already exposed via IPC | We already have file dialog infrastructure. For covers: read file → convert to base64 → store in DB (local app, no CDN needed). |
| **Markdown export** | TipTap `editor.getJSON()` → walk tree → emit Markdown | No library needed. TipTap's JSON is a clean AST. A 100-line recursive function handles all current block types. Alternatively, `@tiptap/html` exports HTML which can be piped through `turndown` (7k stars). |

---

## Capability 7 — Page Title & Icon Experience ✅

### Capability Description

The editor pane gains a dedicated title zone above the TipTap content area. The page title is rendered as a large `contenteditable` heading that syncs bidirectionally with the sidebar label. The page icon appears large and clickable next to the title, opening an emoji picker for changing it. This is the single most impactful UX change — it transforms the editor from "a text area with a tab" to "a page you can name and personalize."

### UX Requirements (Non-Negotiable)

- The title MUST feel like part of the page, not a form input. Large text (≥30px), no visible border, no background difference from the content area.
- Typing in the title MUST update the sidebar label within 300ms (debounced, not on every keystroke).
- Pressing Enter in the title MUST move focus to the first line of the TipTap body (not create a newline in the title).
- The icon MUST be clickable. Clicking it opens an emoji picker popup. Selecting an emoji updates the icon everywhere (sidebar, tab, editor header) immediately.
- An empty page (no title typed yet) MUST show placeholder text: "Untitled" in muted color.
- If the page has no icon set, show a ghosted "Add icon" button that appears on hover over the title area.
- Tab name in the editor group MUST reflect the current title (not a stale name from when the tab was opened).

### Goals

- `contenteditable` title element above TipTap editor, styled as large heading
- Bidirectional sync: title edits → `dataService.updatePage(pageId, { title })` → `onDidChangePage` → sidebar re-renders label
- Tab label updates via `EditorInput` name change propagation
- Emoji picker for icon selection (lightweight, inline popup)
- Icon displayed large (32–40px) in editor header, normal (14px) in sidebar
- "Add icon" hover affordance when no icon is set

### Dependencies

- `canvasEditorProvider.ts` (editor pane — mount title element above TipTap)
- `canvasDataService.ts` (updatePage for title/icon changes)
- `canvasSidebar.ts` (already listens to `onDidChangePage` → re-renders)
- `canvas.css` (new styles for title zone, icon, emoji picker)
- Optional: `emoji-mart` npm package for full picker, or custom simple grid

### Research — How Others Implement This

**Notion:** Title is a `contenteditable` div with `data-content-editable-leaf="true"`. The icon sits to the left, slightly above. The entire title zone has generous padding (80px top when no cover, 36px when cover is present). Placeholder "Untitled" appears via CSS `:empty::before { content: "Untitled"; color: rgba(...) }`.

**Novel:** Does not implement page titles (it's an editor component, not a full app). Title would be the host application's responsibility.

**BlockNote:** No page-level title. Confirms this is an app-level feature, not an editor-library feature.

**Approach for Parallx:** We add a `div.canvas-page-header` container above the TipTap element inside `canvas-editor-wrapper`. This container holds the icon element and the title element. The TipTap editor mounts below it. The header is NOT part of the TipTap document — it's separate DOM managed by `CanvasEditorPane`.

#### Tasks

**Task 7.1 — Add Title Element to Editor Pane** ✅
- **Task Description:** Create a `contenteditable` title heading above the TipTap editor in `CanvasEditorPane.init()`.
- **Output:** Large editable title rendered above the content body.
- **Completion Criteria:**
  - `div.canvas-page-header` inserted into `canvas-editor-wrapper` BEFORE the TipTap `<div>` element
  - Inside the header: `div.canvas-page-title` with `contenteditable="true"`, `data-placeholder="Untitled"`, `spellcheck="false"`
  - Title loaded from `IPage.title` via `_dataService.getPage(pageId)`
  - CSS: font-size 40px, font-weight 700, line-height 1.2, no border, no outline, padding matches TipTap body (64px horizontal), max-width 860px
  - Placeholder via CSS `:empty::before { content: attr(data-placeholder); color: rgba(255,255,255,0.2) }`
  - Multiline prevention: `keydown` handler blocks Enter (moves focus to TipTap instead), blocks paste of newlines
  - `input` event on title → debounced (300ms) → `_dataService.updatePage(pageId, { title: titleEl.textContent })`
  - Title text rendered as plain text only (strip HTML on paste)

**Task 7.2 — Bidirectional Title ↔ Sidebar Sync** ✅
- **Task Description:** Ensure title changes in the editor propagate to the sidebar and vice versa.
- **Output:** Editing the page title in the editor updates the sidebar label in real-time.
- **Completion Criteria:**
  - Editor title `input` event → debounced `updatePage()` → fires `onDidChangePage(Updated)` → sidebar `_refreshTree()` re-renders with new title
  - Sidebar inline rename (F2 / double-click) → `updatePage()` → fires `onDidChangePage(Updated)` → editor pane listens to `onDidChangePage` and updates title element if `pageId` matches
  - Editor tab label: `EditorInput.name` or display label updates when title changes. The editor group system picks up name changes via existing `onDidChangeLabel` or re-render logic.
  - No circular updates: title element checks if new value differs from current before writing to DOM

**Task 7.3 — Page Icon Display in Editor Header** ✅
- **Task Description:** Show the page icon large in the editor header, clickable to change.
- **Output:** Icon displayed at 32–40px above or beside the title.
- **Completion Criteria:**
  - `span.canvas-page-icon` element inside `canvas-page-header`, positioned above the title (Notion-style: icon sits above the title with slight left offset)
  - If `page.icon` is set: display the emoji at 40px
  - If `page.icon` is null: show nothing by default; on hover over the title area, show a ghosted "🖼 Add icon" button (muted text, appears on hover)
  - Click on icon → opens emoji picker (Task 7.4)
  - Click on "Add icon" hover button → opens emoji picker
  - Icon updates via `_dataService.updatePage(pageId, { icon: selectedEmoji })`
  - `onDidChangePage` updates icon in sidebar (already works — sidebar reads `node.icon`)

**Task 7.4 — Emoji Picker for Icon Selection** ✅
- **Task Description:** Implement or integrate an emoji picker popup for changing the page icon.
- **Output:** Popup with emoji grid, search, and "Remove" option.
- **Completion Criteria:**
  - **Option A (Recommended for MVP):** Build a simple custom emoji grid:
    - 8 category tabs: Smileys, People, Animals, Food, Travel, Activities, Objects, Symbols
    - Grid of ~300 most-used emojis (Notion shows ~200 in quick picker)
    - Search input at top: filters emojis by name/keyword
    - "Remove" button to clear icon back to null
    - Positioned as absolute popup below/beside the icon click target
    - Click outside or Escape dismisses
    - CSS: dark bg (#252525), rounded corners, max-height with scroll, same styling language as slash menu
  - **Option B (Full-featured):** Install `emoji-mart` vanilla JS element:
    - `npm install emoji-mart @emoji-mart/data`
    - Mount `<em-emoji-picker>` web component in popup
    - Configure: `theme="dark"`, `skinTonePosition="search"`, category icons
    - On select: `event.detail.native` gives the emoji string
    - Handles search, skin tones, recently-used automatically
  - Either option: selected emoji → `_dataService.updatePage(pageId, { icon })` → UI updates everywhere

---

## Capability 8 — Cover Image System ✅

### Capability Description

Pages can have a full-width cover image displayed at the top of the editor pane, above the icon and title. Covers support local file upload, URL paste, and built-in gradient presets. Users can reposition covers by dragging vertically. Cover state persists in the database.

### UX Requirements (Non-Negotiable)

- Cover MUST be full-width within the editor wrapper (not constrained to max-width 860px — it bleeds edge-to-edge).
- Cover height: ~200px (shorter than Notion's 280px to leave room for content in smaller windows).
- Repositioning MUST feel like dragging a photo behind a window — smooth, no jank, instant feedback.
- "Change cover" and "Remove" buttons appear on hover over the cover, anchored to the bottom-right.
- When no cover is set: a subtle "Add cover" button appears on hover over the title area (alongside "Add icon").
- The cover area MUST NOT push content down aggressively. When scrolling, the cover should scroll with the content (not sticky).

### Goals

- New database columns: `cover_url TEXT`, `cover_y_offset REAL DEFAULT 0.5` on `pages` table
- Cover image rendered as `div.canvas-page-cover` with `background-image` and `background-position: center {Y}%`
- Upload from disk via Electron file dialog (stored as base64 data URL in DB)
- URL paste option
- Built-in gallery: 12–15 gradient/color presets (CSS gradients, no image files needed)
- Reposition mode: drag vertically to adjust Y offset, saved on mouseup
- "Add cover" / "Change cover" / "Remove" hover controls

### Dependencies

- Migration `003_page_settings.sql` (new columns — shared with Capability 9)
- `canvasEditorProvider.ts` (mount cover element)
- `canvasDataService.ts` (extend `updatePage` to handle cover fields)
- `canvasTypes.ts` (extend `IPage` with cover fields)
- `canvas.css` (cover image styles, hover controls, reposition cursor)
- Electron IPC: `dialog.showOpenDialog()` for file picker (already available)

### Research — How Others Implement This

**Notion:** Cover uses `<img>` with `object-fit: cover; object-position: center {Y}%`. Cover panel offers tabs: Upload, Link, Unsplash, Gallery. Reposition mode changes cursor to `ns-resize` and tracks mouse delta to adjust Y. Covers are stored as URLs (Notion uses S3/CDN). For local apps, base64 data URLs or local file paths are appropriate.

**Implementation trade-offs for local storage:**
- **Base64 in SQLite:** Simple, portable (database is self-contained), but large images bloat the DB. Limit to ~2MB per cover (reject larger files with a warning). A 2MB base64 string is ~2.6MB in the TEXT column — acceptable for SQLite.
- **File path reference:** Store the file path, load from disk. Breaks if file moves. More complex but lighter DB.
- **Recommendation:** Base64 for MVP (simplicity). Can migrate to file references later if DB size becomes an issue.

**Built-in gradient presets (no files needed):**
```css
/* Example presets — pure CSS, no image download */
linear-gradient(135deg, #667eea 0%, #764ba2 100%)   /* Purple haze */
linear-gradient(135deg, #f093fb 0%, #f5576c 100%)   /* Pink sunset */
linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)   /* Ocean blue */
linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)   /* Mint green */
linear-gradient(135deg, #fa709a 0%, #fee140 100%)   /* Warm flame */
linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)   /* Lavender */
linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)   /* Peach */
linear-gradient(135deg, #667eea 0%, #f093fb 100%)   /* Twilight */
linear-gradient(180deg, #2c3e50 0%, #3498db 100%)   /* Dark blue */
linear-gradient(180deg, #141e30 0%, #243b55 100%)   /* Deep space */
linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)   /* Midnight */
linear-gradient(180deg, #232526 0%, #414345 100%)   /* Charcoal */
```

#### Tasks

**Task 8.1 — Database Migration for Cover and Page Settings Fields** ✅
- **Task Description:** Create `003_page_settings.sql` adding cover and page settings columns to the `pages` table.
- **Output:** New columns available for cover URL, cover Y offset, and page display settings.
- **Completion Criteria:**
  - Migration `003_page_settings.sql`:
    ```sql
    ALTER TABLE pages ADD COLUMN cover_url TEXT DEFAULT NULL;
    ALTER TABLE pages ADD COLUMN cover_y_offset REAL NOT NULL DEFAULT 0.5;
    ALTER TABLE pages ADD COLUMN font_family TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE pages ADD COLUMN full_width INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pages ADD COLUMN small_text INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pages ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pages ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0;
    ```
  - Migration is idempotent (safe to run on existing databases)
  - Note: All Capability 7–10 columns added in one migration for efficiency

**Task 8.2 — Extend IPage and Data Service for Cover** ✅
- **Task Description:** Add cover fields to `IPage` interface and `updatePage()` method.
- **Output:** Cover data flows through the full CRUD pipeline.
- **Completion Criteria:**
  - `IPage` gains: `coverUrl: string | null`, `coverYOffset: number`
  - `rowToPage()` maps `cover_url` and `cover_y_offset` from DB rows
  - `updatePage()` accepts `coverUrl` and `coverYOffset` in the updates partial
  - `createPage()` defaults: `coverUrl = null`, `coverYOffset = 0.5`

**Task 8.3 — Render Cover Image in Editor Pane** ✅
- **Task Description:** Display the cover image at the top of the editor pane.
- **Output:** Full-width cover image with CSS background positioning.
- **Completion Criteria:**
  - `div.canvas-page-cover` inserted as the FIRST child of `canvas-editor-wrapper` (above `canvas-page-header`)
  - If `page.coverUrl` is set: `background-image: url(${coverUrl})`, `background-position: center ${Y}%`, `background-size: cover`, height 200px
  - If `page.coverUrl` is a CSS gradient (starts with `linear-gradient` or `radial-gradient`): use `background` instead of `background-image`
  - If `page.coverUrl` is null: cover element hidden (`display: none`)
  - Cover is full-width (100% of editor wrapper, not constrained to 860px max-width)
  - When cover is present: page header padding adjusts (less top padding since cover provides visual space)

**Task 8.4 — Cover Hover Controls (Change / Remove)** ✅
- **Task Description:** Show "Change cover" and "Remove" buttons on hover over the cover.
- **Output:** Hover controls for managing the cover image.
- **Completion Criteria:**
  - `div.canvas-cover-controls` container, absolutely positioned at bottom-right of cover
  - Visible only on hover over `canvas-page-cover` (CSS `:hover` or mouseenter/mouseleave)
  - Two buttons: "Change cover" and "Remove"
  - "Remove" → `updatePage(pageId, { coverUrl: null })` → cover hides
  - "Change cover" → opens cover picker (Task 8.5)
  - Buttons styled: semi-transparent dark background, white text, rounded, small font (12px)

**Task 8.5 — Cover Picker Popup** ✅
- **Task Description:** Create a popup for selecting a cover image (upload, URL, gallery).
- **Output:** Tabbed popup with three cover sources.
- **Completion Criteria:**
  - Popup with three tabs/sections:
    - **Gallery:** Grid of 12 built-in gradient thumbnails (40×30px previews). Click → applies as cover.
    - **Upload:** Button that opens Electron file dialog filtered for images (png, jpg, jpeg, gif, webp). On select → reads file as base64 → `updatePage(pageId, { coverUrl: base64DataUrl })`. Reject files > 2MB with error.
    - **Link:** Text input for pasting an image URL. "Apply" button → `updatePage(pageId, { coverUrl })`.
  - Popup positioned below the "Change cover" button or centered above the cover
  - Click outside or Escape dismisses
  - CSS: matches slash menu visual language (dark bg, rounded, shadow, fade-in)

**Task 8.6 — Cover Reposition (Drag to Adjust Y Offset)** ✅
- **Task Description:** Allow users to drag the cover image vertically to adjust the crop position.
- **Output:** Drag-to-reposition with immediate visual feedback.
- **Completion Criteria:**
  - "Reposition" button added to cover hover controls (or: hold click on cover activates reposition mode)
  - In reposition mode: cursor changes to `ns-resize`, cover image follows mouse Y movement
  - Implementation: `mousedown` captures start Y and start offset → `mousemove` calculates delta as percentage of cover height → updates `background-position` in real-time → `mouseup` saves new `coverYOffset` via `updatePage()`
  - Y offset clamped to 0.0–1.0 range
  - Semi-transparent overlay with "Drag to reposition" hint text during reposition mode
  - Click "Done" button or click outside to exit reposition mode

**Task 8.7 — "Add Cover" Hover Affordance** ✅
- **Task Description:** Show an "Add cover" button when hovering over the title area of a page with no cover.
- **Output:** Discoverable way to add a cover to pages that don't have one.
- **Completion Criteria:**
  - When `page.coverUrl` is null: hovering over `canvas-page-header` reveals a subtle "📷 Add cover" button
  - Button is muted text, appears via CSS transition (opacity 0 → 1)
  - Click → opens cover picker (same as Task 8.5)
  - Similar to the "Add icon" affordance from Task 7.3 — both appear in the same hover zone

---

## Capability 9 — Page Display Settings ✅

### Capability Description

Per-page display settings that control the visual presentation of the content: font family, full-width mode, and text size. Accessed via a "⋯" menu at the top-right of the editor pane. Settings persist in the database per page.

### UX Requirements (Non-Negotiable)

- The "⋯" menu MUST be always visible (not just on hover) when the editor has a page open. Positioned at the top-right of the editor wrapper.
- Font changes MUST apply instantly (no save/reload). The TipTap editor and title should immediately reflect the new font.
- Full-width toggle MUST animate smoothly (max-width transition, ~200ms ease).
- Small text toggle MUST NOT cause jarring content reflow — the font size change should feel natural.

### Goals

- "⋯" menu button at top-right of editor pane
- Dropdown menu with: Font (Default / Serif / Mono), Full width toggle, Small text toggle, Lock page toggle
- Per-page settings stored in `pages` table (`font_family`, `full_width`, `small_text`, `is_locked`)
- Settings applied via CSS classes on the editor wrapper
- Real-time application — no page reload needed

### Dependencies

- Migration `003_page_settings.sql` (columns already defined in Task 8.1)
- `canvasEditorProvider.ts` (menu button, CSS class toggles)
- `canvasDataService.ts` (extended `updatePage` for new fields)
- `canvasTypes.ts` (extended `IPage` with new fields)
- `canvas.css` (font-family variants, full-width mode, small-text mode, locked state)

### Research — How Notion Implements This

**Notion's three fonts:**
- **Default:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif` — the standard system font stack
- **Serif:** `Lyon-Text, Georgia, ui-serif, serif` — Notion bundles Lyon-Text. We'd use `Georgia, "Times New Roman", ui-serif, serif`
- **Mono:** `iawriter-mono, "Nitti", Menlo, Courier, monospace` — Notion bundles iawriter-mono. We'd use `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`

**Full width:** Notion toggles `max-width` from `720px` to `none` (fills the viewport width up to ~1200px with padding). Transition is smooth CSS.

**Small text:** Notion reduces font-size from `16px` to `14px` across body text. Headings scale proportionally.

**Lock page:** Notion sets `contenteditable="false"` on the editor and shows a 🔒 indicator. This can be achieved by calling `editor.setEditable(false)` on the TipTap instance and disabling the title contenteditable.

#### Tasks

**Task 9.1 — Extend IPage and Data Service for Settings** ✅
- **Task Description:** Add page display settings to `IPage` and the data service update flow.
- **Output:** Font family, full width, small text, and lock state tracked per page.
- **Completion Criteria:**
  - `IPage` gains: `fontFamily: 'default' | 'serif' | 'mono'`, `fullWidth: boolean`, `smallText: boolean`, `isLocked: boolean`
  - `rowToPage()` maps `font_family`, `full_width`, `small_text`, `is_locked` columns
  - `updatePage()` accepts these fields in the updates partial
  - Defaults: `fontFamily = 'default'`, `fullWidth = false`, `smallText = false`, `isLocked = false`

**Task 9.2 — Page Menu ("⋯") Button and Dropdown** ✅
- **Task Description:** Add a menu button to the top-right of the editor pane with display settings.
- **Output:** Dropdown menu with font, width, text size, and lock toggles.
- **Completion Criteria:**
  - `button.canvas-page-menu-btn` positioned at top-right of `canvas-editor-wrapper` (fixed/sticky within the wrapper)
  - Content: "⋯" (horizontal ellipsis) or three-dot SVG icon
  - Click → shows dropdown (`div.canvas-page-menu`)
  - Menu items:
    - **Font:** Three-option radio group (Default / Serif / Mono) with visual label showing the font style. Currently active font has a check mark.
    - **Full width:** Toggle switch with label. Shows current state.
    - **Small text:** Toggle switch with label. Shows current state.
    - **Lock page:** Toggle switch with label. Shows 🔒 when locked.
    - Divider line
    - **Duplicate:** Button to deep-copy the page (delegates to Capability 10)
    - **Export as Markdown:** Button (delegates to Capability 10)
    - **Delete:** Button (red text, delegates to existing delete with confirmation)
  - Click outside or Escape dismisses
  - CSS: matches other popup styling (dark bg, rounded, shadow)

**Task 9.3 — Apply Font Family CSS Classes** ✅
- **Task Description:** Apply the selected font family to the editor content.
- **Output:** Content renders in the selected font instantly.
- **Completion Criteria:**
  - CSS classes on `canvas-editor-wrapper`: `.canvas-font-default`, `.canvas-font-serif`, `.canvas-font-mono`
  - `.canvas-font-default` → Inter / system sans-serif (current default)
  - `.canvas-font-serif` → `Georgia, "Times New Roman", ui-serif, serif` — body text only, headings stay sans-serif
  - `.canvas-font-mono` → `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace` — applies to all text
  - Class applied/removed in `CanvasEditorPane` based on `page.fontFamily` when loading and on setting change
  - Title element also inherits the font class

**Task 9.4 — Apply Full Width and Small Text CSS Classes** ✅
- **Task Description:** Toggle full-width and small-text modes via CSS classes.
- **Output:** Content width and text size respond to settings.
- **Completion Criteria:**
  - `.canvas-full-width` on `canvas-editor-wrapper`: sets `max-width: none` on `.canvas-tiptap-editor` (with CSS transition: `max-width 0.2s ease`)
  - `.canvas-small-text` on `canvas-editor-wrapper`: sets `font-size: 14px` on `.canvas-tiptap-editor`, proportionally reduces heading sizes
  - Both classes applied in `CanvasEditorPane.init()` based on loaded page settings
  - Toggling in the menu → `updatePage(pageId, { fullWidth: !current })` → re-apply class → content reflows

**Task 9.5 — Lock Page (Read-Only Mode)** ✅
- **Task Description:** Implement page lock toggle that prevents editing.
- **Output:** Locked pages are visually distinct and non-editable.
- **Completion Criteria:**
  - When `page.isLocked` is true:
    - `editor.setEditable(false)` on TipTap instance
    - Title `contenteditable` set to `false`
    - Lock icon (🔒) shown in editor header or tab
    - Bubble menu and slash menu disabled
    - Visual indicator: subtle banner or lock icon at top of page
  - Toggling lock in menu → `updatePage(pageId, { isLocked: !current })` → immediately apply/remove editability
  - Locked state persisted and restored when page reopens

---

## Capability 10 — Page Organization & Utilities ✅

### Capability Description

Additional page management features that round out the Notion-like experience: favorites/pinning, trash view with restore, page duplication, breadcrumb navigation, and Markdown export.

### UX Requirements (Non-Negotiable)

- Favorites section at the top of the sidebar MUST be visually distinct (separator line, "Favorites" label in muted text).
- Trash view MUST be accessible without destroying the current page tree — either as a collapsible sidebar section at the bottom, or as a separate tab/view.
- Duplicate MUST deep-copy content and all child pages recursively. The new page should appear in the sidebar immediately with title "Copy of {original}".
- Breadcrumbs MUST be clickable. Clicking a parent page navigates to it.

### Goals

- Favorites section in sidebar showing pinned pages
- Trash/archive view for soft-deleted pages with restore and permanent delete
- Page duplication (deep copy with children)
- Breadcrumb trail in editor header showing parent chain
- Markdown export of page content

### Dependencies

- `canvasSidebar.ts` (favorites section, trash section)
- `canvasDataService.ts` (favorite toggle, archive/restore, duplicate, breadcrumb data)
- `canvasEditorProvider.ts` (breadcrumb display)
- `canvasTypes.ts` (extended `IPage` with `isFavorited`)
- Migration `003_page_settings.sql` (is_favorited column — already defined in Task 8.1)

### Research — Existing Approaches

**Favorites:** Simple — query `SELECT * FROM pages WHERE is_favorited = 1 AND is_archived = 0 ORDER BY title`. Render as a flat list above the tree. Toggle via right-click context menu or star icon on hover.

**Trash:** Notion's trash is modal-based (search + list). For our sidebar approach: a collapsible "Trash" section at the bottom. Shows archived pages. Click "Restore" unsets `is_archived`, click "Delete permanently" runs actual `DELETE`.

**Duplicate:** Recursive CTE or application-level recursion. For each page: `createPage()` with same parent (or new parent for root-level copy), copy content/icon/cover, then recursively duplicate children with new `parentId`.

**Breadcrumbs:** Walk up the `parentId` chain from the current page to root. Render as: `Root > Parent > Current`. Use existing `breadcrumbsBar.ts` if compatible, or render simple inline spans with click handlers.

**Markdown export:** Walk TipTap JSON AST → emit Markdown string:
- `heading` → `# `, `## `, `### `
- `paragraph` → text + `\n\n`
- `bulletList` / `listItem` → `- item`
- `orderedList` → `1. item`
- `blockquote` → `> text`
- `codeBlock` → `` ```lang\ncode\n``` ``
- `taskList` → `- [ ] item` / `- [x] item`
- `horizontalRule` → `---`
- `callout` → `> {emoji} text`
- Bold → `**text**`, Italic → `*text*`, Code → `` `text` ``, Link → `[text](url)`
- Table → pipe-delimited markdown table
- Image → `![alt](src)`

Alternatively, install `turndown` (HTML → Markdown converter, 7k stars) and use `@tiptap/html` to get HTML first. But for our controlled set of block types, a custom converter is cleaner and has zero dependencies.

#### Tasks

**Task 10.1 — Extend Data Service for Favorites** ✅
- **Task Description:** Add favorite/unfavorite methods and a query for favorited pages.
- **Output:** Favorite pages queryable from data service.
- **Completion Criteria:**
  - `toggleFavorite(pageId: string): Promise<IPage>` — flips `is_favorited`, fires `onDidChangePage(Updated)`
  - `getFavoritedPages(): Promise<IPage[]>` — `SELECT * FROM pages WHERE is_favorited = 1 AND is_archived = 0 ORDER BY title`
  - Extend `rowToPage()` to include `isFavorited` field

**Task 10.2 — Sidebar Favorites Section** ✅
- **Task Description:** Add a "Favorites" section at the top of the sidebar tree showing pinned pages.
- **Output:** Favorited pages appear in a dedicated section above the page tree.
- **Completion Criteria:**
  - "FAVORITES" label (muted text, small caps, 11px) appears above the tree if any pages are favorited
  - Flat list (no nesting) of favorited pages, each clickable to open
  - Star icon (★/☆) on hover over any page in the tree or favorites section — click toggles favorite
  - Visual: separator line between Favorites section and "PAGES" section
  - Favorites section collapses if empty
  - Right-click context menu on any page includes "Add to Favorites" / "Remove from Favorites"

**Task 10.3 — Page Trash View with Restore** ✅
- **Task Description:** Add a "Trash" section at the bottom of the sidebar showing archived pages.
- **Output:** Users can see, restore, or permanently delete archived pages.
- **Completion Criteria:**
  - "TRASH" label + chevron at the bottom of sidebar, collapsible
  - Lists all pages where `is_archived = 1`, ordered by `updated_at DESC` (most recently deleted first)
  - Each trash item shows title + delete date
  - "Restore" button/action → sets `is_archived = 0` → page reappears in tree
  - "Delete permanently" button/action → `DELETE FROM pages` (true delete, not soft) with confirmation
  - "Empty trash" button in section header → permanently deletes ALL archived pages with confirmation
  - Extend `canvasDataService`: `archivePage(pageId)` (sets `is_archived = 1`), `restorePage(pageId)` (sets `is_archived = 0`), `permanentlyDeletePage(pageId)`, `getArchivedPages(): Promise<IPage[]>`
  - Update existing `deletePage()` to archive instead of delete: `this.archivePage(pageId)` (soft delete)

**Task 10.4 — Page Duplication (Deep Copy)** ✅
- **Task Description:** Implement deep-copy of a page and all its descendants.
- **Output:** Duplicated page tree appears in sidebar with "Copy of" prefix.
- **Completion Criteria:**
  - `duplicatePage(pageId: string): Promise<IPage>` on `canvasDataService`
  - Copies: title ("Copy of {title}"), icon, content, cover_url, cover_y_offset, font_family, full_width, small_text
  - Does NOT copy: is_favorited, is_locked, sort_order (gets new sort_order at end of siblings)
  - Recursively duplicates children, maintaining parent-child relationships with new IDs
  - The new root copy is placed as a sibling of the original (same parent)
  - Fires `onDidChangePage(Created)` for each new page
  - UI: accessible via page menu (Capability 9) and right-click context menu

**Task 10.5 — Breadcrumb Navigation** ✅
- **Task Description:** Show a breadcrumb trail above the title in the editor header.
- **Output:** Clickable path showing the current page's ancestor chain.
- **Deviation:** Breadcrumbs were moved from `canvas-page-header` into a new **top ribbon bar** (`canvas-top-ribbon`) that sits between the tab bar and the cover image. The ribbon displays breadcrumbs on the left and "Edited X ago", favorite star, and ⋯ menu on the right — matching Notion's layout. The VS Code-style `BreadcrumbsBar` component (file-path breadcrumbs from `breadcrumbsBar.ts`) was removed from `EditorGroupView` since canvas pages use their own page-hierarchy breadcrumbs in the ribbon instead.
- **Completion Criteria:**
  - `div.canvas-breadcrumbs` rendered above the icon/title in `canvas-page-header`
  - Shows: ancestor chain from root to current page's parent (not including current page)
  - Each breadcrumb is a clickable link that opens that ancestor page in the editor
  - Separator: `/` or `›` between crumbs
  - Root-level pages show no breadcrumbs (or just "Pages" as a label)
  - Data: walk up `parentId` chain via `_dataService.getPage(parentId)` recursively, or add `getAncestors(pageId): Promise<IPage[]>` to data service
  - CSS: muted text (12px, `rgba(255,255,255,0.4)`), hover highlights individual crumbs
  - Updates when page is reparented (via `onDidChangePage(Moved)`)

**Task 10.6 — Markdown Export** ✅
- **Task Description:** Export a page's content as a Markdown file.
- **Output:** Downloads/saves a `.md` file of the page content.
- **Completion Criteria:**
  - Custom TipTap JSON → Markdown converter function (`tiptapJsonToMarkdown(doc: object): string`)
  - Handles all current block types: paragraph, heading (1-3), bulletList, orderedList, taskList, blockquote, codeBlock (with language), horizontalRule, callout, details, table, image
  - Handles all inline marks: bold, italic, strike, underline, code, link, highlight, color
  - Output starts with `# {page title}` as the first line
  - Triggered from page menu (Capability 9, Task 9.2) → "Export as Markdown"
  - Uses Electron file dialog (`dialog.showSaveDialog`) to choose save location
  - Filename default: `{page-title}.md` (sanitized for filesystem)
  - IPC channel: `tools:save-file` or reuse existing file-write capability

**Task 10.7 — Right-Click Context Menu for Pages** ✅
- **Task Description:** Add a right-click context menu to page tree nodes in the sidebar.
- **Output:** Context menu with common page actions.
- **Completion Criteria:**
  - Right-click on any page in sidebar tree → shows context menu
  - Menu items:
    - **Open** — opens page in editor
    - **New subpage** — creates child page under this page
    - **Rename** — starts inline rename
    - Divider
    - **Add to Favorites** / **Remove from Favorites** — toggles favorite state
    - **Duplicate** — deep copies the page
    - **Export as Markdown** — exports this page
    - Divider
    - **Delete** — moves to trash (with confirmation)
  - Menu positioned at cursor, clipped to viewport
  - Click outside or Escape dismisses
  - CSS: matches page menu and slash menu styling

---

## Execution Order (Capabilities 7–10)

```
Capability 7 (Title & Icon)              ← Highest impact, do first
    │
    ├── Task 7.1: Title element
    ├── Task 7.2: Title ↔ sidebar sync
    ├── Task 7.3: Icon in editor header
    └── Task 7.4: Emoji picker
         │
Capability 8 (Cover Image)              ← Second highest visual impact
    │
    ├── Task 8.1: DB migration (003)     ← Shared migration for all new columns
    ├── Task 8.2: IPage + data service extensions
    ├── Task 8.3: Cover rendering
    ├── Task 8.4: Hover controls
    ├── Task 8.5: Cover picker popup
    ├── Task 8.6: Reposition drag
    └── Task 8.7: "Add cover" affordance
         │
Capability 9 (Page Settings)            ← Depends on migration from Cap 8
    │
    ├── Task 9.1: IPage + data service for settings
    ├── Task 9.2: Page menu dropdown
    ├── Task 9.3: Font family CSS classes
    ├── Task 9.4: Full width + small text CSS
    └── Task 9.5: Lock page
         │
Capability 10 (Organization & Utilities) ← Independent tasks, parallelize
    │
    ├── Task 10.1: Favorites data service
    ├── Task 10.2: Sidebar favorites section
    ├── Task 10.3: Trash view
    ├── Task 10.4: Page duplication
    ├── Task 10.5: Breadcrumbs
    ├── Task 10.6: Markdown export
    └── Task 10.7: Context menu
```

### Estimated Scope (Capabilities 7–10)

- **Capability 7:** 4 tasks — title, sync, icon, emoji picker
- **Capability 8:** 7 tasks — migration, data, cover render, controls, picker, reposition, affordance
- **Capability 9:** 5 tasks — data, menu, fonts, width/text, lock
- **Capability 10:** 7 tasks — favorites, trash, duplicate, breadcrumbs, export, context menu

**Total: 4 capabilities, 23 tasks**

**Running total for Milestone 6: 11 capabilities (0–10), 55 tasks**

### Files Changed / Created (Capabilities 7–10)

**New Files:**
| File | Purpose |
|------|---------|
| `src/built-in/canvas/migrations/003_page_settings.sql` | New columns: cover, font, width, text size, lock, favorite |
| `src/built-in/canvas/emojiPicker.ts` | Emoji picker popup component (or npm package integration) |
| `src/built-in/canvas/coverPicker.ts` | Cover image picker popup (gallery + upload + URL) |
| `src/built-in/canvas/pageMenu.ts` | Page settings "⋯" dropdown menu |
| `src/built-in/canvas/markdownExport.ts` | TipTap JSON → Markdown converter |

**Modified Files:**
| File | Changes |
|------|---------|
| `src/built-in/canvas/canvasTypes.ts` | Extend `IPage` with cover, font, width, text size, lock, favorite fields |
| `src/built-in/canvas/canvasDataService.ts` | Extend `rowToPage()`, `updatePage()`, add `toggleFavorite()`, `archivePage()`, `restorePage()`, `permanentlyDeletePage()`, `getFavoritedPages()`, `getArchivedPages()`, `duplicatePage()`, `getAncestors()` |
| `src/built-in/canvas/canvasEditorProvider.ts` | Add title element, icon element, cover element, page menu button, breadcrumbs, apply settings CSS classes, lock mode |
| `src/built-in/canvas/canvasSidebar.ts` | Add favorites section, trash section, context menu, favorite star icon |
| `src/built-in/canvas/canvas.css` | Title zone, cover image, cover controls, emoji picker, page menu, breadcrumbs, font variants, full-width mode, small-text mode, favorites section, trash section, context menu (~300–400 new lines) |
| `electron/main.cjs` | File save dialog IPC for Markdown export (if not already available) |

### Quality Gates (UX Acceptance Criteria)

Every task must pass these before being considered complete:

1. **Visual consistency:** Does the new UI element match the existing Notion-like styling language (dark bg, rgba borders, Inter font, rounded corners, subtle animations)?
2. **Interaction smoothness:** Are there any jank, flickers, or layout jumps? Transitions should be ≤200ms.
3. **Keyboard accessibility:** Can the feature be fully operated via keyboard? (Tab focus, Enter to confirm, Escape to dismiss)
4. **Edge cases:** What happens with very long titles? Very large cover images? Empty pages? Pages with 10+ levels of nesting?
5. **State persistence:** Does the feature survive: page close/reopen, app restart, workspace switch?
6. **No regressions:** Does the change break any existing editor functionality (bubble menu, slash commands, drag handle, auto-save)?

---

## Fix 16: Column Layout (Notion-style Multi-Column Blocks)

### Research Summary

**Notion's column model:**
- Columns are created by dragging blocks side-by-side (no slash command in Notion)
- Data model: `column_list` wrapper → 2+ `column` children → any block content
- Width ratios stored per-column (0–1, summing to 1)
- Resize via dragging the boundary between columns; double-click to equalize
- Columns cannot be nested inside other columns
- On mobile, columns stack vertically (linearized)
- Any block type can live inside a column (except other columns)

**Reference implementation:** GYHHAHA/prosemirror-columns (`tiptap-extension-multi-column` v0.0.2)
- Inspired by `prosemirror-tables` — uses ProseMirror Plugin for resize
- Uses pixel widths (we improve to percentage-based for responsiveness)
- Column schema: `column { content: 'block+', attrs: { colWidth } }` + `column_container { content: 'column+' }`
- Plugin: mouse event handlers detect column boundaries, show decoration, handle drag resize
- Used in production by Docmost (19k-star open-source wiki)

### Architecture

**Two TipTap Node extensions (defined inline, same pattern as Callout/MathBlock):**
- `ColumnList` — `group: 'block'`, `content: 'column column+'` (min 2), `isolating: true`
- `Column` — `content: 'block+'`, `isolating: true`, attr: `width` (percentage number, default null = equal)

**ProseMirror Plugin for resize:**
- Detects mouse proximity to column boundaries in the DOM
- Shows visual resize indicator (cursor change + blue line via CSS)
- Handles drag resize: mousedown → track → mouseup → commit widths via `tr.setNodeMarkup()`
- Only commits on mouseup (single transaction) — no noisy undo history
- Double-click on boundary → equalize all columns in that columnList

**Slash menu items (3 entries):**
- "2 Columns" — creates columnList with 2 equal columns
- "3 Columns" — creates columnList with 3 equal columns
- "4 Columns" — creates columnList with 4 equal columns

**CSS layout:**
- `display: flex` on columnList, `gap: 16px`
- Column widths via `flex: 0 0 X%` or `flex: 1` (equal)
- Subtle hover background on columns (matching existing callout style)
- Resize handle: `::after` pseudo-element on non-last columns, `col-resize` cursor
- Active resize indicator: thin blue vertical line

**Markdown export:**
- Linearize columns into sequential content (markdown has no column concept)
- Each column's content rendered with a `<!-- column -->` comment separator

**Keyboard behavior:**
- Cmd/Ctrl+A inside a column selects column content (not entire doc)
- Enter creates new paragraph within same column (standard)
- GlobalDragHandle works for blocks inside columns (selectors already match)

### Files Changed

| File | Changes |
|------|---------|
| `src/built-in/canvas/canvasEditorProvider.ts` | Add `Column` + `ColumnList` nodes, resize plugin, slash menu items, register extensions |
| `src/built-in/canvas/canvas.css` | Column layout styles, resize handle, hover states |
| `src/built-in/canvas/canvasIcons.ts` | Add 'columns' icon for slash menu |
| `src/built-in/canvas/markdownExport.ts` | Handle `columnList` and `column` node types |
| `docs/Parallx_Milestone_6.md` | This documentation |