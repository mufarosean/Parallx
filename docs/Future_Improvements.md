# Future Improvements

Deferred enhancements that need proper planning before implementation.

---

## Startup Performance — Indexing Pipeline Freeze

### Problem

The indexing pipeline (`indexingPipeline.ts`) runs embedding generation and file
scanning on the **renderer thread** during Phase 5 startup. On workspaces with
many canvas pages or files, this causes the UI to become unresponsive ("Not
Responding" in Windows task manager). Users cannot open documents, click
sidebar items, or interact with the app while indexing is in progress.

### Root Cause

The pipeline calls Ollama's `/api/embed` endpoint, walks the full directory
tree, reads file contents, computes content hashes, and writes to SQLite — all
on the same thread that handles UI events. Key issues:

1. **Ollama model cold-load** — `ensureModel()` sends a test embedding request.
   If the model isn't loaded in Ollama's memory, this blocks while the full
   `nomic-embed-text` model loads into RAM/VRAM (2–5s system memory pressure).

2. **No cooperative yielding in page loop** — `_indexAllPages()` iterates every
   non-archived page with zero `await Promise.resolve()` between iterations.
   The directory walker yields every 200 entries, but pages don't.

3. **IPC contention** — Each `vectorStore.upsert()` fires IPC to the Electron
   main process for SQLite writes. Under heavy indexing, this IPC traffic
   competes with UI-driven IPC (clicks, layout queries, rendering).

4. **No mtime fast-skip for pages** — Files have an mtime-based fast-skip that
   avoids re-processing unchanged files. Pages load all rows from SQLite and
   hash them every time, even when nothing changed.

5. **Immediate start** — The pipeline fires as soon as the DB opens in Phase 5,
   while extensions are still activating and views are still rendering.

### Proposed Solutions (prioritized)

#### Option 1: Cooperative yielding in all indexing loops
**Impact: HIGH | Effort: LOW (~10 lines)**

Add `await new Promise(r => setTimeout(r, 0))` between page iterations in
`_indexAllPages()` and between batches in `_embedChunks()`. The directory walker
already yields every 200 entries — extend the same pattern to pages and
embedding batches. This alone would eliminate the "Not Responding" dialog for
most workspaces.

#### Option 2: Deferred start with idle scheduling
**Impact: HIGH | Effort: LOW (~15 lines)**

Instead of starting the pipeline immediately after DB open, wait for
`requestIdleCallback` or a fixed 2–3s delay after Phase 5 completes. This lets
the workbench fully settle — sidebar renders, editor opens, tool activations
finish — before any indexing work begins. The user sees a responsive app
immediately; indexing starts silently once idle.

#### Option 3: Move indexing pipeline to a Web Worker
**Impact: HIGHEST | Effort: MEDIUM (significant refactor)**

The pipeline's work is entirely non-DOM: content hashing, chunking, `fetch()`
to Ollama, IPC to SQLite. All of this can run in a Web Worker, completely
decoupling indexing from the UI thread. The renderer would only receive progress
events and "indexing complete" notifications.

Challenge: The pipeline currently uses `IDatabaseService`, `IFileService`, etc.
through direct service references. In a Worker, these would need to be proxied
via `postMessage`. The pipeline already communicates through a clean interface
(`IIndexingPipelineService`), which helps.

#### Option 4: Throttle and batch IPC writes
**Impact: MEDIUM | Effort: LOW (~30 lines)**

Each `_indexSinglePage` and `_indexSingleFile` calls `vectorStore.upsert()`
which fires IPC to the main process. Under heavy load, this creates an IPC
storm. Batching — queue upserts and flush every 500ms or every 10 items — would
reduce contention. The vector store already supports `runTransaction`.

#### Option 5: Index-on-demand for pages (lazy indexing)
**Impact: MEDIUM | Effort: MEDIUM**

Pages are already in SQLite. They don't need pre-embedding for the app to work
— they only need embeddings when someone performs a RAG query. Instead of
indexing all pages at startup:
- Index pages lazily on first retrieval query
- Or index only pages the user opens
- Background-index the rest during idle time

This cuts startup indexing work roughly in half for page-heavy workspaces.

### Recommendation

Implement Options 1 + 2 first (cooperative yielding + deferred start). These
are low-risk, high-impact fixes that eliminate the worst symptom. Then evaluate
Option 3 (Web Worker) as a dedicated milestone — it's the permanent fix but a
bigger commitment.

---

## Startup Performance — Pre-Indexing Bottlenecks

### Problem

Slowness and UI unresponsiveness occur **before** the indexing pipeline starts.
The 5-phase lifecycle runs dozens of sequential IPC round-trips, blocking DB
operations, and synchronous DOM construction that all compete for the renderer
thread.

### Full Pre-Indexing Startup Sequence

#### Phase 1 — Services (`_initializeServices`)

All async, all blocking. Each `await` is an IPC round-trip to Electron main.

| Step | Operation | I/O |
|------|-----------|-----|
| 1 | Read `data/last-workspace.json` via storage bridge | IPC read |
| 2 | Construct `FileBackedWorkspaceStorage` (lazy, no I/O yet) | — |
| 3 | `migrateFromLocalStorage()` — fast after first run (sentinel check) | localStorage read |
| 4 | `initUserThemesCache()` — reads theme data from global storage | IPC read |
| 5 | `registerUnifiedAIConfigService()` → `_loadPresets()` + `_loadWorkspaceOverride()` | 2–4 IPC reads, possible legacy migration + persist writes |
| 6 | `lms.setStorage()` — reads language model defaults | IPC read |
| 7 | `agentTaskStore.setStorage()` + `agentApprovalService.setStorage()` | IPC reads |

#### Phase 2 — Layout (`_initializeLayout`)

Synchronous DOM construction. Builds the grid system and assembles the shell.
Fast individually but contributes to total blocking time.

#### Phase 3 — Parts (`_initializeParts`)

Synchronous. Creates titlebar, sidebar views, panel views, status bar, DnD
controller, command system, context system. Heavy DOM work but no I/O.

#### Phase 4 — Workspace Restore (`_restoreWorkspace`)

**Potentially slow.** Multiple sequential awaits:

| Step | Operation | I/O | Risk |
|------|-----------|-----|------|
| 1 | `WorkspaceLoader.load()` | IPC read | Low |
| 2 | `_applyRestoredState()` — reconstructs part visibility, sizes, grid | Sync DOM | Low–Medium (complex layout recalc) |
| 3 | `_reconcileDurableWorkspaceId()` | IPC `fs.exists` + `fs.readFile` | Low |
| 4 | **`_restoreEditors()`** — opens each saved tab with `await openEditor()` | **Sequential await per tab** | **HIGH — scales with open tab count** |
| 5 | `_workspaceSaver.save()` + `_recentWorkspaces.add()` | IPC writes | Low |
| 6 | `_startWorkspaceFolderWatchers()` | IPC `fs.watch` per folder | Low |
| 7 | `_configService.load()` | IPC read | Low |

#### Phase 5 — Ready (`_initializeToolLifecycle`), before indexing

**Most likely bottleneck phase.** Contains the heaviest operations:

| Step | Operation | I/O | Risk |
|------|-----------|-----|------|
| 1 | Contribution processors + structural keybindings | Sync | Low |
| 2 | `_toolEnablementService.load()` | IPC read | Low |
| 3 | **`_openDatabaseForWorkspace()`** — opens SQLite, enables WAL, loads `sqlite-vec` native extension | **IPC → main process, native module load** | **MEDIUM** |
| 4 | **`consolidateOrphanedSessions()` + `chatService.restoreSessions()`** | **N+1 SQLite queries (1 for sessions + 1 per session for messages)** | **HIGH — scales with chat history size** |
| 5 | `_startIndexingPipeline()` — fire-and-forget | Background | — (indexing starts here) |
| 6 | **`_registerAndActivateBuiltinTools()` — 12 tools via `Promise.allSettled`** | Canvas runs SQL migrations via IPC; others register views/commands | **MEDIUM** |
| 7 | **`_discoverAndRegisterExternalTools()`** — scans `data/extensions/` | IPC filesystem scan | **LOW–MEDIUM** |
| 8 | `fireStartupFinished()` — triggers `onStartupFinished` tool activations | Varies | Low |

### Top Bottleneck Candidates

1. **`restoreSessions()` — N+1 DB queries.** Loads every chat session and every
   message in each session from SQLite. For a user with 50 sessions averaging
   20 messages each, that's 51 sequential queries. The query pattern is:
   `SELECT ... FROM chat_sessions` then `SELECT ... FROM chat_messages WHERE session_id = ?`
   per session. (`src/services/chatSessionPersistence.ts:176`)

2. **`_restoreEditors()` — sequential `await openEditor()`.** Each saved editor
   tab is opened one at a time. Each `openEditor()` may trigger pane creation,
   input deserialization, and view state restore. With 10+ tabs, this adds
   meaningful serial latency. (`workbench.ts:1444`)

3. **`_openDatabaseForWorkspace()` — SQLite + sqlite-vec.** The main process
   opens the database file, enables WAL mode, enforces foreign keys, and loads
   the `sqlite-vec` native extension. The native extension load is a one-time
   cost per process but still I/O-bound. (`electron/database.cjs:36`)

4. **12 builtin tool activations.** Run as `Promise.allSettled` so they
   parallelize, but Canvas activation runs SQL migrations synchronously on the
   main process thread via IPC. Other tools do DOM registration.
   (`workbench.ts:2599`)

5. **Accumulated IPC round-trips.** Phases 1–5 make dozens of individual
   `await bridge.readJson()` / `await fs.exists()` / `await db.all()` calls.
   Each is a renderer→main→renderer round-trip. Even at 1–2ms each, 40+ calls
   add 40–80ms of pure IPC overhead.

### Potential Solutions (not yet planned)

- **Batch `restoreSessions` into a single query** — JOIN sessions + messages in
  one SQL statement, parse in JS. Eliminates N+1 pattern.
- **Parallelize `_restoreEditors`** — open all tabs concurrently with
  `Promise.all` instead of sequential `await`. Activate only the visible one.
- **Batch IPC reads** — combine multiple `storage.readJson` calls into a single
  multi-read IPC message. Requires new IPC handler but cuts round-trips.
- **Defer chat restore** — load session metadata only; lazy-load messages when
  the user opens a session. Most sessions are never re-read.
- **Preload database in Electron main** — start SQLite open + WAL + sqlite-vec
  load during `app.ready`, before the renderer even connects. The DB is ready
  by the time Phase 5 asks for it.
