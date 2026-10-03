# Parallx systems-efficiency audit (machinery, not surface UI)

> Part of the 2026-10-03 whole-app audit. What was fixed after this report was written is listed in [`docs/APP_AUDIT_2026-10-03.md`](../../APP_AUDIT_2026-10-03.md) §1; read that first. Paths under a `scratchpad/` folder (probe scripts, screenshots) belonged to the audit session and were not kept.

Audited at branch `fix/light-mode-and-accent-contrast`, commit `b98427ef`
(2026-10-03). No repo files were edited. Every claim below was checked by
reading code; file:line references are to that commit. Quantities are
derived from code (counts of queries, timers, calls); wall-clock figures
are estimates and are labelled as such. Nothing here was profiled in a
running app. Before shipping any fix, measure with the app-sweep probe or
DevTools Performance.

Already fixed, checked, and not repeated here: chat-session restore is
lazy (`chatSessionPersistence.ts:593-630`, `messagesPendingLoad`); a
session save is one transaction (`chatSessionPersistence.ts:250-262`);
editor restore activates owning tools concurrently
(`workbench.ts:1834-1870`); the first indexing pass waits for
requestIdleCallback (`indexingPipeline.ts:627`); page and file mtime fast
skips are on; upserts are batched (B4); install storms are cut in the main
process by `WATCH_IGNORE_SEGMENTS`; SQLite runs on a worker thread, not
the main thread; the model broker has a real cancel, a lease and
preemption.

---

## 0. Ranked summary (top 15)

| # | Finding | Who it hits / what you notice | Effort |
|---|---|---|---|
| 1 | The system prompt carries a **timestamp to the second** and sits before the whole chat history, so the KV/prompt cache for the history is thrown away on **every chat turn** | Every chat user. Time-to-first-token grows with chat length (a 20K-token chat re-prefills ~20K tokens every turn, roughly 7-15 s on a consumer GPU). Cloud prompt caching breaks the same way. | S |
| 2 | **Workspace Graph** sidebar view is mounted at boot. It runs a **60 fps rAF loop forever**, reallocates its canvas every frame, reheats an **O(n²) physics** run every 30 s even while hidden, re-walks the file system and polls every provider every 30 s, and rebuilds on every canvas autosave | Every user. Idle CPU, GPU and battery. With large workspaces (thousands of nodes), multi-second main-thread bursts every 30 s. | S-M |
| 3 | **Diagnostics re-runs every health check every 30 s, forever**, including a real `/api/embed` call, `/api/tags`, `/api/version`, SQL counts and a memory-table read. Only the usually hidden Diagnostics tab reads the results. | Every user. Wakes the GPU and keeps nomic-embed-text resident permanently. On tight VRAM it can push the chat model out, so the next turn reloads it. | S |
| 4 | **MIND prediction loop** runs on every workspace file change, **even with the heartbeat off**. Each change causes about **6 full rewrites of `workspace-state.json`**, including a 1000-record ledger stored as a JSON string. | Anyone who edits files or runs git in the workspace. Each save causes 6 whole-file serialisations and writes. A `git checkout` of 500 files queues about 3000. | S |
| 5 | **Incremental indexing takes events from every watcher and skips the dot-dir and transcript rules.** After each chat turn the session `.jsonl` is re-chunked and re-embedded even though transcript indexing is **off**. Photos landing in a media library outside the workspace are OCR'd and embedded, then purged at the next launch. | Every chat user: GPU work and a full vector-table scan after each turn, and retrieval polluted by old transcripts. Media users: OCR churn. | S |
| 6 | **Startup critical path.** (a) Docling detection runs `execSync` in the **main process** at every launch and every workspace switch, and spawns a Python server eagerly. (b) Four `"*"` extensions (about 2.9 MB of JS loaded from blob URLs with no code cache, including media-organizer at 1.95 MB) are **awaited before the loading overlay is removed**. | Every launch. While execSync runs, the main process serves no IPC. The overlay waits on extension activation. | S |
| 7 | **Proactive Suggestions** is on by default. While you edit pages it makes up to about **100 Ollama embed calls plus 100 brute-force KNN scans every 5 minutes or less**, and nothing consumes the result: no UI, tool or extension, only two uncalled commands. | Every user who edits pages. GPU contention and DB-worker time spent for nothing. | S |
| 8 | **One SQLite worker serves every database.** There is no prepared-statement cache, default page cache only, and every reindex deletes by **unindexed vec0 and FTS aux columns** (two full-table scans per page save and per file reindex). | Head-of-line blocking: chat retrieval, canvas saves and budget reads queue behind media scans and semantic-graph KNN. It gets worse as the index grows. | M |
| 9 | **Media-organizer:** the relaunch delta scan does **3 IPC queries per unchanged file**. During imports, every file triggers a full-library grid query (4 correlated subqueries per library row before the sort) and an **undebounced sidebar reload**. | Large libraries: minutes of DB-worker saturation after each launch. Grid and sidebar jank during camera-roll imports. | M |
| 10 | **Per-turn retrieval runs twice.** The RAG lane and the memory lane each embed the same query and each run KNN + FTS. The memory lane post-filters a 2x over-fetch and rarely hits. MEMORY.md is included twice (bootstrap and memory lane). | Every chat turn: 2 embeds and 2 brute-force vector scans before the first token, and duplicated prompt tokens. | S-M |
| 11 | **Extension LLM batch work runs at "interactive" priority.** This covers budget sync, media AI tagging runs and flashcard generation. Budget sync makes 1-3 **uncapped thinking-model calls per email**. | Your chat competes head-to-head with a 100-email sync or a 300-photo tagging run. A sync can take hours. | S (priority) / M (pipeline) |
| 12 | **Chat streaming:** the session sidebar list and the agent-task rail are rebuilt on **every animation frame**, and the last markdown part is re-parsed every frame (O(n²) over the answer). | Jank on long answers when there are many sessions. | S |
| 13 | **Background throttling is off for the main window**, and about 12 always-on timers ignore visibility: Ollama poll (**every 5 s forever** if Ollama was never seen), two Agents 30 s log-file reads, indexing-log 1 Hz, cron, workflows, planner, MCP pings, dashboard clocks. | Battery and wakeups while minimised or idle. | M |
| 14 | **Launch-time re-extraction.** A file skipped because its hash matched, or because it yielded no text (photos, scanned PDFs), never gets `indexed_at` bumped, so it is re-read, re-extracted or re-OCR'd at **every launch**. Digital PDFs are extracted twice (legacy pre-check, then Docling). | Workspaces with images or PDFs: CPU and disk at every launch, OCR when Docling is installed. | S |
| 15 | **The renderer's embedding cache is unbounded** (about 6.3 KB per chunk, never evicted). | First full index of a big workspace: 100K chunks is about 630 MB of renderer heap. | S |

Further findings, ranked lower: budget redraw storms and N+1 queries
(§3.3); the browser extension polls the DOM every frame (§3.5); the
dashboard cron scheduler duplicates the cron code and **fires in UTC**
(§7, a correctness bug); the autonomy log appends by rewriting the day
file, and FileBackedStorage rewrites the whole JSON on every `set` (§2.6);
the explorer re-reads the whole tree on every change and can drop updates
(§3.4); the model-list refresh can fail a request mid-run (§8); listeners
leak in the media sidebar (§4.3).

---

## 1. Timers and polling

### 1.1 Idle-cost ledger (window open, user doing nothing)

`backgroundThrottling` is **false** for the production main window
(`electron/main.cjs:639-648`, `PROBE_BACKGROUND` is false unless a test
env var is set). This is deliberate: media ingest, chat streaming and
automations keep running while minimised. The consequence is that every
renderer timer below runs at full rate while the window is minimised or
covered. Electron documents that this flag also affects the Page
Visibility API, so the few `document.hidden` / `visibilityState` checks
that exist (`ext/browser/main.js:777`, `tabBar.ts:370`, `glide.ts:15`,
`partMotion.ts:54`, `worksheet/main.ts:248`) are likely never true. Verify
this on the target Electron version.

| Timer | Where | Period | Work per tick | Runs when hidden? |
|---|---|---|---|---|
| Ollama health | `chat/providers/ollamaProvider.ts:119-125, 966-987` | 30 s connected; **5 s forever if Ollama was never reachable** (backoff needs `_hasEverConnected`, line 979); 60 s after 5 failures | GET `/api/version` + GET `/api/ps` | yes |
| Provider recheck | `chat/data/chatDataService.ts:717, 774` | 5 s while no provider is usable | `checkAvailability()` on every non-Ollama provider (IPC `hasKey`) | yes |
| **Diagnostics** | `built-in/diagnostics/main.ts:42, 85` | **30 s, always** | All checks (§5.3): `/api/version`, `/api/tags`, **`/api/embed`**, `getStats` (2 SQL), `getAllMemories` (1 SQL), root `readdir`, `exists(AGENTS.md)`, keybinding-conflict scan | yes |
| Agents status item | `built-in/agents/agentsPresence.ts:123` | 30 s + every change | `readSnapshot` → autonomy rail `readRows` → **flush + `exists` + `readFile` + JSON-parse of today's whole ndjson** (`autonomyEventLog.ts:297-306`) + `heartbeat.status` command | yes |
| Agents view | `built-in/agents/main.ts:437` | 30 s + every change | Same snapshot read plus a full DOM rebuild. The view mounts at boot (header of `lazyActivationCompliance.test.ts`), so it ticks while hidden. | yes |
| Indexing log rebind | `built-in/indexing-log/main.ts:187` | **1 s, forever** | `services.has/get` probe that could be an event | yes |
| Workspace graph refresh | `ext/workspace-graph/main.js:2846` | 30 s | Full graph rebuild (§3.1) | yes |
| Workspace graph render | `ext/workspace-graph/main.js:2716-2742` | **every frame** | rAF + physics + canvas draw (§3.1) | yes (rAF stops only when Chromium stops producing frames) |
| Cron | `openclaw/openclawCronService.ts:37, 567` | 60 s | In-memory due check | yes |
| Workflows | `services/workflows/workflowService.ts:37, 328` | 60 s | In-memory due check | yes |
| Planner reminders | `built-in/planner/plannerReminderScheduler.ts:18, 31` | 60 s | 1 indexed SQL | yes |
| Planner sync | `built-in/planner/sync/plannerSyncOrchestrator.ts:36, 97` | 5 min | No-op without an account, otherwise a Google reconcile | yes |
| MCP pings | `openclaw/mcp/mcpClientService.ts:27, 383` | 30 s per server | JSON-RPC ping through IPC to the child process | yes |
| Canvas checkpoints | `built-in/canvas/canvasDataService.ts:221` | N min | No-op unless pages are dirty | yes |
| Adblock lists (main process) | `electron/browserBridge.cjs:47, 345-346` | 1 h + at startup | Re-deserialises the engine and reinstalls webRequest handlers on every session, **even when the cache is fresh** | n/a (main) |
| Dashboard widgets | `clockAndLinksWidget.ts:141`, `countdownWidget.ts:135`, `companionWidget.ts:249`, `yearProgressWidget.ts:410`, `quoteWidget.ts:109` | 1 s to 10 min | Text updates | yes, while the dashboard is open |

Duplicate pollers of the same thing:

- **Ollama liveness** is checked by `OllamaProvider._pollHealth`
  (`/api/version`), by Diagnostics (`checkProviderStatus` →
  `checkAvailability`, the same request again), and by flashcards
  (`ext/flashcards/main.js:2278`, which hardcodes `localhost:11434` and
  ignores the configured base URL).
- **Model list** comes from `LanguageModelsService` (cached) and also
  from Diagnostics, which calls `_ollamaProvider.listModels()` directly
  every 30 s and bypasses the cache (`chat/main.ts:1348-1351`).
- **The autonomy history file** is read by two consumers (Agents
  presence and the Agents view) on independent 30 s timers. A third
  consumer, `onAnyChange`, re-reads it on every rail, log or config event
  (`agentsServices.ts:141-167`).

**Fixes**

- (S) Add one `IWindowVisibilityService`, fed from main-process
  `minimize/restore/show/hide/blur/focus` events (VS Code does the
  same). Gate the cosmetic timers on it: diagnostics, Agents ×2, graph,
  dashboard clocks, indexing-log.
- (S) Ollama: back off even if Ollama was never reached (5 s → 60 s
  after N failures). Diagnostics and flashcards should read
  `getLastStatus()` instead of fetching.
- (S) Indexing-log: replace the 1 Hz probe with an
  `onDidChangeIndexingPipeline` event. The workbench already knows when
  it calls `_startIndexingPipeline`.
- (S) Agents: share one snapshot reader with a 1 s memo and serve
  `readDay` for today from `_dayContentCache` instead of disk.
- (S) Adblock: when the engine file is fresh, skip `loadLists` on the
  hourly tick.

---

## 2. Data access

### 2.1 One SQLite worker for every database (head-of-line blocking)

- `electron/databaseClient.cjs:27-60` spawns a **single**
  `worker_threads` Worker. `databaseWorker.cjs:24-25` hosts both the
  workspace DB and every extension DB (`ExtensionDatabaseManager`) in
  that one thread. Every query from every surface is serialised through
  it.
- Long operations therefore block short ones:
  - semantic-graph KNN (brute force over all vectors);
  - the media-organizer delta scan (§2.4), about 150K queries on a
    50K-file library;
  - the vec0 aux-column scans on reindex (§2.2);
  - the media grid union query (§2.4).
  A chat turn's retrieval query, or a canvas autosave, waits behind
  whatever is queued.
- No prepared-statement cache: every call runs `this._db.prepare(sql)`
  (`database.cjs:189, 201, 213, 243, 501, 506, 511, 533`). Parse and plan
  are repeated for hot statements (vector search SQL, grid queries,
  per-file scan queries).
- Pragmas are WAL, `synchronous=NORMAL` and `temp_store=MEMORY`
  (`database.cjs:61-67, 381-385`). `cache_size` (default about 2 MB) and
  `mmap_size` are not set. The page cache is small for a vec table
  holding 768-float rows.

**Fixes**

- (M) Use one worker per database file: workspace DB and each extension
  DB. A cheaper first step is two workers: the workspace DB in one, all
  extension DBs in the other. WAL lets readers run concurrently.
- (S) Add an LRU of about 200 `Statement`s per DB, keyed by SQL text.
- (S) Set `cache_size=-65536` (64 MB) and `mmap_size=268435456` on open.

### 2.2 Vector store: every reindex scans whole tables

- `vec_embeddings` is a vec0 table whose `source_type` and `source_id`
  are **auxiliary (`+`) columns** (`db-migrations/009_fix_vec0_compat.sql`).
  Aux columns have no index.
- `_buildUpsertOps` (`vectorStoreService.ts:291-301`) runs
  `SELECT rowid FROM vec_embeddings WHERE source_type=? AND source_id=?`.
  That is a **full scan of the aux shadow table**, followed by one
  `DELETE ... WHERE rowid=?` per old chunk.
- It also runs `DELETE FROM fts_chunks WHERE source_type=? AND
  source_id=?` (line 280). Both columns are `UNINDEXED` in FTS5
  (`008_vector_embeddings.sql`), so this is a second full scan.
- `getSourceCentroid` (line 782) scans the same way. The semantic graph
  calls it for every changed source.
- These run on every page reindex (3 s after an edit,
  `indexingPipeline.ts:52`), every file reindex, every `deleteSource`, and
  per transcript after every chat turn (§6.2). Cost grows linearly with
  total chunk count.

**Fix (M):** `chunk_metadata` already exists with an index on
`(source_type, source_id, chunk_index)` (`011_retrieval_metadata.sql`) and
`chunk_id` = vec rowid. Look rowids up there:
`SELECT chunk_id FROM chunk_metadata WHERE source_type=? AND source_id=?`.
Delete vec rows by rowid, and delete FTS rows by rowid too (make the FTS
rowid equal the vec rowid). The centroid read should also go through
`chunk_metadata` → rowids → `vec_embeddings WHERE rowid IN (...)`.

### 2.3 Budget (ext/budget)

- **N+1 in `readMonthBills`** (`main.js:6301-6338`): one query lists the
  series, then one query per series (line 6308). Each per-series query
  uses `LOWER(COALESCE(t.merchant,'')) LIKE '%' || ? || '%'` OR an
  `IN (subquery)`. The leading wildcard means it scans the month's rows
  once per series.
- `readMonthPlan` = `evalBudgetStatus` (1) + spent (1) + bills (1 + N).
  So **3 + N IPC queries** per call (`main.js:6363-6379`).
- **Duplicate readers.** The sidebar glance (`main.js:1229-1251`), the
  open page (`main.js:3103`, `4358`) and the MTD dashboard widget each
  call it independently.
- **Every `notifyLedgerChanged()` re-runs all of them.** There are 13
  listener sites (`main.js:1249, 2333, 2825, 3038, 3097, 3826, 4015,
  4114, 4233, 4581, 4701, 5018, 5152`), and the review page fires it after
  every verdict (`main.js:2802`). So one review click costs about
  2 × (3 + N) + the review page's own reads.
- The sidebar `refresh()` has no in-flight or sequence guard. Only a few
  pages do (`drawSeq` at 2452, `seq` at 2173 and 4320). The others can
  paint a stale result over a fresher one.
- **Sync loop:** one `SELECT 1 FROM email_imports WHERE gmail_message_id=?`
  per email (`main.js:6987`), and every write is its own `db.run` IPC
  with no transaction.
- **Missing index:** `transactions.gmail_message_id` (used in
  `DELETE FROM transactions WHERE gmail_message_id=?`, `main.js:7116`,
  and as the FK target of `email_imports` deletes).

**Fixes**

- (S) Compute bills in one query: a CTE of series, joined to month
  transactions on the occurrence link or the pattern, grouped by series
  id.
- (S) Memoise `readMonthPlan(monthKey)` keyed by a ledger version
  counter that `notifyLedgerChanged` bumps. Coalesce listener refreshes
  to one per frame.
- (S) Batch the email-id check:
  `SELECT gmail_message_id FROM email_imports WHERE gmail_message_id IN (...)`
  for the page of messages. Wrap each email's writes in `runTransaction`.
- (S) Add `CREATE INDEX tx_gmail_idx ON transactions(gmail_message_id)`.

### 2.4 Media organizer (ext/media-organizer)

- **Relaunch delta scan.** `runDeltaScan` (`main.js:3618-3700`) runs at
  every launch, kicked by rIC (`main.js:3741-3752`). It walks every scan
  root, then calls `processFile` for **every** file on disk.
  `processFileNow` (`main.js:2736-2780`) does, for an unchanged file:
  `FileQueries.findByFolderAndName` + `FingerprintQueries.findByFile` +
  `ImageFileQueries/VideoFileQueries.findByFileId`. That is **3 IPC
  round trips per unchanged file**, plus a `setTimeout(0)` yield every 10
  files. A 50K-file library costs about 150K IPC queries and 5K timers at
  every launch, all on the shared DB worker (§2.1).
  **Fix (M):** one bulk query per root:
  `SELECT f.id, fo.path, f.basename, f.mod_time, EXISTS(fp), EXISTS(meta)`
  for all files under the root. Diff in memory, and call `processFile`
  only for new, changed or incomplete entries.
- **Import storms.** For each created file in a watcher batch,
  `drainWatcherQueue` (`main.js:3485-3487`) calls `_notifySidebarRefresh()`
  and dispatches `mo:refresh-grid`.
  - The grid handler is debounced to 200 ms (`main.js:13810-13826`), but
    each create takes 1-30 s (hash, ffprobe), so it reloads the grid once
    per imported file.
  - The sidebar callback `refreshAll` (`main.js:11725`) is **not
    debounced**. It runs `loadFolders` + `loadTags` + `loadAlbums` +
    `loadSmartAlbums` + counts per file.
- **Grid query shape.** The library "all media" query (`main.js:12936-12946`)
  is a `UNION ALL` subquery. Each arm computes 4 correlated subqueries
  per row (`photoSizeExpr` plus `MO_PHOTO_EXTRA_COLS` width, height and
  is-gif, `main.js:11743`) **for every row in the library** before the
  outer `ORDER BY ... LIMIT ? OFFSET ?`. A separate `COUNT(*)` query runs
  every page.
  **Fix (M):** first select `(media_type, id, sort key)` ORDER BY + LIMIT
  (keyset, not OFFSET), then fetch the extra columns for the page of ids.
  Or denormalise `primary_width/height/size/is_gif` onto
  `mo_photos/mo_videos`.
- `moTagOnePhoto` re-reads the whole tag tree (`moTagTree()`) and two
  settings per photo during an AI tagging run (`main.js:30525`).
  Minor.
- At startup, `activate` runs `COUNT(*)` over `mo_photos_fts` and
  `mo_videos_fts` (`main.js:38337-38341`). An FTS COUNT is a full scan.
  It runs async, but on the same DB worker during boot.

### 2.5 Chatty IPC on hot paths

- Each chat turn reads the bootstrap files sequentially: 5 files plus up
  to 3 memory paths, each an awaited IPC
  (`openclawParticipantRuntime.ts:124-150`). Also `exists` + `readFile`
  pairs in `recallMemories` (`chatDataService.ts:1350-1400`). Use
  `Promise.all`. (S)
- `canvasDataService.updatePage` re-reads the whole page after every
  autosave UPDATE (`canvasDataService.ts:479`, `getPage`). That is a full
  content round trip per 500 ms debounce that could be built from the
  update. (S)
- Synchronous fs in the main process on hot paths: mostly clean. The
  renderer HTTP server uses `readFileSync` per request
  (`electron/main.cjs:362`), which is startup only. The real
  main-process blocker is Docling's `execSync` (§4.1).

### 2.6 Whole-file rewrites

- **`FileBackedStorage.set/delete`** (`platform/fileBackedStorage.ts:98-127`)
  queues a write of the **entire** store, pretty-printed with
  `JSON.stringify(data, null, 2)` (`storageHandlers.cjs:96`). There is no
  coalescing: 10 sets in a tick produce 10 full serialisations, 10 IPC
  calls and 10 disk renames. This amplifies §5.5 (MIND).
  **Fix (S):** coalesce with a microtask or a 50-100 ms trailing debounce
  (latest snapshot wins), and write compact JSON.
- **Autonomy event log** (`services/autonomyEventLog.ts:356-390`) appends
  by building `existing + appended` and calling `writeFile` on the whole
  day file. That is O(n²) over a day, and the whole day stays in memory.
  `readDay` (line 297) re-reads the file from disk even when
  `_dayContentCache` holds it.
  **Fix (S):** use an append IPC (`fs.appendFile`), and parse today's
  records from the cache.
- **Chat transcripts:** every completed turn rewrites the whole session
  `.jsonl` (`workspaceTranscriptService.ts:109-116`, called from
  `chatService.ts:991`), alongside delete-all/re-insert-all in SQLite. The
  rewrite also feeds the indexer (§6.2).

---

## 3. Rendering

### 3.1 Workspace Graph (ext/workspace-graph)

- The view `view.workspaceGraph` is contributed into `view.explorer`
  (`parallx-manifest.json`) and mounts at boot. `createGraphSidebar`
  sets `_model._api` (`main.js:2617`), and nothing ever clears it.
  `_model.refresh()` therefore runs from then on.
- **The rAF loop never stops** (`main.js:2725, 2741`). Every frame it
  runs `physicsTick` (when the editor is not open) and `drawGraph`.
  - `drawGraph` (`main.js:1181-1188`) reads `clientWidth/clientHeight`
    and **assigns `cvs.width/cvs.height` every frame**. That reallocates
    and clears the canvas backing store 60 times a second.
  - When the section is collapsed or hidden, w < 2 returns early, but
    the rAF and the layout read continue.
- **Physics:** `resetSimulation()` sets `_alpha = 1` on every refresh
  (`main.js:242, 278`). With `ALPHA_DECAY` about 0.0228 and
  `ALPHA_MIN = 0.001` (`main.js:231-232`), that is about **300 ticks of
  O(n²) repulsion** (`main.js:351-360`).
  - The 30 s timer (`main.js:2846`) does this **every 30 s, visible or
    not**.
  - n = 2,000 nodes is about 2M pair evaluations per tick × 300 ticks per
    cycle. Estimate: several seconds of busy main thread per 30 s.
- **Each refresh** (`buildGraphData`, `main.js:631-679`) does:
  - an IPC `readdir` per directory down 3 levels;
  - a page-tree query;
  - `readdir` of the sessions and memory directories;
  - one `snapshot()` per registered provider (budget, media-organizer and
    creations-ai, each running DB queries);
  - a full recompute of the link parameters.
- `api.workspace.onDidChangeCanvasPages(() => m.refresh())`
  (`main.js:2746`) is **not debounced**. Every canvas autosave fires an
  `Updated` event (`canvasDataService.ts:488`), so every pause in typing
  rebuilds the graph. The bridge drops `changedFields`
  (`workspaceBridge.ts:270-275`), so the graph cannot tell a content-only
  save from a title change.

**Fixes**

- (S) Stop the rAF loop when `_alpha < ALPHA_MIN` and nothing is being
  dragged or hovered; restart it on an interaction or a model change.
- (S) Size the canvas only from a `ResizeObserver`.
- (S) Pause everything while the view is hidden or collapsed
  (`onDidChangeVisibility` exists on views).
- (S) Do not `resetSimulation` when the node set is unchanged.
- (S) Route canvas events through `_scheduleRefresh`, and forward
  `changedFields` so content-only saves are ignored.
- (M) Replace the 30 s poll with file and provider events. Use a
  Barnes-Hut or grid approximation above about 500 nodes.

### 3.2 Chat streaming

- `chatWidget.ts:441-456`: on every rAF-coalesced `onDidChangeSession`
  (about once per streamed chunk, capped at the frame rate),
  `_renderMessages()` and `this._sessionSidebar.refresh()` both run.
  - `refresh()` → `_renderSessionList()` (`chatSessionSidebar.ts:266, 305-306`)
    sets `innerHTML = ''` and rebuilds **every session row**, with
    listeners, whether or not the sidebar is visible.
  - `_renderMessages` also calls `_renderAgentTasks()`
    (`chatWidget.ts:1095-1102`), which runs `replaceChildren()` on the
    task rail every frame. Unlike `_renderPlanCard`, it has no
    signature check.
  - The incremental update re-renders the whole last markdown part
    (`chatListRenderer.ts:394-433` → `_refreshPart`). That is O(answer
    length) per frame and O(n²) per answer.
  - `chip.refresh()` is called on every chunk without throttling
    (`chatWidget.ts:401`). It is cheap, but it writes `title` and
    `textContent` each time.

**Fixes (S)**

- Refresh the sidebar only when the session list or titles change (fire
  a separate event), and skip it when the sidebar is hidden.
- Put a signature check on the task rail.
- For markdown: re-render only the last block. Split on the last
  top-level block boundary, keep the earlier blocks' DOM, and re-parse
  only the tail.

### 3.3 Budget redraws

See §2.3. Every `notifyLedgerChanged` rebuilds each open page and the
sidebar from scratch, each with its own `readMonthPlan`.
Sync `progress` events touch only the sidebar status text (good).
`complete` refreshes 5 listeners (`main.js:2332, 2824, 3096, 4014, 4582,
5019`).

### 3.4 Explorer

`explorer/main.ts:195-210`: any batch with a non-`.parallx` path
re-`readdir`s **every expanded directory** after a 1.5 s quiet window and
rebuilds the whole tree DOM (`main.ts:456`, no virtualization). The
change paths are known, so only their parent directories need reloading.

`refreshTree` (`main.ts:1467-1493`) returns early when a refresh is
already running and records no pending flag. **Changes that arrive
mid-refresh are lost** until the next event.

**Fix (S):** refresh only the dirty parent nodes, plus a pending-rerun
flag.

### 3.5 Browser extension: per-frame DOM polling

`ext/browser/main.js:769-787` runs a permanent rAF loop per browser pane
that has a native view. Each frame it calls `getBoundingClientRect`,
reads `offsetParent` (forced layout), and while visible calls
`coveredBy`. `coveredBy` makes **up to 16 `document.elementFromPoint`
hit tests per frame** (`main.js:737-748`) to detect overlays. It also
re-queries all `.grid-sash` rects whenever the rect changes.

**Fix (M):** use a `ResizeObserver` and an `IntersectionObserver` for
bounds. For overlays, subscribe to the interaction-mode stack
(`ui/interactionMode.ts`) or to a `MutationObserver` on the overlay
root.

### 3.6 Media grid

There is one `ResizeObserver` **per tagged card** (`main.js:9594-9599`).
Each one reads `scrollWidth/clientWidth` and then toggles a class, which
interleaves reads and writes across cards. The observers are never
disconnected (`_moTagsResizeObserver` is assigned, never used again).
**Fix (S):** one shared observer and batched reads then writes.

---

## 4. Lifecycle and startup

### 4.1 Docling detection blocks the main process (every launch, every workspace switch)

- `registerIndexingServices` creates a new `DocumentExtractionService`
  and calls `initialize()` (`workbenchServices.ts:328-335`). This runs at
  startup **and on every `_startIndexingPipeline`**, which happens on
  every workspace switch (`workbench.ts:3730-3755`).
- `initialize` → IPC `docling:start` (`main.cjs:2425`) →
  `startService` (`doclingBridge.cjs:249-265`). That calls:
  - `detectPython()`, which runs `execSync('<cmd> --version')` for up to
    3 candidates, each with a 5 s timeout (`doclingBridge.cjs:94-120`);
  - `checkDoclingInstalled()`, which runs
    `execSync('python -c "import docling..."')` with a 10 s timeout
    (`doclingBridge.cjs:131-146`).
  - The negative result is not cached across calls.
- `execSync` blocks the Electron main process. While it runs there is no
  IPC (every renderer DB query and file read stalls), no window
  move/resize and no repaint of native UI. This happens during
  Phase 5, while tools are activating.
- When Docling **is** installed, a Python HTTP server is spawned at
  every launch, whether or not any rich document needs extracting.
- There are two independent Python detectors: this one, and
  `pythonBridge.detectSystemPython` (`pythonBridge.cjs:213-250`, also
  `execFileSync`). They use different candidate orders and can disagree.

**Fix (S):** make detection async (`execFile`) and cache it on disk,
keyed by the interpreter path and mtime. Reuse `pythonBridge`'s
detector. Start the Docling server lazily on the first rich-document
extraction.

### 4.2 Extension activation on the critical path

- External tools with `"*"` are awaited before the loading overlay is
  dismissed (`workbench.ts:4112-4140`, then overlay removal at the end
  of `_initializeToolLifecycle`):
  - browser (229 KB);
  - flashcards (588 KB);
  - **media-organizer (1.95 MB)**;
  - web-research (139 KB + 92 KB `readability.js`).
- External modules are loaded by reading source over IPC and importing
  from **blob URLs** (`toolModuleLoader.ts:185-235`). Blob URLs are not
  eligible for Chromium's persistent V8 code cache, so these modules
  are parsed and compiled from scratch at every launch.
- 17 of 18 built-ins are eager and awaited
  (`workbench.ts:3948-4027`; lazy-only: theme-editor).
- The renderer bundle is served by a local HTTP server with
  `Cache-Control: no-cache` and no validators (`main.cjs:351-366`). That
  probably defeats code caching for the 12.5 MB dev / minified prod
  `main.js` as well. Measure before acting on this one.
- media-organizer's `activate` awaits: `ensureDatabase` (29 migrations
  checked), a `.parallx` purge scan with `LIKE '%...%'` over
  `mo_folders` (`main.js:38456`), a scan-roots backfill, and a sync of
  roots to the fs gate.

**Fixes**

- (S) Change the four `"*"` manifests to `onStartupFinished` (plus
  `onCommand:` where needed). Their views still mount; their activation
  stops blocking the overlay.
- (M) Load external modules through a stable URL (a custom protocol or
  the renderer server with ETag), so V8 can cache code. Add ETag or
  `immutable` to the renderer server.

### 4.3 Leaks and listener hygiene

- `renderBrowserSidebar` (`ext/media-organizer/main.js:10394`) adds
  `document` listeners with anonymous arrows for
  `mo:smart-albums-changed` (line 10585) and `mo:clip-projects-changed`
  (line 10648). Its `dispose` (line 11728) cannot remove them. Every
  remount leaks two listeners that keep the old sidebar DOM alive and run
  DB queries on events.
- `_model._api` in workspace-graph is never cleared (§3.1), which keeps
  the refresh loop alive after its views close.
- Every tool's `WorkspaceBridge` (one per tool API, `apiFactory.ts:489`)
  subscribes eagerly to `IFileService.onDidFileChange` and re-maps every
  batch (`workspaceBridge.ts:183-193`), even when the tool never listens.
  With 26 tools that is 26 allocations per fs batch. Subscribe lazily on
  the first `onDidFilesChange` listener. (S)

---

## 5. AI and model calls

### 5.1 The KV/prompt cache is invalidated on every turn (highest per-turn cost)

- `buildRuntimeSection` writes `Current date/time:` **with seconds**
  (`openclawSystemPrompt.ts:663`). It is placed last in the system
  prompt "to keep the prefix stable" (`openclawSystemPrompt.ts:164,
  313-318`).
- But the message order is `[system, ...history, user]`
  (`openclawAttempt.ts:457-461`). The system message comes *before* the
  history, so the changed timestamp invalidates the cached KV for the
  **entire conversation history** on every turn.
- The context engine already moved retrieval late specifically to avoid
  this (`openclawContextEngine.ts:452-460`, HARNESS.md §3.4). The
  timestamp undoes that.
- Cost: a full re-prefill of the history every turn. Time-to-first-token
  grows linearly with chat length. With Anthropic prompt caching, the
  whole history is re-billed.
- Within a turn the prompt is built once, so tool-loop steps still reuse
  the cache. The damage is per turn, not per step.

**Fix (S):** move the `## Runtime` block (or at least the time line) into
the late standing-context user message. Or round the time to the day
(or hour) and let a tool return the precise clock. Keep a byte-stable
system prompt.

### 5.2 Per-turn retrieval runs twice

- `openclawContextEngine.ts:362-372` runs `retrieveContext` and
  `recallMemories` in parallel.
  - `recallMemories` → `canonicalMemorySearchService.search`
    → `retrievalService.retrieve` (`canonicalMemorySearchService.ts:~48`).
    That is a **second `embedQuery` of the same prompt**
    (`retrievalService.ts:183`), a second brute-force vec0 KNN and a
    second FTS query.
  - The KNN over-fetches only 2x for a `sourceFilter`
    (`vectorStoreService.ts:946-949`), then post-filters to
    `.parallx/memory/*`. On any real workspace the top 2K file chunks
    rarely include memory files, so the second retrieval usually returns
    nothing.
  - The code then falls back to reading MEMORY.md and up to 3 daily
    files directly (`chatDataService.ts:1349-1401`).
- MEMORY.md is **already in the system prompt** as a bootstrap file
  (`openclawParticipantRuntime.ts:144-150`). The memory lane adds it
  again as "Durable memory:".
- If transcript recall is enabled (default off,
  `unifiedConfigTypes.ts:570`), `searchWorkspaceTranscripts`
  (`transcriptSearch.ts:29-70`) **reads and renders every transcript in
  full, sequentially, on every turn**, even though the transcripts are in
  the vector index.

**Fixes (S-M)**

- Embed the query once per turn and pass the vector to both lanes, or
  cache by text for a few seconds.
- Filter memory chunks before KNN: use a vec0 metadata or partition
  column (sqlite-vec ≥ 0.1.6), or keep the few memory chunks' vectors in
  memory and score them directly.
- Drop the durable-memory read from the memory lane when bootstrap
  already includes it.
- Serve transcript recall from the index.

### 5.3 Diagnostics poll (GPU residency, eviction risk)

- `diagnostics/main.ts:80-87` runs `runChecks()` at activation and then
  every 30 s. All checks run (`diagnosticsService.ts:36-49`):
  - `checkEmbedding` → `embeddingService.embedQuery('test')`
    (`workbenchServices.ts:415`). This is a real `/api/embed` request,
    sent **outside the broker** and with no `keep_alive`.
  - `listModels` → `/api/tags` directly.
  - `checkProviderStatus` → `/api/version`.
  - `getStats` (2 SQL), `getAllMemories`, a root `readdir`, and
    `exists(AGENTS.md)`.
  - The workbench checks (`workbench.ts:3499`), including the
    keybinding-conflict scan.
- The only consumers are the Diagnostics panel and `/doctor`, which
  runs its own checks (`grep getLastResults` finds no other reader).
- Effect: nomic-embed-text never unloads. When the chat model fills VRAM
  (a big model at large `num_ctx`), Ollama must evict an idle model to
  load the embedder, so the idle chat model can be pushed out and the
  next turn pays a full reload.
- The design doc lists model reloads as the top lag
  (`AGENT_RUNTIME_DESIGN.md` §5). "Co-residence" is not built (§8).

**Fix (S):** run the checks only while the Diagnostics view is visible,
and on `/doctor`. Take the embed probe out of periodic runs, or make it
`/api/show` of the embed model. Reuse `OllamaProvider.getLastStatus()`
and the cached model list.

### 5.4 Proactive Suggestions: costly and unused

- `proactiveSuggestionsService.ts:94-101` schedules an analysis on
  `onDidCompleteInitialIndex` **and on every `onDidUpdateIndex`**, which
  fires on every page or file upsert. There is a 5-minute cooldown
  (line 34) and it is enabled by default (`unifiedConfigTypes.ts:553`).
- Each analysis takes up to 50 pages, with full content
  (`SELECT id, title, content ... LIMIT 50`, line 332). Then:
  - `_findTopicClusters` makes one `embedQuery` + one KNN per unassigned
    page (lines 252-260);
  - `_findOrphans` makes **another** `embedQuery` + KNN per page
    (lines 291-295).
  - The page vectors already exist in `vec_embeddings`.
  - It uses the `search_query:` prefix for document text.
- Output: `chat.getSuggestions`, `chat.dismissSuggestion` and
  `chat.analyzeSuggestions` (`chat/main.ts:3400-3418`). **No code, UI,
  manifest or extension calls them.**

**Fix (S):** default it off, or delete it. If it is kept, use
`getSourceCentroid` (no Ollama) and run it on demand.

### 5.5 MIND prediction loop on every file change (heartbeat off)

- `chat/main.ts:2541-2567`: for every file-change event that passes the
  heartbeat include and exclude filters, which are evaluated **even when
  the heartbeat is disabled**, the code calls
  `heartbeatRunner.pushEvent` (a no-op when disabled) **and**
  `observeForPrediction(uri)`. The latter is gated only on `mindService`
  existing (`chat/main.ts:2282-2289`).
- Per observation:
  - `recordHuman` → `_saveProbe` + `_saveMeter` (`mindService.ts:275-283`):
    2 storage sets;
  - `predictionLoop.observe` → `resolve` → `_store.save` +
    `_ledger.append` (`mindService.ts:376-385`): 2 sets;
  - `predict` → `_store.save` + `_ledger.append`
    (`mindService.ts:365-366`): 2 sets.
- `ActionLedger.append` re-parses the whole ledger (up to 1000 records,
  `actionLedger.ts:116, 137-141`) and re-stringifies it.
- All of this lives in `IWorkspaceStorageService`, which is the
  `FileBackedStorage` for `.parallx/workspace-state.json`
  (`workbench.ts:943, 973`). So **6 full pretty-printed rewrites of
  workspace-state.json per changed file** (§2.6 has no coalescing).
- It is serialised through `_predictChain`. A `git checkout` touching 500
  `.ts` files queues about 3000 whole-file writes.

**Fix (S):** gate the prediction loop on `heartbeat.enabled` (or its own
flag). Dedupe repeated observations of the same path. Coalesce storage
writes (§2.6). Move the ledger and MIND to a DB table, or to their own
file, appended rather than rewritten.

### 5.6 Extension LLM work: priority and cost

- The broker classifies an untagged call as `interactive`
  (`modelEngineBroker.ts:187-195`). Interactive calls stream at once,
  are never queued against each other, and have no output cap
  (lines 225-247, 477-479). Extension calls go through
  `languageModelBridge.sendChatRequest` with options passed through
  (`api/apiFactory.ts:1060-1064`). No extension sets an `engine` tag.
- Batch jobs therefore run as interactive:
  - budget sync (`ext/budget/main.js:6880-7290`);
  - media AI tagging runs (`main.js:30470-30551`, one vision call per
    photo);
  - flashcard generation (11 call sites).
- They preempt routines (fine), but they also compete head-to-head with
  your chat on a one-slot Ollama, and run with no output cap.
- **Budget sync cost per email:**
  - Stage 1 classify always (`main.js:7008`).
  - Stage 2 extract if it is a transaction (`main.js:7040`). This resends
    the same body (up to 3000 chars, `main.js:6671`) under a different
    system prompt, so there is no prefix reuse.
  - Stage 3 categorise per purchase item with no rule match
    (`main.js:7097`).
  - Each call: `format: 'json'`, `numCtx 16384`, and **no maxTokens with
    thinking left on** (`main.js:6430-6448`).
  - With a thinking model at about 500-2000 reasoning tokens per call,
    1-3 calls per email, and 30-50 tok/s, that is about 10-120 s per
    email. A 98-email sync is roughly 15 minutes to 3 hours of GPU time
    (estimate).
  - The default query is `from:chase.com` (`main.js:6437`): highly
    templated alert emails.

**Fixes**

- (S) Add `priority` (and `label`) to the `parallx.lm` options. Make the
  batch runners (budget sync, MO tag runs, flashcard bulk generation)
  pass `'scheduled'` so chat preempts them and the 8K cap applies.
- (M) Budget:
  - merge classify and extract into one schema-constrained call with
    `think:false` (as media tagging already does, `main.js:30545`);
  - run a deterministic pre-pass (subject-template regex for bank alerts,
    a sender allowlist) and send only the leftovers to the model;
  - make rules and a merchant→category memory the first resort before
    Stage 3.

### 5.7 Other model-path notes

- `EmbeddingService._cache` (`embeddingService.ts:77-78`) is an
  **unbounded** `Map<hash, number[]>`, filled by every document batch
  (lines 191-228). It is freed only when the workspace's RAG services are
  disposed. About 6.3 KB per chunk. **Fix (S):** LRU of 5-10K entries.
- `LanguageModelsService._refreshModels` (`languageModelsService.ts:494-501`)
  calls `_modelToProvider.clear()` **before** awaiting `listModels`, and
  has no single-flight guard. During a refresh (triggered by an Ollama
  status flip, a provider registration, or `getModels` with an empty
  cache):
  - `sendChatRequest` / `sendChatRequestForModel` throw "No provider found
    for model";
  - a run's pinned model silently falls back to the active model
    (lines 357-364), which contradicts "runs pin their model".
  **Fix (S):** build the new map and swap it in when done; single-flight
  the refresh.

---

## 6. File watching and indexing

### 6.1 FileService treats every watcher's events as workspace events

- `FileService._handleChangePayload` (`fileService.ts:430-472`) consumes
  every `fs:change` IPC payload. It **does not check that `watchId` is one
  of its own** (`_watchers`).
- media-organizer's per-root recursive watchers (`main.js:3546`) use the
  same channel, so photo-library events (possibly outside the workspace)
  flow into `IFileService.onDidFileChange`. From there they reach the
  indexer, explorer, heartbeat filter, skills watcher, MIND loop and all
  26 tool bridges.
- The indexer accepts `.jpg/.png/...` (`IMAGE_EXTENSIONS`,
  `indexingPipeline.ts:104-106, 1401`). `_toRelativePath` returns the
  absolute path for out-of-workspace files (`indexingPipeline.ts:1457-1472`).
  The result is a `reindexFile` that OCRs the photo when Docling is
  running (`indexingPipeline.ts:1112-1122`), embeds any text, and stores
  it under an absolute `sourceId`. At the next launch
  `_indexAllFiles` **purges every absolute-path entry**
  (`indexingPipeline.ts:955-965`).
- Main-process noise filter: `WATCHER_IGNORE_FILES` covers only
  `workspace-state.json` and `global-storage.json`
  (`main.cjs:2837-2838`). Every SQLite write to `.parallx/data.db-wal`
  and `.parallx/extensions/*/data.db-wal` (`database.cjs:~364-380`)
  produces an `fs:change` batch. Most listeners drop them, but each batch
  is still an IPC message plus a 26-way bridge fan-out.

**Fixes (S)**

- Route by `watchId`: only the workspace watchers feed
  `onDidFileChange`; extensions get their own events.
- Add `*.db-wal`, `*.db-shm`, `*.db-journal` and `*.ndjson` (or the whole
  `.parallx/extensions` and `.parallx/logs`) to the main-process ignore
  list.

### 6.2 The incremental path skips the full walk's rules

- The full walk skips dot-directories, and skips `.parallx/sessions`
  unless transcript indexing is on (`indexingPipeline.ts:1233-1240`).
  `_handleFileChanges` (`indexingPipeline.ts:1395-1430`) checks only the
  extension and `.parallxignore`.
- Every completed chat turn rewrites `.parallx/sessions/<id>.jsonl`
  (§2.6). `.jsonl` is indexable. Five seconds later (`FILE_DEBOUNCE_MS`,
  line 55) the transcript is read, rendered, chunked and embedded.
  - Only new chunks miss the cache; the rest hit it.
  - It is then upserted: a vec aux scan, an FTS scan, and delete plus
    re-insert of **all** of the transcript's chunks.
  - This happens **with transcript indexing off**.
- The transcript chunks then compete for KNN top-K slots before
  `_applyInternalArtifactHygiene` drops them (`retrievalService.ts:279-292`).
  RAG returns fewer of your real documents, and the most similar text to
  your new question is often your own earlier phrasing in a transcript.

**Fix (S):** factor one `shouldIndex(relPath)` predicate covering the
dot-dir rule, the transcript flag, `.parallxignore` and workspace
membership, and use it in both paths.

### 6.3 Launch-time re-extraction

- The mtime fast-skip (`indexingPipeline.ts:975`) compares with
  `indexed_at`. That column is written only when a source is upserted
  (`vectorStoreService.ts:368`).
- Files that return `false` before commit therefore stay candidates
  forever. This covers:
  - hash match (line 1159);
  - empty extracted text (line 1154): photos, scanned PDFs without OCR;
  - over the size cap (line 1135);
  - all chunks failed to embed.
- Each launch re-reads them, and for rich docs and images **re-extracts
  or re-OCRs** them. That includes the batch Docling pre-extraction of
  every digital doc candidate (`indexingPipeline.ts:996-1030`).
- Digital PDFs are extracted twice: a legacy `readDocumentText` "scan
  detection" pre-check (line 1108), then Docling (line 1122).
- The content hash is computed after extraction. A touched-but-unchanged
  PDF pays a full Docling run to find out nothing changed.

**Fixes (S)**

- On skip, upsert `indexing_metadata.indexed_at` (and record a "no text"
  marker).
- Hash the raw bytes (or size + mtime) of rich docs before extracting.
- Use the Docling output's page density for scan detection instead of a
  second extraction.

### 6.4 Semantic graph (background)

Each changed source costs one aux scan for the centroid plus 1 + up to
`SEGMENT_SAMPLE_LIMIT` brute-force KNN queries
(`semanticGraphService.ts:943-990`). After every initial index
completion, once started, `rebuildChangedSources` queues every indexed
source (lines 316-330). It is hash-gated, so a warm reopen is cheap. A
fresh or large index is O(sources × chunks) of DB-worker time, which
§2.1 makes everyone else wait on.

---

## 7. Duplicate systems: canonical choice and what to fold

| Concern | Today | Canonical | Fold / delete |
|---|---|---|---|
| Schedulers | `openclawCronService` (60 s), `workflowService` (60 s), `dashboardRefreshScheduler` (own timers), `plannerReminderScheduler` (60 s), `plannerSyncOrchestrator` (5 min), heartbeat (setTimeout chain), Agents ticks (30 s ×2), media AI-tag queue | **One scheduler service** using `cronScheduleSpec` and the local-time walker in `openclawCronService.ts:1115+`, with job kinds: agent turn, callback, reminder | `dashboardRefreshScheduler.ts:32-52` **re-implements the cron walker and still walks UTC fields**, the bug the cron service fixed ("the original implementation walked UTC fields, so that job fired at 4am US-Central", `openclawCronService.ts:1131-1135`). Dashboard page schedules fire at the wrong local hour. Delete the copy and export `computeNextCronRun`. Fold planner reminders and workflow due-checks into the same 60 s tick (or exact `setTimeout` to the next due time). |
| Cron walkers | 2 (`openclawCronService.computeNextCronRun`, `dashboardRefreshScheduler.computeNextCronMs`) | the cron service's | delete the dashboard copy (correctness) |
| Action and event logs | `activity_log` table (journal), `AutonomyLogService` ring (volatile), `AutonomyEventLog` ndjson day files (rewritten per flush), `ActionLedger` (a JSON string inside `workspace-state.json`), `ObservabilityService`, `AgentTraceService`, budget `sync_log`, media import-log JSON (`main.js:3376-3409`), indexing log (memory) | **`activity_log`** for app and user actions; one `autonomy_events` table in the same DB for agent runs (indexed by day and trigger), with the hash-chain column for the ledger | Move the ndjson and ledger into tables; the rail service becomes a query. Domain logs (budget sync_log, media import log) can stay but should append, not rewrite. |
| Event buses | Platform `Emitter` (canonical); media-organizer uses **`document` CustomEvents**, about 30 `mo:*` types including request/reply pairs (`mo:request-selection`/`mo:reply-selection`); budget module `Set`s (`_syncListeners`, `_ledgerListeners`, `_sectionListeners`); workspace-graph `_model._listeners`; `DatabaseService.onDidWrite` (core only) | `Emitter` + `DatabaseService.onDidWrite` | Give extension DB bridges an `onDidWrite` (table, op) so budget's `notifyLedgerChanged` and media's `mo:refresh-grid` become derived and coalesced; convert `mo:*` to module emitters (removable, typed). |
| Ollama clients and pollers | `OllamaProvider` (health, models, chat), `EmbeddingService` (direct `/api/embed`), the indexing embed worker, flashcards' hardcoded `fetch('http://localhost:11434/api/version')`, Diagnostics (duplicate status and list calls) | `OllamaProvider` for status and models; `EmbeddingService` for embeddings | Diagnostics and flashcards read cached status; flashcards honours the configured base URL. |
| Python detection | `doclingBridge.detectPython` (execSync), `pythonBridge.detectSystemPython` (execFileSync) | `pythonBridge` (async version) | Docling uses it. |
| File watchers | Workspace recursive watcher plus media-organizer per-root recursive watchers, all feeding `IFileService` (no watchId routing) | per-owner routing by watchId | §6.1 |
| Vector stores | core `vec_embeddings`; flashcards keeps its own vec table and embeddings in its extension DB (`ext/flashcards/main.js:2240-2300`) | acceptable for isolation | Leave as is, but share the embedding service and its status. |
| Settings stores | Settings registry + ConfigurationService (bridged, per STANDARDIZATION P1); UnifiedAIConfig presets (global storage) + `.parallx/ai-config.json`; localStorage (keybindings, appearance fast layer); extension tables (`mo_settings`, budget `sync_state`, planner settings) | the registry | Per STANDARDIZATION P1 tail. Add: MIND, ledger and capability state are not settings and should leave `workspace-state.json`. |
| Chat transcripts | SQLite `chat_messages` (delete-all/re-insert per save) + `.jsonl` full rewrite per turn | SQLite | Make the jsonl append-only, or generate it on demand (export, indexing); stop the per-turn rewrite feeding the indexer. |
| Memory | Markdown memory (canonical since M85) + legacy SQLite `conversation_memories` (still swept at startup, `chatDataService.ts:736-738`) | markdown | Retire the legacy store and its eviction sweep. |
| Recents, history | Six recents implementations | per STANDARDIZATION P2 | (already queued) |

---

## 8. Data-correctness risks found along the way

1. **Dashboard cron schedules fire in UTC** (`dashboardRefreshScheduler.ts:32-52`). The duplicated walker missed the local-time fix.
2. **Transcripts are indexed while "transcript indexing" is off** (§6.2). Out-of-workspace media files are indexed under absolute ids, then purged at the next launch (§6.1).
3. **Model map race** (`languageModelsService.ts:494-501`): requests fail and pinned runs switch model during a refresh.
4. **Explorer lost updates** (`explorer/main.ts:1470`): changes during a refresh are dropped.
5. **Budget stale paints:** most ledger listeners have no sequence guard, so an older async refresh can overwrite a newer one (§2.3).
6. **media-organizer leaked listeners** run queries against detached sidebars (§4.3).

---

## 9. Suggested order of work

Each step is small, and they are listed in order of payoff for the
effort.

1. Prompt cache: make the system prompt byte-stable and move the clock
   late (§5.1).
2. Turn the cosmetic and dead pollers off:
   - Diagnostics only while visible (§5.3);
   - Proactive Suggestions off (§5.4);
   - Workspace Graph loop stops at rest and while hidden (§3.1);
   - indexing-log event instead of 1 Hz (§1.1).
3. Gate the MIND prediction loop and coalesce FileBackedStorage writes
   (§5.5, §2.6).
4. Indexing: route by watchId, one `shouldIndex` predicate, bump
   `indexed_at` on skip, add the WAL/ndjson ignore entries (§6.1-6.3).
5. Startup: async, cached Docling detection with a lazy server; `"*"` →
   `onStartupFinished` for the four extensions (§4.1-4.2).
6. Retrieval: one query embedding per turn, a memory lane that does not
   re-run KNN, no double MEMORY.md (§5.2). Bound the embedding cache
   (§5.7).
7. Data layer (M): statement cache and pragmas, rowid-keyed deletes via
   `chunk_metadata`, then split the DB worker (§2.1-2.2).
8. Extensions (M): media bulk delta scan and debounced sidebar; budget
   single-query bills, memoised plan, batched sync; `parallx.lm`
   priority (§2.3-2.4, §5.6).
9. Chat streaming render diffing (§3.2). Visibility service for the
   remaining timers (§1.1).
10. Fold the duplicate schedulers and cron walker; logs into tables
    (§7).
