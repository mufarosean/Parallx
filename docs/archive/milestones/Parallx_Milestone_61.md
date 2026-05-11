# Milestone 61 — One Settings UI, Workspace-Scoped Everything

**Date:** 2026-04-30
**Status:** Planning
**Branch:** `milestone-61` (from `milestone-60` post-polish)
**Theme:** Collapse the two settings worlds into one schema-driven editor,
make every autonomy / cron / MCP / persona setting **workspace-scoped by
default** (no contamination across projects), surface MCP install +
catalog as a first-class flow, and ship a real user guide.

This milestone is **not** new features. It's the cleanup that M60 deferred:
the user shouldn't have to know which UI to open or which storage scope a
setting lives in. One door, one map, one guide.

---

## 1. Vision

A user opens Parallx, hits `Ctrl+Alt+S`, and sees **one** settings panel.
They search "heartbeat", flip one toggle, it works. They install Gmail
MCP from a catalog dropdown — no JSON, no terminal commands. They open a
different workspace and that Gmail server isn't there. They never see two
sliders for the same thing. They read a 1-page guide that explains
exactly where each setting lives and why.

### 1.1 Anti-vision

- **Not** a rewrite of the registry editor. The Phase ε overlay stays as-is;
  we feed it more entries.
- **Not** a kill of MCP, autonomy, or cron features. They keep working;
  only their UI surface and storage scope change.
- **Not** a refactor of `IAISettingsService` internals to be "more elegant."
  It either gets folded into the registry or deleted. No middle ground.
- **Not** an excuse to add new schemas. Only existing settings move.

---

## 2. Scope Decisions (locked)

### 2.1 One settings UI (Decision A1)

The Phase ε registry editor (`Ctrl+Alt+S` → `settings.open` overlay) is
the only user-facing settings surface. The AI Settings sidebar view is
**deleted** at the end of this milestone. The wrench-icon entry in chat
points at `settings.open`. Quick Pick entries, welcome card, status bar
all redirect.

### 2.2 Scope model (Decision B — locked)

| Setting class | Scope | Rationale |
|---|---|---|
| API keys, provider auth, embeddings provider | **User (global)** | Personal credentials. Re-pasting per workspace is hostile. |
| Theme, font, layout density, custom keybindings | **User (global)** | Personal preference. |
| Autonomy flags (heartbeat / cron / subagent / followup / surfaces / paused / rail / patternMemory) | **Workspace** | No contamination per project. |
| Cron jobs (schedule list + persistence) | **Workspace** | Was `<APP_ROOT>/data/cron.json` — moves to `<workspace>/.parallx/cron.json`. |
| MCP server registry (which servers, their commands, env, enabled bits) | **Workspace** | Per-project tool surface. |
| Heartbeat config (interval, coalesce, watch globs) | **Workspace** | Tied to autonomy. |
| Retrieval / indexing paths, watch globs, chunk sizes | **Workspace** | Already workspace-scoped — keep. |
| Persona / system prompt / model preference | **Workspace** | Project voice. |
| Settings editor itself (`settings.editor.enabled` rollback flag) | **User** | Operator escape hatch. |

**Profiles / presets are deleted.** A workspace **is** a profile. The
`PresetSwitcher` UI goes away. `IAISettingsService.{getAllProfiles,
createProfile, setActiveProfile, ...}` either disappear or collapse to a
single "active config" with no peers.

### 2.3 MCP user story (Decision C — both)

1. **Manual install** — paste a command + args + env in a dialog. We have
   this in `McpSection`; verify it persists, auto-connects, registers
   tools, and the agent can call them. Document any gaps; fix them.
2. **Catalog browse** — a curated JSON manifest (shipped in the app, not
   downloaded) of well-known MCP servers (Gmail, GitHub, filesystem,
   Slack, Linear, Postgres, Brave Search). User picks one, fills in
   required env vars (e.g. OAuth token), clicks Install → workspace
   server entry created → connect.

Out of scope: remote registry sync, marketplace UI, server publishing,
Windows/macOS/Linux package format diffs (we install via `npx` and bail
gracefully if not present).

---

## 3. Current State Audit (read this before changing code)

### 3.1 Storage facts (verified by grep)

- `IGlobalStorageService` → `<APP_ROOT>/data/global-storage.json`
- `IWorkspaceStorageService` → `<workspace>/.parallx/workspace-state.json`
- `AutonomyFeatureFlagsService` ← `IWorkspaceStorageService` ✓ already workspace
- `McpClientService.initStorage(storage)` ← `this._storage` ✓ already workspace
- `UnifiedAIConfigService(storage, …)` ← `this._storage` ✓ already workspace
- `CronService.setPersistence(...)` ← `<APP_ROOT>/data/cron.json` ❌ **GLOBAL — must move**

So heartbeat config, autonomy flags, MCP server list, and unified AI
config are **already** workspace-scoped. The only contamination point
is the cron `data/cron.json` file.

### 3.2 UI facts

- `Ctrl+Alt+S` → `settings.open` → `SettingsEditor` overlay (registry-driven)
- Wrench icon in chat → `view.aiSettings` (sidebar panel) → `AISettingsPanel`
  with sections: Model, Retrieval, Agent, Heartbeat, Cron, Tools, Advanced,
  Preview, MCP
- Both UIs have entries for autonomy flags, heartbeat, cron — duplication.
- `AISettingsPanel` has a `PresetSwitcher` (profile chooser).

### 3.3 Registry coverage today

`autonomySettingsSchemas.ts` registers ~14 entries:
- `autonomy.followup.{enabled,maxDepth}`
- `autonomy.heartbeat.enabled`
- `autonomy.cron.{enabled,persistencePath}`
- `autonomy.surface.{chat,notification,statusbar,canvas,filesystem}.enabled`
- `autonomy.paused.global`
- `autonomy.rail.enabled`
- `autonomy.patternMemory.enabled`
- `autonomy.subagent.approvalMode`

Missing from the registry (still only in AI Settings sidebar): model
default, retrieval params, indexing controls, chunk sizes, persona,
system prompt, MCP server list editor, heartbeat interval/coalesce/watch
globs, advanced flags (canvas blockIds, dataview, indexing.lazyMtime,
indexing.worker).

---

## 4. Plan (8 phases, single linear pass)

### Phase 1 — Read-only audit
Grep + read every AI Settings section, every registry schema, every
storage init site. Output a single internal note (`docs/SETTINGS_AUDIT.md`,
~1 page) listing every setting × current scope × target scope × current UI
× target UI. No code edits. Verify there are no other contamination
points besides cron.

### Phase 2 — Cron → workspace
Rewire cron persistence from `<APP_ROOT>/data/cron.json` to
`<workspace>/.parallx/cron.json`. Migration shim: on first workspace
load, if `<workspace>/.parallx/cron.json` doesn't exist and
`<APP_ROOT>/data/cron.json` does, copy it once and leave a `.migrated`
marker. Update `autonomy.cron.persistencePath` schema default + comment.
Test: cron jobs in workspace A don't appear in workspace B.

### Phase 3 — MCP end-to-end audit + catalog
1. **Audit** the existing manual install path. Click through the
   sidebar's MCP section, install a fake server, restart, verify it
   reconnects, verify tools appear in the picker, verify the agent can
   call them. Fix every break.
2. **Catalog manifest** — `src/openclaw/mcp/mcpCatalog.ts` exports
   `MCP_CATALOG: McpCatalogEntry[]`. Each entry: id, displayName,
   description, command/args template, required env vars (with help
   text), homepage URL.
3. **Install dialog** — when the user picks a catalog entry, show a
   short form for the env vars, then write the server config to
   workspace storage. Same connect path as manual install.

### Phase 4 — Migrate AI Settings sections → registry
One section at a time, in this order to bound risk:
- 4a. Heartbeat (interval, coalesce, watch include, watch exclude)
- 4b. Cron (job list editor — new schema type `cronJobList`)
- 4c. Tools (enable/disable per tool — schema type `toolEnablement`)
- 4d. Retrieval (chunk size, top-k, etc.)
- 4e. Model (default model dropdown — schema type `modelChoice`)
- 4f. Agent (autonomy.subagent.* extras)
- 4g. Advanced (the kill-switch flags)
- 4h. Persona / system prompt (schema type `multilineText`)
- 4i. MCP — register a synthetic schema entry that opens the MCP install
     dialog (no inline editing for server arrays in the registry; that
     stays as a dedicated dialog).

After each section: TS check, vitest, eyeball the registry overlay
shows the new entries, eyeball the sidebar still works for the others.

### Phase 5 — Delete the sidebar and profiles
Once every section has registry parity:
- Delete `src/aiSettings/ui/aiSettingsPanel.ts` and all `sections/*`.
- Delete `src/aiSettings/ui/presetSwitcher.ts`.
- Collapse `IAISettingsService` to a thin one-config wrapper or delete it
  entirely if `IUnifiedAIConfigService` covers the surface.
- Delete `view.aiSettings`, `ai-settings.open`, `ai-settings.scrollToSection`
  command registrations.
- Delete `parallx.ai-settings` tool entry (or repurpose its activation to
  the new `parallx.settings`).

### Phase 6 — Reroute every entry point
- Wrench icon in chat → `settings.open` (with optional category jump arg)
- Welcome card "Settings" → already `settings.open` ✓
- Status bar gear (if present) → `settings.open`
- Menu "Preferences > Settings" → already `settings.open` ✓
- Quick Pick "AI: Open Settings" → `settings.open`
- Any remaining `view.aiSettings` references → delete or redirect

### Phase 7 — `docs/USER_GUIDE.md`
~3-page quick-start. Sections:
1. **Where settings live** (one page, the scope table from §2.2)
2. **How to enable autonomy** (heartbeat, cron, followup) — one toggle
   each, the global pause kill-switch, where to see logs
3. **How to install an MCP server** — manual + catalog, with screenshots
   placeholders
4. **Workspaces are profiles** — open a new workspace = new config; copy
   settings via export/import (note: export/import is a future item)
5. **Troubleshooting** — autonomy not firing, MCP not connecting, settings
   not persisting

### Phase 8 — Final verification
- `npx tsc --noEmit` clean
- `npx vitest run` 2667+ pass (no regressions)
- Manual smoke: open Parallx, hit `Ctrl+Alt+S`, search every category,
  toggle heartbeat, install an MCP catalog server, restart, verify
  persistence, switch workspaces, verify isolation
- Commit as a milestone branch, no force-merge to milestone-60

---

## 5. Risks

- **R1 — Profiles deletion breaks downstream.** `IAISettingsService` is
  imported in lots of places. Mitigation: keep the interface shell as a
  thin facade over `IUnifiedAIConfigService` for the duration of phase 5;
  delete only after consumers are gone.
- **R2 — Registry editor needs new schema types.** `cronJobList`,
  `toolEnablement`, `modelChoice`, `multilineText` don't exist yet.
  Mitigation: add them as small, testable widgets in
  `src/built-in/settings/widgets/`. Keep them simple — the goal is parity
  with the sidebar, not improvement.
- **R3 — Workspace migration deletes user data.** Cron migration shim
  must be **copy, not move**. Leave the global file in place. Document
  in commit message.
- **R4 — MCP catalog ships secrets.** Catalog entries declare *required
  env vars*; they never embed secrets. User fills them in at install
  time. Stored in workspace storage, never in the catalog file.
- **R5 — Scope creep.** No new features. No "while I'm in there" cleanups.
  If something looks broken outside scope, file it as a follow-up
  (`docs/Future_Improvements.md`).

---

## 6. Definition of Done

1. `Ctrl+Alt+S` is the only way to open settings. Sidebar gone.
2. Every autonomy / cron / heartbeat / MCP / persona / model / retrieval
   setting appears in the registry editor with correct scope tags.
3. Two workspaces show fully isolated cron / MCP / autonomy state.
4. A user can install Gmail MCP from the catalog in ≤ 5 clicks.
5. `docs/USER_GUIDE.md` exists, is accurate, and is linked from `README.md`.
6. `npx tsc --noEmit` clean; `npx vitest run` ≥ 2667 pass; no
   localStorage references in autonomy/cron/MCP/heartbeat code.
7. Branch `milestone-61` merged into `main`.
