# Settings Audit (M61 Phase 1)

**Date:** 2026-04-30
**Status:** Read-only audit. No code changes yet.
**Inputs:** AI Settings sidebar sections, settings registry schemas,
storage init sites, MCP/cron persistence wiring.

This document maps every user-facing setting to its current scope, current
UI surface, and target end-state under M61. Phases 2–7 plan against this
table.

---

## 1. Settings inventory

Legend:
- **Scope today:** where the value actually persists right now
- **Scope target:** where M61 wants it
- **UI today:** which UI(s) currently expose it
- **UI target:** the registry overlay (`Ctrl+Alt+S` → `settings.open`)
  is the only target; column shows the schema key it should use

### 1.1 Persona section (`personaSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Agent name | Workspace (via `IAISettingsService` profiles) | **Workspace** | `persona.name` |
| Description | Workspace | **Workspace** | `persona.description` |
| Avatar (icon ID) | Workspace | **Workspace** | `persona.avatar` |

Service: `IAISettingsService.updateActiveProfile`. Profile system to be
collapsed in Phase 5 — values read/write directly on workspace storage.

### 1.2 Model section (`modelSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Default model | Workspace | **Workspace** | `model.default` |
| Temperature | Workspace | **Workspace** | `model.temperature` |
| Max tokens | Workspace | **Workspace** | `model.maxTokens` |
| Context window | Workspace | **Workspace** | `model.contextWindow` |

Backed by `IAISettingsService` profile.model. Needs new schema widget:
`modelChoice` (dropdown populated from `ILanguageModelsService`).

### 1.3 Chat / system prompt (currently on the persona/preview side)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| System prompt | Workspace | **Workspace** | `chat.systemPrompt` (multiline) |
| `systemPromptIsCustom` | Workspace | **Workspace** | hidden (derived) |
| Response length | Workspace | **Workspace** | `chat.responseLength` (enum) |

### 1.4 Suggestions section (`suggestionsSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Tone | Workspace | **Workspace** | `suggestions.tone` |
| Focus domain | Workspace | **Workspace** | `suggestions.focusDomain` |
| Custom focus | Workspace | **Workspace** | `suggestions.customFocus` |
| Confidence threshold | Workspace | **Workspace** | `suggestions.confidenceThreshold` |
| Suggestions enabled | Workspace | **Workspace** | `suggestions.enabled` |
| Max pending | Workspace | **Workspace** | `suggestions.maxPending` |

### 1.5 Heartbeat section (`heartbeatSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Enabled (toggle) | Workspace via `AutonomyFeatureFlagsService` (✓) **and mirror** to `heartbeat.enabled` | Drop the mirror — flag is sole source | `autonomy.heartbeat.enabled` (already registered) |
| Interval ms | Workspace via `IUnifiedAIConfigService` | **Workspace** | `autonomy.heartbeat.intervalMs` (already registered, currently `scope: 'user'` — fix to `'workspace'`) |
| Coalesce ms | Workspace | **Workspace** | `autonomy.heartbeat.coalesceMs` (new) |
| Watch include exts | Workspace | **Workspace** | `autonomy.heartbeat.watchInclude` (new, multiline) |
| Watch exclude globs | Workspace | **Workspace** | `autonomy.heartbeat.watchExclude` (new, multiline) |

### 1.6 Cron section (`cronSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Enabled flag | Workspace | **Workspace** | `autonomy.cron.enabled` (already registered) |
| Persistence path | Hard-coded `<APP_ROOT>/data/cron.json` (**GLOBAL** — bug) | **Workspace** `<workspace>/.parallx/cron.json` | `autonomy.cron.persistencePath` (already registered, fix default + scope to workspace) |
| Job list | Persisted in cron.json (currently global) | **Workspace** | dedicated dialog launched from a `cron.jobs` action row |

**Action items:** Phase 2 moves persistence; Phase 4b adds the job-list
dialog; default value changes to `<workspace>/.parallx/cron.json`.

### 1.7 Tools section (`toolsSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Per-tool enabled | Workspace via `IUnifiedAIConfigService.tools.*` and `ToolEnablementService` | **Workspace** | `tools.enabled` (action row that opens a dialog) |

Tool list is dynamic (depends on registered tools), so the registry can't
list each one. Use a single action-style schema entry that opens the
existing tools dialog; that's parity with the M60 MCP pattern.

### 1.8 MCP section (`mcpSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Server list | Workspace via `IMcpClientService.initStorage(this._storage)` ✓ | **Workspace** | `mcp.servers` (action row) |
| Per-server enabled | Workspace | **Workspace** | inside dialog |
| Status indicators | Live | Live | inside dialog |

**Verify:** confirm `initStorage(storage)` at `workbenchServices.ts:337`
receives the workspace storage. Already done in audit — yes, `storage`
is `this._storage` (workspace).

**New work (Phase 3):**
- `src/openclaw/mcp/mcpCatalog.ts` — static manifest of well-known servers
- Install dialog with manual + catalog tabs

### 1.9 Retrieval section (`retrievalSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Auto-RAG | Workspace | **Workspace** | `retrieval.autoRag` |
| Top K | Workspace | **Workspace** | `retrieval.ragTopK` |
| Score threshold | Workspace | **Workspace** | `retrieval.scoreThreshold` |

### 1.10 Indexing section (`indexingSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Auto-index | Workspace | **Workspace** | `indexing.autoIndex` |
| Watch files | Workspace | **Workspace** | `indexing.watchFiles` |
| Max file size | Workspace | **Workspace** | `indexing.maxFileSize` |
| Exclude patterns | Workspace | **Workspace** | `indexing.excludePatterns` |
| `indexing.lazyMtime.enabled` | Workspace flag | **Workspace** | already registered (✓) |
| `indexing.worker.enabled` | Workspace flag | **Workspace** | already registered (✓) |

### 1.11 Agent section (`agentSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Max iterations | Workspace | **Workspace** | `agent.maxIterations` |
| Per-agent overrides | Workspace | **Workspace** | `agent.configs` (action row) |

### 1.12 Advanced section (`advancedSection.ts`)

| Field | Scope today | Scope target | Target schema key |
|---|---|---|---|
| Export profile (button) | n/a | **Workspace export action** | `workspace.exportConfig` (action row) |
| Import profile (file) | n/a | **Workspace import action** | `workspace.importConfig` (action row) |
| Reset all | Active profile reset | **Workspace reset** | `workspace.resetConfig` (action row) |

### 1.13 Preview section (`previewSection.ts`)

Pure UX feature (run a test prompt). **Out of scope for M61 settings
unification** — this is functionality, not configuration. Decision:
move to a top-level "AI: Test Prompt" command (`Ctrl+Alt+T`) accessible
from the registry editor's "Test settings" link or the command palette.
Defer if the move is non-trivial; in the worst case keep it as a small
panel launched from the registry editor's chrome.

### 1.14 Already in registry (Phase ε)

These need no migration, only scope-flag corrections (currently many are
`scope: 'user'` and should be `'workspace'`):

```
autonomy.followup.enabled
autonomy.followup.maxDepth
autonomy.heartbeat.enabled
autonomy.heartbeat.intervalMs       ← scope user → workspace
autonomy.cron.enabled
autonomy.cron.persistencePath       ← scope user → workspace, default change
autonomy.surface.{chat,notification,statusbar,canvas,filesystem}.enabled
autonomy.subagent.enabled
autonomy.subagent.approvalMode      ← scope user → workspace
autonomy.paused.global
autonomy.rail.enabled
autonomy.patternMemory.enabled
canvas.blockIds.enabled
canvas.dataview.enabled
indexing.lazyMtime.enabled
indexing.worker.enabled
```

---

## 2. Storage scope verification

| Service / store | Storage backing | Scope verdict |
|---|---|---|
| `IGlobalStorageService` → `data/global-storage.json` | global JSON | Global ✓ |
| `IWorkspaceStorageService` → `<ws>/.parallx/workspace-state.json` | workspace JSON | Workspace ✓ |
| `AutonomyFeatureFlagsService` (uses `IWorkspaceStorageService`) | workspace | Workspace ✓ |
| `McpClientService.initStorage(storage)` (storage = `this._storage` from `workbench.ts:836`) | workspace | Workspace ✓ |
| `UnifiedAIConfigService(storage, …)` (`this._storage`) | workspace | Workspace ✓ |
| `IAISettingsService` (profile data) | workspace (with M15 layered global → workspace override; profiles list is in workspace) | Workspace (mostly) — profile concept dies in Phase 5 |
| `CronService.setPersistence(...)` → `<APP_ROOT>/data/cron.json` (chat/main.ts:1371) | global file | **Global ❌ — Phase 2 fix** |
| `RecentWorkspaces` | global | Global ✓ (correct: across workspaces) |

**Conclusion:** the only contamination point is cron persistence. Every
other autonomy/MCP/heartbeat surface is already workspace-scoped at the
storage layer; Phase 4 work is mostly registry plumbing, not storage
moves.

---

## 3. UI duplication map (today)

A user looking for "heartbeat enable" finds it in **two** places:
1. AI Settings sidebar → Heartbeat section → "Enabled" toggle
2. `Ctrl+Alt+S` → search "heartbeat" → `autonomy.heartbeat.enabled` toggle

Both write to the same flag (post-polish round). Same pattern repeats for
cron.enabled, all surface.* flags, paused.global, rail, patternMemory,
indexing.lazyMtime, indexing.worker.

Phase 5 deletes the sidebar; only `Ctrl+Alt+S` remains.

---

## 4. Entry points to settings

| Entry | Currently routes to | After M61 |
|---|---|---|
| `Ctrl+Alt+S` keybinding | `settings.open` | unchanged |
| Menu → Preferences → Settings | `settings.open` | unchanged |
| Wrench icon in chat toolbar | `view.aiSettings` (sidebar) | `settings.open` |
| Welcome card "Settings" | `settings.open` | unchanged |
| Quick Pick "AI Settings: Open" | `view.aiSettings` | `settings.open` |
| Status bar (none currently) | n/a | n/a |

Phase 6 is two-line change in chat toolbar registration plus deleting
the `view.aiSettings` view registration.

---

## 5. New schema widgets needed

Phase 4 needs these new widget types in
`src/built-in/settings/widgets/`:

1. **`multilineText`** — for system prompt, watch globs (textarea bound to
   string with `\n` separator)
2. **`enum`** ← already exists per Phase ε, verify usable for tone/focus/responseLength
3. **`modelChoice`** — dropdown populated from `ILanguageModelsService`
4. **`actionRow`** — non-value-bound entry that renders a button which
   opens a dedicated dialog (used for tools, MCP servers, cron jobs,
   agent configs, export/import/reset)
5. **`bytes`** — number with KB/MB suffix display (max file size)

`actionRow` is the most important — it lets us keep complex editors as
dialogs while still listing them in the unified settings index.

---

## 6. Action items distilled (input to Phases 2–7)

1. **Phase 2**: Move cron.json from `<APP_ROOT>/data/cron.json` to
   `<workspace>/.parallx/cron.json`. Migration shim (copy on first load).
   Update `autonomy.cron.persistencePath` schema default + scope.
2. **Phase 3**: Create `mcpCatalog.ts`. Add catalog tab to MCP install
   dialog. Verify end-to-end manual install path works.
3. **Phase 4**: Build `actionRow`, `multilineText`, `modelChoice`,
   `bytes` widgets. Register schemas for every section row in §1. Audit
   scopes — flip user → workspace where the table says workspace.
4. **Phase 5**: Delete `src/aiSettings/ui/aiSettingsPanel.ts`,
   `sections/*.ts`, `presetSwitcher.ts`. Collapse `IAISettingsService`
   to a thin facade that reads the same workspace storage keys directly
   (no profile/preset concept).
5. **Phase 6**: Re-route wrench icon, delete `view.aiSettings` view,
   update Quick Pick entries.
6. **Phase 7**: Write `docs/USER_GUIDE.md`.
7. **Phase 8**: Verify TS, vitest 2667+, manual smoke.

---

## 7. Open questions to resolve before Phase 4 starts

- **Q1: Preview section** — keep, move, or drop? Recommendation: drop
  for now (it's a developer UX, not a settings feature). Re-add as a
  top-level test command if missed.
- **Q2: Export/import format** — JSON of full workspace settings? Or
  per-section? Recommendation: single JSON of all `workspace.*` schemas
  (round-trips through registry).
- **Q3: Profile migration on existing workspaces** — when a user
  upgrades, do their existing profile values port over? Yes, by reading
  the legacy profile keys once and writing them into the new flat
  schema keys, then leaving the old keys in place for one release.
