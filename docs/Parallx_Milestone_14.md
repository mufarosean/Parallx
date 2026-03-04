# Milestone 14: Workspace Session Isolation & Chat Lifecycle Hardening

## Research Document — March 4, 2026

---

## Table of Contents

1. [Vision](#vision)
2. [VS Code Research — How The Reference Does It](#vs-code-research--how-the-reference-does-it)
3. [Current State — Parallx Audit](#current-state--parallx-audit)
4. [Gap Analysis — 8-Point Scorecard](#gap-analysis--8-point-scorecard)
5. [Architecture Decision: Window Semantics](#architecture-decision-window-semantics)
6. [Target Architecture](#target-architecture)
7. [Transformation Plan](#transformation-plan)
8. [Task Tracker](#task-tracker)
9. [Deterministic Verification Checklist](#deterministic-verification-checklist)
10. [Migration Safety Rules](#migration-safety-rules)

---

## Vision

**The one-sentence pitch:**

> Every workspace-scoped operation — chat, indexing, file tools, vector search, embeddings, prompts — must carry a `WorkspaceSessionContext` that is the sole gateway to workspace state, and every async result must be validated against the active session before committing.

**Before M14 — what happens today:**

> You switch workspaces. The page reloads. Ollama reconnects. The chat panel reappears. It *usually* works because the full page reload destroys all JS state. But there's no formal session concept — services don't know which workspace they belong to, async tasks don't carry session identity, there's no stale-session guard, and diagnostic logging doesn't include workspace context. If the reload is slow, races happen. If you add a folder without reloading, the indexing pipeline re-registers services in the DI container and old consumers hold stale references. The architecture is held together by the reload — remove it, and everything leaks.

**After M14 — what you get:**

> A `WorkspaceSessionContext` object carries `workspaceId`, `sessionId` (fresh UUID per switch/open), root paths, DB handle, abort controller, and index namespace. Every service is constructed with this context. Every async job captures `sessionId` at start and validates it before committing results. Diagnostic logging on every operation includes `[ws:abc123 sid:def456]`. A gate compliance test greps for violations. The reload strategy is validated and documented as the official isolation mechanism. If you ever want to move to multi-window, the context model is already there.

**Why this matters:**

The reload-based switch eliminates most state leaks today, but it provides no guarantees, no diagnostics, and no defense against within-session folder changes. M14 makes isolation explicit, verifiable, and future-proof.

---

## VS Code Research — How The Reference Does It

### Process-Level Isolation (The Nuclear Option)

VS Code uses **separate Electron BrowserWindows** per workspace. Each window:

- Gets its own renderer process (OS-level memory isolation)
- Has its own `DesktopMain` instance that bootstraps a fresh `ServiceCollection`
- Creates its own `Workbench`, `WorkspaceService`, `StorageService`, etc.
- Extension hosts are spawned per-window (separate Node.js processes)
- The shared process (a hidden BrowserWindow) hosts only cross-window services (extension management, telemetry, storage sync)

**Key file:** `src/vs/workbench/electron-browser/desktop.main.ts` — `DesktopMain.open()` runs the full service bootstrap per window:

```
1. domContentLoaded()
2. initServices()  ← creates fresh ServiceCollection
3. Connect IMainProcessService (Electron IPC)
4. Connect ISharedProcessService (MessagePort)
5. Create NativeWorkbenchEnvironmentService
6. Create WorkspaceService (configuration)
7. Create NativeWorkbenchStorageService  ← per-window
8. new Workbench(domElement, serviceCollection)
9. workbench.startup()
```

This means **workspace switching in VS Code = opening a new OS window with a new process**. There is no in-process "reset all services" flow. The old window simply closes (or stays open for multi-workspace).

### Service Registration Pattern

VS Code uses lazy singleton registration via `registerSingleton()`:

```typescript
registerSingleton(ITitleService, BrowserTitleService, InstantiationType.Eager);
registerSingleton(ITimerService, TimerService, InstantiationType.Delayed);
```

Services are resolved by `IInstantiationService` on first `get()` call. Since each window gets its own `ServiceCollection`, singletons are scoped to the window lifetime — not the application lifetime.

### Chat System Architecture

VS Code's chat uses URI-scoped sessions (`vscodeLocalChatSession:///<uuid>`). Key isolation properties:

| Property | VS Code Approach |
|----------|-----------------|
| Session identity | `sessionResource: URI` — unique per session, not per workspace |
| Request dispatch | `IChatService.sendRequest(sessionResource, ...)` — always scoped to a specific session URI |
| Service lifetime | `ChatService` is a workbench singleton — one per window. Window = workspace, so it's implicitly workspace-scoped |
| Agent invocation | `IChatAgentService.invokeAgent(id, request, progress, history, token)` — `CancellationToken` for abort |
| Session persistence | `IChatSessionsService` — stores history keyed by session URI |
| Extension isolation | Extension host is per-window, so extension-contributed agents are workspace-scoped by definition |

VS Code doesn't need "workspace_id on every request" because the process boundary enforces it.

### Lifecycle Phases

VS Code renderer lifecycle (from `ILifecycleService`):

| Phase | Meaning |
|-------|---------|
| Starting | Service collection being built |
| Ready | `Workbench.startup()` returned |
| Restored | Editors and views restored from state |
| Eventually | Deferred background work can begin |

Parallx has an equivalent 5-phase startup in `workbench.ts` but no formal `ILifecycleService`.

### Key Takeaway for Parallx

VS Code gets workspace isolation "for free" via process boundaries. Parallx uses a single window with full-page reload — which achieves the same result but without formal guarantees. M14 adds the formal guarantees without changing the reload strategy.

---

## Current State — Parallx Audit

### What Works Today

| Area | Status | Evidence |
|------|--------|----------|
| Workspace switch via reload | ✅ Sound | `switchWorkspace()` → save → setActiveId → lock → close DB → reload |
| Chat sessions scoped by workspace_id | ✅ Correct | `chat_sessions` table has `workspace_id` column, filtered on load |
| Database close-before-open | ✅ Correct | `DatabaseManager.open()` closes existing DB first |
| File watchers tracked via `_register()` | ✅ Correct | `IndexingPipelineService` registers listener via `_register()` |
| AbortControllers per-request | ✅ Correct | OllamaProvider creates per-fetch AbortControllers |
| Module-level chat state cleared in `deactivate()` | ✅ Defense-in-depth | 11 `let` variables all cleared in `deactivate()` |
| Vector index physically per-workspace | ✅ Correct | Each workspace has its own `.parallx/data.db` |
| Dynamic workspace root resolution | ✅ Fixed in M13 | `getRootUri()` reads `folders[0]` at call time, not at capture time |

### What's Missing

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | **No `WorkspaceSessionContext` object** | Medium | No central context to depend on; workspace identity is scattered across 6+ ad-hoc `folders[0]` reads |
| 2 | **No `sessionId` concept** | Medium | No way to detect stale async work |
| 3 | **No stale-session guards** | Medium | Async work that finishes late could theoretically corrupt state (mitigated by reload, but not guaranteed) |
| 4 | **No diagnostic logging with workspace/session identity** | Medium | When debugging workspace issues, there's no log trail |
| 5 | **Orphaned RAG services on indexing restart** | Low-Med | `_startIndexingPipeline()` re-registers `EmbeddingService`, `VectorStoreService` without disposing old instances |
| 6 | **`ChatDataService.resetForWorkspaceSwitch()` is dead code** | Low | Exists but never called — reload makes it unnecessary, but indicates an incomplete mental model |
| 7 | **`beforeunload` shutdown is fire-and-forget** | Low | No guarantee async cleanup completes before page unload |
| 8 | **No formal lifecycle phases** | Low | Workbench has 5 phases but no `ILifecycleService` for other code to subscribe to |
| 9 | **Main-process `DatabaseManager` is a true singleton** | Info | Would need per-window scoping if multi-window is ever added |

---

## Gap Analysis — 8-Point Scorecard

### 1. "New Workspace Session" Mental Model

**Target:** Define `Workspace` (persistent config) vs `WorkspaceSession` (runtime instance). On switch, end Session A, start Session B.

**Current:** No formal `WorkspaceSession` concept. The reload implicitly ends the old session (page unload) and starts a new one (fresh `bootstrap()`). Services are singletons within a page lifecycle, and page = session.

**Verdict: ⚠️ Implicitly correct, not explicitly modeled.** The reload achieves the right outcome, but no code can inspect "what session am I in?" or "is my session still active?". Adding `WorkspaceSessionContext` makes the implicit explicit.

### 2. Single `WorkspaceContext` Object

**Target:** One object that carries `workspaceId`, `sessionId`, paths, storage handles, abort primitives. No service reads `currentWorkspace` from a global singleton.

**Current:** Workspace identity is accessed via `workspaceService.folders[0].uri` in 4+ call sites, `this._workspace.id` on the Workbench, and `ChatService._workspaceId` set manually. No central context object.

**Verdict: ❌ Not implemented.** The information exists but is scattered. Creating `WorkspaceSessionContext` is a pure addition — no existing code needs to change, but all new code should use it.

### 3. Hard Dispose Graph

**Target:** Deterministic shutdown order: freeze UI → cancel in-flight → dispose services → clear caches → create new context.

**Current:** `switchWorkspace()` does: save → setActiveId → lock → close DB → set pending flag → reload. The reload destroys everything. Within a session, `_startIndexingPipeline()` disposes the old pipeline but doesn't dispose orphaned sub-services.

**Verdict: ⚠️ Reload is the dispose graph.** For workspace switching, this is correct. For within-session folder changes, there's a gap (orphaned RAG services). Adding explicit dispose sequencing for `_startIndexingPipeline()` fixes this.

### 4. AI Chat + Indexing Workspace-Keyed

**Target:** Every AI request carries `{workspaceId, sessionId}`. Backend validates. Index is namespaced by workspace.

**Current:** Chat sessions are keyed by `workspace_id` in the DB. The vector index is physically per-workspace (separate `.parallx/data.db`). AI requests don't carry explicit workspace/session identity — they rely on the correct DB being open. Tool invocations resolve workspace root dynamically.

**Verdict: ⚠️ Correct by physical isolation, not by design.** The per-workspace DB file and dynamic `folders[0]` resolution mean the right data is accessed. But there's no explicit validation that "this request belongs to the active session." Adding `sessionId` to requests enables the stale-guard pattern.

### 5. Stale Session Guards

**Target:** Every async job captures `sessionId` at start, validates before committing.

**Current:** Zero instances of stale-session guards. Async work (OllamaProvider health polls, embedding batches, indexing pipeline file processing) does not capture or validate session identity.

**Verdict: ❌ Not implemented.** The reload makes this low-risk for workspace switches, but it's completely unguarded for within-session races (folder changes, indexing restarts). Adding guards is cheap and high-leverage.

### 6. Window Semantics Decision

**Target:** Decide between VS Code-style new window (process isolation) or single-window with reload.

**Current:** Single window with `window.location.reload()`.

**Verdict: ⚠️ Needs formal documentation.** The reload strategy is correct and well-implemented. We should document it as the official decision, note the tradeoffs, and identify the migration path if multi-window is ever needed.

### 7. Diagnostic Logging

**Target:** Every operation logs `workspaceId` + `sessionId`.

**Current:** No workspace/session context in any log output. Existing logs use feature prefixes (`[Workbench]`, `[IndexingPipeline]`) without workspace identity.

**Verdict: ❌ Not implemented.** This is pure addition — no existing code changes, just enrichment.

### 8. Best 3 Steps First

**Target:** (1) sessionId + stale guards, (2) per-session service container, (3) vector index namespacing.

**Current:** (1) Not started.  (2) Not needed — reload is the container. (3) Already done — per-workspace DB file.

**Verdict:** The "best 3" are partially addressed by the reload architecture. The remaining high-leverage work is (1) `WorkspaceSessionContext` with sessionId, and (2) stale-session guards.

---

## Architecture Decision: Window Semantics

### Decision: Single Window + Reload (Keep Current Approach)

**Rationale:**

1. **VS Code parity:** VS Code uses new windows, but this requires `IWindowsMainService`, `DesktopMain` per-window bootstrap, per-window extension host processes, and a shared process for cross-window coordination. This is ~10K lines of infrastructure we don't have and don't need.

2. **Reload achieves the same isolation:** A full-page reload destroys all JS state, DOM, timers, closures, and WeakRefs. It's equivalent to process isolation for a single-window app. VS Code's Electron windows each get their own V8 isolate — `window.location.reload()` gives us the same for a single window.

3. **Cost of multi-window:** Would require: new main-process window manager, per-window IPC channels, per-window service bootstrap, shared-process coordination, per-window extension host management. Estimated: 5K+ lines, 3+ milestones.

4. **Future path:** If we ever need multi-window, `WorkspaceSessionContext` (introduced in this milestone) provides the abstraction layer. Each window would create its own context. The migration path is: context → per-window bootstrap → process isolation.

**Documented tradeoffs:**

| Aspect | Reload (current) | New Window (VS Code) |
|--------|------------------|---------------------|
| State isolation | ✅ Full (V8 GC) | ✅ Full (OS process) |
| Startup time | ⚠️ ~2s (full bootstrap) | ⚠️ ~2s (new process + bootstrap) |
| Memory | ✅ One renderer process | ❌ N renderer processes |
| Multi-workspace | ❌ Not supported | ✅ Supported |
| Implementation cost | ✅ Already done | ❌ ~5K lines |
| Formal session tracking | ❌ Needs M14 | ✅ Process = session |

---

## Target Architecture

### WorkspaceSessionContext

```typescript
// src/workspace/workspaceSessionContext.ts

export interface IWorkspaceSessionContext {
  /** Stable identifier from workspace config (persisted). */
  readonly workspaceId: string;

  /** Fresh UUID created on every open/switch. */
  readonly sessionId: string;

  /** Workspace root folders (snapshot at session start). */
  readonly roots: readonly URI[];

  /** Primary root URI (convenience — roots[0]). */
  readonly primaryRoot: URI | undefined;

  /** AbortController — signalled on session end. */
  readonly abortController: AbortController;

  /** Convenience: abortController.signal */
  readonly cancellationSignal: AbortSignal;

  /** Whether this session is still the active one. */
  isActive(): boolean;

  /** Log prefix: `[ws:abc123 sid:def456]`. */
  readonly logPrefix: string;
}
```

### SessionManager

```typescript
// src/workspace/sessionManager.ts

export interface ISessionManager {
  /** The currently active session context. */
  readonly activeContext: IWorkspaceSessionContext | undefined;

  /** Create a new session for a workspace. Signals abort on the old one. */
  beginSession(workspaceId: string, roots: readonly URI[]): IWorkspaceSessionContext;

  /** End the current session (abort + invalidate). */
  endSession(): void;

  /** Event fired when the active session changes. */
  readonly onDidChangeSession: Event<IWorkspaceSessionContext | undefined>;
}
```

### Stale Guard Utility

```typescript
// src/workspace/staleGuard.ts

/**
 * Captures the current session ID and returns a validator function.
 * Usage:
 *   const guard = captureSession(sessionManager);
 *   // ... async work ...
 *   if (!guard.isValid()) return; // bail if session changed
 */
export function captureSession(mgr: ISessionManager): { isValid(): boolean; sessionId: string } {
  const captured = mgr.activeContext?.sessionId ?? '';
  return {
    sessionId: captured,
    isValid: () => mgr.activeContext?.sessionId === captured,
  };
}
```

### Integration Points

```
Workbench.startup()
  Phase 1: Register services
  Phase 4: _restoreWorkspace()
    → SessionManager.beginSession(workspaceId, roots)
    → Context available to all services
  Phase 5: Chat activate()
    → Receives context.logPrefix, context.cancellationSignal
    → Every tool invocation checks guard.isValid()

switchWorkspace()
  → SessionManager.endSession()  // signals abort
  → save, setActiveId, lock, close DB
  → window.location.reload()
  → Fresh bootstrap creates new session
```

---

## Transformation Plan

### Phase 1: Foundation — WorkspaceSessionContext + SessionManager (Tasks 1.1–1.5)

Create the context model, session manager, and wire into the workbench lifecycle. Pure addition — no existing code changes behavior.

### Phase 2: Stale Session Guards (Tasks 2.1–2.5)

Add `captureSession()` pattern to indexing pipeline, chat request handling, and embedding operations. Add abort signal propagation.

### Phase 3: Diagnostic Logging (Tasks 3.1–3.3)

Add `logPrefix` to all workspace-scoped operations. Create a diagnostic E2E test that validates log output after workspace switch.

### Phase 4: Dispose Graph Hardening (Tasks 4.1–4.3)

Fix orphaned RAG services on indexing restart. Add explicit dispose sequencing for `_startIndexingPipeline()`. Remove dead code (`resetForWorkspaceSwitch`).

### Phase 5: Gate Compliance + Verification (Tasks 5.1–5.3)

Add gate test that greps for `workspaceService.folders[0]` outside of `WorkspaceSessionContext`. Verify all 8 criteria pass.

---

## Task Tracker

### Phase 1: Foundation (5 tasks)

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | **Create `IWorkspaceSessionContext` interface** in `src/workspace/workspaceSessionContext.ts`. Fields: `workspaceId`, `sessionId`, `roots`, `primaryRoot`, `abortController`, `cancellationSignal`, `isActive()`, `logPrefix`. Export from service types. | ☐ |
| 1.2 | **Create `SessionManager` class** in `src/workspace/sessionManager.ts`. Implements `ISessionManager`. `beginSession()` creates new context with `crypto.randomUUID()`, aborts any previous context. `endSession()` signals abort. `onDidChangeSession` event. Register in `serviceTypes.ts`. | ☐ |
| 1.3 | **Create `captureSession()` utility** in `src/workspace/staleGuard.ts`. Returns `{ isValid(), sessionId }` object. Lightweight, zero-dependency. Unit test in `tests/unit/staleGuard.test.ts`. | ☐ |
| 1.4 | **Wire `SessionManager` into Workbench lifecycle.** In `workbenchServices.ts`: register `ISessionManager` as eager singleton. In `workbench.ts` Phase 4 (`_restoreWorkspace`): call `sessionManager.beginSession(workspaceId, roots)`. In `switchWorkspace()`: call `sessionManager.endSession()` before reload. | ☐ |
| 1.5 | **Pass context to ChatDataService.** In `chat/main.ts` `activate()`: read `sessionManager.activeContext` and pass to `ChatDataService` constructor. `ChatDataService` stores the context and exposes `context.logPrefix` for sub-services. | ☐ |

### Phase 2: Stale Session Guards (5 tasks)

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | **Guard indexing pipeline.** In `IndexingPipelineService`: capture session ID at pipeline start. Before every `_indexFile()` / `_processChunk()` commit, check `guard.isValid()`. Skip and log if stale. | ☐ |
| 2.2 | **Guard chat request handling.** In `ChatService.sendRequest()` and `DefaultParticipant.handleRequest()`: capture session ID at request start. Before appending response messages to history, check `guard.isValid()`. | ☐ |
| 2.3 | **Guard embedding operations.** In `EmbeddingService.embed()` and batch embedding calls: capture session ID. Before writing embeddings to vector store, check `guard.isValid()`. | ☐ |
| 2.4 | **Guard tool invocations.** In `builtInTools.ts` tool dispatch: capture session ID before each tool call. Before returning results to LLM, check `guard.isValid()`. If stale, return error: `"Workspace session changed — results discarded."` | ☐ |
| 2.5 | **Propagate `cancellationSignal` to OllamaProvider.** Pass `context.cancellationSignal` through the chat request pipeline so that `sessionManager.endSession()` automatically aborts in-flight LLM requests via the session-scoped AbortController. | ☐ |

### Phase 3: Diagnostic Logging (3 tasks)

| Task | Description | Status |
|------|-------------|--------|
| 3.1 | **Create `SessionLogger` utility.** A thin wrapper that prepends `context.logPrefix` (`[ws:abc123 sid:def456]`) to every `console.log/warn/error` call. Accepts `IWorkspaceSessionContext`. Located in `src/workspace/sessionLogger.ts`. | ☐ |
| 3.2 | **Add session logging to all workspace-scoped operations.** Instrument: chat send, tool invocation, index write, index query, watcher event, DB query (in DatabaseService), embedding write. Use `SessionLogger` for consistent formatting. | ☐ |
| 3.3 | **Add E2E diagnostic test.** In `tests/e2e/25-workspace-session-logging.spec.ts`: switch workspace, verify console output contains new session ID, verify no log lines with old session ID appear after switch. | ☐ |

### Phase 4: Dispose Graph Hardening (3 tasks)

| Task | Description | Status |
|------|-------------|--------|
| 4.1 | **Fix orphaned RAG services on indexing restart.** In `_startIndexingPipeline()`: before re-registering `EmbeddingService`, `VectorStoreService`, `ChunkingService` in the DI container, dispose the previous instances. Track them in a `DisposableStore` on the Workbench. | ☐ |
| 4.2 | **Remove dead `resetForWorkspaceSwitch()` methods.** `ChatService.resetForWorkspaceSwitch()` and `ChatDataService.resetForWorkspaceSwitch()` are never called in the reload flow. Remove them. If the logic is needed for within-session folder changes, refactor it to use `onDidChangeSession` instead. | ☐ |
| 4.3 | **Guard `_startIndexingPipeline()` with session check.** Before starting a new pipeline, verify `sessionManager.activeContext?.isActive()`. If the session is ending, skip pipeline start. This prevents pipeline creation during the `switchWorkspace()` shutdown sequence. | ☐ |

### Phase 5: Gate Compliance + Verification (3 tasks)

| Task | Description | Status |
|------|-------------|--------|
| 5.1 | **Create `workspaceSessionCompliance.test.ts`.** Grep-based gate test that verifies: (a) no direct `workspaceService.folders[0]` reads outside of `WorkspaceSessionContext` and allowed callsites, (b) no `new AbortController()` in workspace-scoped services (must use `context.cancellationSignal`), (c) `captureSession` is called in all async pipeline entry points. | ☐ |
| 5.2 | **Create E2E workspace session identity test.** In `tests/e2e/26-workspace-session-identity.spec.ts`: open workspace A, capture session ID from context, switch to workspace B, verify new session ID is different, verify old session's abort controller is signalled. | ☐ |
| 5.3 | **Document window semantics decision.** Add a section to `ARCHITECTURE.md` documenting: (a) single-window + reload strategy, (b) why not multi-window, (c) `WorkspaceSessionContext` as the abstraction layer, (d) migration path to multi-window if ever needed. | ☐ |

**Total: 19 tasks across 5 phases.**

---

## Deterministic Verification Checklist

Each criterion below must pass to consider M14 complete. Every check is binary — pass or fail.

### Criterion 1: WorkspaceSession Concept Exists

- [ ] `IWorkspaceSessionContext` interface exists in `src/workspace/workspaceSessionContext.ts`
- [ ] `SessionManager` class exists in `src/workspace/sessionManager.ts`
- [ ] `SessionManager.beginSession()` creates a new context with unique `sessionId`
- [ ] `SessionManager.endSession()` signals abort on the old context
- [ ] Unit test: `beginSession()` returns context with non-empty `sessionId`
- [ ] Unit test: `endSession()` causes old `context.isActive()` to return `false`
- [ ] Unit test: `endSession()` aborts old `context.abortController`

### Criterion 2: Single WorkspaceContext Object

- [ ] `workbench.ts` Phase 4 calls `sessionManager.beginSession()`
- [ ] `switchWorkspace()` calls `sessionManager.endSession()` before reload
- [ ] `ChatDataService` receives context via constructor or initialization
- [ ] No new code reads `workspaceService.folders[0]` directly — uses `context.roots` or `context.primaryRoot`
- [ ] Gate test `workspaceSessionCompliance.test.ts` passes (no violations)

### Criterion 3: Hard Dispose Graph

- [ ] `_startIndexingPipeline()` disposes old `EmbeddingService`, `VectorStoreService`, `ChunkingService` before creating new ones
- [ ] Old instances are tracked in a `DisposableStore`
- [ ] Pipeline start is guarded by `sessionManager.activeContext?.isActive()`
- [ ] Unit test: calling `_startIndexingPipeline()` twice does not leak disposables

### Criterion 4: Workspace-Keyed AI + Indexing

- [ ] Chat sessions are loaded with `WHERE workspace_id = ?` (already done)
- [ ] Vector index is per-workspace DB file (already done)
- [ ] `captureSession()` is called in `ChatService.sendRequest()` before processing
- [ ] `captureSession()` is called in `IndexingPipelineService._indexFile()` before committing
- [ ] `captureSession()` is called in `EmbeddingService.embed()` before writing to vector store

### Criterion 5: Stale Session Guards

- [ ] `captureSession()` utility exists and is unit-tested
- [ ] At least 5 call sites use `captureSession()`: chat send, tool invoke, index write, embedding write, pipeline process
- [ ] Unit test: `captureSession().isValid()` returns `false` after `endSession()`
- [ ] Unit test: stale guard prevents commit when session changes mid-operation

### Criterion 6: Window Semantics Documented

- [ ] `ARCHITECTURE.md` contains "Window Semantics" section
- [ ] Documents single-window + reload choice with rationale
- [ ] Documents tradeoffs vs multi-window
- [ ] Documents migration path to multi-window via `WorkspaceSessionContext`

### Criterion 7: Diagnostic Logging

- [ ] `SessionLogger` utility exists
- [ ] Chat send includes `[ws:... sid:...]` in log output
- [ ] Tool invocation includes `[ws:... sid:...]` in log output
- [ ] Index write includes `[ws:... sid:...]` in log output
- [ ] DB query includes `[ws:... sid:...]` in log output
- [ ] E2E test verifies session ID changes after workspace switch

### Criterion 8: All Tests Pass

- [ ] `tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all unit tests pass (including new ones)
- [ ] `npx playwright test` — all E2E tests pass (including new ones)
- [ ] Gate compliance test `workspaceSessionCompliance.test.ts` — passes
- [ ] No regressions in existing 1464+ unit tests and 23+ E2E tests

### Summary Scorecard

| # | Criterion | Pass/Fail |
|---|-----------|-----------|
| 1 | WorkspaceSession concept exists | ☐ |
| 2 | Single WorkspaceContext object | ☐ |
| 3 | Hard dispose graph | ☐ |
| 4 | Workspace-keyed AI + indexing | ☐ |
| 5 | Stale session guards | ☐ |
| 6 | Window semantics documented | ☐ |
| 7 | Diagnostic logging | ☐ |
| 8 | All tests pass | ☐ |

---

## Migration Safety Rules

These rules apply to every task in M14. Violating them is a bug.

### Rule 1: Pure Addition First

Phases 1–3 are **pure additions** — new files, new classes, new utilities. No existing code changes behavior. The app must work identically before and after.

### Rule 2: No Behavioral Changes

M14 adds infrastructure (context, guards, logging). It does not change what the app does. Same features, same UI, same workspace switching. If a test breaks, the task implementation is wrong.

### Rule 3: One Phase at a Time

Complete and verify each phase (`tsc --noEmit` + `npx vitest run` + git commit) before starting the next.

### Rule 4: Commit Per Task

Each numbered task gets its own commit. Fine-grained rollback if anything goes wrong.

### Rule 5: Test After Every Change

`tsc --noEmit` + `npx vitest run` after every file change. `npx playwright test` after every phase.

### Rule 6: Context Reads Are Lazy

`WorkspaceSessionContext.roots` is a snapshot at session start. Individual tool/service calls that need the *current* folder list should still read `workspaceService.folders` dynamically. The context provides identity (`workspaceId`, `sessionId`), not mutable state.

### Rule 7: Guards Are Cheap

`captureSession()` is ~5 lines. `guard.isValid()` is a string comparison. Adding guards must not measurably impact performance. If a guard fires (stale session detected), it logs a warning and bails — no error dialogs, no retries.

### Rule 8: Logging Is Non-Blocking

`SessionLogger` must never throw. If context is unavailable, it falls back to `[ws:? sid:?]`. Logging must not block the operation it instruments.

---

## Appendix A: File Inventory

### New Files (Created by M14)

| File | Phase | Purpose |
|------|-------|---------|
| `src/workspace/workspaceSessionContext.ts` | 1.1 | `IWorkspaceSessionContext` interface + impl |
| `src/workspace/sessionManager.ts` | 1.2 | `ISessionManager` interface + `SessionManager` class |
| `src/workspace/staleGuard.ts` | 1.3 | `captureSession()` utility |
| `src/workspace/sessionLogger.ts` | 3.1 | `SessionLogger` wrapper |
| `tests/unit/sessionManager.test.ts` | 1.2 | Unit tests for SessionManager |
| `tests/unit/staleGuard.test.ts` | 1.3 | Unit tests for stale guard |
| `tests/unit/workspaceSessionCompliance.test.ts` | 5.1 | Gate compliance grep test |
| `tests/e2e/25-workspace-session-logging.spec.ts` | 3.3 | E2E diagnostic logging test |
| `tests/e2e/26-workspace-session-identity.spec.ts` | 5.2 | E2E session identity test |

### Modified Files (Changed by M14)

| File | Phase | Change |
|------|-------|--------|
| `src/services/serviceTypes.ts` | 1.2 | Add `ISessionManager` service identifier |
| `src/workbench/workbenchServices.ts` | 1.4 | Register `SessionManager` as eager singleton |
| `src/workbench/workbench.ts` | 1.4, 4.1, 4.3 | Wire session lifecycle, fix orphaned services |
| `src/built-in/chat/main.ts` | 1.5 | Pass context to ChatDataService |
| `src/built-in/chat/data/chatDataService.ts` | 1.5, 2.2 | Accept context, add stale guards |
| `src/services/chatService.ts` | 2.2, 4.2 | Add stale guard to sendRequest, remove dead code |
| `src/services/indexingPipeline.ts` | 2.1, 2.3 | Add stale guards to pipeline operations |
| `src/built-in/chat/tools/builtInTools.ts` | 2.4 | Add stale guard to tool dispatch |
| `src/built-in/chat/providers/ollamaProvider.ts` | 2.5 | Accept cancellation signal in request pipeline |
| `src/services/databaseService.ts` | 3.2 | Add session logging to queries |
| `ARCHITECTURE.md` | 5.3 | Document window semantics decision |

### Dependency Order

```
Phase 1 (foundation) → Phase 2 (guards) → Phase 3 (logging) → Phase 4 (hardening) → Phase 5 (verification)
     ↓                      ↓                    ↓                     ↓                       ↓
  1.1 → 1.2 → 1.3       2.1–2.5 (any order)  3.1 → 3.2 → 3.3     4.1 → 4.2 → 4.3       5.1 → 5.2 → 5.3
       ↓
     1.4 → 1.5
```

Phase 1 tasks must be sequential (each builds on the previous). Phases 2–4 can be done in any order after Phase 1. Phase 5 must be last.
