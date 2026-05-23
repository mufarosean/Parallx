---
Status: Draft
Author: Research Agent (subagent invocation; conductor compiled)
Branch: systems-redesign-planning
Commit: eb27a92
Created: 2026-05-23
Manifest: docs/PARALLX_MANIFEST.md
Agent card: docs/research/agents/research-agent.md
---

# Parallx Workbench — Current-Code Research Brief

## Executive Summary

This brief documents the current state of Parallx's workbench architecture on branch `systems-redesign-planning` at commit `eb27a92`. The primary user workflow (workspace → Explorer → editor → AI chat → Canvas → artifacts → persist & reopen) crosses multiple independent subsystems with clear entry points but ambiguous ownership boundaries for shared state and cross-tool interactions.

Key findings:
- 5-phase workbench initialization model (Services → Layout → Parts → WorkspaceRestore → Ready).
- 15 built-in tools activated via an extension-like manifest model.
- ~15 API bridges translate extension calls to workbench primitives.
- Cross-tool workflows use one-off selection action dispatchers and explicit feature-to-feature bridges.
- Persistence is fragmented: SQLite (workspace-scoped), JSON files, FileBackedGlobalStorage, FileBackedWorkspaceStorage.
- IPC contracts are typed and comprehensive; main process exposes ~50 handlers.
- Test coverage exists for individual features but lacks integrated cross-tool workflow tests.

---

## A. Repo Layout Verification

### Top-level `src/` directories

| Directory | Purpose |
|---|---|
| `agent/` | Agent execution model and task lifecycle |
| `aiSettings/` | Unified AI configuration and profile management |
| `api/` | Extension API factory and bridges to workbench services |
| `assets/` | Static icons, themes, data files |
| `built-in/` | Built-in tools (Explorer, Canvas, Chat, Search, Welcome, etc.) |
| `commands/` | Command registry, quick access, editor commands, CLI integration |
| `configuration/` | Configuration service, registry, schema management |
| `context/` | Context keys, focus tracking, workbench context |
| `contributions/` | Contribution processors (commands, keybindings, views, menus) |
| `dnd/` | Drag and drop controller and data model |
| `editor/` | Editor service, groups, panes, input/output model |
| `layout/` | Grid layout model, layout renderer, part references |
| `links/` | Link resolver service, per-extension link contracts |
| `main.ts` | Renderer entry: document bootstrap, Workbench instantiation |
| `openclaw/` | OpenClaw runtime, participants, tool binding, agent model |
| `parts/` | Workbench parts: editor part, status bar, titlebar, sidebar, panel, auxiliary bar |
| `platform/` | Base classes: Disposable, Emitter/Event, URI, storage, lifecycle |
| `services/` | DI services: workspace, editor, file, database, chat, indexing, persistence, etc. |
| `theme/` | Theme service, color registry, theme editor |
| `tools/` | Tool registry, activation events, tool scanner, enablement, error isolation |
| `typings/` | Global type definitions |
| `ui/` | DOM utilities, tooltips, context menus, icons, tab bars |
| `views/` | View manager, view containers, placeholder views |
| `workbench/` | Workbench shell (orchestrator), lifecycle phases, services registration, contribution handler |
| `workspace/` | Workspace model, loader, saver, folder model, state serialization |

### `electron/` files

| File | Purpose |
|---|---|
| `main.cjs` | Electron main process: window lifecycle, IPC handlers, workspace teardown |
| `preload.cjs` | Preload script: contextBridge exposes APIs to renderer |
| `index.html` | Window HTML template |
| `database.cjs` | SQLite connection and migration orchestration |
| `documentExtractor.cjs` | PDF/EPUB text extraction bridge to docling |
| `doclingBridge.cjs` | Docling service management |
| `mcpBridge.cjs` | MCP server spawning and process communication |
| `storageHandlers.cjs` | JSON file-backed storage IPC handlers |
| `webFetchBridge.cjs` | Network fetch and web search IPC handlers |

### `ext/` directories

| Directory | Extension type |
|---|---|
| `budget/` | Finance/expense tracking |
| `media-organizer/` | Media library indexing and organization |
| `text-generator/` | Content generation |
| `web-research/` | Web search and scraping |
| `workspace-graph/` | Knowledge graph visualization |

**Verification result:** the system map in `docs/PARALLX_MANIFEST.md` §6 is accurate. Explorer / Canvas / Chat live in `src/built-in/`, not `ext/`. External extensions in `ext/` are the user-installable layer.

---

## B. Entry Points for the Primary Workflow

### 1. App startup

- Renderer: `src/main.ts:L106-L120` constructs `new Workbench(container)`; `src/workbench/workbench.ts:L210` constructor; `src/workbench/workbench.ts:L400+` `initialize()` with 5 lifecycle phases.
- Main process: `electron/main.cjs:L200-L350` (`app.on('ready')` → `createWindow()` → `BrowserWindow.loadURL()`); all `ipcMain.handle()` registrations follow.

### 2. Workspace open and restore (Phase 4: `WorkspaceRestore`)

1. Load recent workspaces — `src/workspace/recentWorkspaces.ts:L20`.
2. Open workspace dialog or restore last workspace.
3. Create `Workspace` instance — `src/workspace/workspace.ts:L38`.
4. Load workspace state from `.parallx/workspace-state.json` — `src/workspace/workspaceLoader.ts:L23`.
5. Deserialize editor snapshots, parts, layout, views — `src/workspace/workspaceTypes.ts:L74`.
6. Restore layout, parts, open editors — `src/workbench/workbench.ts:L640-L750`.

Persistence files:
- `.parallx/workspace-identity.json` — workspace metadata.
- `.parallx/workspace-state.json` — layout, parts, open editors, context keys.
- `.parallx/data.db` — SQLite (canvas pages, indexes, configuration).

### 3. Explorer rendering and file selection

- Activate: `src/built-in/explorer/main.ts:L417`.
- View providers for `view.explorer` and `view.openEditors`: `src/built-in/explorer/main.ts:L425+`.
- Tree view from workspace folders: `src/built-in/explorer/main.ts:L500+`.
- File change subscription: `src/built-in/explorer/main.ts:L480+`.
- Selection dispatch: `src/services/selectionActionDispatcher.ts:L16`.

### 4. Editor open dispatch

- Service: `src/services/editorService.ts:L17` (`IEditorService`).
- `openEditor()` → EditorPart → editor group → editor pane.
- Editor deserializer per file type: `src/editor/editorInputDeserializer.ts:L1+`.
- PDF/EPUB: `src/built-in/editor/pdfEditorPane.ts:L162+`.
- Canvas: `src/built-in/canvas/canvasEditorProvider.ts:L102`.

### 5. AI chat entry

- Activate: `src/built-in/chat/main.ts:L1` (~2000 LOC).
- OpenClaw participants: `src/openclaw/registerOpenclawParticipants.ts`, `src/openclaw/participants/openclawWorkspaceParticipant.ts:L29`.
- Built-in chat tools: `src/built-in/chat/tools/builtInTools.ts`.
- Chat reads active editor/canvas via EditorService: `src/built-in/chat/input/chatContextAttachments.ts:L25+`.
- Turn executor: `src/openclaw/openclawAttempt.ts:L18+`.

### 6. Canvas page open/save

- Activate: `src/built-in/canvas/main.ts:L1`.
- Editor provider: `src/built-in/canvas/canvasEditorProvider.ts:L102`.
- Data service: `src/built-in/canvas/canvasDataService.ts:L82` (load), `L200+` (mutations).
- Block registry: `src/built-in/canvas/config/blockRegistry.ts`.
- Sidebar: `src/built-in/canvas/canvasSidebar.ts:L49`.

### 7. Extension activation

- Tool scanner: `src/tools/toolScanner.ts`.
- Manifest model: `src/tools/toolManifest.ts`.
- Activation events (Phase 5): `src/tools/activationEventService.ts`.
- Activator: `src/tools/toolActivator.ts:L100+` (calls `module.activate(parallxApi, context)`).
- API factory: `src/api/apiFactory.ts:L7+`.
- Views bridge example: `src/api/bridges/viewsBridge.ts:L40`.

---

## C. Primitives Inventory

### Commands
- Registry: `src/commands/commandRegistry.ts:L33`.
- Built-ins: `src/commands/structuralCommands.ts`.
- Events: `onDidRegisterCommand`, `onDidUnregisterCommand`.

### Contributions
- Processors: `src/contributions/commandContribution.ts:L40`, `keybindingContribution.ts:L156`, `viewContribution.ts:L92`, `menuContribution.ts:L46`.
- Handler: `src/workbench/workbenchContributionHandler.ts:L46`.
- Manifest shape: `contributes: { commands, keybindings, views, menus }`.

### Context keys
- Service: `src/context/contextKey.ts`.
- Manager: `src/context/workbenchContext.ts:L64`.
- Key contexts: `CTX_SIDEBAR_VISIBLE`, `CTX_PANEL_VISIBLE`, `CTX_AUXILIARY_BAR_VISIBLE`, `CTX_STATUS_BAR_VISIBLE`, `openEditorsCount` (set by Explorer at `src/built-in/explorer/main.ts:L133`).

### Selection
- Dispatcher: `src/services/selectionActionDispatcher.ts:L16`.
- Handlers: `src/services/selectionActionHandlers.ts:L35+` (`AddSelectionToChatHandler`, `SendSelectionToCanvasHandler`).
- Command binding: `src/commands/editorCommands.ts:L205` (`editor.addSelectionToChat`).

### Resource and link resolver
- Service: `src/links/linkResolverService.ts`.
- Per-feature contracts: Explorer `src/built-in/explorer/main.ts:L220+`, Canvas `src/built-in/canvas/main.ts:L150+`.
- URI scheme example: `parallx://explorer/file?path=...`.

### Tool registry
- Registry: `src/tools/toolRegistry.ts`.
- Enablement: `src/tools/toolEnablementService.ts`.
- Event: `onDidRegisterTool`.

### Extension manifest schema
- Conceptual model documented in `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md`.
- Built-in tools return their manifest from `activate()` (e.g. `src/built-in/explorer/main.ts:L300+`).

### Capability checks
- Pattern: **not** centralized. Each capability is guarded by service availability:
  - Filesystem — `IFileService` (`src/services/fileService.ts:L173+`).
  - Shell — `parallxElectron.shell` (`src/main.ts:L70+`).
  - Database — `IDatabaseService` (`src/services/databaseService.ts`).
  - Secrets — `parallxElectron.secret` (`src/main.ts:L85+`).
  - Autonomy — `AutonomyFeatureFlagsService` (`src/services/autonomyFeatureFlags.ts`).
  - Permissions — `PermissionService` for tool execution approvals (`src/services/permissionService.ts`).

### Event bus
- Base: `Emitter<T>` / `Event<T>` (`src/platform/events.ts`).
- Sample events: `workbench.onDidInitialize`, `workbench.onDidSwitchWorkspace`, `workspace.onDidChangeFolders`, `editor.onDidActiveEditorChange`, `canvas.onDidChangeCanvasPages`, `configuration.onDidChangeConfiguration`.

### IPC handlers (electron/main.cjs)
Approximate count: ~50 across categories:

| Category | Handlers (sample) | File |
|---|---|---|
| Window | `window:isMaximized/minimize/maximize/close` | main.cjs:L588+ |
| Tools | `tools:scan-directory`, `tools:install-from-file`, `tools:uninstall`, `tools:read-module` | main.cjs:L639+ |
| Filesystem | `fs:readFile/writeFile/stat/readdir/rename/delete/mkdir/copy/watch/unwatch` | main.cjs:L1254+ |
| Shell | `shell:startDrag/showItemInFolder/openPath/openExternal` | main.cjs:L1005+ |
| Secrets | `secret:set/get/delete` | main.cjs:L1548+ |
| Dialog | `dialog:openFile/openFolder/saveFile/showMessageBox` | main.cjs:L1641+ |
| Database | `database:open/query/exec/close` | main.cjs:L1809+ |
| Document | `document:extractText/readEpub/isRichDocument`, `docling:*` | main.cjs:L1703+ |
| MCP | `mcp:spawn/send/kill/oauth-bootstrap` | mcpBridge.cjs:L58+ |
| Web | `webFetch:request`, `webSearch:request`, `webFetch:resetTurn` | webFetchBridge.cjs:L550+ |
| Storage | `storage:read-json/write-json/exists` | storageHandlers.cjs:L61+ |

Preload bundles these into `window.parallxElectron` — `electron/preload.cjs`.

### Persistence owners

**SQLite** (`.parallx/data.db`): `DatabaseService` (`src/services/databaseService.ts`). Tables for canvas pages, blocks, indexes, vector embeddings, chat sessions, autonomy events, cron jobs. Per-workspace.

**JSON files:**
- `workspace-identity.json`, `workspace-state.json`, `window-state.json`, `.parallx/settings.json`, `.parallx/cron-jobs.json`, `.parallx/autonomy-events.ndjson`, `.parallx/pattern-memory.ndjson`, extension-specific `ext/<toolId>/state.json`.

**IStorage:** `FileBackedGlobalStorage` (`src/platform/fileBackedStorage.ts:L30`), `FileBackedWorkspaceStorage` (L146). Part state via `part.saveState()` / `part.restoreState()` (`src/parts/partTypes.ts:L99+`).

---

## D. Cross-Tool Bridges and Duplicate Ownership

### One-off bridges

1. **Selection → Chat/Canvas** — `src/services/selectionActionDispatcher.ts:L16` + `selectionActionHandlers.ts:L35+`. Direct handler binding to specific features; every new destination requires a new handler.
2. **Canvas pages ↔ Chat context** — `src/built-in/chat/data/chatDataService.ts` uses hard-coded URI pattern `parallx.canvas:canvas:<uuid>` via `extractCanvasPageId()` (`tests/unit/chatContextIntegration.test.ts:L181+`).
3. **Chat ↔ Explorer (attachments)** — `src/built-in/chat/input/chatContextAttachments.ts:L25+` iterates `api.editors.openEditors` directly.
4. **Canvas sidebar ↔ Editor part** — `src/built-in/canvas/canvasSidebar.ts:L49` opens pages via `api.editors.openEditor()` without observing editor lifecycle.
5. **Workspace service ↔ Recent workspaces** — `src/workspace/recentWorkspaces.ts:L20` vs `src/workspace/workspace.ts:L160+` (`Workspace.touch()`). Both can modify workspace metadata.

### Duplicate or ambiguous state ownership

1. **Canvas page title/metadata** — CanvasDataService (DB) and Canvas sidebar (UI cache) both hold; sidebar does not observe DB.
2. **Open editors list** — EditorService + EditorPart + editor groups; `_wireGroupListeners()` required for within-group changes (`src/services/editorService.ts:L50+`).
3. **Workspace folder set** — `Workspace.folders` vs `FileService.setWorkspaceRoot()`; two separate notifications.
4. **Tool enablement** — `ToolEnablementService` vs contribution visibility in menus; disabling doesn't remove contributions.
5. **Chat history** — `ChatDataService` (DB) vs chat widget in-memory session; no explicit save trigger visible.

### Hidden coupling

1. **Canvas blocks ↔ Theme service** — block rendering reads theme colors at construction time; no `onDidChangeTheme` listener observed.
2. **Chat participant ↔ OpenClaw internals** — `src/built-in/chat/main.ts:L30+` directly imports OpenClaw runtime; switching models requires editing Chat activation.
3. **Autonomy ↔ Chat activation** — heartbeat, cron, subagents activated only inside `src/built-in/chat/main.ts:L100+`. No standalone autonomy lifecycle.

---

## E. Test Coverage Map

### Cross-tool workflow edges

| Edge | Test | Status |
|---|---|---|
| Explorer → Editor | (none found) | NO |
| Editor → Chat (attach) | `tests/unit/chatContextIntegration.test.ts:L524+` | PARTIAL |
| Chat → Canvas (artifact) | `tests/unit/chatContextIntegration.test.ts:L4+` | PARTIAL |
| Canvas → Editor (open) | `tests/unit/canvasMovePagePreservesContent.test.ts:L7+` | NO (page move only) |
| Selection → Chat | `tests/unit/selectionActionHandlers.test.ts` | UNCLEAR |
| Selection → Canvas | (none found) | NO |
| Workspace open → Explorer refresh | (none found) | NO |
| Settings change → Editor re-render | `tests/unit/aiSettingsPersistence.test.ts:L85+` | NO (persistence only) |

### Feature test density (approximate)

| Category | Files |
|---|---|
| Agent / Autonomy | 30+ |
| Canvas | 10+ |
| Chat | 10+ |
| AI Settings | 5+ |
| Advanced features | 1 |
| **Total observed** | **70+** |

### Critical gaps

1. Workspace restore → tool activation end-to-end.
2. File save → chat reference invalidation.
3. Concurrent edit (canvas sidebar + chat artifact) on the same page.
4. IPC bridge end-to-end coverage.
5. Persistence migration across workspace schema versions.
6. Cross-extension command invocation.

---

## F. Uncertainty Markers

Assumptions not verified by direct code anchor:

1. **Canvas concurrent edits** — assumed to rely on SQLite ACID; no transaction or optimistic-lock code observed in `canvasDataService.ts:L200+`.
2. **Tool deactivation cleanup** — `ToolActivator.deactivate()` exists at `src/tools/toolActivator.ts:L150+`, errors caught but cleanup completeness not validated.
3. **File-watcher partial-write recovery** — `src/built-in/explorer/main.ts:L480+` debounces by 1500ms; no retry path observed.
4. **Theme change propagation to canvas blocks** — `onDidChangeTheme` not observed in block rendering.
5. **Editor-pane → editor-service event fan-out** — `_wireGroupListeners()` exists but exact invariants for stale group references not verified.
6. **AI chat session lifecycle** — explicit save trigger not located in chat widget code.

---

## G. Open Design Questions for Atlas / Interaction Model

Forwarded to System Atlas Cartographer and Unified Workbench Interaction Agent:

1. What is the canonical `Resource` identity across files, canvas pages, chat sessions, and tool artifacts? Currently a mix of file paths, canvas URIs (`parallx.canvas:canvas:<uuid>`), and editor IDs.
2. Should `Selection` be a workbench-level primitive observable by any surface, instead of a dispatcher with hard-coded handlers per destination?
3. Where should the `Surface` concept live? Today it is implied by editor panes, views, and parts but not modeled.
4. Can `Capability` be centralized into a single registry with per-tool grants instead of per-service availability checks?
5. Should tool deactivation be guaranteed to remove contributions, or is contribution lifecycle separate from tool lifecycle?
6. What is the migration path for `parallx.canvas:canvas:<uuid>` URIs if Resource IDs unify?
7. Should autonomy/heartbeat/cron be lifted out of Chat into a top-level workbench task service?
8. Is the SelectionActionDispatcher pattern keepable, or should it be replaced by a typed event the workbench publishes and any surface subscribes to?
9. Should `Workspace` be the canonical owner of folder set and propagate to `FileService`, removing the dual-notification pattern?
10. What persistence-version migration test pattern should be standard for every owner of durable state?

---

## H. Conductor Notes (handoff)

- This brief is the input artifact for the **System Atlas Cartographer**. Atlas must verify every anchor in §B–§D against current code, refine ambiguous line numbers (e.g. `L100+`), and produce the canonical ownership table.
- It is also the input for the **Research Agent (external)** to define which VS Code / Eclipse / JetBrains patterns to study for §G.
- It is the input for the **Baseline and Metrics Agent** to pick the first measurable targets (cold start, workspace restore, editor open, chat first-response, canvas save round-trip).
- No app code has been changed. No conclusions about "better" have been drawn here — descriptive only.
