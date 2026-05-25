---
Status: active
Milestone: M85 — Performance & Contention Audit
Branch: systems-redesign-planning
Created: 2026-05-24
Predecessors: M83 (startup hardening — W1/W3/W4/W5 shipped, W2 reverted)
Companion: M84 (System Fitness Harness) — M85 findings feed M84 baselines
---

# Parallx Milestone 85 — Performance & Contention Audit

> Continuation of M83. M83 shipped four startup/activation hardening slices
> (W1 parallel-warm, W3 IResourceService seed, W4 tool activation timeout,
> W5 diagnostics view-scoped auto-refresh) plus the W2 revert. This milestone
> sweeps the rest of the codebase for the same anti-patterns and ships fixes
> one commit at a time.

## Source of truth

The anti-patterns audited here come from [/memories/debugging.md](../memories/debugging.md):

1. **Watcher pipelines must never tax the happy path** — no per-event polling
   to defend against rare partial-write edge cases.
2. **Background scans contend for the same DB as the hot path** — no
   periodic "self-heal" loops that iterate the library through the same
   single-writer SQLite the watcher uses.
3. **No `rebuild*Index()` calls from per-item paths** — full rebuilds are
   only valid for full-import / migration scenarios.
4. **Big transactions block concurrent writers for their full wall-clock
   duration** — chunk + yield long batch work.
5. **`setInterval` in `activate()` runs forever** — gate periodic refresh
   on view/editor visibility (the W5 lesson).
6. **Renderer-side `fs:exists` is allowlist-gated** — startup checks against
   workspace roots always return false (the W2 lesson).

## Findings

### F1 — workspace-graph periodic refresh runs even when no view is mounted

- **File:** [ext/workspace-graph/main.js](../ext/workspace-graph/main.js) line 2659
- **Pattern:** `setInterval(() => _scheduleRefresh(0), 30_000)` registered
  unconditionally in `activate()`. The interval fires `_model.refresh()`,
  which walks workspace files three levels deep, queries `api.workspaceGraph`
  providers, and rebuilds the shared graph model.
- **Severity:** HIGH. Same shape as the M83-W5 diagnostics bug. Fires every
  30s for the entire app lifetime regardless of whether the sidebar view or
  the editor pane is mounted. On a large workspace the file walk plus
  provider queries can be hundreds of ms.
- **Fix:** ref-count consumers (sidebar `createView` + editor
  `createEditorPane`). Start the periodic timer when the count goes
  0→1 and clear it when it goes 1→0. Event-driven refreshes
  (`workspaceGraph.onDidChange`, `onDidChangeOpenEditors`,
  `onDidChangeWorkspaceFolders`, `links.onDidChangeContracts`) keep firing
  because they correlate with user activity in surfaces that ARE mounted.

### F2 — W2 missing-workspace-folder fallback needs a main-process probe

- **Files:** [src/workbench/workbench.ts](../src/workbench/workbench.ts) line 823 + [electron/main.cjs](../electron/main.cjs) line 1370
- **Pattern:** the renderer cannot probe the recorded last-workspace path
  before opening it, because `fs:exists` gates on `_isAllowedReadPath` and
  the workspace root is not yet in the allowlist at Phase 1.
- **Severity:** MEDIUM. Recoverable today — if the path is stale, the
  storage bridge errors on first read and the user lands on welcome anyway,
  just less cleanly.
- **Fix:** add a narrow `fs:existsPath` IPC in main.cjs that does
  `fs.access(filePath)` with no allowlist check (the path is only ever
  consumed to decide whether to open the workspace — it grants no read
  access by itself). Restore the workbench-side guard.

### F3 — Phase 1 still has one post-warm storage read

- **File:** [src/workbench/workbench.ts](../src/workbench/workbench.ts) line 884
- **Pattern:** after migrateFromLocalStorage, `initUserThemesCache` reads
  `THEME_STORAGE_KEY` via `await this._globalStorage.get(...)`. This is
  already a cache hit thanks to W1's pre-warm, so the await is fast — but
  if any other Phase 1 service ever does a fresh read, the pattern
  reappears.
- **Severity:** LOW. W1 already covers this in practice.
- **Fix:** add a comment near the warm block warning future readers to use
  Promise.all if they introduce new Phase 1 storage reads. No runtime change.

### F4 — ollama health poll runs even when chat is not visible

- **File:** [src/built-in/chat/providers/ollamaProvider.ts](../src/built-in/chat/providers/ollamaProvider.ts) line 892
- **Pattern:** `_pollTimer` runs continuously for the lifetime of the
  provider, hitting the local Ollama endpoint at adaptive intervals.
- **Severity:** N/A. The chat status indicator is rendered in the
  titlebar — "chat not visible" doesn't apply.
- **Fix:** none. Documented as inspected-and-OK.

### F5 — media-organizer FTS activation rebuild (already chunked per M64)

- **File:** [ext/media-organizer/main.js](../ext/media-organizer/main.js) line 2747
- **Pattern:** lazy FTS rebuild on activation when tables are empty but the
  underlying photo/video tables have content. Per `/memories/debugging.md`,
  the M64 fix already chunked this into 500-row transactions with a
  `setTimeout(0)` yield between chunks.
- **Severity:** N/A.
- **Fix:** none. Verified as part of audit.

### F6 — openclawCronService.start() does not gate on view visibility

- **File:** [src/openclaw/openclawCronService.ts](../src/openclaw/openclawCronService.ts) line 542
- **Pattern:** `setInterval(_checkDueJobs, CRON_CHECK_INTERVAL_MS)` for the
  lifetime of the service.
- **Severity:** N/A. Cron is by definition a background scheduler — gating
  it on view visibility would break the feature.
- **Fix:** none.

### F7 — mcpClientService health timer is per-server and unconditional

- **File:** [src/openclaw/mcp/mcpClientService.ts](../src/openclaw/mcp/mcpClientService.ts) line 383
- **Pattern:** `setInterval(healthCheck, ...)` per MCP server entry.
- **Severity:** N/A. Bounded by configured server count; needed to surface
  disconnections.
- **Fix:** none.

## Execution order

1. **F1** — workspace-graph periodic refresh gating (highest value, smallest
   blast radius). NOT a preservation surface (extension code).
2. **F2** — W2 follow-up: add `fs:existsPath` IPC + restore renderer guard.
   Both files are preservation surface → degraded-mode commit.
3. **F3** — comment-only update. Preservation surface but trivial.

Each fix lands as its own commit with a focused test. Pre-existing
`preserve:slice` failures on the branch (9 e2e tests in Explorer/
Workspaces/Canvas, verified at HEAD `faf3e801`) continue to require
`degraded-mode` framing for any preservation-surface change.
