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